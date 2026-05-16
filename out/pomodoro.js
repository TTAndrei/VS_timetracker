"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.PomodoroTimer = void 0;
const vscode = __importStar(require("vscode"));
const storage_1 = require("./storage");
class PomodoroTimer {
    constructor(workMinutes, breakMinutes) {
        this.phase = 'idle';
        this.phaseStart = null;
        this.completedThisRun = 0;
        this.timer = null;
        this.currentProject = '';
        this.currentPath = '';
        this.workMs = workMinutes * 60 * 1000;
        this.breakMs = breakMinutes * 60 * 1000;
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
        this.statusBarItem.command = 'vscodeTracker.pomodoroStop';
        this.statusBarItem.text = '$(clock) Pomodoro';
        this.statusBarItem.tooltip = 'Click para detener | vscodeTracker.pomodoroStart para iniciar';
        this.statusBarItem.show();
    }
    start(project, projectPath) {
        if (this.phase !== 'idle') {
            vscode.window.showInformationMessage('Pomodoro ya activo. Usa "Stop Pomodoro" primero.');
            return;
        }
        this.currentProject = project;
        this.currentPath = projectPath;
        this.completedThisRun = 0;
        this.startPhase('work');
    }
    startPhase(phase) {
        this.phase = phase;
        this.phaseStart = new Date();
        if (this.timer)
            clearInterval(this.timer);
        this.timer = setInterval(() => this.tick(), 1000);
        this.updateStatusBar();
    }
    tick() {
        if (!this.phaseStart)
            return;
        const elapsed = Date.now() - this.phaseStart.getTime();
        const total = this.phase === 'work' ? this.workMs : this.breakMs;
        if (elapsed >= total) {
            this.phaseEnd();
        }
        else {
            this.updateStatusBar();
        }
    }
    phaseEnd() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        if (this.phase === 'work') {
            this.completedThisRun++;
            const today = new Date().toISOString().substring(0, 10);
            (0, storage_1.appendPomodoro)({
                project: this.currentProject,
                projectPath: this.currentPath,
                date: today,
                completedPomodoros: 1,
                totalWorkMs: this.workMs,
            });
            vscode.window.showInformationMessage(`🍅 Pomodoro completo! (${this.completedThisRun} hoy en ${this.currentProject}). Descansa ${Math.round(this.breakMs / 60000)} min.`, 'Empezar descanso', 'Parar').then(choice => {
                if (choice === 'Empezar descanso')
                    this.startPhase('break');
                else
                    this.resetIdle();
            });
        }
        else {
            vscode.window.showInformationMessage('☕ Descanso terminado. ¿Otro pomodoro?', 'Empezar', 'Parar').then(choice => {
                if (choice === 'Empezar')
                    this.startPhase('work');
                else
                    this.resetIdle();
            });
        }
    }
    skip() {
        if (this.phase === 'idle')
            return;
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        this.phaseEnd();
    }
    stop() {
        this.resetIdle();
        vscode.window.showInformationMessage('Pomodoro detenido.');
    }
    resetIdle() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        this.phase = 'idle';
        this.phaseStart = null;
        this.updateStatusBar();
    }
    getCompletedToday(project) {
        const { readPomodoro } = require('./storage');
        const today = new Date().toISOString().substring(0, 10);
        return readPomodoro()
            .filter(s => s.date === today && s.project === project)
            .reduce((acc, s) => acc + s.completedPomodoros, 0);
    }
    updateStatusBar() {
        if (this.phase === 'idle') {
            this.statusBarItem.text = '$(clock) Pomodoro';
            this.statusBarItem.tooltip = 'Iniciar: vscodeTracker.pomodoroStart';
            return;
        }
        if (!this.phaseStart)
            return;
        const elapsed = Date.now() - this.phaseStart.getTime();
        const total = this.phase === 'work' ? this.workMs : this.breakMs;
        const remaining = Math.max(0, total - elapsed);
        const m = Math.floor(remaining / 60000);
        const s = Math.floor((remaining % 60000) / 1000);
        const mm = String(m).padStart(2, '0');
        const ss = String(s).padStart(2, '0');
        if (this.phase === 'work') {
            this.statusBarItem.text = `$(stop-circle) ${mm}:${ss} 🍅`;
            this.statusBarItem.tooltip = `Pomodoro — ${this.currentProject} | Click para detener`;
        }
        else {
            this.statusBarItem.text = `$(coffee) ${mm}:${ss} ☕`;
            this.statusBarItem.tooltip = `Descanso | Click para detener`;
        }
    }
    dispose() {
        if (this.timer)
            clearInterval(this.timer);
        this.statusBarItem.dispose();
    }
}
exports.PomodoroTimer = PomodoroTimer;
