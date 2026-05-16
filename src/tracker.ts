import * as vscode from 'vscode';
import * as path from 'path';
import { Segment, appendSegment, getTodayTotal } from './storage';

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
        if (e.focused) this.startSession();
        else this.endSession();
      }),
      vscode.window.onDidChangeActiveTextEditor(editor => {
        this.lastActivity = new Date();
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
      })
    );
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
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
      this.currentProject = folders[0].name;
      this.currentPath = folders[0].uri.fsPath;
    } else {
      this.currentProject = 'No workspace';
      this.currentPath = '';
    }
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
      const segment: Segment = {
        project: this.currentProject,
        projectPath: this.currentPath,
        start: this.sessionStart.toISOString(),
        end: end.toISOString(),
        duration_ms,
        language: dominantLang,
        languages: Object.keys(this.langTime).length > 0 ? { ...this.langTime } : undefined,
      };
      appendSegment(segment);
      this.checkGoalNotification(segment.duration_ms);
      this.checkBreakReminder(segment.duration_ms);
    }
    this.sessionStart = null;
    this.langTime = {};
    this.currentLang = '';
  }

  private checkGoalNotification(savedDuration: number): void {
    const cfg = vscode.workspace.getConfiguration('vscodeTracker');
    const goalMs = (cfg.get<number>('dailyGoalHours') ?? 0) * 3600000;
    if (goalMs <= 0) return;
    const today = new Date().toISOString().substring(0, 10);
    if (this.goalNotifiedDate === today) return;
    const todayTotal = getTodayTotal();
    const prevTotal = todayTotal - savedDuration;
    if (prevTotal < goalMs && todayTotal >= goalMs) {
      this.goalNotifiedDate = today;
      vscode.window.showInformationMessage(
        `🎯 ¡Meta diaria alcanzada! ${(goalMs / 3600000).toFixed(1)}h de código completadas.`
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
        `⏰ Llevas ~${Math.round(this.continuousWorkMs / 3600000 * 10) / 10}h seguidas. Considera tomar un descanso.`
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
      const threshold = (config.get<number>('idleThresholdSeconds') ?? 300) * 1000;
      const idleMs = Date.now() - this.lastActivity.getTime();
      if (idleMs > threshold && this.sessionStart) {
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
