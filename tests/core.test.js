import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultState, migrateLegacyState, importBundle, loadState, saveState, STORAGE_KEY, PREVIOUS_KEY, OLDER_KEY } from '../src/storage.js';
import { getLog, getStatus, getCleanDays, getWeeklyStats, getSavings, getStreak, getBestStreak, addDays, dateISO, getWeekStartISO, getWeeklyReviewMetrics, hasReportedUseOnDate, getProgressAnalytics, getPracticeAnalytics } from '../src/domain.js';

test('legacy v1 migration preserves date, note, count, hourly history and finances', () => {
  const legacy = {
    start: '2025-01-03', limit: 8, baseline: 22, spend: 35, cur: '€', goalName: 'Путешествие', goalAmt: 500,
    lastPuffAt: 1735900000000, beaten: 4, hideSetup: true,
    days: { '2025-01-04': { p: 3, h: Array.from({ length: 24 }, (_, i) => i === 10 ? 3 : 0), n: 'После кофе' } },
    notif: { on: false, times: ['10:00', '15:00', '21:00'], sent: {} },
  };
  const migrated = migrateLegacyState(legacy);
  assert.equal(migrated.schemaVersion, 4);
  assert.equal(migrated.plan.startDate, '2025-01-03');
  assert.equal(migrated.plan.strategy, 'reduce');
  assert.equal(migrated.dailyLogs['2025-01-04'].amount, 3);
  assert.equal(migrated.dailyLogs['2025-01-04'].note, 'После кофе');
  assert.equal(migrated.dailyLogs['2025-01-04'].hourly[10], 3);
  assert.equal(migrated.dailyLogs['2025-01-04'].measurements.puffs.amount, 3);
  assert.equal(migrated.finance.goalName, 'Путешествие');
  assert.equal(migrated.finance.weeklySpend, 35);
});

test('switching unit does not silently relabel legacy puff records', () => {
  const state = migrateLegacyState({ start: '2025-01-01', limit: 0, days: { '2025-01-02': { p: 5, h: Array(24).fill(0), n: '' } } });
  state.tracking.unit = 'sessions';
  const row = getLog(state, '2025-01-02');
  assert.equal(row.amount, 0);
  assert.equal(row.untracked, true);
  assert.equal(getStatus(state, '2025-01-02'), 'untracked');
  state.dailyLogs['2025-01-02'].measurements.sessions = { amount: 2, hourly: Array(24).fill(0) };
  const sessions = getLog(state, '2025-01-02');
  assert.equal(sessions.amount, 2);
  assert.equal(sessions.untracked, false);
  assert.equal(state.dailyLogs['2025-01-02'].measurements.puffs.amount, 5);
});

test('new empty state has versioned defaults and no fake historical measurements', () => {
  const state = createDefaultState();
  assert.equal(state.schemaVersion, 4);
  assert.equal(state.plan.strategy, 'quit');
  assert.deepEqual(state.dailyLogs, {});
  assert.equal(getLog(state, state.plan.startDate).amount, 0);
});

test('date helpers and weekly chart produce seven stable local dates', () => {
  assert.equal(addDays('2025-03-01', 1), '2025-03-02');
  const state = createDefaultState();
  state.plan.startDate = '2025-01-01';
  const week = getWeeklyStats(state, new Date('2025-01-07T18:00:00'));
  assert.equal(week.length, 7);
  assert.equal(week.at(-1).date, '2025-01-07');
  assert.equal(getCleanDays(state, new Date('2025-01-07T18:00:00')), 7);
});

test('import rejects invalid backup files and accepts exported-shaped bundles', () => {
  assert.throws(() => importBundle({ not: 'a backup' }), /резервн/);
  const state = createDefaultState();
  const restored = importBundle({ app: 'Выдох', exportVersion: 1, state });
  assert.equal(restored.schemaVersion, 4);
  assert.equal(restored.plan.strategy, 'quit');
});


test('import sanitizes custom labels, currency, reminders and malformed calendar entries', () => {
  const base = createDefaultState();
  const restored = importBundle({ state: {
    ...base,
    plan: { ...base.plan, startDate: '2026-02-31', baseline: 'NaN' },
    tracking: { unit: 'custom', unitLabel: '<img src=x onerror=alert(1)>&' },
    finance: { ...base.finance, currency: '<svg onload=alert(1)>', weeklySpend: 'Infinity', goalName: '<b>trip</b>' },
    preferences: { ...base.preferences, reminderTimes: ['99:99', '09:30'], sound: 'false', remindersEnabled: 'true' },
    completedTasks: { '2026-01-01': {}, '2026-01-02': ['one', 3] },
  } });
  assert.equal(restored.plan.startDate, base.plan.startDate);
  assert.equal(restored.plan.baseline, null);
  assert.equal(restored.tracking.unitLabel.includes('<'), false);
  assert.equal(restored.tracking.unitLabel.includes('&'), false);
  assert.equal(restored.finance.currency, '€');
  assert.equal(restored.finance.weeklySpend, null);
  assert.deepEqual(restored.preferences.reminderTimes, ['09:30']);
  assert.equal(restored.preferences.sound, false);
  assert.equal(restored.preferences.remindersEnabled, false);
  assert.deepEqual(restored.completedTasks, { '2026-01-02': ['one'] });
});


test('gradual-reduction savings are not estimated without a baseline for the current unit', () => {
  const state = createDefaultState();
  state.plan.strategy = 'reduce';
  state.plan.startDate = '2025-01-01';
  state.finance.weeklySpend = 35;
  state.plan.baseline = null;
  assert.equal(getSavings(state, new Date('2025-01-07T18:00:00')), null);
  state.plan.baseline = 20;
  assert.equal(getSavings(state, new Date('2025-01-07T18:00:00')), null, 'a baseline alone is not enough without comparable daily measurements');
  state.dailyLogs['2025-01-07'] = { amount: 10, unit: state.tracking.unit, hourly: Array(24).fill(0), note: '', triggers: [], measurements: { [state.tracking.unit]: { amount: 10, hourly: Array(24).fill(0) } } };
  assert.notEqual(getSavings(state, new Date('2025-01-07T18:00:00')), null);
});



test('mixed-unit records are never presented as an unambiguous zero-use day', () => {
  const today = dateISO();
  const state = createDefaultState();
  state.plan.startDate = today;
  state.tracking.unit = 'sessions';
  state.dailyLogs[today] = {
    amount: 5,
    unit: 'puffs',
    hourly: Array(24).fill(0),
    note: '',
    triggers: [],
    measurements: {
      puffs: { amount: 5, hourly: Array(24).fill(0) },
      sessions: { amount: 0, hourly: Array(24).fill(0) },
    },
  };
  const log = getLog(state, today);
  assert.equal(log.amount, 0);
  assert.equal(log.untracked, true);
  assert.equal(getStatus(state, today), 'untracked');
  assert.equal(getWeeklyStats(state).at(-1).amount, null);

  state.dailyLogs[today].measurements.sessions.amount = 2;
  assert.equal(getLog(state, today).amount, 2);
  assert.equal(getLog(state, today).untracked, false);
  assert.equal(getStatus(state, today), 'used');
});

test('import rejects backup formats newer than the application supports', () => {
  const state = createDefaultState();
  assert.throws(
    () => importBundle({ exportVersion: 5, state }),
    /более новой версией/
  );
  assert.throws(
    () => importBundle({ exportVersion: 1, state: { ...state, schemaVersion: 9 } }),
    /новее поддерживаемой версии/
  );
});

test('import sanitation does not mutate the parsed backup object', () => {
  const base = createDefaultState();
  const input = {
    state: {
      ...base,
      dailyLogs: {
        '2026-01-01': {
          amount: '7', unit: 'puffs', note: '<note>', hourly: [1],
          measurements: { puffs: { amount: '7', hourly: [1] } },
          triggers: ['coffee'],
        },
      },
    },
  };
  const originalRow = input.state.dailyLogs['2026-01-01'];
  const imported = importBundle(input);
  assert.equal(originalRow.amount, '7');
  assert.equal(originalRow.note, '<note>');
  assert.equal(originalRow.measurements.puffs.amount, '7');
  assert.equal(imported.dailyLogs['2026-01-01'].amount, 7);
  assert.equal(imported.dailyLogs['2026-01-01'].note, '<note>');
  assert.equal(imported.dailyLogs['2026-01-01'].hourly.length, 24);
});

test('date start from imported data cannot be in the future', () => {
  const base = createDefaultState();
  const future = new Date();
  future.setDate(future.getDate() + 30);
  const futureISO = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}`;
  const restored = importBundle({ state: { ...base, plan: { ...base.plan, startDate: futureISO } } });
  assert.notEqual(restored.plan.startDate, futureISO);
});


test('import drops unknown measurement units so they cannot distort progress or streaks', () => {
  const base = createDefaultState();
  const today = dateISO();
  const restored = importBundle({ state: {
    ...base,
    plan: { ...base.plan, startDate: today },
    dailyLogs: {
      [today]: {
        amount: 0,
        unit: 'puffs',
        hourly: Array(24).fill(0),
        note: '',
        triggers: [],
        measurements: { unknownUnit: { amount: 99, hourly: Array(24).fill(0) } },
      },
    },
  } });
  assert.deepEqual(restored.dailyLogs[today].measurements, {});
  assert.equal(getStatus(restored, today), 'unrecorded');
  assert.equal(getWeeklyStats(restored).at(-1).amount, null);
  assert.equal(getCleanDays(restored), 1, 'elapsed days without a logged use remain a separate counter');
});


test('schema v4 preserves v2 backups and adds new analytics/practice settings compatibly', () => {
  const v2 = createDefaultState();
  v2.schemaVersion = 2;
  v2.cravingLogs = [{ at: '2026-10-12T10:00:00.000Z', durationSeconds: 90, type: 'pause', beforeRating: 4 }];
  const restored = importBundle({ exportVersion: 1, state: v2 });
  assert.equal(restored.schemaVersion, 4);
  assert.equal(restored.cravingLogs.length, 1);
  assert.equal(restored.cravingLogs[0].beforeRating, 4);
  assert.deepEqual(restored.weeklyReviews, {});
});

test('craving diary and weekly review metadata survive sanitization', () => {
  const state = createDefaultState();
  state.cravingLogs = [{
    at: '2026-10-12T10:00:00.000Z', durationSeconds: 120, type: 'craving-checkin',
    beforeRating: 5, afterRating: 2, trigger: 'coffee', emotion: 'anxious',
    action: 'breath', outcome: 'easier', note: 'Вышел на воздух',
  }];
  state.weeklyReviews = { '2026-10-12': { focus: 'trigger-plan', note: 'Подготовить альтернативу', updatedAt: '2026-10-13T10:00:00.000Z' } };
  state.cravingLogs[0].date = '2026-10-12';
  const restored = importBundle({ exportVersion: 2, state });
  assert.deepEqual(restored.cravingLogs[0], state.cravingLogs[0]);
  assert.equal(restored.weeklyReviews['2026-10-12'].focus, 'trigger-plan');
  assert.equal(restored.weeklyReviews['2026-10-12'].note, 'Подготовить альтернативу');
});

test('weekly review summarizes explicit observations without interpreting missing logs as zeroes', () => {
  const state = createDefaultState();
  const today = dateISO(new Date('2026-10-13T12:00:00'));
  state.plan.strategy = 'reduce';
  state.plan.startDate = addDays(today, -6);
  state.tracking.unit = 'sessions';
  const values = [8, 6, 4];
  [0, 1, 5].forEach((offset, index) => {
    const date = addDays(state.plan.startDate, offset);
    state.dailyLogs[date] = { amount: values[index], unit: 'sessions', hourly: Array(24).fill(0), note: '', mood: index === 0 ? 'anxious' : null, triggers: index === 0 ? ['coffee'] : ['stress'], measurements: { sessions: { amount: values[index], hourly: Array(24).fill(0) } } };
  });
  state.cravingLogs = [
    { at: `${addDays(state.plan.startDate, 1)}T10:00:00.000Z`, type: 'craving-checkin', trigger: 'coffee', emotion: 'anxious', action: 'breath', beforeRating: 4, afterRating: 2, outcome: 'easier' },
    { at: `${addDays(state.plan.startDate, 4)}T10:00:00.000Z`, type: 'slip', trigger: 'stress', emotion: 'stressed', action: 'restart-plan' },
  ];
  state.practiceSessions = [{ id: 'calm-46', finishedAt: `${today}T10:00:00.000Z`, duration: 120 }];
  const metrics = getWeeklyReviewMetrics(state, new Date(`${today}T12:00:00`));
  assert.equal(metrics.cravingCount, 1);
  assert.equal(metrics.slipCount, 1);
  assert.equal(metrics.trackedDays, 3, 'only dates with an explicit quantity measurement count as tracked');
  assert.equal(metrics.noUseDays, 0, 'unlogged and context-only days must not be inferred as zero-use days');
  assert.equal(metrics.practices, 1);
  assert.equal(metrics.topTriggers[0][0], 'coffee');
  assert.equal(metrics.topActions[0][0], 'breath');
  assert.equal(metrics.trend, 'down');
  assert.match(getWeekStartISO(today), /^\d{4}-\d{2}-\d{2}$/);
});


test('loadState upgrades vydokh.v2 to schema v4 without deleting the old key', () => {
  const v2 = createDefaultState();
  v2.schemaVersion = 2;
  v2.plan.startDate = '2026-10-01';
  const store = new Map([[OLDER_KEY, JSON.stringify(v2)]]);
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: key => store.has(key) ? store.get(key) : null,
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: key => store.delete(key),
    },
  });
  try {
    const loaded = loadState();
    assert.equal(loaded.source, 'v2');
    assert.equal(loaded.migrated, true);
    assert.equal(loaded.state.schemaVersion, 4);
    saveState(loaded.state);
    assert.ok(store.has(STORAGE_KEY));
    assert.ok(store.has(OLDER_KEY));
    assert.equal(JSON.parse(store.get(OLDER_KEY)).schemaVersion, 2);
  } finally {
    if (originalDescriptor) Object.defineProperty(globalThis, 'localStorage', originalDescriptor);
    else delete globalThis.localStorage;
  }
});


test('a reported slip affects the current streak without deleting the prior best streak', () => {
  const now = new Date('2026-10-13T18:00:00');
  const today = dateISO(now);
  const state = createDefaultState();
  state.plan.startDate = addDays(today, -6);
  state.plan.strategy = 'quit';
  assert.equal(getStreak(state, now), 7);
  assert.equal(getBestStreak(state, now), 7);

  state.cravingLogs.push({ at: `${today}T10:00:00.000Z`, date: today, type: 'slip', durationSeconds: 0 });
  assert.equal(hasReportedUseOnDate(state, today), true);
  assert.equal(getStreak(state, now), 0, 'the current run reflects a reported use episode');
  assert.equal(getStatus(state, today), 'used');
  assert.equal(getWeeklyStats(state, now).at(-1).amount, null, 'unknown amount is not plotted as zero');
  assert.equal(getBestStreak(state, now), 6, 'the past best run remains available');
  assert.equal(getCleanDays(state, now), 6, 'the slip day is not counted as a no-use day');
  state.finance.weeklySpend = 70;
  const savingsWithSlip = getSavings(state, now);
  const withoutSlip = { ...state, cravingLogs: [] };
  assert.ok(savingsWithSlip < getSavings(withoutSlip, now), 'an unquantified slip day is excluded from estimated savings');
});

test('weekly review does not count context-only rows as confirmed zero-use measurements', () => {
  const state = createDefaultState();
  const now = new Date('2026-10-13T12:00:00');
  state.plan.startDate = addDays(dateISO(now), -6);
  state.dailyLogs[dateISO(now)] = { amount: 0, unit: 'puffs', hourly: Array(24).fill(0), note: 'Напряжённый день', mood: 'anxious', triggers: ['stress'], measurements: {} };
  const metrics = getWeeklyReviewMetrics(state, now);
  assert.equal(metrics.trackedDays, 0);
  assert.equal(metrics.noUseDays, 0);
  assert.equal(metrics.recordedDays, 1);
});


test('local event date survives storage sanitation independently of the UTC timestamp', () => {
  const state = createDefaultState();
  state.cravingLogs = [{ at: '2026-10-13T22:30:00.000Z', date: '2026-10-14', type: 'slip' }];
  const restored = importBundle({ exportVersion: 2, state });
  assert.equal(hasReportedUseOnDate(restored, '2026-10-14'), true);
  assert.equal(hasReportedUseOnDate(restored, '2026-10-13'), false);
});


test('an unquantified use-context in gradual reduction is recorded as context, not a nicotine-free zero', () => {
  const state = createDefaultState();
  const now = new Date('2026-10-13T18:00:00');
  const today = dateISO(now);
  state.plan.startDate = addDays(today, -2);
  state.plan.strategy = 'reduce';
  state.tracking.unit = 'sessions';
  state.dailyLogs[today] = { amount: 0, unit: 'sessions', hourly: Array(24).fill(0), note: 'Контекст', mood: null, triggers: ['stress'], measurements: {} };
  state.cravingLogs.push({ at: `${today}T16:00:00.000Z`, date: today, type: 'use-context', trigger: 'stress' });
  assert.equal(getStatus(state, today), 'used');
  assert.equal(getWeeklyStats(state, now).at(-1).amount, null);
  const metrics = getWeeklyReviewMetrics(state, now);
  assert.equal(metrics.useContextCount, 1);
  assert.equal(metrics.noUseDays, 0);
});


test('progress analytics tracks only measured days and never treats unknown days as zero', () => {
  const state = createDefaultState();
  state.plan.strategy = 'reduce';
  state.plan.startDate = '2026-10-01';
  state.plan.baseline = 10;
  state.tracking.unit = 'puffs';
  state.dailyLogs['2026-10-11'] = { amount: 7, unit: 'puffs', measurements: { puffs: { amount: 7, hourly: Array(24).fill(0) } }, triggers: ['coffee'], mood: 'anxious' };
  state.dailyLogs['2026-10-12'] = { amount: 3, unit: 'puffs', measurements: { puffs: { amount: 3, hourly: Array(24).fill(0) } }, triggers: ['coffee', 'stress'], mood: 'anxious' };
  state.dailyLogs['2026-10-13'] = { amount: 0, unit: 'puffs', noUseConfirmed: true, measurements: {}, triggers: [], mood: null };
  const metrics = getProgressAnalytics(state, 'week', new Date('2026-10-13T12:00:00'));
  assert.equal(metrics.trackedDays, 3);
  assert.equal(metrics.average, 10/3);
  assert.equal(metrics.baseline, 10);
  assert.ok(metrics.deltaPercent > 60);
  assert.equal(metrics.topTriggers[0][0], 'coffee');
  assert.equal(metrics.topMoods[0][0], 'anxious');
  assert.equal(metrics.zeroUseDays, 1);
  assert.equal(metrics.buckets.length, 7);
  assert.equal(metrics.buckets.find(row => row.date === '2026-10-10')?.value, null);
});

test('practice analytics respects range and counts only completed minutes in total', () => {
  const state = createDefaultState();
  state.plan.startDate = '2026-10-01';
  state.practiceSessions = [
    { id: 'natural', date: '2026-10-13', finishedAt: '2026-10-13T12:00:00Z', duration: 180, completed: true, favoriteAtStart: true },
    { id: 'calm-46', date: '2026-10-12', finishedAt: '2026-10-12T12:00:00Z', duration: 60, completed: true },
    { id: 'box', date: '2026-10-02', finishedAt: '2026-10-02T12:00:00Z', duration: 240, completed: false },
  ];
  const metrics = getPracticeAnalytics(state, 'week', new Date('2026-10-13T12:00:00'));
  assert.equal(metrics.completedCount, 2);
  assert.equal(metrics.interruptedCount, 0, 'the interrupted September session is outside the selected week');
  assert.equal(metrics.minutes, 4);
  assert.equal(metrics.favoriteUses, 1);
  assert.equal(metrics.topPractices[0][0], 'natural');
  const all = getPracticeAnalytics(state, 'all', new Date('2026-10-13T12:00:00'));
  assert.equal(all.interruptedCount, 1);
});

test('practice session feedback, favorites and settings survive storage normalization', () => {
  const state = createDefaultState();
  state.practiceSettings = { favorites: ['natural', 'slow-35'], durations: { natural: 3, 'slow-35': 10 }, vibration: true };
  state.preferences.sound = true;
  state.practiceSessions = [{ id: 'natural', sessionKey: '2026-10-13T10:00:00.000Z|natural', date: '2026-10-13', finishedAt: '2026-10-13T10:00:00.000Z', duration: 180, targetDuration: 180, completed: true, favoriteAtStart: true, beforeRating: 4, afterRating: 2, moodAfter: 'calm', note: 'Стало спокойнее' }];
  const restored = importBundle({ exportVersion: 4, state });
  assert.deepEqual(restored.practiceSettings.favorites, ['natural', 'slow-35']);
  assert.equal(restored.practiceSettings.durations['slow-35'], 10);
  assert.equal(restored.practiceSettings.vibration, true);
  assert.equal(restored.preferences.sound, true);
  assert.equal(restored.practiceSessions[0].afterRating, 2);
  assert.equal(restored.practiceSessions[0].moodAfter, 'calm');
  assert.equal(restored.practiceSessions[0].note, 'Стало спокойнее');
});


test('unknown days stay unknown until the user explicitly confirms no use', () => {
  const today = dateISO();
  const state = createDefaultState();
  state.plan.startDate = today;
  assert.equal(getStatus(state, today), 'unrecorded');
  assert.equal(getWeeklyStats(state).at(-1).amount, null);
  assert.equal(getProgressAnalytics(state, 'week').buckets.at(-1).value, null);
  state.dailyLogs[today] = { amount: 0, unit: state.tracking.unit, hourly: Array(24).fill(0), note: '', triggers: [], measurements: {}, noUseConfirmed: true };
  assert.equal(getStatus(state, today), 'clear');
  assert.equal(getWeeklyStats(state).at(-1).amount, 0);
  assert.equal(getProgressAnalytics(state, 'week').buckets.at(-1).value, 0);
});

test('an unquantified use episode cannot enter reduction analytics as a zero', () => {
  const today = dateISO();
  const state = createDefaultState();
  state.plan.startDate = today;
  state.plan.strategy = 'reduce';
  state.tracking.unit = 'puffs';
  state.plan.baseline = 20;
  state.finance.weeklySpend = 35;
  state.dailyLogs[today] = { amount: 0, unit: 'puffs', hourly: Array(24).fill(0), note: '', triggers: [], measurements: { puffs: { amount: 0, hourly: Array(24).fill(0) } } };
  state.cravingLogs = [{ type: 'use-context', date: today, at: `${today}T12:00:00`, trigger: 'stress' }];
  assert.equal(getWeeklyStats(state).at(-1).amount, null);
  assert.equal(getProgressAnalytics(state, 'week').buckets.at(-1).value, null);
  assert.equal(getSavings(state, new Date(`${today}T18:00:00`)), null, 'no comparable usage measurements means no savings estimate');
});


test('quit-mode savings do not resume on unknown days after a reported use episode', () => {
  const today = dateISO();
  const state = createDefaultState();
  state.plan.strategy = 'quit';
  state.plan.startDate = today;
  state.finance.weeklySpend = 35;
  state.cravingLogs = [{ type: 'slip', date: today, at: `${today}T10:00:00.000Z` }];
  assert.equal(getSavings(state, new Date(`${today}T18:00:00`)), null, 'no comparable day remains for a savings estimate');
  state.dailyLogs[today] = { amount: 4, unit: state.tracking.unit, hourly: Array(24).fill(0), note: '', triggers: [], measurements: { [state.tracking.unit]: { amount: 4, hourly: Array(24).fill(0) } } };
  assert.equal(getSavings(state, new Date(`${today}T18:00:00`)), 0, 'a quantified use day can be calculated using recorded data');
});
