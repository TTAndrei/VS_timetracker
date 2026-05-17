import * as vscode from 'vscode';
import * as path from 'path';
import { execSync } from 'child_process';
import { Segment, appendSegment, getTodayTotal, localDay, splitByLocalDay } from './storage';

export class TimeTracker implements vscode.Disposable {
  private sessionStart: Date | null = null;
  private currentProject: string = '';
  private currentPath: string = '';
  private lastActivity: Date = new Date();
  private idleTimer: NodeJS.Timeout | null = null;
  private disposables: vscode.Disposable[] = [];

  private goalNotifiedDate = '';        // YYYY-MM-DD, avoid repeat daily
  private continuousWorkMs = 0;         // accumulated since last long break
  private breakReminderFired = false;   // reset when continuousWorkMs resets

  private langTime: Record<string, number> = {};
  private currentLang: string = '';
  private lastLangSwitch: Date = new Date();

  constructor() {
    this.disposables.push(
      vscode.window.onDidChangeWindowState(e => {
        if (e.focused) {
          this.lastActivity = new Date();
          this.startSession();
        }
        // Blur must NOT end the session. A brief alt-tab (browser, AI run,
        // docs) would otherwise kill the session and spawn a new one on
        // return, fragmenting time into many false segments. The idle timer
        // ends the session after unfocusedGraceSeconds with no activity.
      }),
      vscode.window.onDidChangeActiveTextEditor(editor => {
        this.lastActivity = new Date();
        const folder = editor ? vscode.workspace.getWorkspaceFolder(editor.document.uri) : undefined;
        if (folder && folder.name !== this.currentProject) {
          this.endSession();
          this.updateCurrentProject();
          this.startSession();
        }
        this.recordLangSwitch(editor);
        if (!this.sessionStart) this.startSession();
      }),
      vscode.workspace.onDidChangeTextDocument(() => {
        this.lastActivity = new Date();
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.endSession();
        this.updateCurrentProject();
        this.startSession();
      }),
    );
    // Proposed API: only usable in extension dev mode / with --enable-proposed-api.
    // Calling it in a normally-installed extension throws, so guard it.
    try {
      const onTerminalData = (vscode.window as any).onDidWriteTerminalData;
      if (typeof onTerminalData === 'function') {
        this.disposables.push(
          onTerminalData(() => {
            this.lastActivity = new Date();
            if (!this.sessionStart) this.startSession();
          })
        );
      }
    } catch {
      // terminalDataWriteEvent proposal unavailable — terminal activity not tracked
    }
    this.updateCurrentProject();
    this.startSession();
    this.startIdleTimer();
  }

  private recordLangSwitch(editor: vscode.TextEditor | undefined): void {
    const config = vscode.workspace.getConfiguration('vscodeTracker');
    if (!config.get<boolean>('enableLanguageTracking', true)) return;

    const now = new Date();
    if (this.currentLang && this.sessionStart) {
      const elapsed = now.getTime() - this.lastLangSwitch.getTime();
      this.langTime[this.currentLang] = (this.langTime[this.currentLang] ?? 0) + elapsed;
    }
    this.lastLangSwitch = now;

    if (editor) {
      const ext = path.extname(editor.document.fileName).slice(1).toLowerCase();
      this.currentLang = ext || 'other';
    } else {
      this.currentLang = '';
    }
  }

  private updateCurrentProject(): void {
    const ed = vscode.window.activeTextEditor;
    const wf = ed ? vscode.workspace.getWorkspaceFolder(ed.document.uri) : undefined;
    const folder = wf ?? vscode.workspace.workspaceFolders?.[0];
    if (folder) {
      this.currentProject = folder.name;
      this.currentPath = folder.uri.fsPath;
    } else {
      this.currentProject = 'No workspace';
      this.currentPath = '';
    }
  }

  private readGit(cwd: string): { branch?: string; commit?: string } {
    const run = (args: string): string | undefined => {
      try {
        return execSync('git ' + args, {
          cwd,
          stdio: ['ignore', 'pipe', 'ignore'],
        }).toString().trim() || undefined;
      } catch {
        return undefined;
      }
    };
    return {
      branch: run('rev-parse --abbrev-ref HEAD'),
      commit: run('rev-parse --short HEAD'),
    };
  }

  private startSession(): void {
    if (this.sessionStart) return;
    this.updateCurrentProject();
    this.sessionStart = new Date();
    this.langTime = {};
    this.currentLang = '';
    this.lastLangSwitch = new Date();
    // capture currently open editor
    this.recordLangSwitch(vscode.window.activeTextEditor);
  }

  endSession(): void {
    if (!this.sessionStart) return;

    // flush current lang time
    if (this.currentLang) {
      const elapsed = Date.now() - this.lastLangSwitch.getTime();
      this.langTime[this.currentLang] = (this.langTime[this.currentLang] ?? 0) + elapsed;
    }

    const end = new Date();
    const duration_ms = end.getTime() - this.sessionStart.getTime();
    if (duration_ms > 1000) {
      const dominantLang = Object.entries(this.langTime).sort((a, b) => b[1] - a[1])[0]?.[0];
      let git: { branch?: string; commit?: string } = {};
      if (this.currentPath) git = this.readGit(this.currentPath);

      const parts = splitByLocalDay(this.sessionStart, end);
      const totalMs = duration_ms;
      parts.forEach((p, idx) => {
        const segment: Segment = {
          project: this.currentProject,
          projectPath: this.currentPath,
          start: p.start,
          end: p.end,
          duration_ms: p.duration_ms,
          language: dominantLang,
          // Keep the per-language breakdown only when the session did not
          // span midnight; splitting it across days would double-count.
          languages: parts.length === 1 && Object.keys(this.langTime).length > 0
            ? { ...this.langTime } : undefined,
        };
        if (git.branch) segment.gitBranch = git.branch;
        if (git.commit) segment.gitCommit = git.commit;
        appendSegment(segment);
      });
      this.checkGoalNotification(totalMs);
      this.checkBreakReminder(totalMs);
    }
    this.sessionStart = null;
    this.langTime = {};
    this.currentLang = '';
  }

  private checkGoalNotification(savedDuration: number): void {
    const cfg = vscode.workspace.getConfiguration('vscodeTracker');
    const goalMs = (cfg.get<number>('dailyGoalHours') ?? 0) * 3600000;
    if (goalMs <= 0) return;
    const today = localDay(new Date());
    if (this.goalNotifiedDate === today) return;
    const todayTotal = getTodayTotal();
    const prevTotal = todayTotal - savedDuration;
    if (prevTotal < goalMs && todayTotal >= goalMs) {
      this.goalNotifiedDate = today;
      vscode.window.showInformationMessage(
        `Meta diaria alcanzada: ${(goalMs / 3600000).toFixed(1)}h de codigo completadas.`
      );
    }
  }

  private checkBreakReminder(savedDuration: number): void {
    const cfg = vscode.workspace.getConfiguration('vscodeTracker');
    const reminderHours = cfg.get<number>('breakReminderHours') ?? 2;
    if (reminderHours <= 0) return;
    const reminderMs = reminderHours * 3600000;
    const idleThresholdMs = (cfg.get<number>('idleThresholdSeconds') ?? 300) * 1000;

    // If the session was ended by idle (very short actual activity), treat as break
    if (savedDuration <= idleThresholdMs * 2) {
      this.continuousWorkMs = 0;
      this.breakReminderFired = false;
      return;
    }

    this.continuousWorkMs += savedDuration;
    if (!this.breakReminderFired && this.continuousWorkMs >= reminderMs) {
      this.breakReminderFired = true;
      vscode.window.showWarningMessage(
        `Llevas ~${Math.round(this.continuousWorkMs / 3600000 * 10) / 10}h seguidas. Considera tomar un descanso.`
      );
    }
  }

  resetContinuousWork(): void {
    this.continuousWorkMs = 0;
    this.breakReminderFired = false;
  }

  private startIdleTimer(): void {
    this.idleTimer = setInterval(() => {
      const config = vscode.workspace.getConfiguration('vscodeTracker');
      // Single inactivity grace, applied whether the window is focused or not.
      // Real activity (typing, editor/terminal events, regaining focus) keeps
      // lastActivity fresh; the long grace tolerates watching an AI run or
      // reading docs without fragmenting the session. If there is genuinely
      // no activity for the grace period (even with the window focused and
      // the user away), end the session so idle time is not counted.
      const grace = (config.get<number>('unfocusedGraceSeconds') ?? 900) * 1000;
      const idleMs = Date.now() - this.lastActivity.getTime();
      if (idleMs > grace && this.sessionStart) {
        this.endSession();
      }
    }, 15000);
  }

  getSessionDuration(): number {
    if (!this.sessionStart) return 0;
    return Date.now() - this.sessionStart.getTime();
  }

  getCurrentProject(): string {
    return this.currentProject;
  }

  getCurrentPath(): string {
    return this.currentPath;
  }

  dispose(): void {
    this.endSession();
    if (this.idleTimer) clearInterval(this.idleTimer);
    this.disposables.forEach(d => d.dispose());
  }
}
