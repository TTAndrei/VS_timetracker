import * as vscode from 'vscode';
import { TimeTracker } from './tracker';

export class StatusBarManager implements vscode.Disposable {
  private statusBarItem: vscode.StatusBarItem;
  private noteItem: vscode.StatusBarItem;
  private updateTimer: NodeJS.Timeout;

  constructor(private tracker: TimeTracker) {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );
    this.statusBarItem.command = 'vscodeTracker.showDashboard';
    this.statusBarItem.show();

    // Sits just after the Pomodoro item (priority 50) → bottom-left cluster.
    this.noteItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      49
    );
    this.noteItem.command = 'vscodeTracker.addSessionNote';
    this.noteItem.text = '$(note)';
    this.noteItem.tooltip = 'Añadir nota a la última sesión';
    this.noteItem.show();

    this.updateDisplay();
    this.updateTimer = setInterval(() => this.updateDisplay(), 1000);
  }

  private formatDuration(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  }

  updateDisplay(): void {
    const project = this.tracker.getCurrentProject();
    const duration = this.tracker.getSessionDuration();
    const durationText = duration > 0 ? `  ${this.formatDuration(duration)}` : '';
    this.statusBarItem.text = `$(clock) ${project}${durationText}`;
    this.statusBarItem.tooltip = `VS Code Time Tracker - Click to open dashboard`;
  }

  dispose(): void {
    clearInterval(this.updateTimer);
    this.statusBarItem.dispose();
    this.noteItem.dispose();
  }
}
