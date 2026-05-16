import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';

export interface Segment {
  project: string;
  projectPath: string;
  start: string;  // ISO8601
  end: string;    // ISO8601
  duration_ms: number;
  language?: string;                   // dominant file extension this session
  languages?: Record<string, number>;  // extension -> ms breakdown
  notes?: string;
  tags?: string[];
  pomodoroCount?: number;
  gitBranch?: string;
  gitCommit?: string;
}

export interface PomodoroSession {
  project: string;
  projectPath: string;
  date: string;              // YYYY-MM-DD
  completedPomodoros: number;
  totalWorkMs: number;
}

export interface ProjectConfig {
  project: string;
  hourlyRate?: number;    // €/hr, 0 = not set
  currency?: string;      // "EUR" | "USD" | "GBP"
  dailyGoal_ms?: number;  // per-project optional goal override
  weeklyGoal_ms?: number; // per-project optional goal override
  color?: string;         // hex color assigned to this project
  archived?: boolean;     // hidden from overview, shown in Archived tab
}

export interface ManualAIEntry {
  date: string;            // YYYY-MM-DD
  model: string;           // "copilot", "gpt-4o", "cursor", etc.
  tokens_in: number;
  tokens_out: number;
  cost_usd_override?: number; // optional: user-specified cost instead of computed
}

function getTrackerDir(): string {
  const dir = path.join(os.homedir(), '.vscode-tracker');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getLogFilePath(): string {
  const config = vscode.workspace.getConfiguration('vscodeTracker');
  const customPath = config.get<string>('logFilePath');
  if (customPath && customPath.length > 0) return customPath;
  return path.join(getTrackerDir(), 'logs.json');
}

function getProjectConfigPath(): string {
  return path.join(getTrackerDir(), 'projects.json');
}

function getManualAIPath(): string {
  return path.join(getTrackerDir(), 'ai-manual.json');
}

// Day bucket keyed by the user's LOCAL calendar date, not UTC. Mixing UTC
// (toISOString) with local midnight put post-midnight work in the wrong day.
export function localDay(d: Date | string): string {
  const dt = typeof d === 'string' ? new Date(d) : d;
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseLocalDay(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// A session that spans local midnight must be attributed per calendar day,
// otherwise its whole duration lands on a single day's bar and disagrees
// with the per-day card. Splits [start,end] into one interval per local day.
export function splitByLocalDay(
  start: Date | string,
  end: Date | string
): Array<{ start: string; end: string; duration_ms: number }> {
  const s = typeof start === 'string' ? new Date(start) : new Date(start.getTime());
  const e = typeof end === 'string' ? new Date(end) : new Date(end.getTime());
  const parts: Array<{ start: string; end: string; duration_ms: number }> = [];
  let cur = s;
  while (localDay(cur) !== localDay(e)) {
    const nextMidnight = new Date(
      cur.getFullYear(), cur.getMonth(), cur.getDate() + 1, 0, 0, 0, 0
    );
    parts.push({
      start: cur.toISOString(),
      end: nextMidnight.toISOString(),
      duration_ms: nextMidnight.getTime() - cur.getTime(),
    });
    cur = nextMidnight;
  }
  parts.push({
    start: cur.toISOString(),
    end: e.toISOString(),
    duration_ms: e.getTime() - cur.getTime(),
  });
  return parts;
}

export function writeFileAtomic(filePath: string, data: string): void {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, filePath);
}

export function loadSegments(): Segment[] {
  const filePath = getLogFilePath();
  if (!fs.existsSync(filePath)) return [];
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Segment[];
  } catch {
    return [];
  }
}

export function appendSegment(segment: Segment): void {
  const segments = loadSegments();
  segments.push(segment);
  writeFileAtomic(getLogFilePath(), JSON.stringify(segments, null, 2));
}

export function loadProjectConfigs(): ProjectConfig[] {
  const p = getProjectConfigPath();
  if (!fs.existsSync(p)) return [];
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as ProjectConfig[];
  } catch {
    return [];
  }
}

export function saveProjectConfig(cfg: ProjectConfig): void {
  const configs = loadProjectConfigs().filter(c => c.project !== cfg.project);
  configs.push(cfg);
  writeFileAtomic(getProjectConfigPath(), JSON.stringify(configs, null, 2));
}

export function getProjectConfig(project: string): ProjectConfig | undefined {
  return loadProjectConfigs().find(c => c.project === project);
}

export function loadManualAIEntries(): ManualAIEntry[] {
  const p = getManualAIPath();
  if (!fs.existsSync(p)) return [];
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as ManualAIEntry[];
  } catch {
    return [];
  }
}

export function appendManualAIEntry(entry: ManualAIEntry): void {
  const entries = loadManualAIEntries();
  entries.push(entry);
  writeFileAtomic(getManualAIPath(), JSON.stringify(entries, null, 2));
}

export function exportCsv(): string {
  const segments = loadSegments();
  const lines = ['project,projectPath,start,end,duration_h,language,tags,notes,git_branch,git_commit'];
  for (const s of segments) {
    const dh = (s.duration_ms / 3600000).toFixed(4);
    const tags = (s.tags ?? []).join(';');
    const notes = (s.notes ?? '').replace(/"/g, '""');
    lines.push(`"${s.project}","${s.projectPath}","${s.start}","${s.end}",${dh},"${s.language ?? ''}","${tags}","${notes}","${s.gitBranch ?? ''}","${s.gitCommit ?? ''}"`);
  }
  return lines.join('\n');
}

function getPomodoroPath(): string {
  return path.join(getTrackerDir(), 'pomodoro.json');
}

export function readPomodoro(): PomodoroSession[] {
  const p = getPomodoroPath();
  if (!fs.existsSync(p)) return [];
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as PomodoroSession[];
  } catch {
    return [];
  }
}

export function appendPomodoro(entry: PomodoroSession): void {
  const today = localDay(new Date());
  const sessions = readPomodoro();
  const existing = sessions.find(s => s.date === today && s.project === entry.project);
  if (existing) {
    existing.completedPomodoros += entry.completedPomodoros;
    existing.totalWorkMs += entry.totalWorkMs;
  } else {
    sessions.push(entry);
  }
  writeFileAtomic(getPomodoroPath(), JSON.stringify(sessions, null, 2));
}

export function updateLastSegmentMeta(notes: string, tags: string[], pomodoroCount?: number): void {
  const segments = loadSegments();
  if (segments.length === 0) return;
  const last = segments[segments.length - 1];
  if (notes) last.notes = notes;
  if (tags.length > 0) last.tags = tags;
  if (pomodoroCount !== undefined) last.pomodoroCount = pomodoroCount;
  writeFileAtomic(getLogFilePath(), JSON.stringify(segments, null, 2));
}

export function getTodayTotal(): number {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return loadSegments()
    .filter(s => new Date(s.start) >= today)
    .reduce((acc, s) => acc + s.duration_ms, 0);
}
