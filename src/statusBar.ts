import * as vscode from 'vscode';
import { TimeTracker } from './tracker';

export class StatusBarManager implements vscode.Disposable {
  private statusBarItem: vscode.StatusBarItem;
  private updateTimer: NodeJS.Timeout;

  constructor(private tracker: TimeTracker) {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );
    this.statusBarItem.command = 'vscodeTracker.showDashboard';
    this.statusBarItem.show();
    this.updateDisplay();
    this.updateTimer = setInterval(() => this.updateDisplay(), 60000);
  }

  private formatDuration(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }

  updateDisplay(): void {
    const project = this.tracker.getCurrentProject();
    const duration = this.tracker.getSessionDuration();
    const durationText = duration > 60000 ? `  ${this.formatDuration(duration)}` : '';
    this.statusBarItem.text = `$(clock) ${project}${durationText}`;
    this.statusBarItem.tooltip = `VS Code Time Tracker - Click to open dashboard`;
  }

  dispose(): void {
    clearInterval(this.updateTimer);
    this.statusBarItem.dispose();
  }
}
