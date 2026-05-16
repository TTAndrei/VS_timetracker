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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const tracker_1 = require("./tracker");
const statusBar_1 = require("./statusBar");
const pomodoro_1 = require("./pomodoro");
const dashboard_1 = require("./dashboard");
const storage_1 = require("./storage");
let tracker;
let statusBar;
let pomodoro;
function activate(context) {
    tracker = new tracker_1.TimeTracker();
    statusBar = new statusBar_1.StatusBarManager(tracker);
    const cfg = vscode.workspace.getConfiguration('vscodeTracker');
    pomodoro = new pomodoro_1.PomodoroTimer(cfg.get('pomodoroWorkMinutes') ?? 25, cfg.get('pomodoroBreakMinutes') ?? 5);
    context.subscriptions.push(tracker, statusBar, pomodoro, vscode.commands.registerCommand('vscodeTracker.showDashboard', () => {
        (0, dashboard_1.openDashboard)(context);
    }), vscode.commands.registerCommand('vscodeTracker.configureProject', async () => {
        const project = tracker.getCurrentProject();
        const existing = (0, storage_1.getProjectConfig)(project) ?? { project };
        const config = vscode.workspace.getConfiguration('vscodeTracker');
        const globalCurrency = config.get('currency') ?? 'EUR';
        const rateStr = await vscode.window.showInputBox({
            title: `Tasa horaria — "${project}"`,
            value: (existing.hourlyRate ?? config.get('defaultHourlyRate') ?? 0).toString(),
            prompt: `${globalCurrency}/hora (0 = sin coste)`,
            validateInput: v => isNaN(Number(v)) ? 'Introduce un número' : null,
        });
        if (rateStr === undefined)
            return;
        const dailyStr = await vscode.window.showInputBox({
            title: `Meta diaria individual — "${project}"`,
            value: existing.dailyGoal_ms ? (existing.dailyGoal_ms / 3600000).toFixed(1) : '0',
            prompt: 'Horas/día para este proyecto (0 = usar meta global)',
            validateInput: v => isNaN(Number(v)) ? 'Introduce un número' : null,
        });
        if (dailyStr === undefined)
            return;
        const weeklyStr = await vscode.window.showInputBox({
            title: `Meta semanal individual — "${project}"`,
            value: existing.weeklyGoal_ms ? (existing.weeklyGoal_ms / 3600000).toFixed(1) : '0',
            prompt: 'Horas/semana para este proyecto (0 = usar meta global)',
            validateInput: v => isNaN(Number(v)) ? 'Introduce un número' : null,
        });
        if (weeklyStr === undefined)
            return;
        (0, storage_1.saveProjectConfig)({
            ...existing,
            project,
            hourlyRate: Number(rateStr),
            dailyGoal_ms: Number(dailyStr) > 0 ? Number(dailyStr) * 3600000 : undefined,
            weeklyGoal_ms: Number(weeklyStr) > 0 ? Number(weeklyStr) * 3600000 : undefined,
            currency: globalCurrency,
        });
        vscode.window.showInformationMessage(`Proyecto "${project}" configurado.`);
    }), vscode.commands.registerCommand('vscodeTracker.logAIUsage', async () => {
        const knownModels = ['copilot', 'gpt-4o', 'gpt-4', 'gpt-3.5-turbo', 'cursor', 'aider', 'gemini-pro', 'otro...'];
        const config = vscode.workspace.getConfiguration('vscodeTracker');
        const customModels = config.get('aiCustomModels') ?? [];
        const allModels = [...knownModels.slice(0, -1), ...customModels.map(c => c.name), 'otro...'];
        const picked = await vscode.window.showQuickPick(allModels, {
            title: 'Log AI Usage — Modelo',
            placeHolder: 'Selecciona el modelo de IA usado',
        });
        if (!picked)
            return;
        let model = picked;
        if (picked === 'otro...') {
            const custom = await vscode.window.showInputBox({
                title: 'Nombre del modelo',
                prompt: 'Introduce el nombre del modelo (e.g. "mistral-large")',
            });
            if (!custom)
                return;
            model = custom.trim();
        }
        const tokInStr = await vscode.window.showInputBox({
            title: `Log AI — Tokens de entrada (${model})`,
            prompt: 'Número de tokens de entrada/prompt',
            value: '0',
            validateInput: v => isNaN(Number(v)) || Number(v) < 0 ? 'Número ≥ 0' : null,
        });
        if (tokInStr === undefined)
            return;
        const tokOutStr = await vscode.window.showInputBox({
            title: `Log AI — Tokens de salida (${model})`,
            prompt: 'Número de tokens de salida/respuesta',
            value: '0',
            validateInput: v => isNaN(Number(v)) || Number(v) < 0 ? 'Número ≥ 0' : null,
        });
        if (tokOutStr === undefined)
            return;
        const costStr = await vscode.window.showInputBox({
            title: `Log AI — Coste directo en USD (opcional)`,
            prompt: 'Coste total en USD (deja vacío para calcular automáticamente)',
            value: '',
            validateInput: v => v !== '' && isNaN(Number(v)) ? 'Número o vacío' : null,
        });
        if (costStr === undefined)
            return;
        const dateStr = await vscode.window.showInputBox({
            title: 'Log AI — Fecha',
            prompt: 'Fecha en formato YYYY-MM-DD',
            value: new Date().toISOString().substring(0, 10),
            validateInput: v => /^\d{4}-\d{2}-\d{2}$/.test(v) ? null : 'Formato YYYY-MM-DD requerido',
        });
        if (dateStr === undefined)
            return;
        (0, storage_1.appendManualAIEntry)({
            date: dateStr,
            model,
            tokens_in: Number(tokInStr),
            tokens_out: Number(tokOutStr),
            cost_usd_override: costStr.trim() !== '' ? Number(costStr) : undefined,
        });
        vscode.window.showInformationMessage(`Uso de IA registrado: ${model} — ${dateStr}`);
    }), vscode.commands.registerCommand('vscodeTracker.resetToday', () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const segments = (0, storage_1.loadSegments)().filter(s => new Date(s.start) < today);
        fs.writeFileSync((0, storage_1.getLogFilePath)(), JSON.stringify(segments, null, 2));
        vscode.window.showInformationMessage('Stats de hoy eliminados.');
    }), vscode.commands.registerCommand('vscodeTracker.resetAll', async () => {
        const choice = await vscode.window.showWarningMessage('¿Eliminar TODOS los datos de tiempo? Esta acción no se puede deshacer.', { modal: true }, 'Eliminar todo');
        if (choice === 'Eliminar todo') {
            fs.writeFileSync((0, storage_1.getLogFilePath)(), '[]');
            vscode.window.showInformationMessage('Todos los datos eliminados.');
        }
    }), vscode.commands.registerCommand('vscodeTracker.exportCsv', () => {
        const csvPath = (0, storage_1.getLogFilePath)().replace('.json', '.csv');
        fs.writeFileSync(csvPath, (0, storage_1.exportCsv)());
        vscode.window.showInformationMessage(`CSV exportado: ${csvPath}`);
    }), vscode.commands.registerCommand('vscodeTracker.openLog', () => {
        vscode.workspace.openTextDocument((0, storage_1.getLogFilePath)()).then(doc => {
            vscode.window.showTextDocument(doc);
        });
    }), vscode.commands.registerCommand('vscodeTracker.addSessionNote', async () => {
        const tagOptions = ['bug', 'feature', 'refactor', 'meeting', 'review', 'docs', 'devops', 'test'];
        const picked = await vscode.window.showQuickPick(tagOptions.map(t => ({ label: t })), { canPickMany: true, placeHolder: 'Selecciona tags para la última sesión (opcional)' });
        if (picked === undefined)
            return;
        const notes = await vscode.window.showInputBox({
            placeHolder: 'Notas de sesión (opcional)',
            prompt: '¿En qué trabajaste? Describe la sesión'
        });
        if (notes === undefined)
            return;
        const tags = picked.map(p => p.label);
        (0, storage_1.updateLastSegmentMeta)(notes ?? '', tags);
        vscode.window.showInformationMessage('Nota de sesión guardada.');
    }), vscode.commands.registerCommand('vscodeTracker.exportJson', async () => {
        const defaultUri = vscode.Uri.file('time-tracker-export.json');
        const uri = await vscode.window.showSaveDialog({
            filters: { 'JSON': ['json'] },
            defaultUri,
        });
        if (!uri)
            return;
        const segments = (0, storage_1.loadSegments)();
        await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(segments, null, 2)));
        vscode.window.showInformationMessage(`JSON exportado: ${segments.length} sesiones → ${uri.fsPath}`);
    }), vscode.commands.registerCommand('vscodeTracker.pomodoroStart', () => {
        pomodoro.start(tracker.getCurrentProject(), tracker.getCurrentPath());
    }), vscode.commands.registerCommand('vscodeTracker.pomodoroSkip', () => {
        pomodoro.skip();
    }), vscode.commands.registerCommand('vscodeTracker.pomodoroStop', () => {
        pomodoro.stop();
    }));
}
function deactivate() {
    if (tracker)
        tracker.dispose();
    if (statusBar)
        statusBar.dispose();
}
