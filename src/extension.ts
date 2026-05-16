import * as vscode from 'vscode';
import { TimeTracker } from './tracker';
import { StatusBarManager } from './statusBar';
import { PomodoroTimer } from './pomodoro';
import { openDashboard } from './dashboard';
import {
  getLogFilePath, exportCsv, loadSegments,
  getProjectConfig, saveProjectConfig, appendManualAIEntry,
  updateLastSegmentMeta, writeFileAtomic, localDay
} from './storage';

let tracker: TimeTracker;
let statusBar: StatusBarManager;
let pomodoro: PomodoroTimer;
let output: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel('TT-TimeTracker');
  context.subscriptions.push(output);

  try {
  tracker = new TimeTracker();
  statusBar = new StatusBarManager(tracker);
  const cfg = vscode.workspace.getConfiguration('vscodeTracker');
  pomodoro = new PomodoroTimer(
    cfg.get<number>('pomodoroWorkMinutes') ?? 25,
    cfg.get<number>('pomodoroBreakMinutes') ?? 5
  );

  context.subscriptions.push(
    tracker,
    statusBar,
    pomodoro,

    vscode.commands.registerCommand('vscodeTracker.showDashboard', () => {
      openDashboard(context, tracker);
    }),

    vscode.commands.registerCommand('vscodeTracker.configureProject', async () => {
      const project = tracker.getCurrentProject();
      const existing: import('./storage').ProjectConfig = getProjectConfig(project) ?? { project };
      const config = vscode.workspace.getConfiguration('vscodeTracker');
      const globalCurrency = config.get<string>('currency') ?? 'EUR';

      const rateStr = await vscode.window.showInputBox({
        title: `Tasa horaria — "${project}"`,
        value: (existing.hourlyRate ?? config.get<number>('defaultHourlyRate') ?? 0).toString(),
        prompt: `${globalCurrency}/hora (0 = sin coste)`,
        validateInput: v => isNaN(Number(v)) ? 'Introduce un número' : null,
      });
      if (rateStr === undefined) return;

      const dailyStr = await vscode.window.showInputBox({
        title: `Meta diaria individual — "${project}"`,
        value: existing.dailyGoal_ms ? (existing.dailyGoal_ms / 3600000).toFixed(1) : '0',
        prompt: 'Horas/día para este proyecto (0 = usar meta global)',
        validateInput: v => isNaN(Number(v)) ? 'Introduce un número' : null,
      });
      if (dailyStr === undefined) return;

      const weeklyStr = await vscode.window.showInputBox({
        title: `Meta semanal individual — "${project}"`,
        value: existing.weeklyGoal_ms ? (existing.weeklyGoal_ms / 3600000).toFixed(1) : '0',
        prompt: 'Horas/semana para este proyecto (0 = usar meta global)',
        validateInput: v => isNaN(Number(v)) ? 'Introduce un número' : null,
      });
      if (weeklyStr === undefined) return;

      saveProjectConfig({
        ...existing,
        project,
        hourlyRate: Number(rateStr),
        dailyGoal_ms: Number(dailyStr) > 0 ? Number(dailyStr) * 3600000 : undefined,
        weeklyGoal_ms: Number(weeklyStr) > 0 ? Number(weeklyStr) * 3600000 : undefined,
        currency: globalCurrency,
      });
      vscode.window.showInformationMessage(`Proyecto "${project}" configurado.`);
    }),

    vscode.commands.registerCommand('vscodeTracker.logAIUsage', async () => {
      const knownModels = ['copilot', 'gpt-4o', 'gpt-4', 'gpt-3.5-turbo', 'cursor', 'aider', 'gemini-pro', 'otro...'];
      const config = vscode.workspace.getConfiguration('vscodeTracker');
      const customModels = config.get<Array<{ name: string }>>('aiCustomModels') ?? [];
      const allModels = [...knownModels.slice(0, -1), ...customModels.map(c => c.name), 'otro...'];

      const picked = await vscode.window.showQuickPick(allModels, {
        title: 'Log AI Usage — Modelo',
        placeHolder: 'Selecciona el modelo de IA usado',
      });
      if (!picked) return;

      let model = picked;
      if (picked === 'otro...') {
        const custom = await vscode.window.showInputBox({
          title: 'Nombre del modelo',
          prompt: 'Introduce el nombre del modelo (e.g. "mistral-large")',
        });
        if (!custom) return;
        model = custom.trim();
      }

      const tokInStr = await vscode.window.showInputBox({
        title: `Log AI — Tokens de entrada (${model})`,
        prompt: 'Número de tokens de entrada/prompt',
        value: '0',
        validateInput: v => isNaN(Number(v)) || Number(v) < 0 ? 'Número ≥ 0' : null,
      });
      if (tokInStr === undefined) return;

      const tokOutStr = await vscode.window.showInputBox({
        title: `Log AI — Tokens de salida (${model})`,
        prompt: 'Número de tokens de salida/respuesta',
        value: '0',
        validateInput: v => isNaN(Number(v)) || Number(v) < 0 ? 'Número ≥ 0' : null,
      });
      if (tokOutStr === undefined) return;

      const costStr = await vscode.window.showInputBox({
        title: `Log AI — Coste directo en USD (opcional)`,
        prompt: 'Coste total en USD (deja vacío para calcular automáticamente)',
        value: '',
        validateInput: v => v !== '' && isNaN(Number(v)) ? 'Número o vacío' : null,
      });
      if (costStr === undefined) return;

      const dateStr = await vscode.window.showInputBox({
        title: 'Log AI — Fecha',
        prompt: 'Fecha en formato YYYY-MM-DD',
        value: localDay(new Date()),
        validateInput: v => /^\d{4}-\d{2}-\d{2}$/.test(v) ? null : 'Formato YYYY-MM-DD requerido',
      });
      if (dateStr === undefined) return;

      appendManualAIEntry({
        date: dateStr,
        model,
        tokens_in: Number(tokInStr),
        tokens_out: Number(tokOutStr),
        cost_usd_override: costStr.trim() !== '' ? Number(costStr) : undefined,
      });
      vscode.window.showInformationMessage(`Uso de IA registrado: ${model} — ${dateStr}`);
    }),

    vscode.commands.registerCommand('vscodeTracker.resetToday', () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const segments = loadSegments().filter(s => new Date(s.start) < today);
      writeFileAtomic(getLogFilePath(), JSON.stringify(segments, null, 2));
      vscode.window.showInformationMessage('Stats de hoy eliminados.');
    }),

    vscode.commands.registerCommand('vscodeTracker.resetAll', async () => {
      const choice = await vscode.window.showWarningMessage(
        '¿Eliminar TODOS los datos de tiempo? Esta acción no se puede deshacer.',
        { modal: true },
        'Eliminar todo'
      );
      if (choice === 'Eliminar todo') {
        writeFileAtomic(getLogFilePath(), '[]');
        vscode.window.showInformationMessage('Todos los datos eliminados.');
      }
    }),

    vscode.commands.registerCommand('vscodeTracker.exportCsv', () => {
      const csvPath = getLogFilePath().replace('.json', '.csv');
      writeFileAtomic(csvPath, exportCsv());
      vscode.window.showInformationMessage(`CSV exportado: ${csvPath}`);
    }),

    vscode.commands.registerCommand('vscodeTracker.openLog', () => {
      vscode.workspace.openTextDocument(getLogFilePath()).then(doc => {
        vscode.window.showTextDocument(doc);
      });
    }),

    vscode.commands.registerCommand('vscodeTracker.addSessionNote', async () => {
      const tagOptions = ['bug', 'feature', 'refactor', 'meeting', 'review', 'docs', 'devops', 'test'];
      const picked = await vscode.window.showQuickPick(
        tagOptions.map(t => ({ label: t })),
        { canPickMany: true, placeHolder: 'Selecciona tags para la última sesión (opcional)' }
      );
      if (picked === undefined) return;
      const notes = await vscode.window.showInputBox({
        placeHolder: 'Notas de sesión (opcional)',
        prompt: '¿En qué trabajaste? Describe la sesión'
      });
      if (notes === undefined) return;
      const tags = picked.map(p => p.label);
      updateLastSegmentMeta(notes ?? '', tags);
      vscode.window.showInformationMessage('Nota de sesión guardada.');
    }),

    vscode.commands.registerCommand('vscodeTracker.exportJson', async () => {
      const defaultUri = vscode.Uri.file('time-tracker-export.json');
      const uri = await vscode.window.showSaveDialog({
        filters: { 'JSON': ['json'] },
        defaultUri,
      });
      if (!uri) return;
      const segments = loadSegments();
      await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(segments, null, 2)));
      vscode.window.showInformationMessage(`JSON exportado: ${segments.length} sesiones → ${uri.fsPath}`);
    }),

    vscode.commands.registerCommand('vscodeTracker.pomodoroStart', () => {
      pomodoro.start(tracker.getCurrentProject(), tracker.getCurrentPath());
    }),

    vscode.commands.registerCommand('vscodeTracker.pomodoroSkip', () => {
      pomodoro.skip();
    }),

    vscode.commands.registerCommand('vscodeTracker.pomodoroStop', () => {
      pomodoro.stop();
    }),

    vscode.commands.registerCommand('vscodeTracker.toggleLanguage', async () => {
      const config = vscode.workspace.getConfiguration('vscodeTracker');
      const current = config.get<string>('language') ?? 'auto';
      const items: Array<vscode.QuickPickItem & { value: string }> = [
        { label: 'Auto', description: 'Sigue el idioma de VS Code', value: 'auto' },
        { label: 'English', value: 'en' },
        { label: 'Español', value: 'es' },
      ];
      const picked = await vscode.window.showQuickPick(
        items.map(i => ({ ...i, picked: i.value === current })),
        { title: 'Dashboard language / Idioma del panel', placeHolder: `Actual: ${current}` }
      );
      if (!picked) return;
      await config.update('language', picked.value, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(
        `Idioma: ${picked.label}. Reabre el dashboard o pulsa ↻ para aplicar.`
      );
    })
  );
  } catch (err) {
    const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
    output.appendLine('[activate] ' + msg);
    vscode.window.showErrorMessage(
      'TT-TimeTracker failed to activate: ' +
      (err instanceof Error ? err.message : String(err)) +
      ' (see Output > TT-TimeTracker)'
    );
  }
}

export function deactivate(): void {
  if (tracker) tracker.dispose();
  if (statusBar) statusBar.dispose();
}
