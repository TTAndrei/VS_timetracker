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
exports.TimeTracker = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const storage_1 = require("./storage");
class TimeTracker {
    constructor() {
        this.sessionStart = null;
        this.currentProject = '';
        this.currentPath = '';
        this.lastActivity = new Date();
        this.idleTimer = null;
        this.disposables = [];
        this.goalNotifiedDate = ''; // YYYY-MM-DD, avoid repeat daily
        this.continuousWorkMs = 0; // accumulated since last long break
        this.breakReminderFired = false; // reset when continuousWorkMs resets
        this.langTime = {};
        this.currentLang = '';
        this.lastLangSwitch = new Date();
        this.disposables.push(vscode.window.onDidChangeWindowState(e => {
            if (e.focused)
                this.startSession();
            else
                this.endSession();
        }), vscode.window.onDidChangeActiveTextEditor(editor => {
            this.lastActivity = new Date();
            this.recordLangSwitch(editor);
            if (!this.sessionStart)
                this.startSession();
        }), vscode.workspace.onDidChangeTextDocument(() => {
            this.lastActivity = new Date();
        }), vscode.workspace.onDidChangeWorkspaceFolders(() => {
            this.endSession();
            this.updateCurrentProject();
            this.startSession();
        }));
        this.updateCurrentProject();
        this.startSession();
        this.startIdleTimer();
    }
    recordLangSwitch(editor) {
        const config = vscode.workspace.getConfiguration('vscodeTracker');
        if (!config.get('enableLanguageTracking', true))
            return;
        const now = new Date();
        if (this.currentLang && this.sessionStart) {
            const elapsed = now.getTime() - this.lastLangSwitch.getTime();
            this.langTime[this.currentLang] = (this.langTime[this.currentLang] ?? 0) + elapsed;
        }
        this.lastLangSwitch = now;
        if (editor) {
            const ext = path.extname(editor.document.fileName).slice(1).toLowerCase();
            this.currentLang = ext || 'other';
        }
        else {
            this.currentLang = '';
        }
    }
    updateCurrentProject() {
        const folders = vscode.workspace.workspaceFolders;
        if (folders && folders.length > 0) {
            this.currentProject = folders[0].name;
            this.currentPath = folders[0].uri.fsPath;
        }
        else {
            this.currentProject = 'No workspace';
            this.currentPath = '';
        }
    }
    startSession() {
        if (this.sessionStart)
            return;
        this.updateCurrentProject();
        this.sessionStart = new Date();
        this.langTime = {};
        this.currentLang = '';
        this.lastLangSwitch = new Date();
        // capture currently open editor
        this.recordLangSwitch(vscode.window.activeTextEditor);
    }
    endSession() {
        if (!this.sessionStart)
            return;
        // flush current lang time
        if (this.currentLang) {
            const elapsed = Date.now() - this.lastLangSwitch.getTime();
            this.langTime[this.currentLang] = (this.langTime[this.currentLang] ?? 0) + elapsed;
        }
        const end = new Date();
        const duration_ms = end.getTime() - this.sessionStart.getTime();
        if (duration_ms > 1000) {
            const dominantLang = Object.entries(this.langTime).sort((a, b) => b[1] - a[1])[0]?.[0];
            const segment = {
                project: this.currentProject,
                projectPath: this.currentPath,
                start: this.sessionStart.toISOString(),
                end: end.toISOString(),
                duration_ms,
                language: dominantLang,
                languages: Object.keys(this.langTime).length > 0 ? { ...this.langTime } : undefined,
            };
            (0, storage_1.appendSegment)(segment);
            this.checkGoalNotification(segment.duration_ms);
            this.checkBreakReminder(segment.duration_ms);
        }
        this.sessionStart = null;
        this.langTime = {};
        this.currentLang = '';
    }
    checkGoalNotification(savedDuration) {
        const cfg = vscode.workspace.getConfiguration('vscodeTracker');
        const goalMs = (cfg.get('dailyGoalHours') ?? 0) * 3600000;
        if (goalMs <= 0)
            return;
        const today = new Date().toISOString().substring(0, 10);
        if (this.goalNotifiedDate === today)
            return;
        const todayTotal = (0, storage_1.getTodayTotal)();
        const prevTotal = todayTotal - savedDuration;
        if (prevTotal < goalMs && todayTotal >= goalMs) {
            this.goalNotifiedDate = today;
            vscode.window.showInformationMessage(`🎯 ¡Meta diaria alcanzada! ${(goalMs / 3600000).toFixed(1)}h de código completadas.`);
        }
    }
    checkBreakReminder(savedDuration) {
        const cfg = vscode.workspace.getConfiguration('vscodeTracker');
        const reminderHours = cfg.get('breakReminderHours') ?? 2;
        if (reminderHours <= 0)
            return;
        const reminderMs = reminderHours * 3600000;
        const idleThresholdMs = (cfg.get('idleThresholdSeconds') ?? 300) * 1000;
        // If the session was ended by idle (very short actual activity), treat as break
        if (savedDuration <= idleThresholdMs * 2) {
            this.continuousWorkMs = 0;
            this.breakReminderFired = false;
            return;
        }
        this.continuousWorkMs += savedDuration;
        if (!this.breakReminderFired && this.continuousWorkMs >= reminderMs) {
            this.breakReminderFired = true;
            vscode.window.showWarningMessage(`⏰ Llevas ~${Math.round(this.continuousWorkMs / 3600000 * 10) / 10}h seguidas. Considera tomar un descanso.`);
        }
    }
    resetContinuousWork() {
        this.continuousWorkMs = 0;
        this.breakReminderFired = false;
    }
    startIdleTimer() {
        this.idleTimer = setInterval(() => {
            const config = vscode.workspace.getConfiguration('vscodeTracker');
            const threshold = (config.get('idleThresholdSeconds') ?? 300) * 1000;
            const idleMs = Date.now() - this.lastActivity.getTime();
            if (idleMs > threshold && this.sessionStart) {
                this.endSession();
            }
        }, 15000);
    }
    getSessionDuration() {
        if (!this.sessionStart)
            return 0;
        return Date.now() - this.sessionStart.getTime();
    }
    getCurrentProject() {
        return this.currentProject;
    }
    getCurrentPath() {
        return this.currentPath;
    }
    dispose() {
        this.endSession();
        if (this.idleTimer)
            clearInterval(this.idleTimer);
        this.disposables.forEach(d => d.dispose());
    }
}
exports.TimeTracker = TimeTracker;
