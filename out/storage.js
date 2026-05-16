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
exports.getLogFilePath = getLogFilePath;
exports.loadSegments = loadSegments;
exports.appendSegment = appendSegment;
exports.loadProjectConfigs = loadProjectConfigs;
exports.saveProjectConfig = saveProjectConfig;
exports.getProjectConfig = getProjectConfig;
exports.loadManualAIEntries = loadManualAIEntries;
exports.appendManualAIEntry = appendManualAIEntry;
exports.exportCsv = exportCsv;
exports.readPomodoro = readPomodoro;
exports.appendPomodoro = appendPomodoro;
exports.updateLastSegmentMeta = updateLastSegmentMeta;
exports.getTodayTotal = getTodayTotal;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const vscode = __importStar(require("vscode"));
function getTrackerDir() {
    const dir = path.join(os.homedir(), '.vscode-tracker');
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir, { recursive: true });
    return dir;
}
function getLogFilePath() {
    const config = vscode.workspace.getConfiguration('vscodeTracker');
    const customPath = config.get('logFilePath');
    if (customPath && customPath.length > 0)
        return customPath;
    return path.join(getTrackerDir(), 'logs.json');
}
function getProjectConfigPath() {
    return path.join(getTrackerDir(), 'projects.json');
}
function getManualAIPath() {
    return path.join(getTrackerDir(), 'ai-manual.json');
}
function loadSegments() {
    const filePath = getLogFilePath();
    if (!fs.existsSync(filePath))
        return [];
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
    catch {
        return [];
    }
}
function appendSegment(segment) {
    const segments = loadSegments();
    segments.push(segment);
    fs.writeFileSync(getLogFilePath(), JSON.stringify(segments, null, 2));
}
function loadProjectConfigs() {
    const p = getProjectConfigPath();
    if (!fs.existsSync(p))
        return [];
    try {
        return JSON.parse(fs.readFileSync(p, 'utf-8'));
    }
    catch {
        return [];
    }
}
function saveProjectConfig(cfg) {
    const configs = loadProjectConfigs().filter(c => c.project !== cfg.project);
    configs.push(cfg);
    fs.writeFileSync(getProjectConfigPath(), JSON.stringify(configs, null, 2));
}
function getProjectConfig(project) {
    return loadProjectConfigs().find(c => c.project === project);
}
function loadManualAIEntries() {
    const p = getManualAIPath();
    if (!fs.existsSync(p))
        return [];
    try {
        return JSON.parse(fs.readFileSync(p, 'utf-8'));
    }
    catch {
        return [];
    }
}
function appendManualAIEntry(entry) {
    const entries = loadManualAIEntries();
    entries.push(entry);
    fs.writeFileSync(getManualAIPath(), JSON.stringify(entries, null, 2));
}
function exportCsv() {
    const segments = loadSegments();
    const lines = ['project,projectPath,start,end,duration_h,language,tags,notes'];
    for (const s of segments) {
        const dh = (s.duration_ms / 3600000).toFixed(4);
        const tags = (s.tags ?? []).join(';');
        const notes = (s.notes ?? '').replace(/"/g, '""');
        lines.push(`"${s.project}","${s.projectPath}","${s.start}","${s.end}",${dh},"${s.language ?? ''}","${tags}","${notes}"`);
    }
    return lines.join('\n');
}
function getPomodoroPath() {
    return path.join(getTrackerDir(), 'pomodoro.json');
}
function readPomodoro() {
    const p = getPomodoroPath();
    if (!fs.existsSync(p))
        return [];
    try {
        return JSON.parse(fs.readFileSync(p, 'utf-8'));
    }
    catch {
        return [];
    }
}
function appendPomodoro(entry) {
    const today = new Date().toISOString().substring(0, 10);
    const sessions = readPomodoro();
    const existing = sessions.find(s => s.date === today && s.project === entry.project);
    if (existing) {
        existing.completedPomodoros += entry.completedPomodoros;
        existing.totalWorkMs += entry.totalWorkMs;
    }
    else {
        sessions.push(entry);
    }
    fs.writeFileSync(getPomodoroPath(), JSON.stringify(sessions, null, 2));
}
function updateLastSegmentMeta(notes, tags, pomodoroCount) {
    const segments = loadSegments();
    if (segments.length === 0)
        return;
    const last = segments[segments.length - 1];
    if (notes)
        last.notes = notes;
    if (tags.length > 0)
        last.tags = tags;
    if (pomodoroCount !== undefined)
        last.pomodoroCount = pomodoroCount;
    fs.writeFileSync(getLogFilePath(), JSON.stringify(segments, null, 2));
}
function getTodayTotal() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return loadSegments()
        .filter(s => new Date(s.start) >= today)
        .reduce((acc, s) => acc + s.duration_ms, 0);
}
