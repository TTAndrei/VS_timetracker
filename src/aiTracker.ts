import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadManualAIEntries, ManualAIEntry, localDay, parseLocalDay } from './storage';

export interface CustomModelConfig {
  name: string;
  displayName?: string;
  input_per_mtok: number;
  output_per_mtok: number;
  color?: string;
}

export interface AIModelUsage {
  model: string;        // prefix key e.g. "claude-sonnet-4"
  displayName: string;
  color: string;
  cost_usd: number;
  tokens_in: number;
  tokens_out: number;
  conversations: number;
}

export interface AISession {
  date: string;
  cost_usd: number;
  tokens_in: number;
  tokens_out: number;
  conversations: number;
  models: AIModelUsage[];
}

export interface AIStackedDay {
  date: string;
  models: Array<{ model: string; displayName: string; cost: number; color: string }>;
  total: number;
}

// ── Model metadata ─────────────────────────────────────────────────────────

const MODEL_META: Record<string, { displayName: string; color: string }> = {
  'claude-opus-4':    { displayName: 'Claude Opus 4',    color: '#9c27b0' },
  'claude-sonnet-4':  { displayName: 'Claude Sonnet 4',  color: '#2196f3' },
  'claude-haiku-4':   { displayName: 'Claude Haiku 4',   color: '#4caf50' },
  'claude-opus-3':    { displayName: 'Claude Opus 3',    color: '#7b1fa2' },
  'claude-sonnet-3':  { displayName: 'Claude Sonnet 3',  color: '#03a9f4' },
  'claude-haiku-3':   { displayName: 'Claude Haiku 3',   color: '#66bb6a' },
  'copilot':          { displayName: 'GitHub Copilot',   color: '#f9a825' },
  'gpt-4':            { displayName: 'GPT-4',            color: '#10a37f' },
  'gpt-3':            { displayName: 'GPT-3.5',          color: '#19c37d' },
  'cursor':           { displayName: 'Cursor',            color: '#ff6f00' },
  'aider':            { displayName: 'Aider',             color: '#e91e63' },
  'codex':            { displayName: 'Codex CLI',          color: '#000000' },
  'gpt-5':            { displayName: 'GPT-5',              color: '#0ea5e9' },
  'gpt-4o':           { displayName: 'GPT-4o',             color: '#0d9488' },
  'gpt-4.1':          { displayName: 'GPT-4.1',            color: '#14b8a6' },
  'o4':               { displayName: 'OpenAI o4',          color: '#6366f1' },
  'o3':               { displayName: 'OpenAI o3',          color: '#818cf8' },
  'opencode':         { displayName: 'opencode',           color: '#ef4444' },
};

const MODEL_FALLBACK = { displayName: 'Unknown', color: '#888888' };

// ── Pricing per million tokens ─────────────────────────────────────────────

const PRICING: Array<{ prefix: string; i: number; cw: number; cr: number; o: number }> = [
  { prefix: 'claude-opus-4',    i: 15,   cw: 18.75, cr: 1.50, o: 75   },
  { prefix: 'claude-opus-3',    i: 15,   cw: 18.75, cr: 1.50, o: 75   },
  { prefix: 'claude-sonnet-4',  i: 3,    cw: 3.75,  cr: 0.30, o: 15   },
  { prefix: 'claude-sonnet-3',  i: 3,    cw: 3.75,  cr: 0.30, o: 15   },
  { prefix: 'claude-haiku-4',   i: 0.80, cw: 1.00,  cr: 0.08, o: 4    },
  { prefix: 'claude-haiku-3',   i: 0.25, cw: 0.30,  cr: 0.03, o: 1.25 },
  { prefix: 'gpt-5',            i: 1.25, cw: 1.25,  cr: 0.125, o: 10  },
  { prefix: 'gpt-4o',           i: 2.50, cw: 2.50,  cr: 1.25, o: 10   },
  { prefix: 'gpt-4.1',          i: 2.00, cw: 2.00,  cr: 0.50, o: 8    },
  { prefix: 'o4',               i: 1.10, cw: 1.10,  cr: 0.275, o: 4.4 },
  { prefix: 'o3',               i: 2.00, cw: 2.00,  cr: 0.50, o: 8    },
  { prefix: 'codex',            i: 1.25, cw: 1.25,  cr: 0.125, o: 10  },
];

export function getModelPrefix(model: string): string {
  let best = '';
  for (const key of Object.keys(MODEL_META)) {
    if (model.startsWith(key) && key.length > best.length) best = key;
  }
  for (const p of PRICING) {
    if (model.startsWith(p.prefix) && p.prefix.length > best.length) best = p.prefix;
  }
  return best || model;
}

function getModelMeta(prefix: string, customModels: CustomModelConfig[]): { displayName: string; color: string } {
  if (MODEL_META[prefix]) return MODEL_META[prefix];
  const custom = customModels.find(c => prefix === c.name || prefix.startsWith(c.name));
  if (custom) return { displayName: custom.displayName ?? custom.name, color: custom.color ?? '#888888' };
  for (const key of Object.keys(MODEL_META)) {
    if (prefix.startsWith(key)) return MODEL_META[key];
  }
  return { ...MODEL_FALLBACK, displayName: prefix };
}

function getPricing(model: string, customModels: CustomModelConfig[]) {
  for (const p of PRICING) {
    if (model.startsWith(p.prefix)) return { i: p.i, o: p.o, cw: p.cw, cr: p.cr };
  }
  const custom = customModels.find(c => model.startsWith(c.name) || model === c.name);
  if (custom) return { i: custom.input_per_mtok, o: custom.output_per_mtok, cw: 0, cr: 0 };
  return { i: 3, o: 15, cw: 3.75, cr: 0.30 };
}

function calcCost(usage: Record<string, number>, model: string, customModels: CustomModelConfig[]): number {
  const p = getPricing(model, customModels);
  const M = 1_000_000;
  return (
    (usage['input_tokens'] ?? 0) * p.i / M +
    (usage['cache_creation_input_tokens'] ?? 0) * p.cw / M +
    (usage['cache_read_input_tokens'] ?? 0) * p.cr / M +
    (usage['output_tokens'] ?? 0) * p.o / M
  );
}

export function calcCostManual(tokIn: number, tokOut: number, model: string, customModels: CustomModelConfig[]): number {
  const p = getPricing(model, customModels);
  const M = 1_000_000;
  return tokIn * p.i / M + tokOut * p.o / M;
}

// ── Internal aggregation ───────────────────────────────────────────────────

interface ModelEntry {
  cost_usd: number;
  tokens_in: number;
  tokens_out: number;
  sessions: Set<string>;
}

interface DateEntry {
  models: Map<string, ModelEntry>;
  sessions: Set<string>;
}

function getOrCreateModel(dateEntry: DateEntry, prefix: string): ModelEntry {
  if (!dateEntry.models.has(prefix)) {
    dateEntry.models.set(prefix, { cost_usd: 0, tokens_in: 0, tokens_out: 0, sessions: new Set() });
  }
  return dateEntry.models.get(prefix)!;
}

function getOrCreateDate(byDate: Map<string, DateEntry>, date: string): DateEntry {
  if (!byDate.has(date)) {
    byDate.set(date, { models: new Map(), sessions: new Set() });
  }
  return byDate.get(date)!;
}

// Processes a JSONL file and updates all provided DateEntry maps simultaneously
function processFile(
  filePath: string,
  maps: Map<string, DateEntry>[],
  customModels: CustomModelConfig[]
): void {
  let raw: string;
  try { raw = fs.readFileSync(filePath, 'utf-8'); } catch { return; }

  for (const line of raw.split('\n')) {
    if (!line.includes('"type":"assistant"')) continue;
    let obj: any;
    try { obj = JSON.parse(line); } catch { continue; }
    if (obj.type !== 'assistant' || !obj.message?.usage) continue;

    const ts: string = obj.timestamp ?? '';
    if (!ts) continue;
    const date = localDay(ts);
    const sessionId: string = obj.sessionId ?? filePath;
    const model: string = obj.message.model ?? 'claude-sonnet-4-6';
    const usage: Record<string, number> = obj.message.usage;
    const prefix = getModelPrefix(model);

    const cost = calcCost(usage, model, customModels);
    const tokIn = (usage['input_tokens'] ?? 0)
      + (usage['cache_creation_input_tokens'] ?? 0)
      + (usage['cache_read_input_tokens'] ?? 0);
    const tokOut = usage['output_tokens'] ?? 0;

    for (const byDate of maps) {
      const dateEntry = getOrCreateDate(byDate, date);
      dateEntry.sessions.add(sessionId);
      const modelEntry = getOrCreateModel(dateEntry, prefix);
      modelEntry.cost_usd += cost;
      modelEntry.tokens_in += tokIn;
      modelEntry.tokens_out += tokOut;
      modelEntry.sessions.add(sessionId);
    }
  }
}

function walkDir(
  dir: string,
  depth: number,
  globalByDate: Map<string, DateEntry>,
  customModels: CustomModelConfig[],
  byProjectDir: Map<string, Map<string, DateEntry>>,
  projectDirName?: string
): void {
  if (depth > 3) return;
  let entries: string[];
  try { entries = fs.readdirSync(dir); } catch { return; }
  for (const entry of entries) {
    const full = path.join(dir, entry);
    let stat: fs.Stats;
    try { stat = fs.statSync(full); } catch { continue; }
    if (stat.isDirectory()) {
      // depth === 0 means we're inside ~/.claude/projects/, each subdir is a project dir
      const subProjectDirName = depth === 0 ? entry : projectDirName;
      walkDir(full, depth + 1, globalByDate, customModels, byProjectDir, subProjectDirName);
    } else if (entry.endsWith('.jsonl')) {
      const maps: Map<string, DateEntry>[] = [globalByDate];
      if (projectDirName !== undefined) {
        if (!byProjectDir.has(projectDirName)) byProjectDir.set(projectDirName, new Map());
        maps.push(byProjectDir.get(projectDirName)!);
      }
      processFile(full, maps, customModels);
    }
  }
}

function convertToSessions(byDate: Map<string, DateEntry>, customModels: CustomModelConfig[]): AISession[] {
  return Array.from(byDate.entries())
    .map(([date, dateEntry]) => {
      const models: AIModelUsage[] = Array.from(dateEntry.models.entries())
        .map(([prefix, me]) => {
          const meta = getModelMeta(prefix, customModels);
          return {
            model: prefix,
            displayName: meta.displayName,
            color: meta.color,
            cost_usd: me.cost_usd,
            tokens_in: me.tokens_in,
            tokens_out: me.tokens_out,
            conversations: me.sessions.size,
          };
        })
        .sort((a, b) => b.cost_usd - a.cost_usd);

      return {
        date,
        cost_usd: models.reduce((s, m) => s + m.cost_usd, 0),
        tokens_in: models.reduce((s, m) => s + m.tokens_in, 0),
        tokens_out: models.reduce((s, m) => s + m.tokens_out, 0),
        conversations: dateEntry.sessions.size,
        models,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ── Codex CLI / extra-dir JSONL usage parsing ──────────────────────────────
// Codex CLI rollout files and other agents store usage with varying schemas.
// Walk the parsed JSON defensively and grab the first object that carries
// numeric input/output token counts, plus any model string seen on the way.

interface FoundUsage { input: number; cacheW: number; cacheR: number; output: number; model?: string }

function deepFindUsage(o: unknown, depth = 0, model?: string): FoundUsage | null {
  if (depth > 6 || o === null || typeof o !== 'object') return null;
  const rec = o as Record<string, unknown>;
  if (typeof rec.model === 'string' && !model) model = rec.model;

  const num = (...keys: string[]): number => {
    for (const k of keys) {
      const v = rec[k];
      if (typeof v === 'number' && isFinite(v)) return v;
    }
    return 0;
  };
  const input = num('input_tokens', 'prompt_tokens', 'inputTokens');
  const output = num('output_tokens', 'completion_tokens', 'outputTokens');
  if (input > 0 || output > 0) {
    return {
      input,
      output,
      cacheW: num('cache_creation_input_tokens', 'cache_write_tokens'),
      cacheR: num('cache_read_input_tokens', 'cached_tokens', 'cached_input_tokens'),
      model,
    };
  }
  for (const v of Object.values(rec)) {
    if (v && typeof v === 'object') {
      const found = deepFindUsage(v, depth + 1, model);
      if (found) return found;
    }
  }
  return null;
}

function scanUsageJsonl(
  dir: string,
  byDate: Map<string, DateEntry>,
  customModels: CustomModelConfig[],
  depth = 0
): void {
  if (depth > 4) return;
  let entries: string[];
  try { entries = fs.readdirSync(dir); } catch { return; }
  for (const entry of entries) {
    const full = path.join(dir, entry);
    let stat: fs.Stats;
    try { stat = fs.statSync(full); } catch { continue; }
    if (stat.isDirectory()) {
      scanUsageJsonl(full, byDate, customModels, depth + 1);
      continue;
    }
    if (!entry.endsWith('.jsonl')) continue;
    let raw: string;
    try { raw = fs.readFileSync(full, 'utf-8'); } catch { continue; }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let obj: any;
      try { obj = JSON.parse(line); } catch { continue; }
      const u = deepFindUsage(obj);
      if (!u) continue;
      const ts: string = obj.timestamp ?? obj.ts ?? obj.time ?? '';
      const date = ts ? localDay(ts) : localDay(new Date(stat.mtime));
      const model = u.model ?? 'codex';
      const prefix = getModelPrefix(model);
      const usageRec: Record<string, number> = {
        input_tokens: u.input,
        cache_creation_input_tokens: u.cacheW,
        cache_read_input_tokens: u.cacheR,
        output_tokens: u.output,
      };
      const cost = calcCost(usageRec, model, customModels);
      const sessionId: string = obj.session_id ?? obj.sessionId ?? full;
      const de = getOrCreateDate(byDate, date);
      de.sessions.add(sessionId);
      const me = getOrCreateModel(de, prefix);
      me.cost_usd += cost;
      me.tokens_in += u.input + u.cacheW + u.cacheR;
      me.tokens_out += u.output;
      me.sessions.add(sessionId);
    }
  }
}

// ── Public: encode a local project path to match Claude Code dir naming ────
// Claude Code names project dirs by replacing path separators, colons,
// underscores, and dots with hyphens.
// e.g. C:\Users\foo\my_project → C--Users-foo-my-project
export function encodeProjectPath(p: string): string {
  return p.replace(/[:\\/._]/g, '-');
}

// ── Public: load all AI data in one pass, including per-project breakdown ──

export function loadAIDataFull(
  customModels: CustomModelConfig[] = [],
  customDirs?: { codex?: string; extra?: string[] }
): {
  sessions: AISession[];
  byProjectDir: Map<string, AISession[]>;  // Claude encoded dir name -> sessions for that project
} {
  const globalByDate = new Map<string, DateEntry>();
  const byProjectDir = new Map<string, Map<string, DateEntry>>();

  const claudeDir = path.join(os.homedir(), '.claude', 'projects');
  if (fs.existsSync(claudeDir)) {
    walkDir(claudeDir, 0, globalByDate, customModels, byProjectDir);
  }

  const codexDir = customDirs && customDirs.codex
    ? customDirs.codex
    : path.join(os.homedir(), '.codex', 'sessions');
  if (fs.existsSync(codexDir)) {
    scanUsageJsonl(codexDir, globalByDate, customModels);
  }
  for (const extra of customDirs?.extra ?? []) {
    if (extra && fs.existsSync(extra)) {
      scanUsageJsonl(extra, globalByDate, customModels);
    }
  }

  // Merge manual entries into global only (manual entries have no project association)
  let manualEntries: ManualAIEntry[] = [];
  try { manualEntries = loadManualAIEntries(); } catch { /* ignore */ }
  for (const m of manualEntries) {
    const prefix = getModelPrefix(m.model) || m.model;
    const cost = m.cost_usd_override ?? calcCostManual(m.tokens_in, m.tokens_out, m.model, customModels);
    const manualId = `manual-${m.date}-${m.model}-${m.tokens_in}`;
    const dateEntry = getOrCreateDate(globalByDate, m.date);
    dateEntry.sessions.add(manualId);
    const modelEntry = getOrCreateModel(dateEntry, prefix);
    modelEntry.cost_usd += cost;
    modelEntry.tokens_in += m.tokens_in;
    modelEntry.tokens_out += m.tokens_out;
    modelEntry.sessions.add(manualId);
  }

  const sessions = convertToSessions(globalByDate, customModels);

  const perProjectSessions = new Map<string, AISession[]>();
  for (const [dirName, dateMap] of byProjectDir.entries()) {
    perProjectSessions.set(dirName, convertToSessions(dateMap, customModels));
  }

  return { sessions, byProjectDir: perProjectSessions };
}

// ── Public: backward-compat wrapper ───────────────────────────────────────

export function loadAISessions(
  customModels: CustomModelConfig[] = [],
  customDirs?: { codex?: string; extra?: string[] }
): AISession[] {
  return loadAIDataFull(customModels, customDirs).sessions;
}

export function buildAIDailyData(sessions: AISession[]): AIStackedDay[] {
  if (sessions.length === 0) return [];
  const byDate = new Map(sessions.map(s => [s.date, s]));
  const first = parseLocalDay(sessions[0].date);
  first.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const result: AIStackedDay[] = [];
  const d = new Date(first);
  while (d <= today) {
    const ds = localDay(d);
    const session = byDate.get(ds);
    result.push({
      date: ds,
      models: session ? session.models.map(m => ({ model: m.model, displayName: m.displayName, cost: m.cost_usd, color: m.color })) : [],
      total: session?.cost_usd ?? 0,
    });
    d.setDate(d.getDate() + 1);
  }
  return result;
}
