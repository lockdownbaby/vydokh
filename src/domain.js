export const pad = n => String(n).padStart(2, '0');
export const dateISO = (date = new Date()) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
export const parseISO = value => new Date(`${value}T12:00:00`);
export const addDays = (value, n) => { const d = parseISO(value); d.setDate(d.getDate() + n); return dateISO(d); };
export const dayDifference = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 86400000);
export const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
export const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export const MONTHS_NOM = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
export const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
export const WEEKDAYS_LONG = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
export const plural = (n, forms) => { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? forms[2] : b > 1 && b < 5 ? forms[1] : b === 1 ? forms[0] : forms[2]; };
export const formatLongDate = (value) => { const d = parseISO(value); return `${WEEKDAYS_LONG[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`; };
export const formatShortDate = (value) => { const d = parseISO(value); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };
export const formatMoney = (value, currency = '€') => {
  const n = Math.max(0, Number(value) || 0);
  try { return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: n < 100 ? 1 : 0 }).format(n)} ${currency}`; }
  catch (_) { return `${Math.round(n)} ${currency}`; }
};
export const formatDuration = seconds => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
export const prettyUnit = unit => ({ puffs: ['затяжка', 'затяжки', 'затяжек'], sessions: ['сеанс', 'сеанса', 'сеансов'], pods: ['картридж', 'картриджа', 'картриджей'], custom: ['единица', 'единицы', 'единиц'] }[unit] || ['единица', 'единицы', 'единиц']);

export function hasReportedUseOnDate(state, date) {
  return Array.isArray(state?.cravingLogs) && state.cravingLogs.some(entry => ['slip', 'use-context'].includes(entry?.type) && (entry.date || String(entry.at || '').slice(0, 10)) === date);
}

export function hasRecordedMeasurement(state, row, log) {
  if (!row || !log || log.untracked) return false;
  const unit = state.tracking?.unit || 'puffs';
  if (row.measurements && Object.prototype.hasOwnProperty.call(row.measurements, unit)) return true;
  if (row.noUseConfirmed === true) return true;
  // Older records without per-unit measurements remain usable when they contain a positive value.
  return row.unit === unit && Number(row.amount) > 0;
}

export function getLog(state, date = dateISO()) {
  const row = state.dailyLogs[date];
  const unit = state.tracking?.unit || 'puffs';
  if (!row) return { amount: 0, unit, hourly: Array(24).fill(0), note: '', mood: null, triggers: [], untracked: false };

  const measurements = row.measurements && typeof row.measurements === 'object' ? row.measurements : {};
  const otherUnitHasUse = Object.entries(measurements)
    .some(([key, measure]) => key !== unit && Number(measure?.amount || 0) > 0);

  if (measurements[unit]) {
    const selected = measurements[unit];
    const amount = Math.max(0, Number(selected.amount) || 0);
    // If this date contains use recorded in another unit but the active unit is
    // zero, don't label it as an unambiguous no-use day.
    const ambiguous = amount === 0 && otherUnitHasUse;
    return {
      ...row,
      ...selected,
      amount,
      unit,
      note: row.note || '',
      triggers: Array.isArray(row.triggers) ? row.triggers : [],
      untracked: ambiguous,
    };
  }

  if (!row.unit || row.unit === unit) {
    const amount = Math.max(0, Number(row.amount) || 0);
    return { ...row, amount, unit, untracked: amount === 0 && otherUnitHasUse };
  }

  // Keep old measurements visible under their original unit; do not silently relabel them.
  return { ...row, amount: 0, hourly: Array(24).fill(0), unit, untracked: true };
}

export function getStreak(state, now = new Date()) {
  const start = state.plan.startDate;
  const today = dateISO(now);
  if (start > today) return 0;
  let lastUseDay = null;
  for (const [date, row] of Object.entries(state.dailyLogs)) {
    const anyUse = Number(row.amount || 0) > 0 || Object.values(row.measurements || {}).some(measure => Number(measure?.amount || 0) > 0) || hasReportedUseOnDate(state, date);
    if (date >= start && date <= today && anyUse && (!lastUseDay || date > lastUseDay)) lastUseDay = date;
  }
  for (const entry of state.cravingLogs || []) {
    const date = entry?.date || String(entry?.at || '').slice(0, 10);
    if (entry?.type === 'slip' && date >= start && date <= today && (!lastUseDay || date > lastUseDay)) lastUseDay = date;
  }
  if (!lastUseDay) return Math.max(0, dayDifference(start, today) + 1);
  const log = state.dailyLogs[lastUseDay] || {};
  const anyUseToday = lastUseDay === today && (Number(log.amount || 0) > 0 || Object.values(log.measurements || {}).some(measure => Number(measure?.amount || 0) > 0) || hasReportedUseOnDate(state, today));
  if (anyUseToday) return 0;
  return Math.max(0, dayDifference(addDays(lastUseDay, 1), today));
}

export function getCleanDays(state, now = new Date()) {
  const today = dateISO(now); let count = 0;
  for (let d = state.plan.startDate; d <= today; d = addDays(d, 1)) {
    const row = state.dailyLogs[d];
    if (!row) { if (!hasReportedUseOnDate(state, d)) count++; continue; }
    const anyUse = Number(row.amount || 0) > 0 || Object.values(row.measurements || {}).some(measure => Number(measure?.amount || 0) > 0) || hasReportedUseOnDate(state, d);
    if (!anyUse) count++;
  }
  return count;
}

export function getBestStreak(state, now = new Date()) {
  const today = dateISO(now), start = state.plan.startDate;
  let best = 0, run = 0;
  for (let d = start; d <= today; d = addDays(d, 1)) {
    const row = state.dailyLogs[d];
    const anyUse = (row && (Number(row.amount || 0) > 0 || Object.values(row.measurements || {}).some(measure => Number(measure?.amount || 0) > 0))) || hasReportedUseOnDate(state, d);
    if (!anyUse) { run++; best = Math.max(best, run); }
    else run = 0;
  }
  return best;
}

export function getWeeklyStats(state, now = new Date()) {
  const today = dateISO(now);
  return Array.from({ length: 7 }, (_, index) => {
    const date = addDays(today, index - 6);
    const log = getLog(state, date);
    const row = state.dailyLogs?.[date];
    const measured = hasRecordedMeasurement(state, row, log) && !log.untracked;
    const unquantifiedUse = hasReportedUseOnDate(state, date) && (log.untracked || Number(log.amount || 0) === 0);
    return { date, amount: date < state.plan.startDate || !measured || unquantifiedUse ? null : Number(log.amount || 0), today: date === today };
  });
}

export function getSavings(state, now = new Date()) {
  const weekly = Number(state.finance.weeklySpend);
  if (!Number.isFinite(weekly) || weekly <= 0) return null;
  const baseline = Number(state.plan.baseline);
  if (state.plan.strategy === 'reduce' && (!Number.isFinite(baseline) || baseline <= 0)) return null;
  const start = state.plan.startDate, today = dateISO(now);
  let sum = 0;
  let comparableDays = 0;
  let countedDays = 0;
  let useReportedBefore = false;
  for (let d = start; d <= today; d = addDays(d, 1)) {
    const from = parseISO(d).getTime(), to = parseISO(addDays(d, 1)).getTime();
    const share = Math.max(0, (Math.min(to, now.getTime()) - Math.max(from, parseISO(start).getTime())) / (to - from));
    if (!share) continue;
    const log = getLog(state, d);
    const reportedUse = hasReportedUseOnDate(state, d);
    const measured = hasRecordedMeasurement(state, state.dailyLogs?.[d], log) && !log.untracked;
    // In reduction mode, only estimate savings for measured days in the selected unit.
    // In quit mode the quit date is an assumption only until a reported use episode; after that,
    // days without a measurement are unknown and are not silently treated as nicotine-free.
    if (state.plan.strategy === 'reduce' && !measured) continue;
    if (state.plan.strategy === 'quit' && useReportedBefore && !measured) continue;
    if (log.untracked || (reportedUse && Number(log.amount || 0) === 0)) {
      if (state.plan.strategy === 'quit' && reportedUse) useReportedBefore = true;
      continue;
    }
    if (state.plan.strategy === 'quit' && reportedUse) useReportedBefore = true;
    if (state.plan.strategy === 'reduce') comparableDays++;
    countedDays++;
    const used = Number(log.amount || 0);
    const keep = baseline > 0 ? clamp(1 - used / baseline, 0, 1) : (used === 0 ? 1 : 0);
    sum += weekly / 7 * share * keep;
  }
  if ((state.plan.strategy === 'reduce' && comparableDays === 0) || (state.plan.strategy === 'quit' && countedDays === 0)) return null;
  return sum;
}

export function getStatus(state, date) {
  const today = dateISO();
  if (date < state.plan.startDate) return 'before';
  if (date > today) return 'future';
  const log = getLog(state, date);
  if (hasReportedUseOnDate(state, date)) return 'used';
  if (log.untracked) return 'untracked';
  if (!hasRecordedMeasurement(state, state.dailyLogs?.[date], log)) return 'unrecorded';
  const amount = Number(log.amount || 0);
  if (amount === 0) return 'clear';
  if (state.plan.strategy === 'reduce' && state.plan.dailyTarget > 0 && amount <= state.plan.dailyTarget) return 'within';
  return 'used';
}

export function getUnitLabel(state) {
  const unit = state.tracking.unit;
  return ({ puffs: 'затяжек', sessions: 'сеансов', pods: 'картриджей', custom: state.tracking.unitLabel || 'единиц' })[unit] || 'единиц';
}

/** Monday of the local calendar week, in YYYY-MM-DD format. */
export function getWeekStartISO(value = dateISO()) {
  const day = parseISO(value);
  const mondayOffset = (day.getDay() + 6) % 7;
  day.setDate(day.getDate() - mondayOffset);
  return dateISO(day);
}

/** A descriptive, local-only summary of the last seven days. Counts are observations, not diagnoses. */
export function getWeeklyReviewMetrics(state, now = new Date()) {
  const end = dateISO(now);
  const start = addDays(end, -6);
  const dates = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const logs = dates.map(date => ({ date, row: state.dailyLogs?.[date], log: getLog(state, date) }));
  const tracked = logs.filter(item => item.date >= state.plan.startDate && hasRecordedMeasurement(state, item.row, item.log) && !(hasReportedUseOnDate(state, item.date) && Number(item.log.amount) === 0));
  const recordedDays = logs.filter(({ row, date }) => (row && ((Number(row.amount) || 0) > 0 || Object.values(row.measurements || {}).some(m => Number(m?.amount) > 0) || row.note || (row.triggers || []).length || row.mood)) || hasReportedUseOnDate(state, date));
  const noUseDays = tracked.filter(({ log }) => Number(log.amount) === 0).length;
  // A reported slip has no reliable amount unless one was recorded, so exclude that day from quantity comparison.
  const comparable = logs.filter(({ row, log, date }) => date >= state.plan.startDate && hasRecordedMeasurement(state, row, log) && !(hasReportedUseOnDate(state, date) && Number(log.amount) === 0));
  const earlyValues = comparable.filter(({ date }) => date <= addDays(start, 2)).map(({ log }) => Number(log.amount) || 0);
  const lateValues = comparable.filter(({ date }) => date >= addDays(start, 4)).map(({ log }) => Number(log.amount) || 0);
  const mean = list => list.length ? list.reduce((sum, value) => sum + value, 0) / list.length : null;
  const beforeMean = mean(earlyValues);
  const afterMean = mean(lateValues);
  const triggers = new Map();
  const emotions = new Map();
  const actions = new Map();
  const outcomeCounts = new Map();
  for (const { row } of logs) {
    for (const trigger of (row?.triggers || [])) triggers.set(trigger, (triggers.get(trigger) || 0) + 1);
    if (row?.mood) emotions.set(row.mood, (emotions.get(row.mood) || 0) + 1);
  }
  const cravings = (state.cravingLogs || []).filter(entry => {
    const date = entry.date || String(entry.at || '').slice(0, 10);
    return date >= start && date <= end;
  });
  for (const entry of cravings) {
    // Slip reviews are also attached to the calendar day above; don't double-count their trigger/emotion.
    const useContext = ['slip', 'use-context'].includes(entry.type);
    if (!useContext && entry.trigger) triggers.set(entry.trigger, (triggers.get(entry.trigger) || 0) + 1);
    if (!useContext && entry.emotion) emotions.set(entry.emotion, (emotions.get(entry.emotion) || 0) + 1);
    if (!useContext && entry.action) actions.set(entry.action, (actions.get(entry.action) || 0) + 1);
    if (!useContext && entry.outcome) outcomeCounts.set(entry.outcome, (outcomeCounts.get(entry.outcome) || 0) + 1);
  }
  const sortCounts = map => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const helpfulActionCounts = new Map();
  for (const entry of cravings) {
    const lowerRating = Number.isInteger(Number(entry.beforeRating)) && Number.isInteger(Number(entry.afterRating)) && Number(entry.afterRating) < Number(entry.beforeRating);
    if (!['slip', 'use-context'].includes(entry.type) && entry.action && (entry.outcome === 'easier' || lowerRating)) helpfulActionCounts.set(entry.action, (helpfulActionCounts.get(entry.action) || 0) + 1);
  }
  const practices = (state.practiceSessions || []).filter(entry => {
    const date = String(entry.finishedAt || '').slice(0, 10);
    return date >= start && date <= end;
  });
  const taskCompletions = dates.reduce((sum, date) => sum + (state.completedTasks?.[date]?.length || 0), 0);
  return {
    start,
    end,
    recordedDays: recordedDays.length,
    noUseDays,
    trackedDays: tracked.length,
    cravingCount: cravings.filter(entry => !['slip', 'use-context'].includes(entry.type)).length,
    slipCount: cravings.filter(entry => entry.type === 'slip').length,
    useContextCount: cravings.filter(entry => entry.type === 'use-context').length,
    pauseCount: cravings.filter(entry => entry.type === 'pause' || entry.type === 'practice-handoff' || (entry.type === 'craving-checkin' && Number(entry.durationSeconds) > 0)).length,
    practices: practices.length,
    practiceMinutes: Math.round(practices.reduce((sum, entry) => sum + (Number(entry.duration) || 0), 0) / 60),
    taskCompletions,
    topTriggers: sortCounts(triggers),
    topEmotions: sortCounts(emotions),
    topActions: sortCounts(actions),
    helpfulActions: sortCounts(helpfulActionCounts),
    outcomes: Object.fromEntries(outcomeCounts),
    beforeMean,
    afterMean,
    trend: beforeMean == null || afterMean == null ? 'unknown' : afterMean < beforeMean ? 'down' : afterMean > beforeMean ? 'up' : 'steady',
    unit: state.tracking?.unit || 'puffs',
  };
}


function hasMeasuredValueForUnit(state, date, row) {
  if (!row || typeof row !== 'object') return false;
  const unit = state.tracking?.unit || 'puffs';
  if (row.measurements && Object.prototype.hasOwnProperty.call(row.measurements, unit)) return true;
  if (row.noUseConfirmed === true) return true;
  return row.unit === unit && Number(row.amount) > 0;
}

function rangeStart(range, state, now) {
  const end = dateISO(now);
  if (range === 'month') return addDays(end, -29);
  if (range === 'all') return state.plan.startDate <= end ? state.plan.startDate : end;
  return addDays(end, -6);
}

/** Honest usage analytics: unknown days remain null, explicit zeroes require an explicit measurement/no-use confirmation. */
export function getProgressAnalytics(state, range = 'week', now = new Date()) {
  const end = dateISO(now);
  const start = rangeStart(range, state, now);
  const days = [];
  for (let date = start; date <= end; date = addDays(date, 1)) {
    const row = state.dailyLogs?.[date];
    const log = getLog(state, date);
    const reported = hasReportedUseOnDate(state, date);
    const measured = date >= state.plan.startDate && hasMeasuredValueForUnit(state, date, row) && !log.untracked && !(reported && Number(log.amount || 0) === 0);
    days.push({ date, value: measured ? Number(log.amount) || 0 : null, measured, reported, triggers: row?.triggers || [], mood: row?.mood || null });
  }
  let buckets;
  if (range === 'week') {
    buckets = days.map(day => ({ ...day, label: String(Number(day.date.slice(-2))), title: formatShortDate(day.date), count: day.value === null ? 0 : 1, sum: day.value === null ? 0 : day.value }));
  } else {
    const chunkSize = range === 'month' ? 3 : days.length <= 45 ? 1 : days.length <= 180 ? 7 : 30;
    buckets = [];
    for (let i = 0; i < days.length; i += chunkSize) {
      const chunk = days.slice(i, i + chunkSize);
      const known = chunk.filter(day => day.value !== null);
      const first = chunk[0], last = chunk.at(-1);
      buckets.push({
        date: first.date,
        label: chunkSize === 1 ? (range === 'all' ? formatShortDate(first.date) : String(Number(first.date.slice(-2)))) : (first.date === last.date ? formatShortDate(first.date) : first.date.slice(0, 7) === last.date.slice(0, 7) ? `${Number(first.date.slice(-2))}–${Number(last.date.slice(-2))}` : `${formatShortDate(first.date)}–${formatShortDate(last.date)}`),
        title: first.date === last.date ? formatLongDate(first.date) : `${formatShortDate(first.date)} — ${formatShortDate(last.date)}`,
        value: known.length ? known.reduce((sum, day) => sum + day.value, 0) / known.length : null,
        count: known.length,
        sum: known.reduce((sum, day) => sum + day.value, 0),
        reported: chunk.some(day => day.reported),
      });
    }
  }
  const recorded = days.filter(day => day.value !== null);
  const average = recorded.length ? recorded.reduce((sum, day) => sum + day.value, 0) / recorded.length : null;
  const baseline = Number(state.plan?.baseline);
  const baselineComparable = Number.isFinite(baseline) && baseline > 0 && average !== null;
  const deltaPercent = baselineComparable ? ((baseline - average) / baseline) * 100 : null;
  const triggerCounts = new Map();
  const moodCounts = new Map();
  for (const day of days) {
    for (const trigger of day.triggers) triggerCounts.set(trigger, (triggerCounts.get(trigger) || 0) + 1);
    if (day.mood) moodCounts.set(day.mood, (moodCounts.get(day.mood) || 0) + 1);
  }
  const cravingLogs = (state.cravingLogs || []).filter(entry => {
    const date = entry.date || String(entry.at || '').slice(0, 10);
    return date >= start && date <= end;
  });
  // Context captured during craving check-ins is also part of the user's observations.
  // These counts mean recorded mentions, not proven causal triggers.
  for (const entry of cravingLogs) {
    if (entry.trigger) triggerCounts.set(entry.trigger, (triggerCounts.get(entry.trigger) || 0) + 1);
    if (entry.emotion) moodCounts.set(entry.emotion, (moodCounts.get(entry.emotion) || 0) + 1);
  }
  for (const entry of (state.practiceSessions || []).filter(item => { const date = item.date || String(item.finishedAt || '').slice(0, 10); return date >= start && date <= end && item.moodAfter; })) {
    if (entry.moodAfter) moodCounts.set(entry.moodAfter, (moodCounts.get(entry.moodAfter) || 0) + 1);
  }
  const top = map => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const sessions = (state.practiceSessions || []).filter(entry => {
    const date = entry.date || String(entry.finishedAt || '').slice(0, 10);
    return date >= start && date <= end;
  });
  const completedSessions = sessions.filter(entry => entry.completed !== false);
  const ratedBreath = cravingLogs.filter(entry => entry.action === 'breath' && Number.isInteger(entry.beforeRating) && Number.isInteger(entry.afterRating));
  const lowerAfterBreath = ratedBreath.filter(entry => entry.afterRating < entry.beforeRating).length;
  const moodLinkedEntries = cravingLogs.filter(entry => entry.emotion && (entry.trigger || entry.outcome || entry.action));
  return {
    range, start, end, buckets, trackedDays: recorded.length,
    daysWithReportedUse: days.filter(day => day.reported).length,
    average, baseline: baselineComparable ? baseline : null, deltaPercent,
    totalRecorded: recorded.reduce((sum, day) => sum + day.value, 0),
    zeroUseDays: recorded.filter(day => day.value === 0 && !day.reported).length,
    topTriggers: top(triggerCounts), topMoods: top(moodCounts),
    practiceCount: completedSessions.length,
    practiceMinutes: Math.round(completedSessions.reduce((sum, entry) => sum + (Number(entry.duration) || 0), 0) / 60),
    interruptedPractices: sessions.filter(entry => entry.completed === false).length,
    cravingCount: cravingLogs.filter(entry => !['slip', 'use-context'].includes(entry.type)).length,
    moodLinkedEpisodes: moodLinkedEntries.length,
    ratedBreathCount: ratedBreath.length,
    lowerAfterBreath,
    unit: state.tracking?.unit || 'puffs',
  };
}

export function getPracticeAnalytics(state, range = 'month', now = new Date()) {
  const end = dateISO(now);
  const start = range === 'all' ? state.plan.startDate : addDays(end, range === 'week' ? -6 : -29);
  const sessions = (state.practiceSessions || []).filter(entry => {
    const date = entry.date || String(entry.finishedAt || '').slice(0, 10);
    return date >= start && date <= end;
  });
  const completed = sessions.filter(entry => entry.completed !== false);
  const byId = new Map();
  for (const entry of completed) byId.set(entry.id, (byId.get(entry.id) || 0) + 1);
  const topPractices = [...byId.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  return {
    start, end,
    completedCount: completed.length,
    interruptedCount: sessions.filter(entry => entry.completed === false).length,
    minutes: Math.round(completed.reduce((sum, entry) => sum + (Number(entry.duration) || 0), 0) / 60),
    favoriteUses: completed.filter(entry => entry.favoriteAtStart).length,
    topPractices,
    sessions,
  };
}
