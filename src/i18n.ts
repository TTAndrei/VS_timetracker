export type Lang = 'en' | 'es';

export interface Strings {
  tabOverview: string;
  tabConfig: string;
  tabAI: string;
  tabArchived: string;
  title: string;
  pillToday: string;
  pillWeek: string;
  pillTotal: string;
  pillStreak: string;
  pillStreakDays: string;
  cardGoalDaily: string;
  cardGoalWeekly: string;
  cardPomoToday: string;
  archiveBtn: string;
  unarchiveBtn: string;
  detailConfigBtn: string;
  detailRefreshBtn: string;
  detailBackBtn: string;
  detailLanguages: string;
  detailSessions: string;
  detailSessionDate: string;
  detailSessionDuration: string;
  detailSessionTags: string;
  detailSessionNotes: string;
  detailSessionPomo: string;
  settingsTitle: string;
  settingsGlobalRate: string;
  settingsCurrency: string;
  settingsDailyGoal: string;
  settingsWeeklyGoal: string;
  settingsIdleThreshold: string;
  settingsBreakReminder: string;
  settingsPomoWork: string;
  settingsPomoBreak: string;
  settingsSaveBtn: string;
  settingsSaved: string;
  settingsProjectsTitle: string;
  settingsProjectRate: string;
  settingsProjectCurrency: string;
  settingsProjectDailyGoal: string;
  settingsProjectWeeklyGoal: string;
  aiNoData: string;
  aiRatio: string;
  aiDailyCost: string;
  aiLogBtn: string;
  archiveEmpty: string;
  exportCsvBtn: string;
  exportJsonBtn: string;
  noProjects: string;
  hoursAbbr: string;
  minutesAbbr: string;
  langName: string;
  goalDailyGlobal: string;
  goalWeeklyGlobal: string;
  goalDailyProject: string;
  goalWeeklyProject: string;
  chartDailyByProject: string;
  chartDailyProject: string;
  rangeLabel: string;
  rangeAll: string;
  langsAllTitle: string;
  noLangData: string;
  projectsWord: string;
  projectWord: string;
  archivedWord: string;
  tagAll: string;
  aiCostToday: string;
  aiCostWeek: string;
  aiTotal: string;
  aiTokInPill: string;
  aiTokOutPill: string;
  aiModelBreakdown: string;
  aiByProject: string;
  aiThisProject: string;
  thModel: string;
  thSessions: string;
  thTokIn: string;
  thTokOut: string;
  thCost: string;
  noteBtn: string;
  cumulative: string;
  noDataRange: string;
  noDataShort: string;
  perHourCode: string;
  hoursPerDay: string;
  noPath: string;
}

const en: Strings = {
  tabOverview: 'Overview',
  tabConfig: 'Config',
  tabAI: 'AI',
  tabArchived: 'Archived',
  title: 'Time Tracker',
  pillToday: 'Today',
  pillWeek: 'Week',
  pillTotal: 'Total',
  pillStreak: 'Streak',
  pillStreakDays: 'days',
  cardGoalDaily: 'Daily goal',
  cardGoalWeekly: 'Weekly goal',
  cardPomoToday: 'pomodoros today',
  archiveBtn: 'Archive',
  unarchiveBtn: 'Restore',
  detailConfigBtn: 'Config',
  detailRefreshBtn: '↻',
  detailBackBtn: '← Back',
  detailLanguages: 'Languages (this project)',
  detailSessions: 'Recent sessions',
  detailSessionDate: 'Date',
  detailSessionDuration: 'Duration',
  detailSessionTags: 'Tags',
  detailSessionNotes: 'Notes',
  detailSessionPomo: 'Pomo',
  settingsTitle: 'Configuration',
  settingsGlobalRate: 'Default hourly rate',
  settingsCurrency: 'Currency',
  settingsDailyGoal: 'Daily goal (hours)',
  settingsWeeklyGoal: 'Weekly goal (hours)',
  settingsIdleThreshold: 'Idle threshold (seconds)',
  settingsBreakReminder: 'Break reminder (hours, 0 = off)',
  settingsPomoWork: 'Pomodoro work (minutes)',
  settingsPomoBreak: 'Pomodoro break (minutes)',
  settingsSaveBtn: 'Save',
  settingsSaved: 'Saved!',
  settingsProjectsTitle: 'Projects',
  settingsProjectRate: 'Rate',
  settingsProjectCurrency: 'Currency',
  settingsProjectDailyGoal: 'Daily goal (h)',
  settingsProjectWeeklyGoal: 'Weekly goal (h)',
  aiNoData: 'No AI data. Requires ~/.claude/projects/ or use "Log AI Usage".',
  aiRatio: 'AI/code ratio',
  aiDailyCost: 'Daily AI cost (USD) by model',
  aiLogBtn: '+ Log AI usage manually',
  archiveEmpty: 'No archived projects.',
  exportCsvBtn: 'Export CSV',
  exportJsonBtn: 'Export JSON',
  noProjects: 'No projects tracked yet. Open a folder and start coding.',
  hoursAbbr: 'h',
  minutesAbbr: 'm',
  langName: 'English',
  goalDailyGlobal: 'Daily goal (global)',
  goalWeeklyGlobal: 'Weekly goal (global)',
  goalDailyProject: 'Daily goal (project)',
  goalWeeklyProject: 'Weekly goal (project)',
  chartDailyByProject: 'Daily activity by project',
  chartDailyProject: 'Daily activity — project',
  rangeLabel: 'Range:',
  rangeAll: 'All',
  langsAllTitle: 'Languages (all projects)',
  noLangData: 'No language data.',
  projectsWord: 'Projects',
  projectWord: 'Project',
  archivedWord: 'archived',
  tagAll: 'All',
  aiCostToday: 'Cost today',
  aiCostWeek: 'Cost week',
  aiTotal: 'Total',
  aiTokInPill: 'Input tokens',
  aiTokOutPill: 'Output tokens',
  aiModelBreakdown: 'Breakdown by model',
  aiByProject: 'Usage by project',
  aiThisProject: 'AI — this project',
  thModel: 'Model',
  thSessions: 'Sessions',
  thTokIn: 'Tok. in',
  thTokOut: 'Tok. out',
  thCost: 'Cost',
  noteBtn: '+ Note',
  cumulative: 'Cumulative',
  noDataRange: 'No data for the selected range',
  noDataShort: 'No data',
  perHourCode: '/h code',
  hoursPerDay: 'Hours/day',
  noPath: 'No path'
};

const es: Strings = {
  tabOverview: 'Resumen',
  tabConfig: 'Config',
  tabAI: 'IA',
  tabArchived: 'Archivados',
  title: 'Time Tracker',
  pillToday: 'Hoy',
  pillWeek: 'Semana',
  pillTotal: 'Total',
  pillStreak: 'Racha',
  pillStreakDays: 'dias',
  cardGoalDaily: 'Meta diaria',
  cardGoalWeekly: 'Meta semanal',
  cardPomoToday: 'pomodoros hoy',
  archiveBtn: 'Archivar',
  unarchiveBtn: 'Restaurar',
  detailConfigBtn: 'Config',
  detailRefreshBtn: '↻',
  detailBackBtn: '← Volver',
  detailLanguages: 'Lenguajes (este proyecto)',
  detailSessions: 'Sesiones recientes',
  detailSessionDate: 'Fecha',
  detailSessionDuration: 'Duracion',
  detailSessionTags: 'Tags',
  detailSessionNotes: 'Notas',
  detailSessionPomo: 'Pomo',
  settingsTitle: 'Configuracion',
  settingsGlobalRate: 'Tarifa por hora (global)',
  settingsCurrency: 'Moneda',
  settingsDailyGoal: 'Meta diaria (horas)',
  settingsWeeklyGoal: 'Meta semanal (horas)',
  settingsIdleThreshold: 'Umbral de inactividad (segundos)',
  settingsBreakReminder: 'Recordatorio de descanso (horas, 0 = off)',
  settingsPomoWork: 'Pomodoro trabajo (minutos)',
  settingsPomoBreak: 'Pomodoro descanso (minutos)',
  settingsSaveBtn: 'Guardar',
  settingsSaved: 'Guardado!',
  settingsProjectsTitle: 'Proyectos',
  settingsProjectRate: 'Tarifa',
  settingsProjectCurrency: 'Moneda',
  settingsProjectDailyGoal: 'Meta diaria (h)',
  settingsProjectWeeklyGoal: 'Meta semanal (h)',
  aiNoData: 'Sin datos de IA. Requiere ~/.claude/projects/ o usa "Registrar uso de IA".',
  aiRatio: 'Ratio IA/codigo',
  aiDailyCost: 'Coste IA diario (USD) por modelo',
  aiLogBtn: '+ Registrar uso de IA manual',
  archiveEmpty: 'No hay proyectos archivados.',
  exportCsvBtn: 'Exportar CSV',
  exportJsonBtn: 'Exportar JSON',
  noProjects: 'Sin proyectos aun. Abre una carpeta y empieza a codear.',
  hoursAbbr: 'h',
  minutesAbbr: 'm',
  langName: 'Español',
  goalDailyGlobal: 'Meta diaria (global)',
  goalWeeklyGlobal: 'Meta semanal (global)',
  goalDailyProject: 'Meta diaria (proyecto)',
  goalWeeklyProject: 'Meta semanal (proyecto)',
  chartDailyByProject: 'Actividad diaria por proyecto',
  chartDailyProject: 'Actividad diaria — proyecto',
  rangeLabel: 'Rango:',
  rangeAll: 'Todo',
  langsAllTitle: 'Lenguajes (todos los proyectos)',
  noLangData: 'Sin datos de lenguaje.',
  projectsWord: 'Proyectos',
  projectWord: 'Proyecto',
  archivedWord: 'archivados',
  tagAll: 'Todos',
  aiCostToday: 'Coste hoy',
  aiCostWeek: 'Coste semana',
  aiTotal: 'Total',
  aiTokInPill: 'Tokens entrada',
  aiTokOutPill: 'Tokens salida',
  aiModelBreakdown: 'Desglose por modelo',
  aiByProject: 'Consumo por proyecto',
  aiThisProject: 'IA — este proyecto',
  thModel: 'Modelo',
  thSessions: 'Sesiones',
  thTokIn: 'Tok. entrada',
  thTokOut: 'Tok. salida',
  thCost: 'Coste',
  noteBtn: '+ Nota',
  cumulative: 'Acumulado',
  noDataRange: 'Sin datos para el rango seleccionado',
  noDataShort: 'Sin datos',
  perHourCode: '/h código',
  hoursPerDay: 'Horas/día',
  noPath: 'Sin ruta'
};

export function getStrings(lang: string): Strings {
  return lang.startsWith('es') ? es : en;
}
