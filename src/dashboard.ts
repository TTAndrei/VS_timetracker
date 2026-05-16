import * as vscode from 'vscode';
import * as fs from 'fs';
import {
  loadSegments, exportCsv as exportCsvData, getLogFilePath,
  loadProjectConfigs, saveProjectConfig, getProjectConfig,
  readPomodoro,
  Segment, ProjectConfig
} from './storage';
import { loadAISessions, buildAIDailyData, AISession, AIModelUsage, AIStackedDay, CustomModelConfig } from './aiTracker';

// ── Types ──────────────────────────────────────────────────────────────────

interface ProjectStats {
  project: string;
  projectPath: string;
  today_ms: number;
  week_ms: number;
  total_ms: number;
  hourlyRate: number;
  currency: string;
  dailyGoal_ms: number;
  weeklyGoal_ms: number;
  color: string;
}

interface DailyEntry { date: string; ms: number; }
interface LangEntry  { lang: string; ms: number; }

interface StackedDay {
  date: string;
  slices: Array<{ project: string; ms: number; color: string }>;
}

interface SessionRow {
  project: string;
  date: string;
  duration_ms: number;
  tags: string[];
  notes: string;
  pomodoroCount: number;
}

interface DashboardData {
  stats: ProjectStats[];
  archivedStats: ProjectStats[];
  stackedDaily: StackedDay[];
  perProject: Record<string, DailyEntry[]>;
  langsAll: LangEntry[];
  perProjectLangs: Record<string, LangEntry[]>;
  totalToday_ms: number;
  totalWeek_ms: number;
  totalAll_ms: number;
  streak: number;
  dailyGoal_ms: number;
  weeklyGoal_ms: number;
  defaultRate: number;
  currency: string;
  aiSessions: AISession[];
  aiDailyData: AIStackedDay[];
  aiModelStats: AIModelUsage[];
  aiEnabled: boolean;
  allTags: string[];
  pomodoroByProject: Record<string, number>;
  recentSessions: SessionRow[];
  perProjectSessions: Record<string, SessionRow[]>;
}

// ── Palette ────────────────────────────────────────────────────────────────

const PROJECT_PALETTE = [
  '#4fc3f7','#81c784','#ffb74d','#f06292','#ce93d8',
  '#80cbc4','#ff8a65','#a5d6a7','#b39ddb','#fff176',
  '#4db6ac','#f48fb1','#90caf9','#a1887f','#80deea','#dce775'
];

// ── Helpers ────────────────────────────────────────────────────────────────

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmt(ms: number): string {
  if (!ms) return '—';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function fmtCost(ms: number, rate: number, curr: string): string {
  if (!rate) return '';
  const sym: Record<string, string> = { EUR: '€', USD: '$', GBP: '£', CHF: 'CHF ', JPY: '¥' };
  return `${sym[curr] ?? curr}${Math.round(ms / 3600000 * rate)}`;
}

function fmtTok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)}K`;
  return n.toString();
}

// ── Data aggregation ───────────────────────────────────────────────────────

function getDailyBreakdown(segments: Segment[], project?: string): DailyEntry[] {
  const filtered = project ? segments.filter(s => s.project === project) : segments;
  const byDate = new Map<string, number>();
  for (const seg of filtered) {
    const date = seg.start.substring(0, 10);
    byDate.set(date, (byDate.get(date) ?? 0) + seg.duration_ms);
  }
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (byDate.size === 0) {
    const r: DailyEntry[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      r.push({ date: d.toISOString().substring(0, 10), ms: 0 });
    }
    return r;
  }
  const first = new Date(Array.from(byDate.keys()).sort()[0]); first.setHours(0, 0, 0, 0);
  const result: DailyEntry[] = [];
  const cur = new Date(first);
  while (cur <= today) {
    const ds = cur.toISOString().substring(0, 10);
    result.push({ date: ds, ms: byDate.get(ds) ?? 0 });
    cur.setDate(cur.getDate() + 1);
  }
  return result;
}

function buildStackedDaily(segments: Segment[], colorMap: Map<string, string>): StackedDay[] {
  const byDate = new Map<string, Map<string, number>>();
  for (const seg of segments) {
    const date = seg.start.substring(0, 10);
    if (!byDate.has(date)) byDate.set(date, new Map());
    const dm = byDate.get(date)!;
    dm.set(seg.project, (dm.get(seg.project) ?? 0) + seg.duration_ms);
  }
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (byDate.size === 0) {
    const r: StackedDay[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      r.push({ date: d.toISOString().substring(0, 10), slices: [] });
    }
    return r;
  }
  const first = new Date(Array.from(byDate.keys()).sort()[0]); first.setHours(0, 0, 0, 0);
  const result: StackedDay[] = [];
  const cur = new Date(first);
  while (cur <= today) {
    const ds = cur.toISOString().substring(0, 10);
    const dm = byDate.get(ds) ?? new Map();
    const slices = Array.from(dm.entries())
      .filter(([, ms]) => ms > 0)
      .map(([project, ms]) => ({ project, ms, color: colorMap.get(project) ?? '#888888' }))
      .sort((a, b) => b.ms - a.ms);
    result.push({ date: ds, slices });
    cur.setDate(cur.getDate() + 1);
  }
  return result;
}

function getLangBreakdown(segments: Segment[], project?: string): LangEntry[] {
  const filtered = project ? segments.filter(s => s.project === project) : segments;
  const byLang = new Map<string, number>();
  for (const seg of filtered) {
    if (seg.languages) {
      for (const [lang, ms] of Object.entries(seg.languages)) {
        byLang.set(lang, (byLang.get(lang) ?? 0) + ms);
      }
    } else if (seg.language) {
      byLang.set(seg.language, (byLang.get(seg.language) ?? 0) + seg.duration_ms);
    }
  }
  return Array.from(byLang.entries())
    .map(([lang, ms]) => ({ lang, ms }))
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 10);
}

function calcStreak(stackedDaily: StackedDay[]): number {
  const today = new Date().toISOString().substring(0, 10);
  let streak = 0;
  for (let i = stackedDaily.length - 1; i >= 0; i--) {
    const e = stackedDaily[i];
    if (e.date > today) continue;
    const total = e.slices.reduce((s, sl) => s + sl.ms, 0);
    if (total > 0) streak++;
    else if (e.date !== today) break;
  }
  return streak;
}

function buildData(): DashboardData {
  const segments = loadSegments();
  const configs = loadProjectConfigs();
  const cfgMap = new Map<string, ProjectConfig>(configs.map(c => [c.project, c]));
  const vsConfig = vscode.workspace.getConfiguration('vscodeTracker');
  const defaultRate = vsConfig.get<number>('defaultHourlyRate') ?? 0;
  const currency = vsConfig.get<string>('currency') ?? 'EUR';
  const aiEnabled = vsConfig.get<boolean>('enableAITracking') ?? true;
  const customModels = vsConfig.get<CustomModelConfig[]>('aiCustomModels') ?? [];

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());

  const projectSet = new Set(segments.map(s => s.project));

  const usedColors = new Set(configs.map(c => c.color).filter(Boolean));
  const projectList = Array.from(projectSet);
  for (const project of projectList) {
    if (!cfgMap.has(project) || !cfgMap.get(project)!.color) {
      let color = PROJECT_PALETTE.find(c => !usedColors.has(c))
        ?? PROJECT_PALETTE[projectList.indexOf(project) % PROJECT_PALETTE.length];
      usedColors.add(color);
      const existing = cfgMap.get(project) ?? { project };
      const updated: ProjectConfig = { ...existing, project, color };
      cfgMap.set(project, updated);
      saveProjectConfig(updated);
    }
  }

  const colorMap = new Map<string, string>(
    Array.from(cfgMap.entries()).map(([p, cfg]) => [p, cfg.color ?? '#888888'])
  );

  const map = new Map<string, ProjectStats>();
  for (const seg of segments) {
    const segDate = new Date(seg.start);
    if (!map.has(seg.project)) {
      const cfg = cfgMap.get(seg.project);
      map.set(seg.project, {
        project: seg.project,
        projectPath: seg.projectPath ?? '',
        today_ms: 0, week_ms: 0, total_ms: 0,
        hourlyRate: cfg?.hourlyRate ?? defaultRate,
        currency: cfg?.currency ?? currency,
        dailyGoal_ms: cfg?.dailyGoal_ms ?? 0,
        weeklyGoal_ms: cfg?.weeklyGoal_ms ?? 0,
        color: cfg?.color ?? colorMap.get(seg.project) ?? '#888888',
      });
    }
    const s = map.get(seg.project)!;
    s.total_ms += seg.duration_ms;
    if (segDate >= weekStart) s.week_ms += seg.duration_ms;
    if (segDate >= todayStart) s.today_ms += seg.duration_ms;
  }

  const allStats = Array.from(map.values()).sort((a, b) => b.total_ms - a.total_ms);
  const stats = allStats.filter(s => !cfgMap.get(s.project)?.archived);
  const archivedStats = allStats.filter(s => cfgMap.get(s.project)?.archived === true);

  const stackedDaily = buildStackedDaily(segments, colorMap);
  const perProject: Record<string, DailyEntry[]> = {};
  const perProjectLangs: Record<string, LangEntry[]> = {};
  for (const s of allStats) {
    perProject[s.project] = getDailyBreakdown(segments, s.project);
    perProjectLangs[s.project] = getLangBreakdown(segments, s.project);
  }

  const langsAll = getLangBreakdown(segments);
  const streak = calcStreak(stackedDaily);
  const globalDailyGoal = (vsConfig.get<number>('dailyGoalHours') ?? 0) * 3600000;
  const globalWeeklyGoal = (vsConfig.get<number>('weeklyGoalHours') ?? 0) * 3600000;

  let aiSessions: AISession[] = [];
  let aiDailyData: AIStackedDay[] = [];
  let aiModelStats: AIModelUsage[] = [];
  if (aiEnabled) {
    try {
      aiSessions = loadAISessions(customModels);
      aiDailyData = buildAIDailyData(aiSessions);
      const modelAgg = new Map<string, AIModelUsage>();
      for (const session of aiSessions) {
        for (const m of session.models) {
          if (!modelAgg.has(m.model)) {
            modelAgg.set(m.model, { ...m, cost_usd: 0, tokens_in: 0, tokens_out: 0, conversations: 0 });
          }
          const agg = modelAgg.get(m.model)!;
          agg.cost_usd += m.cost_usd;
          agg.tokens_in += m.tokens_in;
          agg.tokens_out += m.tokens_out;
          agg.conversations += m.conversations;
        }
      }
      aiModelStats = Array.from(modelAgg.values()).sort((a, b) => b.cost_usd - a.cost_usd);
    } catch { /* ignore */ }
  }

  const totalAll_ms = allStats.reduce((a, s) => a + s.total_ms, 0);

  // Tags
  const tagSet = new Set<string>();
  for (const seg of segments) {
    if (seg.tags) for (const t of seg.tags) tagSet.add(t);
  }
  const allTags = Array.from(tagSet).sort();

  // Pomodoro by project (today)
  const todayStr = new Date().toISOString().substring(0, 10);
  const pomodoroByProject: Record<string, number> = {};
  try {
    for (const p of readPomodoro().filter(p => p.date === todayStr)) {
      pomodoroByProject[p.project] = (pomodoroByProject[p.project] ?? 0) + p.completedPomodoros;
    }
  } catch { /* ignore */ }

  // Recent sessions (last 50 overall, last 20 per project)
  const toRow = (seg: Segment): SessionRow => ({
    project: seg.project,
    date: seg.start.substring(0, 10),
    duration_ms: seg.duration_ms,
    tags: seg.tags ?? [],
    notes: seg.notes ?? '',
    pomodoroCount: seg.pomodoroCount ?? 0,
  });
  const recentSessions = segments.slice(-50).reverse().map(toRow);
  const perProjectSessions: Record<string, SessionRow[]> = {};
  for (const s of allStats) {
    perProjectSessions[s.project] = segments
      .filter(seg => seg.project === s.project)
      .slice(-20).reverse().map(toRow);
  }

  return {
    stats,
    archivedStats,
    stackedDaily,
    perProject,
    langsAll,
    perProjectLangs,
    totalToday_ms: stats.reduce((a, s) => a + s.today_ms, 0),
    totalWeek_ms:  stats.reduce((a, s) => a + s.week_ms, 0),
    totalAll_ms,
    streak,
    dailyGoal_ms: globalDailyGoal,
    weeklyGoal_ms: globalWeeklyGoal,
    defaultRate,
    currency,
    aiSessions,
    aiDailyData,
    aiModelStats,
    aiEnabled,
    allTags,
    pomodoroByProject,
    recentSessions,
    perProjectSessions,
  };
}

// ── HTML generation ────────────────────────────────────────────────────────

function projectCards(stats: ProjectStats[], totalAll_ms: number, pomodoroByProject: Record<string, number>, isArchived = false): string {
  if (stats.length === 0) {
    return isArchived
      ? '<p class="empty">No hay proyectos archivados.</p>'
      : '<p class="empty">Sin datos aún. Empieza a codear.</p>';
  }
  const totalAll = totalAll_ms || stats.reduce((a, s) => a + s.total_ms, 0) || 1;
  return stats.map((s, i) => {
    const pct = Math.round(s.total_ms / totalAll * 100);
    const cost = fmtCost(s.total_ms, s.hourlyRate, s.currency);
    const todayPct = s.dailyGoal_ms > 0 ? Math.min(100, Math.round(s.today_ms / s.dailyGoal_ms * 100)) : -1;
    const weekPct  = s.weeklyGoal_ms > 0 ? Math.min(100, Math.round(s.week_ms / s.weeklyGoal_ms * 100)) : -1;
    const goalBars = [
      todayPct >= 0 ? `<div class="card-goal-row">
        <div class="goal-label"><span>Meta hoy</span><span>${fmt(s.today_ms)} / ${fmt(s.dailyGoal_ms)} (${todayPct}%)</span></div>
        <div class="goal-bar"><div class="goal-fill ${todayPct >= 100 ? 'done' : ''}" style="width:${todayPct}%"></div></div>
      </div>` : '',
      weekPct >= 0 ? `<div class="card-goal-row">
        <div class="goal-label"><span>Meta semana</span><span>${fmt(s.week_ms)} / ${fmt(s.weeklyGoal_ms)} (${weekPct}%)</span></div>
        <div class="goal-bar"><div class="goal-fill ${weekPct >= 100 ? 'done' : ''}" style="width:${weekPct}%"></div></div>
      </div>` : '',
    ].join('');
    const pomCount = pomodoroByProject[s.project] ?? 0;
    const pomoBadge = pomCount > 0 ? `<span class="pomo-badge" title="${pomCount} pomodoros hoy">🍅${pomCount}</span>` : '';
    const archiveBtn = isArchived
      ? `<div class="archive-btn" onclick="unarchiveProject(${i},event)" title="Desarchivar">↩</div>`
      : `<div class="archive-btn" onclick="archiveProject(${i},event)" title="Archivar proyecto">✓</div>`;
    return `
<div class="card" id="${isArchived ? 'arc-card-' : 'card-'}${i}" onclick="${isArchived ? '' : `showDetail(${i})`}" style="${isArchived ? 'cursor:default;opacity:.8' : ''}">
  <div class="card-top">
    <div class="color-dot" style="background:${escHtml(s.color)}" ${isArchived ? '' : `onclick="openColorPicker(${i},event)" title="Cambiar color"`}></div>
    <span class="card-name">${escHtml(s.project)}</span>
    <div style="display:flex;gap:5px;align-items:center">
      ${cost ? `<span class="card-cost">${cost}</span>` : ''}
      ${pomoBadge}
      <span class="card-pct">${pct}%</span>
      ${archiveBtn}
    </div>
  </div>
  <div class="card-path">${escHtml(s.projectPath || '—')}</div>
  <div class="card-stats">
    <div class="cs"><div class="cs-label">Hoy</div><div class="cs-val">${fmt(s.today_ms)}</div></div>
    <div class="cs"><div class="cs-label">Semana</div><div class="cs-val">${fmt(s.week_ms)}</div></div>
    <div class="cs"><div class="cs-label">Total</div><div class="cs-val cs-total">${fmt(s.total_ms)}</div></div>
  </div>
  ${goalBars ? `<div class="card-goals">${goalBars}</div>` : ''}
  <div class="card-bar"><div class="card-bar-fill" style="width:${pct}%;background:${escHtml(s.color)}"></div></div>
</div>`;
  }).join('');
}

function settingsTab(data: DashboardData): string {
  const dailyH = data.dailyGoal_ms > 0 ? (data.dailyGoal_ms / 3600000).toFixed(1) : '';
  const weeklyH = data.weeklyGoal_ms > 0 ? (data.weeklyGoal_ms / 3600000).toFixed(1) : '';
  const currencies = ['EUR', 'USD', 'GBP', 'CHF', 'JPY'];

  const currOpts = (sel: string) => currencies.map(c =>
    `<option value="${c}" ${c === sel ? 'selected' : ''}>${c}</option>`
  ).join('');

  const projectRows = data.stats.map((s, i) => {
    const dh = s.dailyGoal_ms > 0 ? (s.dailyGoal_ms / 3600000).toFixed(1) : '';
    const wh = s.weeklyGoal_ms > 0 ? (s.weeklyGoal_ms / 3600000).toFixed(1) : '';
    return `<tr id="proj-row-${i}" class="proj-row">
      <td><div style="display:flex;align-items:center;gap:6px"><div style="width:10px;height:10px;border-radius:3px;background:${escHtml(s.color)};flex-shrink:0"></div><span>${escHtml(s.project)}</span></div></td>
      <td><input class="cfg-input" type="number" min="0" step="1" value="${s.hourlyRate || ''}" placeholder="0" id="rate-${i}" style="width:60px"></td>
      <td><select class="cfg-select" id="cur-${i}">${currOpts(s.currency)}</select></td>
      <td><input class="cfg-input" type="number" min="0" step="0.5" value="${dh}" placeholder="—" id="dgoal-${i}" style="width:55px"></td>
      <td><input class="cfg-input" type="number" min="0" step="1" value="${wh}" placeholder="—" id="wgoal-${i}" style="width:55px"></td>
      <td><button class="ghost cfg-save-btn" onclick="saveProjectGoals(${i})">Guardar</button></td>
    </tr>`;
  }).join('');

  return `<div style="height:8px"></div>
  <div class="section-title">Metas globales</div>
  <div class="cfg-card" style="margin-bottom:14px">
    <div class="cfg-row">
      <label class="cfg-label">Meta diaria (h)</label>
      <input class="cfg-input" type="number" min="0" step="0.5" id="g-daily" value="${dailyH}" placeholder="0">
    </div>
    <div class="cfg-row">
      <label class="cfg-label">Meta semanal (h)</label>
      <input class="cfg-input" type="number" min="0" step="1" id="g-weekly" value="${weeklyH}" placeholder="0">
    </div>
    <div class="cfg-row">
      <label class="cfg-label">Tarifa por defecto (€/h)</label>
      <input class="cfg-input" type="number" min="0" step="1" id="g-rate" value="${data.defaultRate || ''}" placeholder="0">
    </div>
    <div class="cfg-row">
      <label class="cfg-label">Moneda</label>
      <select class="cfg-select" id="g-currency">${currOpts(data.currency)}</select>
    </div>
    <div style="margin-top:10px">
      <button onclick="saveGlobalConfig()">Guardar global</button>
      <span id="g-saved" style="margin-left:8px;font-size:11px;color:var(--vscode-charts-green,#4caf50);display:none">✓ Guardado</span>
    </div>
  </div>

  <div class="section-title">Proyectos activos</div>
  <div style="overflow-x:auto">
    <table class="model-table" style="min-width:550px">
      <thead><tr><th>Proyecto</th><th>€/h</th><th>Moneda</th><th>Meta/día (h)</th><th>Meta/sem (h)</th><th></th></tr></thead>
      <tbody>${projectRows}</tbody>
    </table>
  </div>`;
}

export function generateDashboardHtml(): string {
  const data = buildData();
  const cards = projectCards(data.stats, data.totalAll_ms, data.pomodoroByProject, false);
  const arcCards = projectCards(data.archivedStats, data.totalAll_ms, data.pomodoroByProject, true);
  const settingsHtml = settingsTab(data);
  const dataJson = JSON.stringify(data);

  const todayCost = fmtCost(data.totalToday_ms, data.defaultRate, data.currency);
  const weekCost  = fmtCost(data.totalWeek_ms, data.defaultRate, data.currency);
  const todayGoalPct = data.dailyGoal_ms > 0 ? Math.min(100, Math.round(data.totalToday_ms / data.dailyGoal_ms * 100)) : -1;
  const weekGoalPct  = data.weeklyGoal_ms > 0 ? Math.min(100, Math.round(data.totalWeek_ms / data.weeklyGoal_ms * 100)) : -1;

  const aiTotalCost = data.aiSessions.reduce((a, s) => a + s.cost_usd, 0);
  const aiTodayStr = new Date().toISOString().substring(0, 10);
  const aiToday = data.aiSessions.find(s => s.date === aiTodayStr)?.cost_usd ?? 0;
  const wkStart = new Date(); wkStart.setDate(wkStart.getDate() - wkStart.getDay()); wkStart.setHours(0,0,0,0);
  const aiWeek = data.aiSessions.filter(s => new Date(s.date) >= wkStart).reduce((a, s) => a + s.cost_usd, 0);
  const aiTokIn  = data.aiSessions.reduce((a, s) => a + s.tokens_in, 0);
  const aiTokOut = data.aiSessions.reduce((a, s) => a + s.tokens_out, 0);
  const codingH  = data.totalAll_ms / 3600000;
  const aiRatio  = codingH > 0 && aiTotalCost > 0 ? `$${(aiTotalCost / codingH).toFixed(2)}/h código` : '—';

  const modelTableRows = data.aiModelStats.map(m => `
<tr>
  <td><span class="model-dot" style="background:${escHtml(m.color)}"></span>${escHtml(m.displayName)}</td>
  <td>${m.conversations}</td>
  <td>${fmtTok(m.tokens_in)}</td>
  <td>${fmtTok(m.tokens_out)}</td>
  <td>$${m.cost_usd.toFixed(2)}</td>
</tr>`).join('');

  const paletteSwatches = PROJECT_PALETTE.map(c =>
    `<div class="swatch" style="background:${c}" onclick="pickColor('${c}')"></div>`
  ).join('');

  const arcCount = data.archivedStats.length;

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--vscode-font-family,system-ui,sans-serif);font-size:13px;color:var(--vscode-foreground);background:var(--vscode-editor-background)}

.page{display:none;flex-direction:column;height:100vh;overflow:hidden}
.page.active{display:flex}
.topbar{display:flex;align-items:center;justify-content:space-between;padding:9px 16px;border-bottom:1px solid var(--vscode-widget-border);background:var(--vscode-sideBar-background,var(--vscode-editor-background));flex-shrink:0;gap:8px}
.topbar h1{font-size:14px;font-weight:600;display:flex;align-items:center;gap:6px;white-space:nowrap}
.tab-row{display:flex;gap:4px;flex-wrap:wrap}
.tab-btn{background:transparent;color:var(--vscode-descriptionForeground);border:1px solid transparent;border-radius:4px;padding:3px 9px;font-size:12px;cursor:pointer;transition:all .15s}
.tab-btn:hover{border-color:var(--vscode-widget-border)}
.tab-btn.active{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border-color:transparent}
.actions{display:flex;gap:5px;flex-shrink:0}
.scrollable{overflow-y:auto;flex:1;padding:12px 16px 28px}

button{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;padding:4px 10px;cursor:pointer;border-radius:4px;font-size:12px;font-family:inherit;transition:opacity .15s}
button:hover{opacity:.85}
button.ghost{background:transparent;color:var(--vscode-foreground);border:1px solid var(--vscode-widget-border)}
button.ghost:hover{background:var(--vscode-list-hoverBackground)}

.pills{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap}
.pill{background:var(--vscode-editorWidget-background,#1e1e1e);border:1px solid var(--vscode-widget-border);border-radius:8px;padding:8px 12px;min-width:90px;flex:1}
.pill .pl{font-size:10px;color:var(--vscode-descriptionForeground);margin-bottom:2px;text-transform:uppercase;letter-spacing:.4px}
.pill .pv{font-size:17px;font-weight:700;line-height:1.2}
.pill .ps{font-size:11px;color:var(--vscode-descriptionForeground);margin-top:1px}
.pill.accent .pv{color:var(--vscode-charts-yellow,#daa520)}
.pill.green .pv{color:var(--vscode-charts-green,#4caf50)}
.pill.blue .pv{color:var(--vscode-charts-blue,#4fc3f7)}

.goal-section{margin-bottom:12px}
.goal-row{margin-bottom:5px}
.goal-label{font-size:11px;color:var(--vscode-descriptionForeground);display:flex;justify-content:space-between;margin-bottom:2px}
.goal-bar{height:4px;background:var(--vscode-widget-border);border-radius:3px;overflow:hidden}
.goal-fill{height:100%;background:var(--vscode-button-background);border-radius:3px;transition:width .4s}
.goal-fill.done{background:var(--vscode-charts-green,#4caf50)}

.range-row{display:flex;align-items:center;gap:6px;margin-bottom:8px}
.range-row span{font-size:11px;color:var(--vscode-descriptionForeground)}
.range-btn{background:transparent;color:var(--vscode-descriptionForeground);border:1px solid var(--vscode-widget-border);border-radius:4px;padding:2px 8px;font-size:11px;cursor:pointer;transition:all .15s}
.range-btn:hover{border-color:var(--vscode-focusBorder)}
.range-btn.active{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border-color:transparent}

.chart-wrap{background:var(--vscode-editorWidget-background,#1e1e1e);border:1px solid var(--vscode-widget-border);border-radius:8px;padding:10px 12px;margin-bottom:14px}
.chart-title{font-size:10px;color:var(--vscode-descriptionForeground);margin-bottom:5px;text-transform:uppercase;letter-spacing:.4px;display:flex;justify-content:space-between;align-items:center}
.legend{display:flex;gap:10px;font-size:10px;color:var(--vscode-descriptionForeground);flex-wrap:wrap}
.legend-item{display:flex;align-items:center;gap:3px}
.legend-dot{width:8px;height:8px;border-radius:2px;flex-shrink:0}
.legend-line{width:14px;height:2px;border-radius:2px;flex-shrink:0}
canvas{display:block;width:100%;height:185px}

.lang-section{margin-bottom:14px}
.lang-row{display:flex;align-items:center;gap:6px;margin-bottom:4px}
.lang-name{width:72px;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex-shrink:0}
.lang-bar-wrap{flex:1;height:10px;background:var(--vscode-widget-border);border-radius:3px;overflow:hidden}
.lang-bar-fill{height:100%;border-radius:3px}
.lang-pct{font-size:11px;color:var(--vscode-descriptionForeground);width:32px;text-align:right;flex-shrink:0}
.lang-time{font-size:11px;color:var(--vscode-descriptionForeground);width:50px;text-align:right;flex-shrink:0}

.section-title{font-size:10px;color:var(--vscode-descriptionForeground);text-transform:uppercase;letter-spacing:.4px;margin-bottom:8px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:8px}

.card{background:var(--vscode-editorWidget-background,#1e1e1e);border:1px solid var(--vscode-widget-border);border-radius:8px;padding:10px;cursor:pointer;transition:border-color .15s,transform .1s}
.card:hover{border-color:var(--vscode-focusBorder);transform:translateY(-1px)}
.card-top{display:flex;align-items:center;gap:6px;margin-bottom:2px}
.color-dot{width:12px;height:12px;border-radius:3px;flex-shrink:0;cursor:pointer;transition:transform .15s;border:1px solid rgba(255,255,255,0.15)}
.color-dot:hover{transform:scale(1.3)}
.card-name{font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1}
.card-cost{font-size:11px;color:var(--vscode-charts-green,#4caf50);font-weight:600}
.card-pct{font-size:11px;color:var(--vscode-descriptionForeground);flex-shrink:0}
.card-path{font-size:10px;color:var(--vscode-descriptionForeground);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:7px;opacity:.6}
.card-stats{display:flex;margin-bottom:5px}
.cs{flex:1;border-right:1px solid var(--vscode-widget-border)}
.cs:last-child{border-right:none}
.cs-label{font-size:10px;color:var(--vscode-descriptionForeground);margin-bottom:1px}
.cs-val{font-size:12px;font-weight:600}
.cs-total{color:var(--vscode-charts-blue,#4fc3f7)}
.card-goals{margin-bottom:5px}
.card-goal-row{margin-bottom:3px}
.card-bar{height:2px;background:var(--vscode-widget-border);border-radius:2px;overflow:hidden}
.card-bar-fill{height:100%;border-radius:2px}

/* Archive button on card */
.archive-btn{width:16px;height:16px;border-radius:3px;display:flex;align-items:center;justify-content:center;font-size:10px;cursor:pointer;flex-shrink:0;opacity:.4;transition:opacity .15s,background .15s;border:1px solid var(--vscode-widget-border)}
.archive-btn:hover{opacity:1;background:var(--vscode-button-background);color:var(--vscode-button-foreground)}

/* Color picker popup */
.color-popup{position:fixed;background:var(--vscode-editorWidget-background,#252526);border:1px solid var(--vscode-focusBorder);border-radius:8px;padding:8px;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.5);display:none}
.swatch-grid{display:grid;grid-template-columns:repeat(8,20px);gap:3px}
.swatch{width:20px;height:20px;border-radius:4px;cursor:pointer;border:2px solid transparent;transition:border-color .12s,transform .12s}
.swatch:hover{border-color:white;transform:scale(1.2)}

/* Detail */
.detail-meta{font-size:11px;color:var(--vscode-descriptionForeground);margin-bottom:10px;padding:6px 10px;background:var(--vscode-editorWidget-background);border-radius:6px;border-left:3px solid var(--vscode-button-background)}

/* AI model table */
.model-table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:14px}
.model-table th{text-align:left;padding:5px 8px;border-bottom:1px solid var(--vscode-widget-border);font-size:10px;color:var(--vscode-descriptionForeground);text-transform:uppercase;letter-spacing:.4px}
.model-table td{padding:5px 8px;border-bottom:1px solid rgba(128,128,128,.1)}
.model-dot{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:5px;vertical-align:middle}

/* Config/Settings tab */
.cfg-card{background:var(--vscode-editorWidget-background,#1e1e1e);border:1px solid var(--vscode-widget-border);border-radius:8px;padding:12px}
.cfg-row{display:flex;align-items:center;gap:10px;margin-bottom:8px}
.cfg-label{font-size:12px;color:var(--vscode-descriptionForeground);min-width:180px;flex-shrink:0}
.cfg-input{background:var(--vscode-input-background,#3c3c3c);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,#555);border-radius:4px;padding:3px 7px;font-size:12px;font-family:inherit;width:100px}
.cfg-input:focus{outline:1px solid var(--vscode-focusBorder);border-color:var(--vscode-focusBorder)}
.cfg-select{background:var(--vscode-input-background,#3c3c3c);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,#555);border-radius:4px;padding:3px 6px;font-size:12px;font-family:inherit}
.proj-row.highlight{background:rgba(79,195,247,.1);border-radius:4px}
.cfg-save-btn{padding:2px 8px;font-size:11px}

.empty{color:var(--vscode-descriptionForeground);font-style:italic;padding:16px 0}
.empty-large{text-align:center;padding:40px;color:var(--vscode-descriptionForeground)}

/* Pomodoro badge */
.pomo-badge{font-size:10px;color:var(--vscode-descriptionForeground);flex-shrink:0}

/* Tag chips */
.tag-filters{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:10px}
.tag-chip{font-size:11px;padding:2px 8px;border-radius:10px;cursor:pointer;border:1px solid var(--vscode-widget-border);color:var(--vscode-descriptionForeground);transition:all .15s;user-select:none}
.tag-chip:hover{border-color:var(--vscode-focusBorder)}
.tag-chip.active{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border-color:transparent}

/* Session list */
.session-list{margin-top:10px}
.session-table{width:100%;border-collapse:collapse;font-size:12px}
.session-table th{text-align:left;padding:4px 6px;border-bottom:1px solid var(--vscode-widget-border);font-size:10px;color:var(--vscode-descriptionForeground);text-transform:uppercase;letter-spacing:.4px}
.session-table td{padding:4px 6px;border-bottom:1px solid rgba(128,128,128,.08);vertical-align:top}
.session-tag{display:inline-block;font-size:10px;padding:1px 5px;border-radius:8px;background:var(--vscode-badge-background,#4d4d4d);color:var(--vscode-badge-foreground,#fff);margin-right:2px}
.session-notes{color:var(--vscode-descriptionForeground);font-size:11px;max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
</style>
</head>
<body>

<!-- Color Picker Popup -->
<div class="color-popup" id="color-popup">
  <div class="swatch-grid">${paletteSwatches}</div>
</div>

<!-- ════════ OVERVIEW ════════ -->
<div class="page active" id="pg-overview">
  <div class="topbar">
    <h1>⏱ Time Tracker</h1>
    <div class="tab-row">
      <button class="tab-btn active" onclick="switchTab('overview')">Overview</button>
      <button class="tab-btn" onclick="switchTab('settings')">⚙ Config</button>
      ${data.aiEnabled ? '<button class="tab-btn" onclick="switchTab(\'ai\')">🤖 IA</button>' : ''}
      <button class="tab-btn" onclick="switchTab('archived')">📦 Archivados${arcCount > 0 ? ` (${arcCount})` : ''}</button>
    </div>
    <div class="actions">
      <button class="ghost" onclick="doRefresh()" title="Actualizar">↻</button>
      <button class="ghost" onclick="doExportJson()" title="Exportar JSON">⬇ JSON</button>
      <button onclick="doExport()">⬇ CSV</button>
    </div>
  </div>

  <!-- Tab: Overview -->
  <div class="scrollable" id="tab-overview">
    <div style="height:8px"></div>
    <div class="pills">
      <div class="pill"><div class="pl">Hoy</div><div class="pv">${fmt(data.totalToday_ms)}</div>${todayCost ? `<div class="ps">${todayCost}</div>` : ''}</div>
      <div class="pill"><div class="pl">Semana</div><div class="pv">${fmt(data.totalWeek_ms)}</div>${weekCost ? `<div class="ps">${weekCost}</div>` : ''}</div>
      <div class="pill blue"><div class="pl">Total</div><div class="pv">${fmt(data.totalAll_ms)}</div></div>
      ${data.streak > 0 ? `<div class="pill accent"><div class="pl">Racha</div><div class="pv">🔥 ${data.streak}</div><div class="ps">días</div></div>` : ''}
    </div>

    ${todayGoalPct >= 0 || weekGoalPct >= 0 ? `<div class="goal-section">
      ${todayGoalPct >= 0 ? `<div class="goal-row">
        <div class="goal-label"><span>Meta diaria (global)</span><span>${fmt(data.totalToday_ms)} / ${fmt(data.dailyGoal_ms)} (${todayGoalPct}%)</span></div>
        <div class="goal-bar"><div class="goal-fill ${todayGoalPct >= 100 ? 'done' : ''}" style="width:${todayGoalPct}%"></div></div>
      </div>` : ''}
      ${weekGoalPct >= 0 ? `<div class="goal-row">
        <div class="goal-label"><span>Meta semanal (global)</span><span>${fmt(data.totalWeek_ms)} / ${fmt(data.weeklyGoal_ms)} (${weekGoalPct}%)</span></div>
        <div class="goal-bar"><div class="goal-fill ${weekGoalPct >= 100 ? 'done' : ''}" style="width:${weekGoalPct}%"></div></div>
      </div>` : ''}
    </div>` : ''}

    <div class="chart-wrap">
      <div class="chart-title">
        <span>Actividad diaria por proyecto</span>
        <div class="legend" id="legend-all"></div>
      </div>
      <div class="range-row">
        <span>Rango:</span>
        <button class="range-btn" onclick="setRange('all',this)">Todo</button>
        <button class="range-btn" onclick="setRange(90,this)">90d</button>
        <button class="range-btn active" onclick="setRange(30,this)">30d</button>
        <button class="range-btn" onclick="setRange(7,this)">7d</button>
      </div>
      <canvas id="chart-all"></canvas>
    </div>

    ${data.langsAll.length > 0 ? `<div class="section-title" style="margin-bottom:6px">Lenguajes (todos los proyectos)</div>
    <div class="lang-section" id="langs-all"></div>` : ''}

    <div class="section-title">${data.stats.length} Proyecto${data.stats.length !== 1 ? 's' : ''}</div>
    ${data.allTags.length > 0 ? `<div class="tag-filters" id="tag-filters">
      <span class="tag-chip active" data-tag="all" onclick="filterByTag('all',this)">Todos</span>
      ${data.allTags.map(t => `<span class="tag-chip" data-tag="${escHtml(t)}" onclick="filterByTag('${escHtml(t)}',this)">${escHtml(t)}</span>`).join('')}
    </div>` : ''}
    <div class="grid" id="cards-grid">${cards}</div>
  </div>

  <!-- Tab: Settings/Config -->
  <div class="scrollable" id="tab-settings" style="display:none">
    ${settingsHtml}
  </div>

  <!-- Tab: AI -->
  ${data.aiEnabled ? `<div class="scrollable" id="tab-ai" style="display:none">
    <div style="height:8px"></div>
    ${data.aiSessions.length === 0 ? `<div class="empty-large">Sin datos de IA.<br><small>Requiere <code>~/.claude/projects/</code> o usa "Log AI Usage"</small></div>` : `
    <div class="pills">
      <div class="pill"><div class="pl">Coste hoy</div><div class="pv">$${aiToday.toFixed(2)}</div></div>
      <div class="pill"><div class="pl">Coste semana</div><div class="pv">$${aiWeek.toFixed(2)}</div></div>
      <div class="pill green"><div class="pl">Total</div><div class="pv">$${aiTotalCost.toFixed(2)}</div></div>
      <div class="pill"><div class="pl">Tokens entrada</div><div class="pv">${fmtTok(aiTokIn)}</div></div>
      <div class="pill"><div class="pl">Tokens salida</div><div class="pv">${fmtTok(aiTokOut)}</div></div>
      <div class="pill accent"><div class="pl">Ratio IA/código</div><div class="pv" style="font-size:13px">${aiRatio}</div></div>
    </div>
    <div class="chart-wrap">
      <div class="chart-title">
        <span>Coste IA diario (USD) por modelo</span>
        <div class="legend" id="ai-legend"></div>
      </div>
      <div class="range-row">
        <span>Rango:</span>
        <button class="range-btn" onclick="setAIRange('all',this)">Todo</button>
        <button class="range-btn" onclick="setAIRange(90,this)">90d</button>
        <button class="range-btn active" onclick="setAIRange(30,this)">30d</button>
        <button class="range-btn" onclick="setAIRange(7,this)">7d</button>
      </div>
      <canvas id="chart-ai"></canvas>
    </div>
    <div class="section-title" style="margin-bottom:6px">Desglose por modelo</div>
    <table class="model-table">
      <thead><tr><th>Modelo</th><th>Sesiones</th><th>Tok. entrada</th><th>Tok. salida</th><th>Coste</th></tr></thead>
      <tbody>${modelTableRows}</tbody>
    </table>
    <div style="margin-top:8px">
      <button onclick="doLogAI()">+ Registrar uso de IA manual</button>
    </div>
    `}
  </div>` : ''}

  <!-- Tab: Archived -->
  <div class="scrollable" id="tab-archived" style="display:none">
    <div style="height:8px"></div>
    <div class="section-title">${arcCount} Proyecto${arcCount !== 1 ? 's' : ''} archivado${arcCount !== 1 ? 's' : ''}</div>
    <div class="grid">${arcCards}</div>
  </div>
</div>

<!-- ════════ DETAIL ════════ -->
<div class="page" id="pg-detail">
  <div class="topbar">
    <div style="display:flex;align-items:center;gap:10px;overflow:hidden;min-width:0">
      <button class="ghost" onclick="showOverview()">← Volver</button>
      <h1 id="dt-name" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></h1>
    </div>
    <div class="actions">
      <button class="ghost" onclick="showProjectSettings()" title="Configurar este proyecto">⚙ Config</button>
      <button class="ghost" onclick="doRefresh()">↻</button>
    </div>
  </div>
  <div class="scrollable">
    <div style="height:8px"></div>
    <div class="detail-meta" id="dt-path"></div>
    <div class="pills" id="dt-pills"></div>
    <div id="dt-goals"></div>
    <div class="chart-wrap">
      <div class="chart-title">
        <span>Actividad diaria — proyecto</span>
        <div class="legend" id="dt-legend"></div>
      </div>
      <div class="range-row">
        <span>Rango:</span>
        <button class="range-btn" onclick="setRangeDetail('all',this)">Todo</button>
        <button class="range-btn" onclick="setRangeDetail(90,this)">90d</button>
        <button class="range-btn active" onclick="setRangeDetail(30,this)">30d</button>
        <button class="range-btn" onclick="setRangeDetail(7,this)">7d</button>
      </div>
      <canvas id="chart-detail"></canvas>
    </div>
    <div class="section-title" style="margin-bottom:6px">Lenguajes (este proyecto)</div>
    <div class="lang-section" id="dt-langs"></div>
    <div class="section-list" id="dt-sessions"></div>
  </div>
</div>

<script>
(function() {
  const vscode = acquireVsCodeApi();
  const DATA = ${dataJson};
  const PALETTE = ${JSON.stringify(PROJECT_PALETTE)};

  let currentProject = null;
  let currentProjectIdx = null;
  let allRange = 30, detailRange = 30, aiRange = 30;
  let currentTab = 'overview';
  let colorPickerIdx = null;

  // ── Colors ──────────────────────────────────────
  function getColors() {
    const cs = getComputedStyle(document.body);
    const line = cs.getPropertyValue('--vscode-charts-orange').trim()
               || cs.getPropertyValue('--vscode-editorWarning-foreground').trim() || '#f0a844';
    const muted = cs.getPropertyValue('--vscode-descriptionForeground').trim() || 'rgba(150,150,150,.8)';
    return { line, muted };
  }

  // ── Navigation ───────────────────────────────────
  function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('#pg-overview .tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('#pg-overview .tab-btn[onclick*="\\'' + tab + '\\'"]')?.classList.add('active');
    const tabs = ['overview', 'settings', 'ai', 'archived'];
    tabs.forEach(t => {
      const el = document.getElementById('tab-' + t);
      if (el) el.style.display = t === tab ? '' : 'none';
    });
    if (tab === 'ai') requestAnimationFrame(() => drawAIChart(sliceRange(DATA.aiDailyData, aiRange)));
  }
  window.switchTab = switchTab;

  function showOverview() {
    document.getElementById('pg-overview').classList.add('active');
    document.getElementById('pg-detail').classList.remove('active');
    currentProject = null;
    currentProjectIdx = null;
  }

  function showDetail(idx) {
    const s = DATA.stats[idx];
    currentProject = s.project;
    currentProjectIdx = idx;
    const pct = DATA.totalAll_ms > 0 ? Math.round(s.total_ms / DATA.totalAll_ms * 100) : 0;

    document.getElementById('dt-name').textContent = s.project;
    document.getElementById('dt-path').textContent = s.projectPath || 'Sin ruta';
    document.getElementById('dt-legend').innerHTML =
      '<div class="legend-item"><div class="legend-dot" style="background:' + s.color + '"></div><span>Horas/día</span></div>' +
      '<div class="legend-item"><div class="legend-line" id="dt-lg-line"></div><span>Acumulado</span></div>';

    const fmtCostJS = (ms, rate, curr) => {
      if (!rate) return '';
      const sym = { EUR:'€', USD:'$', GBP:'£', CHF:'CHF ', JPY:'¥' };
      return (sym[curr]||curr) + Math.round(ms/3600000*rate);
    };
    const cost = fmtCostJS(s.total_ms, s.hourlyRate, s.currency);

    document.getElementById('dt-pills').innerHTML = [
      pill('Hoy',    fmt(s.today_ms), fmtCostJS(s.today_ms, s.hourlyRate, s.currency)),
      pill('Semana', fmt(s.week_ms),  fmtCostJS(s.week_ms,  s.hourlyRate, s.currency)),
      pill('Total',  fmt(s.total_ms), cost, 'blue'),
      pill('% total', pct + '%', s.hourlyRate ? s.currency + ' ' + s.hourlyRate + '/h' : ''),
    ].join('');

    let goalsHtml = '';
    if (s.dailyGoal_ms > 0) {
      const p = Math.min(100, Math.round(s.today_ms / s.dailyGoal_ms * 100));
      goalsHtml += goalRow('Meta diaria (proyecto)', s.today_ms, s.dailyGoal_ms, p);
    }
    if (s.weeklyGoal_ms > 0) {
      const p = Math.min(100, Math.round(s.week_ms / s.weeklyGoal_ms * 100));
      goalsHtml += goalRow('Meta semanal (proyecto)', s.week_ms, s.weeklyGoal_ms, p);
    }
    document.getElementById('dt-goals').innerHTML = goalsHtml
      ? '<div class="goal-section">' + goalsHtml + '</div>' : '';

    const langs = DATA.perProjectLangs[s.project] || [];
    document.getElementById('dt-langs').innerHTML = renderLangs(langs);

    const sessions = DATA.perProjectSessions[s.project] || [];
    document.getElementById('dt-sessions').innerHTML = sessions.length > 0
      ? '<div class="section-title" style="margin-top:12px;margin-bottom:6px">Sesiones recientes</div>' + renderSessionTable(sessions)
      : '';

    document.getElementById('pg-overview').classList.remove('active');
    document.getElementById('pg-detail').classList.add('active');
    detailRange = 30;
    document.querySelectorAll('#pg-detail .range-btn').forEach((b, i) => b.classList.toggle('active', i === 2));

    requestAnimationFrame(() => {
      const c = getColors();
      const el = document.getElementById('dt-lg-line');
      if (el) el.style.background = c.line;
      drawSingleChart('chart-detail', sliceRange(DATA.perProject[s.project]||[], detailRange), s.color, c.line, c.muted);
    });
  }
  window.showDetail = showDetail;
  window.showOverview = showOverview;

  function showProjectSettings() {
    showOverview();
    switchTab('settings');
    if (currentProjectIdx !== null) {
      setTimeout(() => {
        const row = document.getElementById('proj-row-' + currentProjectIdx);
        if (row) {
          row.scrollIntoView({ behavior: 'smooth', block: 'center' });
          row.classList.add('highlight');
          setTimeout(() => row.classList.remove('highlight'), 2000);
        }
      }, 100);
    }
  }
  window.showProjectSettings = showProjectSettings;

  function pill(label, val, sub, cls) {
    return \`<div class="pill \${cls||''}"><div class="pl">\${label}</div><div class="pv">\${val}</div>\${sub ? \`<div class="ps">\${sub}</div>\` : ''}</div>\`;
  }
  function goalRow(label, cur, goal, pct) {
    return \`<div class="goal-row">
      <div class="goal-label"><span>\${label}</span><span>\${fmt(cur)} / \${fmt(goal)} (\${pct}%)</span></div>
      <div class="goal-bar"><div class="goal-fill \${pct>=100?'done':''}" style="width:\${pct}%"></div></div>
    </div>\`;
  }

  // ── Range ────────────────────────────────────────
  function setRange(n, btn) {
    allRange = n;
    document.querySelectorAll('#tab-overview .range-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    drawStackedChart('chart-all', sliceRange(DATA.stackedDaily, allRange));
  }
  function setRangeDetail(n, btn) {
    detailRange = n;
    document.querySelectorAll('#pg-detail .range-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const s = DATA.stats.find(x => x.project === currentProject);
    const c = getColors();
    drawSingleChart('chart-detail', sliceRange(DATA.perProject[currentProject]||[], detailRange), s?.color||'#4fc3f7', c.line, c.muted);
  }
  function setAIRange(n, btn) {
    aiRange = n;
    document.querySelectorAll('#tab-ai .range-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    drawAIChart(sliceRange(DATA.aiDailyData, aiRange));
  }
  window.setRange = setRange;
  window.setRangeDetail = setRangeDetail;
  window.setAIRange = setAIRange;

  function sliceRange(arr, n) { return n === 'all' ? arr : (arr||[]).slice(-n); }

  // ── Actions ──────────────────────────────────────
  function doExport()     { vscode.postMessage({ command: 'exportCsv' }); }
  function doExportJson() { vscode.postMessage({ command: 'exportJson' }); }
  function doRefresh()    { vscode.postMessage({ command: 'refresh' }); }
  function doLogAI()      { vscode.postMessage({ command: 'logAIUsage' }); }
  window.doExport = doExport; window.doExportJson = doExportJson;
  window.doRefresh = doRefresh; window.doLogAI = doLogAI;

  // ── Tag filter ───────────────────────────────────
  let activeTag = 'all';
  function filterByTag(tag, chipEl) {
    activeTag = tag;
    document.querySelectorAll('.tag-chip').forEach(c => c.classList.remove('active'));
    chipEl.classList.add('active');
    document.querySelectorAll('#cards-grid .card').forEach((card, i) => {
      if (tag === 'all') { card.style.display = ''; return; }
      const project = DATA.stats[i]?.project;
      const hasSessions = (DATA.recentSessions || []).some(
        s => s.project === project && s.tags && s.tags.includes(tag)
      );
      card.style.display = hasSessions ? '' : 'none';
    });
  }
  window.filterByTag = filterByTag;

  // ── Session table ────────────────────────────────
  function renderSessionTable(sessions) {
    if (!sessions || !sessions.length) return '';
    const rows = sessions.map(s => {
      const tags = (s.tags||[]).map(t => \`<span class="session-tag">\${t}</span>\`).join('');
      const pomo = s.pomodoroCount > 0 ? \`🍅\${s.pomodoroCount}\` : '';
      return \`<tr>
        <td style="white-space:nowrap;color:var(--vscode-descriptionForeground)">\${s.date}</td>
        <td style="white-space:nowrap">\${fmt(s.duration_ms)}</td>
        <td>\${tags}</td>
        <td class="session-notes" title="\${s.notes||''}">\${s.notes||'—'}</td>
        <td style="white-space:nowrap">\${pomo}</td>
      </tr>\`;
    }).join('');
    return \`<table class="session-table">
      <thead><tr><th>Fecha</th><th>Duración</th><th>Tags</th><th>Notas</th><th>🍅</th></tr></thead>
      <tbody>\${rows}</tbody>
    </table>\`;
  }

  // ── Archive ──────────────────────────────────────
  function archiveProject(idx, event) {
    event.stopPropagation();
    const s = DATA.stats[idx];
    if (!s) return;
    vscode.postMessage({ command: 'archiveProject', project: s.project, archived: true });
  }
  function unarchiveProject(idx, event) {
    event.stopPropagation();
    const s = DATA.archivedStats[idx];
    if (!s) return;
    vscode.postMessage({ command: 'archiveProject', project: s.project, archived: false });
  }
  window.archiveProject = archiveProject;
  window.unarchiveProject = unarchiveProject;

  // ── Settings ─────────────────────────────────────
  function saveGlobalConfig() {
    const daily = parseFloat(document.getElementById('g-daily').value) || 0;
    const weekly = parseFloat(document.getElementById('g-weekly').value) || 0;
    const rate = parseFloat(document.getElementById('g-rate').value) || 0;
    const currency = document.getElementById('g-currency').value;
    vscode.postMessage({ command: 'saveGlobalConfig', dailyGoalHours: daily, weeklyGoalHours: weekly, defaultHourlyRate: rate, currency });
    const saved = document.getElementById('g-saved');
    if (saved) { saved.style.display = 'inline'; setTimeout(() => saved.style.display = 'none', 2000); }
  }
  function saveProjectGoals(idx) {
    const s = DATA.stats[idx];
    if (!s) return;
    const rate = parseFloat(document.getElementById('rate-' + idx)?.value) || 0;
    const currency = document.getElementById('cur-' + idx)?.value || 'EUR';
    const dh = parseFloat(document.getElementById('dgoal-' + idx)?.value) || 0;
    const wh = parseFloat(document.getElementById('wgoal-' + idx)?.value) || 0;
    vscode.postMessage({ command: 'saveProjectGoals', project: s.project, hourlyRate: rate, currency, dailyGoalHours: dh, weeklyGoalHours: wh });
    const btn = document.querySelector('#proj-row-' + idx + ' .cfg-save-btn');
    if (btn) { btn.textContent = '✓'; setTimeout(() => btn.textContent = 'Guardar', 1500); }
  }
  window.saveGlobalConfig = saveGlobalConfig;
  window.saveProjectGoals = saveProjectGoals;

  // ── Color picker ─────────────────────────────────
  function openColorPicker(idx, event) {
    event.stopPropagation();
    colorPickerIdx = idx;
    const popup = document.getElementById('color-popup');
    const rect = event.target.getBoundingClientRect();
    popup.style.display = 'block';
    popup.style.left = Math.min(rect.left, window.innerWidth - 200) + 'px';
    popup.style.top = (rect.bottom + 6) + 'px';
  }
  function pickColor(color) {
    if (colorPickerIdx === null) return;
    const s = DATA.stats[colorPickerIdx];
    s.color = color;
    const card = document.getElementById('card-' + colorPickerIdx);
    if (card) {
      card.querySelector('.color-dot').style.background = color;
      card.querySelector('.card-bar-fill').style.background = color;
    }
    for (const day of DATA.stackedDaily) {
      for (const sl of day.slices) {
        if (sl.project === s.project) sl.color = color;
      }
    }
    closeColorPicker();
    drawStackedChart('chart-all', sliceRange(DATA.stackedDaily, allRange));
    vscode.postMessage({ command: 'setProjectColor', project: s.project, color });
  }
  function closeColorPicker() {
    document.getElementById('color-popup').style.display = 'none';
    colorPickerIdx = null;
  }
  document.addEventListener('click', e => {
    if (!e.target.closest('#color-popup')) closeColorPicker();
  });
  window.openColorPicker = openColorPicker;
  window.pickColor = pickColor;

  // ── Formatters ───────────────────────────────────
  function fmt(ms) {
    if (!ms) return '—';
    const h = Math.floor(ms/3600000), m = Math.floor((ms%3600000)/60000);
    if (!h) return m + 'm'; if (!m) return h + 'h'; return h + 'h ' + m + 'm';
  }

  // ── Language bars ────────────────────────────────
  function renderLangs(langs) {
    if (!langs?.length) return '<p class="empty">Sin datos de lenguaje.</p>';
    const total = langs.reduce((a,l) => a+l.ms, 0);
    const colors = ['#4fc3f7','#81c784','#ffb74d','#f06292','#ce93d8','#80cbc4','#ff8a65','#a5d6a7','#b39ddb','#fff176'];
    return langs.slice(0, 8).map((l, i) => {
      const pct = total > 0 ? Math.round(l.ms/total*100) : 0;
      const h = Math.floor(l.ms/3600000), m = Math.floor((l.ms%3600000)/60000);
      const t = h > 0 ? h+'h '+m+'m' : m+'m';
      return \`<div class="lang-row">
        <div class="lang-name">\${l.lang||'?'}</div>
        <div class="lang-bar-wrap"><div class="lang-bar-fill" style="width:\${pct}%;background:\${colors[i%colors.length]}"></div></div>
        <div class="lang-pct">\${pct}%</div>
        <div class="lang-time">\${t}</div>
      </div>\`;
    }).join('');
  }

  // ── Canvas helpers ────────────────────────────────
  function setupCanvas(canvasId, H) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return null;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.offsetWidth || 600;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    return { ctx, W, H };
  }

  function drawGrid(ctx, P, pw, ph, gridLines, maxL, maxR, muted, fmtL, fmtR) {
    ctx.strokeStyle = 'rgba(128,128,128,.1)'; ctx.lineWidth = 1;
    ctx.fillStyle = muted; ctx.font = '10px sans-serif';
    for (let i = 0; i <= gridLines; i++) {
      const y = P.top + ph - (i/gridLines)*ph;
      ctx.beginPath(); ctx.moveTo(P.left, y); ctx.lineTo(P.left+pw, y); ctx.stroke();
      ctx.textAlign = 'right';
      ctx.fillText(fmtL(maxL*i/gridLines), P.left-4, y+3);
      ctx.textAlign = 'left';
      ctx.fillText(fmtR(maxR*i/gridLines), P.left+pw+4, y+3);
    }
  }

  function drawCumLine(ctx, pts, lineColor) {
    if (pts.length < 2) return;
    ctx.shadowColor = lineColor + '55'; ctx.shadowBlur = 5;
    ctx.beginPath(); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.lineWidth = 2.5; ctx.strokeStyle = lineColor;
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      const cx = (pts[i-1].x+pts[i].x)/2;
      ctx.bezierCurveTo(cx, pts[i-1].y, cx, pts[i].y, pts[i].x, pts[i].y);
    }
    ctx.stroke(); ctx.shadowBlur = 0;
    for (const p of pts) {
      ctx.beginPath(); ctx.arc(p.x,p.y,2.5,0,Math.PI*2);
      ctx.fillStyle = lineColor; ctx.fill();
    }
  }

  function drawXLabels(ctx, entries, P, pw, ph, muted) {
    ctx.fillStyle = muted; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
    const n = entries.length;
    const step = Math.max(1, Math.ceil(n/8));
    for (let i = 0; i < n; i += step) {
      ctx.fillText(entries[i].date.substring(5), P.left+i*(pw/n)+pw/n/2, P.top+ph+14);
    }
    if (n > 1) ctx.fillText(entries[n-1].date.substring(5), P.left+(n-1)*(pw/n)+pw/n/2, P.top+ph+14);
  }

  function drawAxisLines(ctx, P, pw, ph) {
    ctx.strokeStyle = 'rgba(128,128,128,.2)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(P.left,P.top); ctx.lineTo(P.left,P.top+ph); ctx.lineTo(P.left+pw,P.top+ph); ctx.stroke();
  }

  // ── Stacked bar chart (overview) ─────────────────
  function drawStackedChart(canvasId, stackedDays) {
    const setup = setupCanvas(canvasId, 185);
    if (!setup) return;
    const { ctx, W, H } = setup;
    const { line: lineColor, muted } = getColors();
    const n = (stackedDays||[]).length;
    const P = { top:18, right:58, bottom:42, left:50 };
    const pw = W-P.left-P.right, ph = H-P.top-P.bottom;

    if (!n) {
      ctx.fillStyle = muted; ctx.font='12px sans-serif'; ctx.textAlign='center';
      ctx.fillText('Sin datos para el rango seleccionado', W/2, H/2); return;
    }

    const totals = stackedDays.map(d => d.slices.reduce((s,sl)=>s+sl.ms,0));
    const maxH = Math.max(...totals.map(t=>t/3600000), 0.5);
    let cum = 0;
    const cumH = totals.map(t => { cum += t/3600000; return cum; });
    const maxCum = Math.max(...cumH, 0.5);

    const gapW = pw/n, barW = Math.max(gapW*0.65, 1.5);

    drawGrid(ctx, P, pw, ph, 4, maxH, maxCum, muted,
      v => v>=1 ? v.toFixed(1)+'h' : Math.round(v*60)+'m',
      v => v.toFixed(0)+'h');

    for (let i = 0; i < n; i++) {
      const slices = stackedDays[i].slices;
      if (!slices.length) continue;
      const x = P.left + i*gapW + (gapW-barW)/2;
      let yBottom = P.top + ph;
      for (let j = 0; j < slices.length; j++) {
        const slice = slices[j];
        const bh = (slice.ms/3600000/maxH)*ph;
        if (bh < 0.5) continue;
        const y = yBottom - bh;
        const isTop = j === slices.length - 1;
        ctx.fillStyle = slice.color + 'cc';
        if (isTop) {
          const r = Math.min(2.5, bh/2);
          ctx.beginPath();
          ctx.moveTo(x+r, y); ctx.lineTo(x+barW-r, y);
          ctx.quadraticCurveTo(x+barW, y, x+barW, y+r);
          ctx.lineTo(x+barW, y+bh); ctx.lineTo(x, y+bh); ctx.lineTo(x, y+r);
          ctx.quadraticCurveTo(x, y, x+r, y); ctx.fill();
        } else {
          ctx.fillRect(x, y, barW, bh);
        }
        yBottom -= bh;
      }
    }

    const pts = [];
    for (let i = 0; i < n; i++) {
      if (!cumH[i]) continue;
      pts.push({ x: P.left+i*gapW+gapW/2, y: P.top+ph-(cumH[i]/maxCum)*ph });
    }
    drawCumLine(ctx, pts, lineColor);
    drawXLabels(ctx, stackedDays, P, pw, ph, muted);
    drawAxisLines(ctx, P, pw, ph);

    const legendEl = document.getElementById('legend-all');
    if (legendEl) {
      const seen = new Map();
      for (const day of stackedDays) {
        for (const sl of day.slices) {
          if (!seen.has(sl.project)) seen.set(sl.project, sl.color);
        }
      }
      legendEl.innerHTML = Array.from(seen.entries()).slice(0,6).map(([p,c]) =>
        \`<div class="legend-item"><div class="legend-dot" style="background:\${c}"></div><span>\${p}</span></div>\`
      ).join('') + \`<div class="legend-item"><div class="legend-line" style="background:\${lineColor}"></div><span>Acumulado</span></div>\`;
    }
  }

  // ── Single-project bar chart (detail) ────────────
  function drawSingleChart(canvasId, entries, barColor, lineColor, muted) {
    const setup = setupCanvas(canvasId, 185);
    if (!setup) return;
    const { ctx, W, H } = setup;
    const n = (entries||[]).length;
    const P = { top:18, right:58, bottom:42, left:50 };
    const pw = W-P.left-P.right, ph = H-P.top-P.bottom;

    if (!n) {
      ctx.fillStyle = muted; ctx.font='12px sans-serif'; ctx.textAlign='center';
      ctx.fillText('Sin datos para el rango seleccionado', W/2, H/2); return;
    }

    const hours = entries.map(e=>(e.ms||0)/3600000);
    const maxH = Math.max(...hours, 0.5);
    let cum = 0; const cumH = hours.map(h=>{cum+=h;return cum;});
    const maxCum = Math.max(...cumH, 0.5);
    const gapW = pw/n, barW = Math.max(gapW*0.65, 1.5);

    drawGrid(ctx, P, pw, ph, 4, maxH, maxCum, muted,
      v => v>=1 ? v.toFixed(1)+'h' : Math.round(v*60)+'m',
      v => v.toFixed(0)+'h');

    for (let i = 0; i < n; i++) {
      if (!hours[i]) continue;
      const x = P.left+i*gapW+(gapW-barW)/2;
      const bh = (hours[i]/maxH)*ph, y = P.top+ph-bh;
      const r = Math.min(2.5, bh/2);
      const grad = ctx.createLinearGradient(0,y,0,y+bh);
      grad.addColorStop(0, barColor+'dd'); grad.addColorStop(1, barColor+'44');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(x+r,y); ctx.lineTo(x+barW-r,y);
      ctx.quadraticCurveTo(x+barW,y,x+barW,y+r);
      ctx.lineTo(x+barW,y+bh); ctx.lineTo(x,y+bh); ctx.lineTo(x,y+r);
      ctx.quadraticCurveTo(x,y,x+r,y); ctx.fill();
    }

    const pts = [];
    for (let i = 0; i < n; i++) {
      if (!cumH[i]) continue;
      pts.push({x: P.left+i*gapW+gapW/2, y: P.top+ph-(cumH[i]/maxCum)*ph});
    }
    drawCumLine(ctx, pts, lineColor);
    drawXLabels(ctx, entries, P, pw, ph, muted);
    drawAxisLines(ctx, P, pw, ph);
  }

  // ── AI stacked chart ─────────────────────────────
  function drawAIChart(aiDays) {
    const setup = setupCanvas('chart-ai', 185);
    if (!setup) return;
    const { ctx, W, H } = setup;
    const { line: lineColor, muted } = getColors();
    const n = (aiDays||[]).length;
    const P = { top:18, right:66, bottom:42, left:58 };
    const pw = W-P.left-P.right, ph = H-P.top-P.bottom;

    if (!n) { ctx.fillStyle=muted; ctx.font='12px sans-serif'; ctx.textAlign='center'; ctx.fillText('Sin datos',W/2,H/2); return; }

    const totals = aiDays.map(d => d.total||0);
    const maxC = Math.max(...totals, 0.01);
    let cum = 0; const cumC = totals.map(t=>{cum+=t;return cum;});
    const maxCum = Math.max(...cumC, 0.01);
    const gapW = pw/n, barW = Math.max(gapW*0.65, 1.5);

    drawGrid(ctx, P, pw, ph, 4, maxC, maxCum, muted,
      v => '$'+v.toFixed(2), v => '$'+v.toFixed(1));

    for (let i = 0; i < n; i++) {
      const models = aiDays[i].models || [];
      if (!models.length) continue;
      const x = P.left+i*gapW+(gapW-barW)/2;
      let yBottom = P.top+ph;
      for (let j = 0; j < models.length; j++) {
        const m = models[j];
        const bh = (m.cost/maxC)*ph;
        if (bh < 0.5) continue;
        const y = yBottom - bh;
        const isTop = j === models.length-1;
        ctx.fillStyle = m.color + 'cc';
        if (isTop) {
          const r = Math.min(2.5, bh/2);
          ctx.beginPath();
          ctx.moveTo(x+r,y); ctx.lineTo(x+barW-r,y);
          ctx.quadraticCurveTo(x+barW,y,x+barW,y+r);
          ctx.lineTo(x+barW,y+bh); ctx.lineTo(x,y+bh); ctx.lineTo(x,y+r);
          ctx.quadraticCurveTo(x,y,x+r,y); ctx.fill();
        } else { ctx.fillRect(x,y,barW,bh); }
        yBottom -= bh;
      }
    }

    const pts = [];
    for (let i = 0; i < n; i++) {
      if (!cumC[i]) continue;
      pts.push({x: P.left+i*gapW+gapW/2, y: P.top+ph-(cumC[i]/maxCum)*ph});
    }
    drawCumLine(ctx, pts, lineColor);
    drawXLabels(ctx, aiDays, P, pw, ph, muted);
    drawAxisLines(ctx, P, pw, ph);

    const aiLegend = document.getElementById('ai-legend');
    if (aiLegend) {
      const seen = new Map();
      for (const day of aiDays) {
        for (const m of (day.models||[])) {
          if (!seen.has(m.model)) seen.set(m.model, { name: m.displayName, color: m.color });
        }
      }
      aiLegend.innerHTML = Array.from(seen.values()).slice(0,5).map(m =>
        \`<div class="legend-item"><div class="legend-dot" style="background:\${m.color}"></div><span>\${m.name}</span></div>\`
      ).join('') + \`<div class="legend-item"><div class="legend-line" style="background:\${lineColor}"></div><span>Acumulado</span></div>\`;
    }
  }

  // ── Init ─────────────────────────────────────────
  function init() {
    drawStackedChart('chart-all', sliceRange(DATA.stackedDaily, allRange));
    const langsEl = document.getElementById('langs-all');
    if (langsEl) langsEl.innerHTML = renderLangs(DATA.langsAll);
  }
  requestAnimationFrame(init);

  window.addEventListener('resize', () => {
    const c = getColors();
    if (document.getElementById('pg-detail').classList.contains('active') && currentProject) {
      const s = DATA.stats.find(x => x.project === currentProject);
      drawSingleChart('chart-detail', sliceRange(DATA.perProject[currentProject]||[], detailRange), s?.color||'#4fc3f7', c.line, c.muted);
    } else if (currentTab === 'ai') {
      drawAIChart(sliceRange(DATA.aiDailyData, aiRange));
    } else {
      drawStackedChart('chart-all', sliceRange(DATA.stackedDaily, allRange));
    }
  });
})();
</script>
</body>
</html>`;
}

export function openDashboard(context: vscode.ExtensionContext): void {
  const panel = vscode.window.createWebviewPanel(
    'vscodeTracker',
    'Time Tracker',
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  function refresh(): void {
    panel.webview.html = generateDashboardHtml();
  }

  refresh();

  panel.webview.onDidReceiveMessage(async msg => {
    switch (msg.command) {
      case 'exportCsv': {
        const csvPath = getLogFilePath().replace('.json', '.csv');
        fs.writeFileSync(csvPath, exportCsvData());
        vscode.window.showInformationMessage(`CSV exportado: ${csvPath}`);
        break;
      }
      case 'exportJson':
        vscode.commands.executeCommand('vscodeTracker.exportJson');
        break;
      case 'refresh':
        refresh();
        break;
      case 'logAIUsage':
        vscode.commands.executeCommand('vscodeTracker.logAIUsage');
        break;
      case 'setProjectColor': {
        const existing = getProjectConfig(msg.project) ?? { project: msg.project };
        saveProjectConfig({ ...existing, project: msg.project, color: msg.color });
        break;
      }
      case 'archiveProject': {
        const existing = getProjectConfig(msg.project) ?? { project: msg.project };
        saveProjectConfig({ ...existing, project: msg.project, archived: msg.archived });
        refresh();
        break;
      }
      case 'saveGlobalConfig': {
        const config = vscode.workspace.getConfiguration('vscodeTracker');
        await config.update('dailyGoalHours', msg.dailyGoalHours || 0, vscode.ConfigurationTarget.Global);
        await config.update('weeklyGoalHours', msg.weeklyGoalHours || 0, vscode.ConfigurationTarget.Global);
        await config.update('defaultHourlyRate', msg.defaultHourlyRate || 0, vscode.ConfigurationTarget.Global);
        await config.update('currency', msg.currency || 'EUR', vscode.ConfigurationTarget.Global);
        break;
      }
      case 'saveProjectGoals': {
        const existing = getProjectConfig(msg.project) ?? { project: msg.project };
        saveProjectConfig({
          ...existing,
          project: msg.project,
          hourlyRate: msg.hourlyRate || 0,
          currency: msg.currency || 'EUR',
          dailyGoal_ms: (msg.dailyGoalHours || 0) * 3600000,
          weeklyGoal_ms: (msg.weeklyGoalHours || 0) * 3600000,
        });
        break;
      }
    }
  }, undefined, context.subscriptions);
}
