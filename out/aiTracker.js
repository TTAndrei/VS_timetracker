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
exports.loadAISessions = loadAISessions;
exports.buildAIDailyData = buildAIDailyData;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const storage_1 = require("./storage");
// ── Model metadata ─────────────────────────────────────────────────────────
const MODEL_META = {
    'claude-opus-4': { displayName: 'Claude Opus 4', color: '#9c27b0' },
    'claude-sonnet-4': { displayName: 'Claude Sonnet 4', color: '#2196f3' },
    'claude-haiku-4': { displayName: 'Claude Haiku 4', color: '#4caf50' },
    'claude-opus-3': { displayName: 'Claude Opus 3', color: '#7b1fa2' },
    'claude-sonnet-3': { displayName: 'Claude Sonnet 3', color: '#03a9f4' },
    'claude-haiku-3': { displayName: 'Claude Haiku 3', color: '#66bb6a' },
    'copilot': { displayName: 'GitHub Copilot', color: '#f9a825' },
    'gpt-4': { displayName: 'GPT-4', color: '#10a37f' },
    'gpt-3': { displayName: 'GPT-3.5', color: '#19c37d' },
    'cursor': { displayName: 'Cursor', color: '#ff6f00' },
    'aider': { displayName: 'Aider', color: '#e91e63' },
};
const MODEL_FALLBACK = { displayName: 'Unknown', color: '#888888' };
// ── Pricing per million tokens (input / cache-write / cache-read / output) ─
const PRICING = [
    { prefix: 'claude-opus-4', i: 15, cw: 18.75, cr: 1.50, o: 75 },
    { prefix: 'claude-opus-3', i: 15, cw: 18.75, cr: 1.50, o: 75 },
    { prefix: 'claude-sonnet-4', i: 3, cw: 3.75, cr: 0.30, o: 15 },
    { prefix: 'claude-sonnet-3', i: 3, cw: 3.75, cr: 0.30, o: 15 },
    { prefix: 'claude-haiku-4', i: 0.80, cw: 1.00, cr: 0.08, o: 4 },
    { prefix: 'claude-haiku-3', i: 0.25, cw: 0.30, cr: 0.03, o: 1.25 },
];
function getModelPrefix(model) {
    let best = '';
    for (const key of Object.keys(MODEL_META)) {
        if (model.startsWith(key) && key.length > best.length)
            best = key;
    }
    for (const p of PRICING) {
        if (model.startsWith(p.prefix) && p.prefix.length > best.length)
            best = p.prefix;
    }
    return best || model;
}
function getModelMeta(prefix, customModels) {
    if (MODEL_META[prefix])
        return MODEL_META[prefix];
    const custom = customModels.find(c => prefix === c.name || prefix.startsWith(c.name));
    if (custom)
        return { displayName: custom.displayName ?? custom.name, color: custom.color ?? '#888888' };
    // Partial match: "gpt" matches any gpt-* model
    for (const key of Object.keys(MODEL_META)) {
        if (prefix.startsWith(key))
            return MODEL_META[key];
    }
    return { ...MODEL_FALLBACK, displayName: prefix };
}
function getPricing(model, customModels) {
    for (const p of PRICING) {
        if (model.startsWith(p.prefix))
            return { i: p.i, o: p.o, cw: p.cw, cr: p.cr };
    }
    const custom = customModels.find(c => model.startsWith(c.name) || model === c.name);
    if (custom)
        return { i: custom.input_per_mtok, o: custom.output_per_mtok, cw: 0, cr: 0 };
    return { i: 3, o: 15, cw: 3.75, cr: 0.30 }; // default: sonnet-4
}
function calcCost(usage, model, customModels) {
    const p = getPricing(model, customModels);
    const M = 1000000;
    return ((usage['input_tokens'] ?? 0) * p.i / M +
        (usage['cache_creation_input_tokens'] ?? 0) * p.cw / M +
        (usage['cache_read_input_tokens'] ?? 0) * p.cr / M +
        (usage['output_tokens'] ?? 0) * p.o / M);
}
function calcCostManual(tokIn, tokOut, model, customModels) {
    const p = getPricing(model, customModels);
    const M = 1000000;
    return tokIn * p.i / M + tokOut * p.o / M;
}
function getOrCreateModel(dateEntry, prefix) {
    if (!dateEntry.models.has(prefix)) {
        dateEntry.models.set(prefix, { cost_usd: 0, tokens_in: 0, tokens_out: 0, sessions: new Set() });
    }
    return dateEntry.models.get(prefix);
}
function getOrCreateDate(byDate, date) {
    if (!byDate.has(date)) {
        byDate.set(date, { models: new Map(), sessions: new Set() });
    }
    return byDate.get(date);
}
function processFile(filePath, byDate, customModels) {
    let raw;
    try {
        raw = fs.readFileSync(filePath, 'utf-8');
    }
    catch {
        return;
    }
    for (const line of raw.split('\n')) {
        if (!line.includes('"type":"assistant"'))
            continue;
        let obj;
        try {
            obj = JSON.parse(line);
        }
        catch {
            continue;
        }
        if (obj.type !== 'assistant' || !obj.message?.usage)
            continue;
        const ts = obj.timestamp ?? '';
        if (!ts)
            continue;
        const date = ts.substring(0, 10);
        const sessionId = obj.sessionId ?? filePath;
        const model = obj.message.model ?? 'claude-sonnet-4-6';
        const usage = obj.message.usage;
        const prefix = getModelPrefix(model);
        const cost = calcCost(usage, model, customModels);
        const tokIn = (usage['input_tokens'] ?? 0)
            + (usage['cache_creation_input_tokens'] ?? 0)
            + (usage['cache_read_input_tokens'] ?? 0);
        const tokOut = usage['output_tokens'] ?? 0;
        const dateEntry = getOrCreateDate(byDate, date);
        dateEntry.sessions.add(sessionId);
        const modelEntry = getOrCreateModel(dateEntry, prefix);
        modelEntry.cost_usd += cost;
        modelEntry.tokens_in += tokIn;
        modelEntry.tokens_out += tokOut;
        modelEntry.sessions.add(sessionId);
    }
}
function walkDir(dir, depth, byDate, customModels) {
    if (depth > 3)
        return;
    let entries;
    try {
        entries = fs.readdirSync(dir);
    }
    catch {
        return;
    }
    for (const entry of entries) {
        const full = path.join(dir, entry);
        let stat;
        try {
            stat = fs.statSync(full);
        }
        catch {
            continue;
        }
        if (stat.isDirectory()) {
            walkDir(full, depth + 1, byDate, customModels);
        }
        else if (entry.endsWith('.jsonl')) {
            processFile(full, byDate, customModels);
        }
    }
}
function loadAISessions(customModels = []) {
    const byDate = new Map();
    // 1. Parse Claude Code JSONL logs
    const claudeDir = path.join(os.homedir(), '.claude', 'projects');
    if (fs.existsSync(claudeDir)) {
        walkDir(claudeDir, 0, byDate, customModels);
    }
    // 2. Merge manual entries
    let manualEntries = [];
    try {
        manualEntries = (0, storage_1.loadManualAIEntries)();
    }
    catch { /* ignore */ }
    for (const m of manualEntries) {
        const prefix = getModelPrefix(m.model) || m.model;
        const cost = m.cost_usd_override ?? calcCostManual(m.tokens_in, m.tokens_out, m.model, customModels);
        const manualId = `manual-${m.date}-${m.model}-${m.tokens_in}`;
        const dateEntry = getOrCreateDate(byDate, m.date);
        dateEntry.sessions.add(manualId);
        const modelEntry = getOrCreateModel(dateEntry, prefix);
        modelEntry.cost_usd += cost;
        modelEntry.tokens_in += m.tokens_in;
        modelEntry.tokens_out += m.tokens_out;
        modelEntry.sessions.add(manualId);
    }
    // 3. Convert to AISession[]
    return Array.from(byDate.entries())
        .map(([date, dateEntry]) => {
        const models = Array.from(dateEntry.models.entries())
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
function buildAIDailyData(sessions) {
    if (sessions.length === 0)
        return [];
    const byDate = new Map(sessions.map(s => [s.date, s]));
    const first = new Date(sessions[0].date);
    first.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const result = [];
    const d = new Date(first);
    while (d <= today) {
        const ds = d.toISOString().substring(0, 10);
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
