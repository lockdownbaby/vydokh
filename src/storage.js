export const STORAGE_KEY = 'vydokh.v4';
export const PREVIOUS_KEY = 'vydokh.v3';
export const OLDER_KEY = 'vydokh.v2';
export const LEGACY_KEY = 'vydokh.v1';

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function createDefaultState() {
  return {
    schemaVersion: 4,
    onboardingComplete: false,
    profile: { displayName: '', personalReason: '', createdAt: todayISO() },
    plan: { strategy: 'quit', startDate: todayISO(), baseline: null, dailyTarget: 0 },
    tracking: { unit: 'puffs', unitLabel: 'затяжек' },
    dailyLogs: {},
    cravingLogs: [],
    weeklyReviews: {},
    practiceSessions: [],
    practiceSettings: { favorites: ['natural'], durations: {}, vibration: false },
    completedTasks: {},
    preferences: { remindersEnabled: false, reminderTimes: ['11:00', '16:00', '21:00'], sound: false, theme: 'light' },
    finance: { weeklySpend: null, currency: '€', goalName: '', goalAmount: null },
    achievements: { celebrated: [], urgeCount: 0 },
    lastUseAt: null,
    ui: { showStarterHint: true, analyticsRange: 'week', practiceRange: 'month' },
  };
}

function validDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T12:00:00`);
  return !Number.isNaN(d.getTime()) && `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` === s;
}

function sanitizeCurrent(input) {
  const base = createDefaultState();
  const value = input && typeof input === 'object' ? input : {};
  const safe = { ...base, ...value, schemaVersion: 4 };
  safe.onboardingComplete = value.onboardingComplete === true;
  const profileInput = value.profile && typeof value.profile === 'object' && !Array.isArray(value.profile) ? value.profile : {};
  safe.profile = { ...base.profile, ...profileInput };
  safe.profile.displayName = typeof profileInput.displayName === 'string' ? profileInput.displayName.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 48) : '';
  safe.profile.personalReason = typeof profileInput.personalReason === 'string' ? profileInput.personalReason.replace(/\u0000/g, '').slice(0, 240) : '';
  safe.profile.createdAt = validDate(profileInput.createdAt) ? profileInput.createdAt : base.profile.createdAt;
  safe.plan = { ...base.plan, ...(value.plan || {}) };
  safe.tracking = { ...base.tracking, ...(value.tracking || {}) };
  safe.tracking.unitLabel = typeof safe.tracking.unitLabel === 'string' ? safe.tracking.unitLabel.replace(/[<>\u0026\"'`]/g, '').trim().slice(0, 24) || 'единиц' : 'единиц';
  safe.preferences = { ...base.preferences, ...(value.preferences || {}) };
  safe.finance = { ...base.finance, ...(value.finance || {}) };
  safe.finance.currency = ['€', '₽', '$', '£', '₴', '₸', 'Br', 'zł'].includes(safe.finance.currency) ? safe.finance.currency : '€';
  safe.finance.weeklySpend = safe.finance.weeklySpend == null || safe.finance.weeklySpend === '' ? null : (Number.isFinite(Number(safe.finance.weeklySpend)) ? Math.min(1_000_000_000, Math.max(0, Number(safe.finance.weeklySpend))) : null);
  safe.finance.goalAmount = safe.finance.goalAmount == null || safe.finance.goalAmount === '' ? null : (Number.isFinite(Number(safe.finance.goalAmount)) ? Math.min(1_000_000_000, Math.max(0, Number(safe.finance.goalAmount))) : null);
  safe.finance.goalName = typeof safe.finance.goalName === 'string' ? safe.finance.goalName.slice(0, 60) : '';
  safe.achievements = { ...base.achievements, ...(value.achievements || {}) };
  safe.achievements.celebrated = Array.isArray(safe.achievements.celebrated) ? safe.achievements.celebrated.filter(n => Number.isFinite(Number(n))).map(Number) : [];
  safe.achievements.urgeCount = Math.min(1_000_000, Math.max(0, Number(safe.achievements.urgeCount) || 0));
  safe.lastUseAt = safe.lastUseAt == null || !Number.isFinite(Number(safe.lastUseAt)) ? null : Math.max(0, Number(safe.lastUseAt));
  safe.preferences.reminderTimes = Array.isArray(safe.preferences.reminderTimes) ? safe.preferences.reminderTimes.filter(t => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t)).slice(0, 5) : base.preferences.reminderTimes.slice();
  if (!safe.preferences.reminderTimes.length) safe.preferences.reminderTimes = base.preferences.reminderTimes.slice();
  safe.preferences.remindersEnabled = safe.preferences.remindersEnabled === true;
  safe.preferences.sound = safe.preferences.sound === true;
  safe.preferences.theme = ['light', 'dark', 'system'].includes(safe.preferences.theme) ? safe.preferences.theme : 'light';
  safe.practiceSettings = { ...base.practiceSettings, ...(value.practiceSettings || {}) };
  const validPracticeIds = new Set(['calm-46', 'box', 'natural', 'slow-35', 'switching', 'diaphragmatic', 'craving-breath', 'equal-55', 'anchor-breath', 'body-scan']);
  safe.practiceSettings.favorites = Array.isArray(safe.practiceSettings.favorites) ? [...new Set(safe.practiceSettings.favorites.filter(id => validPracticeIds.has(id)))].slice(0, 20) : base.practiceSettings.favorites.slice();
  const durations = safe.practiceSettings.durations && typeof safe.practiceSettings.durations === 'object' && !Array.isArray(safe.practiceSettings.durations) ? safe.practiceSettings.durations : {};
  safe.practiceSettings.durations = {};
  for (const [id, minutes] of Object.entries(durations)) { if (validPracticeIds.has(id) && [1, 3, 5, 10].includes(Number(minutes))) safe.practiceSettings.durations[id] = Number(minutes); }
  safe.practiceSettings.vibration = safe.practiceSettings.vibration === true;
  safe.ui = { ...base.ui, ...(value.ui || {}) };
  safe.ui.showStarterHint = safe.ui.showStarterHint !== false;
  safe.ui.analyticsRange = ['week', 'month', 'all'].includes(safe.ui.analyticsRange) ? safe.ui.analyticsRange : 'week';
  safe.ui.practiceRange = ['week', 'month', 'all'].includes(safe.ui.practiceRange) ? safe.ui.practiceRange : 'month';
  safe.dailyLogs = value.dailyLogs && typeof value.dailyLogs === 'object' && !Array.isArray(value.dailyLogs) ? { ...value.dailyLogs } : {};
  safe.cravingLogs = Array.isArray(value.cravingLogs) ? value.cravingLogs : [];
  safe.weeklyReviews = {};
  if (value.weeklyReviews && typeof value.weeklyReviews === 'object' && !Array.isArray(value.weeklyReviews)) {
    for (const [weekStart, review] of Object.entries(value.weeklyReviews)) {
      if (!validDate(weekStart) || !review || typeof review !== 'object' || Array.isArray(review)) continue;
      safe.weeklyReviews[weekStart] = {
        focus: typeof review.focus === 'string' && /^[a-z-]{1,40}$/.test(review.focus) ? review.focus : '',
        note: typeof review.note === 'string' ? review.note.slice(0, 2000) : '',
        updatedAt: typeof review.updatedAt === 'string' && Number.isFinite(Date.parse(review.updatedAt)) ? new Date(review.updatedAt).toISOString() : null,
      };
    }
  }
  safe.practiceSessions = Array.isArray(value.practiceSessions) ? value.practiceSessions : [];
  safe.completedTasks = {};
  if (value.completedTasks && typeof value.completedTasks === 'object' && !Array.isArray(value.completedTasks)) {
    for (const [date, ids] of Object.entries(value.completedTasks)) {
      if (validDate(date) && Array.isArray(ids)) safe.completedTasks[date] = ids.filter(id => typeof id === 'string' && id.length <= 64).slice(0, 100);
    }
  }
  safe.cravingLogs = safe.cravingLogs
    .filter(entry => entry && typeof entry === 'object' && typeof entry.at === 'string' && Number.isFinite(Date.parse(entry.at)))
    .slice(-500)
    .map(entry => ({
      at: new Date(entry.at).toISOString(),
      ...(validDate(entry.date) ? { date: entry.date } : {}),
      durationSeconds: Math.max(0, Math.min(300, Math.round(Number(entry.durationSeconds) || 0))),
      type: ['pause', 'practice-handoff', 'craving-checkin', 'slip', 'use-context'].includes(entry.type) ? entry.type : 'pause',
      ...(typeof entry.trigger === 'string' && /^[a-z-]{1,32}$/.test(entry.trigger) ? { trigger: entry.trigger } : {}),
      ...(typeof entry.emotion === 'string' && /^[a-z-]{1,32}$/.test(entry.emotion) ? { emotion: entry.emotion } : {}),
      ...(typeof entry.action === 'string' && /^[a-z-]{1,40}$/.test(entry.action) ? { action: entry.action } : {}),
      ...(typeof entry.outcome === 'string' && /^[a-z-]{1,32}$/.test(entry.outcome) ? { outcome: entry.outcome } : {}),
      ...(typeof entry.note === 'string' ? { note: entry.note.slice(0, 1000) } : {}),
      ...(Number.isInteger(Number(entry.beforeRating)) && Number(entry.beforeRating) >= 1 && Number(entry.beforeRating) <= 5 ? { beforeRating: Number(entry.beforeRating) } : {}),
      ...(Number.isInteger(Number(entry.afterRating)) && Number(entry.afterRating) >= 1 && Number(entry.afterRating) <= 5 ? { afterRating: Number(entry.afterRating) } : {}),
    }));
  safe.practiceSessions = safe.practiceSessions
    .filter(entry => entry && typeof entry === 'object' && typeof entry.id === 'string' && entry.id.length <= 64 && typeof entry.finishedAt === 'string' && Number.isFinite(Date.parse(entry.finishedAt)))
    .slice(-500)
    .map(entry => ({ id: entry.id, finishedAt: new Date(entry.finishedAt).toISOString(), ...(validDate(entry.date) ? { date: entry.date } : {}), ...(typeof entry.sessionKey === 'string' && entry.sessionKey.length <= 150 ? { sessionKey: entry.sessionKey } : {}), duration: Math.max(1, Math.min(7200, Math.round(Number(entry.duration) || 1))), targetDuration: Math.max(1, Math.min(7200, Math.round(Number(entry.targetDuration ?? entry.duration) || 1))), completed: entry.completed !== false, favoriteAtStart: entry.favoriteAtStart === true, ...(Number.isInteger(Number(entry.beforeRating)) && Number(entry.beforeRating) >= 1 && Number(entry.beforeRating) <= 5 ? { beforeRating: Number(entry.beforeRating) } : {}), ...(Number.isInteger(Number(entry.afterRating)) && Number(entry.afterRating) >= 1 && Number(entry.afterRating) <= 5 ? { afterRating: Number(entry.afterRating) } : {}), ...(typeof entry.moodAfter === 'string' && /^[a-z-]{1,32}$/.test(entry.moodAfter) ? { moodAfter: entry.moodAfter } : {}), ...(typeof entry.note === 'string' ? { note: entry.note.slice(0, 500) } : {}) }));
  if (!validDate(safe.plan.startDate) || safe.plan.startDate > todayISO()) safe.plan.startDate = todayISO();
  safe.plan.baseline = safe.plan.baseline == null || safe.plan.baseline === '' ? null : (Number.isFinite(Number(safe.plan.baseline)) ? Math.min(99999, Math.max(0, Number(safe.plan.baseline))) : null);
  safe.plan.dailyTarget = Math.min(99999, Math.max(0, Number(safe.plan.dailyTarget) || 0));
  if (!['quit', 'reduce'].includes(safe.plan.strategy)) safe.plan.strategy = 'quit';
  if (!['puffs', 'sessions', 'pods', 'custom'].includes(safe.tracking.unit)) safe.tracking.unit = 'puffs';
  for (const [date, originalRow] of Object.entries(safe.dailyLogs)) {
    if (!validDate(date) || !originalRow || typeof originalRow !== 'object' || Array.isArray(originalRow)) { delete safe.dailyLogs[date]; continue; }
    const row = { ...originalRow };
    safe.dailyLogs[date] = row;
    row.amount = Math.min(99999, Math.max(0, Number(row.amount) || 0));
    row.unit = ['puffs', 'sessions', 'pods', 'custom'].includes(row.unit) ? row.unit : 'puffs';
    row.note = typeof row.note === 'string' ? row.note.slice(0, 4000) : '';
    row.mood = typeof row.mood === 'string' && /^[a-z-]{1,32}$/.test(row.mood) ? row.mood : null;
    row.noUseConfirmed = row.noUseConfirmed === true;
    row.hourly = Array.isArray(row.hourly) ? Array.from({ length: 24 }, (_, i) => Math.min(99999, Math.max(0, Number(row.hourly[i]) || 0))) : Array(24).fill(0);
    row.triggers = Array.isArray(row.triggers) ? [...new Set(row.triggers.filter(t => typeof t === 'string' && /^[a-z-]{1,32}$/.test(t)))].slice(0, 20) : [];
    row.measurements = row.measurements && typeof row.measurements === 'object' && !Array.isArray(row.measurements) ? { ...row.measurements } : {};
    for (const [unit, inputMeasure] of Object.entries(row.measurements)) {
      if (!['puffs', 'sessions', 'pods', 'custom'].includes(unit) || !inputMeasure || typeof inputMeasure !== 'object' || Array.isArray(inputMeasure)) { delete row.measurements[unit]; continue; }
      const measure = { ...inputMeasure };
      measure.amount = Math.min(99999, Math.max(0, Number(measure.amount) || 0));
      measure.hourly = Array.isArray(measure.hourly) ? Array.from({ length: 24 }, (_, i) => Math.min(99999, Math.max(0, Number(measure.hourly[i]) || 0))) : Array(24).fill(0);
      row.measurements[unit] = measure;
    }
  }
  return safe;
}

export function migrateLegacyState(legacy, base = createDefaultState()) {
  if (!legacy || typeof legacy !== 'object') return base;
  const out = createDefaultState();
  const start = validDate(legacy.start) ? legacy.start : out.plan.startDate;
  out.onboardingComplete = true;
  out.plan.startDate = start;
  out.plan.strategy = Number(legacy.limit) > 0 ? 'reduce' : 'quit';
  out.plan.dailyTarget = Math.max(0, Number(legacy.limit) || 0);
  out.plan.baseline = legacy.baseline == null || legacy.baseline === '' ? null : Math.max(0, Number(legacy.baseline) || 0);
  out.tracking = { unit: 'puffs', unitLabel: 'затяжек' };
  for (const [date, old] of Object.entries(legacy.days || {})) {
    if (!validDate(date) || !old || typeof old !== 'object') continue;
    const hourly = Array.isArray(old.h) ? Array.from({ length: 24 }, (_, i) => Math.max(0, Number(old.h[i]) || 0)) : Array(24).fill(0);
    out.dailyLogs[date] = {
      amount: Math.max(0, Number(old.p) || 0),
      unit: 'puffs',
      hourly,
      note: typeof old.n === 'string' ? old.n : '',
      mood: null,
      triggers: [],
      measurements: { puffs: { amount: Math.max(0, Number(old.p) || 0), hourly: [...hourly] } },
      migratedFromV1: true,
    };
  }
  out.lastUseAt = Number(legacy.lastPuffAt) || null;
  out.achievements.urgeCount = Math.max(0, Number(legacy.beaten) || 0);
  out.achievements.celebrated = Array.isArray(legacy.celebrated) ? legacy.celebrated : [];
  out.finance.weeklySpend = legacy.spend == null || legacy.spend === '' ? null : Math.max(0, Number(legacy.spend) || 0);
  out.finance.currency = ['₽', '$', '€', '₴', '₸', 'Br', 'zł'].includes(legacy.cur) ? legacy.cur : '€';
  out.finance.goalName = typeof legacy.goalName === 'string' ? legacy.goalName : '';
  out.finance.goalAmount = legacy.goalAmt == null || legacy.goalAmt === '' ? null : Math.max(0, Number(legacy.goalAmt) || 0);
  out.preferences.remindersEnabled = !!legacy.notif?.on;
  out.preferences.reminderTimes = Array.isArray(legacy.notif?.times) ? legacy.notif.times.slice(0, 3) : out.preferences.reminderTimes;
  out.ui.showStarterHint = !legacy.hideSetup;
  // Keep original local data untouched under vydokh.v1; this function only creates a new object.
  return sanitizeCurrent(out);
}

export function loadState() {
  try {
    const rawNew = localStorage.getItem(STORAGE_KEY);
    if (rawNew) return { state: sanitizeCurrent(JSON.parse(rawNew)), migrated: false, source: 'v4' };
  } catch (_) { /* corrupted current store: attempt the legacy copy below */ }
  try {
    const rawPrevious = localStorage.getItem(PREVIOUS_KEY);
    if (rawPrevious) return { state: sanitizeCurrent(JSON.parse(rawPrevious)), migrated: true, source: 'v3' };
  } catch (_) { /* try v2 next */ }
  try {
    const rawOlder = localStorage.getItem(OLDER_KEY);
    if (rawOlder) return { state: sanitizeCurrent(JSON.parse(rawOlder)), migrated: true, source: 'v2' };
  } catch (_) { /* try the original v1 storage next */ }
  try {
    const rawLegacy = localStorage.getItem(LEGACY_KEY);
    if (rawLegacy) return { state: migrateLegacyState(JSON.parse(rawLegacy)), migrated: true, source: 'v1' };
  } catch (_) { /* default state is safer than blocking startup */ }
  return { state: createDefaultState(), migrated: false, source: 'fresh' };
}

export function saveState(state) {
  const payload = JSON.stringify({ ...state, schemaVersion: 4 });
  localStorage.setItem(STORAGE_KEY, payload);
}

export function exportBundle(state) {
  return {
    app: 'Выдох',
    exportVersion: 4,
    exportedAt: new Date().toISOString(),
    state: { ...state, schemaVersion: 4 },
  };
}

export function importBundle(payload) {
  if (!payload || typeof payload !== 'object' || !payload.state || typeof payload.state !== 'object') {
    throw new Error('Файл не похож на резервную копию «Выдоха».');
  }
  if (Number(payload.exportVersion) > 4) {
    throw new Error('Эта резервная копия создана более новой версией приложения. Обнови «Выдох» перед восстановлением.');
  }
  const version = Number(payload.state.schemaVersion) || 0;
  if (version > 4) {
    throw new Error('Формат данных новее поддерживаемой версии. Исходная история не изменена.');
  }
  const source = version === 1 || payload.state.days ? migrateLegacyState(payload.state) : payload.state;
  return sanitizeCurrent(source);
}
