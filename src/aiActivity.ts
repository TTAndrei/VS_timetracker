import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { appendAIActivity, localDay } from './storage';

// Time-only tracking for AI assistants that do not expose token/cost logs
// (Copilot is seat-priced; opencode is local). We watch the newest mtime of
// each tool's storage dir and accrue elapsed time, capping idle gaps so a
// long pause between interactions is not counted as continuous use.
export class AIActivityTracker implements vscode.Disposable {
  private enabled: boolean;
  private pollMs: number;
  private gapMs: number;
  private sources: Record<string, string[]>;
  private lastMtime: Record<string, number> = {};
  private lastSeen: Record<string, number> = {};
  private timer: NodeJS.Timeout | null = null;

  constructor() {
    const cfg = vscode.workspace.getConfiguration('vscodeTracker');
    this.enabled = cfg.get<boolean>('enableAIActivityTracking') ?? true;
    this.pollMs = (cfg.get<number>('aiActivityPollSeconds') ?? 30) * 1000;
    this.gapMs = (cfg.get<number>('aiActivityIdleGapSeconds') ?? 300) * 1000;
    const overrides = cfg.get<Record<string, string[]>>('aiActivityToolPaths') ?? {};

    const appData = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
    this.sources = {
      copilot: [path.join(appData, 'Code', 'User', 'globalStorage', 'github.copilot-chat')],
      codex: [
        path.join(os.homedir(), '.codex', 'sessions'),
        path.join(os.homedir(), '.codex', 'logs_2.sqlite-wal'),
      ],
      opencode: [
        path.join(os.homedir(), '.local', 'share', 'opencode', 'storage'),
        path.join(os.homedir(), '.opencode'),
      ],
    };
    Object.assign(this.sources, overrides);

    if (this.enabled) {
      this.poll();
      this.timer = setInterval(() => this.poll(), this.pollMs);
    }
  }

  private newestMtime(paths: string[], depth = 0): number {
    let max = 0;
    for (const p of paths) {
      let stat: fs.Stats;
      try {
        if (!fs.existsSync(p)) continue;
        stat = fs.statSync(p);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        if (depth > 3) continue;
        let entries: string[];
        try { entries = fs.readdirSync(p); } catch { continue; }
        const childPaths = entries.map(e => path.join(p, e));
        const m = this.newestMtime(childPaths, depth + 1);
        if (m > max) max = m;
      } else if (stat.mtimeMs > max) {
        max = stat.mtimeMs;
      }
    }
    return max;
  }

  private poll(): void {
    const now = Date.now();
    for (const [tool, paths] of Object.entries(this.sources)) {
      let m: number;
      try { m = this.newestMtime(paths); } catch { continue; }
      if (m === 0) continue;
      const prev = this.lastMtime[tool];
      this.lastMtime[tool] = m;
      if (prev === undefined) {
        this.lastSeen[tool] = now;
        continue;
      }
      if (m > prev) {
        const last = this.lastSeen[tool] ?? now;
        const delta = now - last;
        const credited = delta <= this.gapMs ? delta : this.pollMs;
        appendAIActivity(tool, localDay(new Date()), credited);
        this.lastSeen[tool] = now;
      }
    }
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
