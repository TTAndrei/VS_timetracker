import * as vscode from 'vscode';
import { appendPomodoro, localDay } from './storage';

export class PomodoroTimer implements vscode.Disposable {
  private workMs: number;
  private breakMs: number;
  private phase: 'work' | 'break' | 'idle' = 'idle';
  private phaseStart: Date | null = null;
  private completedThisRun = 0;
  private timer: NodeJS.Timeout | null = null;
  private statusBarItem: vscode.StatusBarItem;
  private currentProject = '';
  private currentPath = '';

  constructor(workMinutes: number, breakMinutes: number) {
    this.workMs = workMinutes * 60 * 1000;
    this.breakMs = breakMinutes * 60 * 1000;
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    this.statusBarItem.command = 'vscodeTracker.pomodoroStart';
    this.statusBarItem.text = '🍅 Pomodoro';
    this.statusBarItem.tooltip = 'Click para iniciar Pomodoro';
    this.statusBarItem.show();
  }

  start(project: string, projectPath: string): void {
    if (this.phase !== 'idle') {
      vscode.window.showInformationMessage('Pomodoro ya activo. Usa "Stop Pomodoro" primero.');
      return;
    }
    this.currentProject = project;
    this.currentPath = projectPath;
    this.completedThisRun = 0;
    this.startPhase('work');
  }

  private startPhase(phase: 'work' | 'break'): void {
    this.phase = phase;
    this.phaseStart = new Date();
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(), 1000);
    this.updateStatusBar();
  }

  private tick(): void {
    if (!this.phaseStart) return;
    const elapsed = Date.now() - this.phaseStart.getTime();
    const total = this.phase === 'work' ? this.workMs : this.breakMs;

    if (elapsed >= total) {
      this.phaseEnd();
    } else {
      this.updateStatusBar();
    }
  }

  private phaseEnd(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }

    if (this.phase === 'work') {
      this.completedThisRun++;
      const today = localDay(new Date());
      appendPomodoro({
        project: this.currentProject,
        projectPath: this.currentPath,
        date: today,
        completedPomodoros: 1,
        totalWorkMs: this.workMs,
      });
      vscode.window.showInformationMessage(
        `🍅 Pomodoro completo! (${this.completedThisRun} hoy en ${this.currentProject}). Descansa ${Math.round(this.breakMs / 60000)} min.`,
        'Empezar descanso', 'Parar'
      ).then(choice => {
        if (choice === 'Empezar descanso') this.startPhase('break');
        else this.resetIdle();
      });
    } else {
      vscode.window.showInformationMessage(
        '☕ Descanso terminado. ¿Otro pomodoro?',
        'Empezar', 'Parar'
      ).then(choice => {
        if (choice === 'Empezar') this.startPhase('work');
        else this.resetIdle();
      });
    }
  }

  skip(): void {
    if (this.phase === 'idle') return;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.phaseEnd();
  }

  stop(): void {
    this.resetIdle();
    vscode.window.showInformationMessage('Pomodoro detenido.');
  }

  private resetIdle(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.phase = 'idle';
    this.phaseStart = null;
    this.updateStatusBar();
  }

  getCompletedToday(project: string): number {
    const { readPomodoro } = require('./storage');
    const today = localDay(new Date());
    return (readPomodoro() as import('./storage').PomodoroSession[])
      .filter(s => s.date === today && s.project === project)
      .reduce((acc, s) => acc + s.completedPomodoros, 0);
  }

  private updateStatusBar(): void {
    if (this.phase === 'idle') {
      this.statusBarItem.text = '🍅 Pomodoro';
      this.statusBarItem.tooltip = 'Click para iniciar Pomodoro';
      this.statusBarItem.command = 'vscodeTracker.pomodoroStart';
      return;
    }
    if (!this.phaseStart) return;
    const elapsed = Date.now() - this.phaseStart.getTime();
    const total = this.phase === 'work' ? this.workMs : this.breakMs;
    const remaining = Math.max(0, total - elapsed);
    const m = Math.floor(remaining / 60000);
    const s = Math.floor((remaining % 60000) / 1000);
    const mm = String(m).padStart(2, '0');
    const ss = String(s).padStart(2, '0');
    this.statusBarItem.command = 'vscodeTracker.pomodoroStop';
    if (this.phase === 'work') {
      this.statusBarItem.text = `$(stop-circle) ${mm}:${ss} 🍅`;
      this.statusBarItem.tooltip = `Pomodoro — ${this.currentProject} | Click para detener`;
    } else {
      this.statusBarItem.text = `$(coffee) ${mm}:${ss} ☕`;
      this.statusBarItem.tooltip = `Descanso | Click para detener`;
    }
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.statusBarItem.dispose();
  }
}
