import { icon } from './icons.js';
import { PRACTICES, TIP_CATEGORIES, TIP_LEVELS, TIP_SITUATIONS, TIPS, REASONS, MILESTONES } from './content.js';
import { loadState, saveState, STORAGE_KEY, createDefaultState, exportBundle, importBundle } from './storage.js';
import { addDays, dateISO, formatLongDate, formatShortDate, formatMoney, formatDuration, getBestStreak, getCleanDays, getLog, getSavings, getStatus, getStreak, getWeeklyStats, MONTHS_NOM, MONTHS, WEEKDAYS, plural, prettyUnit, getUnitLabel, clamp, getWeekStartISO, getWeeklyReviewMetrics, hasReportedUseOnDate, hasRecordedMeasurement, getProgressAnalytics, getPracticeAnalytics } from './domain.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const root = $('#app');
const today = () => dateISO();

const loaded = loadState();
let state = loaded.state;
if (loaded.migrated) {
  try { saveState(state); } catch (_) { /* keep migrated state in memory; legacy key remains untouched */ }
}
let activeTab = 'today';
let lastRenderedTab = null;
let tipCategory = 'all';
let tipSearch = '';
let tipLevel = 'all';
let tipSituation = 'all';
let practiceFavoritesOnly = false;
let selectedCalendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let overlay = null;
let toastTimer = null;
let practiceTimer = null;
let cravingTimer = null;
let activePractice = null;
let practiceStartedAt = null;
let practiceElapsedBeforePause = 0;
let practicePaused = false;
let practiceResultDraft = { afterRating: null, mood: '', note: '' };
let practiceResultSessionKey = '';
let practiceFromCraving = false;
let practiceHandoffAt = '';
let cravingStartedAt = null;
let cravingRemaining = 300;
let cravingDraft = freshCravingDraft();
let slipDraft = freshSlipDraft();
let soundContext = null;
let lastPracticePhase = null;
let lastReason = Math.floor(Math.random() * REASONS.length);
let importInput = null;
let overlayTrigger = null;
const TRIGGER_OPTIONS = [
  ['stress', 'Стресс'], ['boredom', 'Скука'], ['coffee', 'Кофе'], ['after-meal', 'После еды'],
  ['work-break', 'Перерыв'], ['social', 'Компания'], ['habit', 'Автоматически'], ['other', 'Другое'],
];
const EMOTION_OPTIONS = [
  ['anxious', 'Тревога'], ['stressed', 'Напряжение'], ['bored', 'Скука'], ['tired', 'Усталость'],
  ['lonely', 'Одиночество'], ['calm', 'Спокойствие'], ['irritated', 'Раздражение'], ['other', 'Другое'],
];
const ACTION_OPTIONS = [
  ['pause', 'Пауза на 5 минут'], ['breath', 'Дыхание'], ['walk-water', 'Прогулка или вода'],
  ['support', 'Связаться с близким / специалистом'], ['none', 'Пока ничего не выбрал(а)'],
];
const OUTCOME_OPTIONS = [['easier', 'Стало легче'], ['same', 'Почти без изменений'], ['stronger', 'Тяга усилилась']];
function freshCravingDraft() { return { beforeRating: null, afterRating: null, trigger: '', emotion: '', action: '', outcome: '', note: '' }; }
function freshSlipDraft() { return { trigger: '', emotion: '', note: '' }; }

const triggerLabel = id => TRIGGER_OPTIONS.find(([key]) => key === id)?.[1] || 'неизвестная ситуация';
const emotionLabel = id => EMOTION_OPTIONS.find(([key]) => key === id)?.[1] || 'не указано';
const actionLabel = id => ACTION_OPTIONS.find(([key]) => key === id)?.[1] || 'не указано';
const outcomeLabel = id => OUTCOME_OPTIONS.find(([key]) => key === id)?.[1] || 'не отмечено';

function getDailyPlanTasks(date = today()) {
  const top = new Map();
  const windowStart = addDays(date, -29);
  for (const [day, row] of Object.entries(state.dailyLogs || {})) {
    if (day < windowStart || day > date) continue;
    for (const id of row.triggers || []) top.set(id, (top.get(id) || 0) + 1);
  }
  for (const entry of state.cravingLogs || []) {
    const day = String(entry.at || '').slice(0, 10);
    if (day < windowStart || day > date || !entry.trigger || entry.type === 'slip') continue;
    top.set(entry.trigger, (top.get(entry.trigger) || 0) + 1);
  }
  const frequentTrigger = [...top.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (state.plan.strategy === 'reduce') {
    const target = Number(state.plan.dailyTarget) || 0;
    const unit = getUnitLabel(state);
    return [
      { id: 'reduce-track', title: 'Записать показатель за день', subtitle: `Отмечай употребление в выбранной единице: ${unit}.` },
      { id: 'reduce-compare', title: 'Сравнить день со своей целью', subtitle: target ? `Ориентир — ${target} ${unit}. Цель помогает наблюдать, а не наказывать себя.` : 'Задай реалистичный дневной ориентир в профиле, когда будешь готов(а).' },
      { id: 'reduce-trigger', title: frequentTrigger ? `Подготовиться к ситуации «${triggerLabel(frequentTrigger).toLowerCase()}»` : 'Выбрать одну ситуацию для изменения', subtitle: 'Подготовь альтернативное действие заранее, без резких компенсационных ограничений.' },
    ];
  }
  return [
    { id: 'quit-checkin', title: 'Замечать момент тяги', subtitle: 'Если она появится, оцени её силу и отметь ситуацию — это займёт минуту.' },
    { id: 'quit-pause', title: 'Запланировать короткую паузу', subtitle: 'Выбери дыхание, воду, прогулку или разговор с близким.' },
    { id: 'quit-trigger', title: frequentTrigger ? `Подготовить ответ на «${triggerLabel(frequentTrigger).toLowerCase()}»` : 'Подумать об одном возможном триггере', subtitle: 'Заранее реши, что попробуешь сделать вместо автоматической затяжки.' },
  ];
}

function weeklyReviewMessage(metrics) {
  if (state.plan.strategy === 'reduce') {
    if (metrics.trend === 'down') return 'В последних сопоставимых записях показатель ниже, чем в начале периода. Посмотри, что помогло, и выбери один шаг, который реально повторить.';
    if (metrics.trend === 'up') return 'Последние значения выше ранних. Это повод посмотреть на контекст и цель, а не ужесточать ограничения автоматически.';
    if (metrics.trend === 'steady') return 'Показатель выглядит примерно стабильным. Проверь, подходит ли текущая цель твоей жизни и какие ситуации влияют на употребление.';
    return 'Пока мало сопоставимых записей для сравнения. Продолжай вести один и тот же показатель — выводы станут полезнее.';
  }
  if (metrics.slipCount > 0) return 'На этой неделе были сложные моменты. Они не стирают предыдущий опыт. Выбери один триггер и заранее придумай, что попробуешь в следующий раз.';
  if (metrics.cravingCount > 0) return 'Ты замечал(а) тягу и уделял(а) ей внимание. Используй дневник, чтобы найти повторяющиеся ситуации и подготовить альтернативу.';
  return 'Небольшие наблюдения тоже полезны. Если тяга появляется, можно записать её силу и контекст — без обязанности заполнять дневник каждый день.';
}

function persist({ notify = true } = {}) {
  try {
    saveState(state);
    return true;
  } catch (error) {
    if (notify) showToast('Не удалось сохранить данные. Освободи место на устройстве и экспортируй резервную копию.');
    return false;
  }
}

function cloneState() {
  return JSON.parse(JSON.stringify(state));
}

function commitMutation(previousState, { renderMode = 'none', message = 'Не удалось сохранить изменения. Текущие данные восстановлены.' } = {}) {
  if (persist({ notify: false })) return true;
  state = previousState;
  if (renderMode === 'screen') render();
  else if (renderMode === 'overlay') renderOverlayOnly();
  showToast(message);
  return false;
}

function showToast(message) {
  const region = $('#toast-region');
  if (!region) return;
  region.innerHTML = `<div class="toast">${icon('info', 18)}<span>${esc(message)}</span></div>`;
  region.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => region.classList.remove('visible'), 3400);
}

function dateHeading() {
  const d = new Date();
  return `${['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'][d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

function navItem(id, label, glyph) {
  return `<button type="button" class="nav-item ${activeTab === id ? 'active' : ''}" data-tab="${id}" aria-current="${activeTab === id ? 'page' : 'false'}">${icon(glyph, 21)}<span>${label}</span></button>`;
}

function renderShell(content, { screenChanged = false } = {}) {
  root.innerHTML = `
    <div class="app-frame">
      <header class="topbar">
        <a href="#today" class="brand" data-tab="today" aria-label="Выдох — на главную">
          <span class="brand-symbol"><span></span></span>
          <span class="brand-word">выдох<span>.</span></span>
        </a>
        <div class="topbar-right">
          <span class="privacy-pill">${icon('lock', 13)} Данные на устройстве</span>
          <button class="avatar-button" type="button" data-action="go-profile" aria-label="Открыть профиль">${icon('user', 20)}</button>
        </div>
      </header>
      <main id="main-content" class="main-content${screenChanged ? ' screen-enter' : ''}" data-screen="${activeTab}" tabindex="-1">${content}</main>
      <nav class="bottom-nav" aria-label="Основная навигация">
        ${navItem('today', 'Сегодня', 'home')}
        ${navItem('calendar', 'Календарь', 'calendar')}
        ${navItem('practices', 'Практики', 'wind')}
        ${navItem('tips', 'Советы', 'book')}
        ${navItem('profile', 'Профиль', 'user')}
      </nav>
    </div>
    <div id="overlay-root">${renderOverlay()}</div>
    <div id="toast-region" role="status" aria-live="polite"></div>
    <input id="import-file" class="visually-hidden" type="file" accept="application/json,.json" aria-label="Импорт резервной копии">
  `;
  importInput = $('#import-file');
  if (importInput) importInput.addEventListener('change', handleImportFile);
  updateCountdownElements();
}

function render() {
  const screens = {
    today: renderToday,
    calendar: renderCalendar,
    practices: renderPractices,
    tips: renderTips,
    profile: renderProfile,
  };
  const screenChanged = lastRenderedTab !== null && lastRenderedTab !== activeTab;
  renderShell((screens[activeTab] || renderToday)(), { screenChanged });
  lastRenderedTab = activeTab;
  if (overlay) focusDialog();
}

function progressRing(percent, caption, value, sublabel = '') {
  return `<div class="progress-ring" style="--progress:${clamp(percent, 0, 100)}%; --progress-deg:${clamp(percent, 0, 100) * 3.6 - 90}deg" role="img" aria-label="${esc(caption)}: ${esc(value)}">
    <span class="ring-marker" aria-hidden="true"></span><div class="progress-ring-inner"><span class="ring-value">${value}</span><span class="ring-caption">${caption}</span>${sublabel ? `<span class="ring-sublabel">${sublabel}</span>` : ''}</div>
  </div>`;
}

function renderToday() {
  const currentDate = today();
  const log = getLog(state, currentDate);
  const reportedUseToday = hasReportedUseOnDate(state, currentDate);
  const hasMeasurementToday = hasRecordedMeasurement(state, state.dailyLogs?.[currentDate], log) && !log.untracked;
  const unknownUseAmountToday = log.untracked || !hasMeasurementToday || (reportedUseToday && log.amount === 0);
  const strategy = state.plan.strategy;
  const streak = getStreak(state);
  const unit = getUnitLabel(state);
  const target = Number(state.plan.dailyTarget) || 0;
  const pct = target > 0 ? clamp(log.amount / target * 100, 0, 100) : log.amount === 0 ? 0 : 100;
  const progressValue = strategy === 'quit' ? `${streak}` : `${log.amount}`;
  const progressCaption = strategy === 'quit' ? plural(streak, ['день', 'дня', 'дней']) : 'сегодня';
  const progressSub = strategy === 'quit' ? 'в своём ритме' : `из ${target || '—'} ${unit}`;
  const savings = getSavings(state);
  const cleanDays = getCleanDays(state);
  const bestStreak = getBestStreak(state);
  const week = getWeeklyStats(state);
  const maxWeekly = Math.max(1, ...week.map(d => Number(d.amount || 0)), target || 0);
  const dailyTasks = getDailyPlanTasks(currentDate);
  const taskIds = new Set(dailyTasks.map(task => task.id));
  const tasksDone = new Set((state.completedTasks[currentDate] || []).filter(id => taskIds.has(id)));
  const reviewMetrics = getWeeklyReviewMetrics(state);
  const reviewKey = getWeekStartISO(currentDate);
  const savedReview = state.weeklyReviews?.[reviewKey] || {};
  const reviewCard = `<section class="weekly-review-teaser"><div class="review-teaser-top"><span class="review-teaser-icon">${icon('sparkles', 20)}</span><span class="eyebrow">ОБЗОР ЗА 7 ДНЕЙ</span></div><h2>Что стало понятнее на этой неделе?</h2><p>${esc(weeklyReviewMessage(reviewMetrics))}</p><div class="review-mini-stats"><span><strong>${reviewMetrics.cravingCount}</strong><small>эпизодов тяги</small></span><span><strong>${reviewMetrics.practices}</strong><small>практик</small></span><span><strong>${reviewMetrics.taskCompletions}</strong><small>шагов отмечено</small></span></div><button type="button" class="button button-primary" data-action="open-weekly-review">Открыть недельный обзор ${icon('arrow', 15)}</button>${savedReview.updatedAt ? `<small class="review-saved">Твой фокус уже сохранён на эту неделю.</small>` : ''}</section>`;
  const reason = REASONS[lastReason % REASONS.length];
  const hint = state.ui.showStarterHint && (!state.plan.baseline || state.finance.weeklySpend == null) ? `
    <section class="soft-hint" aria-label="Настрой приложение под себя">
      <span class="hint-icon">${icon('sparkles', 19)}</span>
      <div class="hint-copy"><strong>Сделаем поддержку персональной</strong><p>Укажи исходный показатель и расходы, чтобы точнее видеть свою динамику.</p><button class="text-action" type="button" data-action="go-profile">Настроить профиль ${icon('arrow', 14)}</button></div>
      <button class="quiet-icon" type="button" data-action="dismiss-hint" aria-label="Скрыть подсказку">${icon('close', 17)}</button>
    </section>` : '';

  const heroIntro = strategy === 'quit'
    ? `<div class="hero-kicker"><span class="pulse-dot"></span> ТВОЙ ПУТЬ</div><h1>Каждый новый день —<br><em>твой выбор.</em></h1><p class="hero-description">Не нужно быть идеальным. Важно продолжать в своём темпе.</p>`
    : `<div class="hero-kicker"><span class="pulse-dot"></span> ТВОЙ ПЛАН</div><h1>Маленькие шаги.<br><em>Реальные изменения.</em></h1><p class="hero-description">Отмечай свой привычный показатель и сравнивай дни между собой.</p>`;

  const ring = strategy === 'quit'
    ? progressRing(clamp(streak / 30 * 100, 3, 100), 'дней подряд', streak, streak > 0 ? 'в пути' : 'новый шаг')
    : progressRing(!unknownUseAmountToday && target > 0 ? clamp(100 - (log.amount / target * 100), 0, 100) : 0, 'цель на день', !unknownUseAmountToday && target > 0 ? `${Math.max(0, target - log.amount)}` : '—', !unknownUseAmountToday && target > 0 ? `${unit} осталось` : 'нет измерения');

  const quickProgress = strategy === 'quit'
    ? `<div class="metric-grid"><article class="metric-card"><span class="metric-icon mint">${icon('calendar', 19)}</span><span class="metric-label">Дней без записей об употреблении</span><strong>${cleanDays}</strong><span class="metric-foot">с начала отсчёта</span></article><article class="metric-card"><span class="metric-icon lime">${icon('chart', 19)}</span><span class="metric-label">Лучшая серия</span><strong>${bestStreak}</strong><span class="metric-foot">${plural(bestStreak, ['день', 'дня', 'дней'])}</span></article></div>`
    : `<div class="metric-grid"><article class="metric-card"><span class="metric-icon mint">${icon('chart', 19)}</span><span class="metric-label">Сегодня отмечено</span><strong>${unknownUseAmountToday ? '—' : log.amount}</strong><span class="metric-foot">${unknownUseAmountToday ? 'пока нет измерения' : unit}</span></article><article class="metric-card"><span class="metric-icon lime">${icon('target', 19)}</span><span class="metric-label">Твоя цель на день</span><strong>${target || '—'}</strong><span class="metric-foot">${target ? unit : 'не задана'}</span></article></div>`;

  const weeklyBars = week.map(row => {
    const value = Number(row.amount || 0);
    const height = row.amount === null ? 6 : (target > 0 && strategy === 'reduce' ? clamp(value / Math.max(target, value, 1) * 100, 8, 100) : clamp(value / maxWeekly * 100, value === 0 ? 7 : 12, 100));
    const colorClass = row.amount === null ? 'bar-before' : value === 0 ? 'bar-clear' : (strategy === 'reduce' && target > 0 && value <= target ? 'bar-within' : 'bar-used');
    const date = row.date.slice(-2).replace(/^0/, '');
    return `<div class="week-column"><div class="week-value">${row.amount === null ? '·' : value}</div><div class="week-track"><div class="week-bar ${colorClass}" style="height:${height}%"></div></div><span class="week-label ${row.today ? 'today' : ''}">${WEEKDAYS[(new Date(`${row.date}T12:00:00`).getDay() + 6) % 7]}</span><span class="week-date">${date}</span></div>`;
  }).join('');

  const completedTaskRows = dailyTasks.map(task => `<button class="task-row ${tasksDone.has(task.id) ? 'is-done' : ''}" type="button" data-action="toggle-task" data-id="${task.id}" aria-pressed="${tasksDone.has(task.id)}"><span class="task-check">${tasksDone.has(task.id) ? icon('check', 17) : ''}</span><span class="task-copy"><strong>${task.title}</strong><small>${task.subtitle}</small></span><span class="task-plus">${tasksDone.has(task.id) ? 'Готово' : 'Отметить'}</span></button>`).join('');
  const triggerCounts = new Map();
  const triggerWindowStart = addDays(currentDate, -29);
  for (const [date, row] of Object.entries(state.dailyLogs)) {
    if (date < triggerWindowStart || date > currentDate || !Array.isArray(row?.triggers)) continue;
    for (const trigger of row.triggers) triggerCounts.set(trigger, (triggerCounts.get(trigger) || 0) + 1);
  }
  for (const entry of state.cravingLogs || []) { const date = entry.date || String(entry.at || '').slice(0, 10); if (date < triggerWindowStart || date > currentDate || !entry.trigger || entry.type === 'slip') continue; triggerCounts.set(entry.trigger, (triggerCounts.get(entry.trigger) || 0) + 1); }
  const triggerLabelById = new Map(TRIGGER_OPTIONS);
  const topTriggers = [...triggerCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const triggerInsights = topTriggers.length ? `<section class="panel-card trigger-insights"><div class="panel-heading"><div><p class="eyebrow">НАБЛЮДЕНИЯ ЗА 30 ДНЕЙ</p><h2>Что чаще влияет на привычку</h2></div><span class="metric-icon mint">${icon('sparkles', 19)}</span></div><p class="chart-note">Это не оценка и не диагноз, а повторяющиеся ситуации, которые ты сам(а) отметил(а).</p><div class="trigger-insight-list">${topTriggers.map(([id, count]) => `<div class="trigger-insight-row"><span>${esc(triggerLabelById.get(id) || 'Другая ситуация')}</span><span>${count} ${plural(count, ['отметка', 'отметки', 'отметок'])}</span></div>`).join('')}</div><button type="button" class="text-action" data-action="open-day" data-date="${currentDate}">Отметить ситуацию сегодня ${icon('arrow', 14)}</button></section>` : '';

  return `
    <section class="page-heading fade-in"><div><p class="eyebrow">${esc(dateHeading())}</p><h1>Привет, это твой день <span class="heading-spark">✳</span></h1><p class="page-subtitle">Пусть сегодня будет чуть легче.</p></div><button class="heading-action" type="button" data-action="go-profile" aria-label="Настройки профиля">${icon('settings', 20)}</button></section>
    ${hint}
    <section class="hero-card fade-in" aria-label="Твой прогресс">
      <div class="hero-glow hero-glow-a"></div><div class="hero-glow hero-glow-b"></div><div class="hero-content"><div class="hero-copy">${heroIntro}<div class="hero-actions"><button class="button button-lime" type="button" data-action="open-craving">${icon('wind', 18)} Мне хочется затянуться</button><button class="button button-glass" type="button" data-action="quick-practice">${icon('play', 15)} Пауза на минуту</button></div></div><div class="hero-visual">${ring}<div class="ring-orbit orbit-one"></div><div class="ring-orbit orbit-two"></div></div></div>
      <div class="hero-footer"><span>${icon('sparkles', 15)} Не нужно проходить этот путь идеально</span><span class="hero-footer-mark">ВДОХ · ВЫДОХ</span></div>
    </section>
    <div class="section-title-row"><div><p class="eyebrow">ТВОЙ ПРОГРЕСС</p><h2>Из маленького складывается большое</h2></div><button class="text-action" type="button" data-tab="calendar">Вся история ${icon('arrow', 14)}</button></div>
    ${quickProgress}
    ${strategy === 'quit' && (log.amount > 0 || hasReportedUseOnDate(state, currentDate)) ? `<section class="slip-support-card"><span class="slip-support-icon">${icon('heart', 19)}</span><div><strong>Этот эпизод не стирает предыдущий опыт</strong><p>Можно спокойно записать, что произошло, и выбрать следующий шаг. История останется на месте.</p><button type="button" class="text-action" data-action="open-slip">Разобрать ситуацию без самокритики ${icon('arrow', 14)}</button></div></section>` : ''}
    <section class="panel-card usage-card">
      <div class="panel-heading"><div><p class="eyebrow">СЕГОДНЯ</p><h2>${strategy === 'quit' ? 'Как прошёл день?' : 'Отметить употребление'}</h2></div><span class="status-pill ${unknownUseAmountToday ? 'status-warn' : log.amount === 0 ? 'status-calm' : strategy === 'reduce' && target > 0 && log.amount <= target ? 'status-warn' : 'status-used'}">${unknownUseAmountToday ? 'Эпизод отмечен' : log.amount === 0 ? 'Пока 0' : `${log.amount} ${unit}`}</span></div>
      <div class="usage-body"><div class="usage-copy"><strong class="usage-total">${unknownUseAmountToday ? '—' : log.amount}</strong><span>${unknownUseAmountToday ? 'количество пока не отмечено' : `${unit} отмечено сегодня`}</span><small>${unknownUseAmountToday ? (reportedUseToday ? 'Ты отметил(а) употребление без количества. Если хочешь, добавь показатель отдельно.' : log.untracked ? 'Есть данные в другой единице. Приложение не пересчитывает их автоматически.' : 'Нет измерения за сегодня. Отметь количество или явно подтверди день без употребления.') : strategy === 'quit' ? 'Если употребление произошло, это не отменяет предыдущий прогресс.' : target > 0 ? `Твоя цель — ${target} ${unit}. Сравнивай дни без самокритики.` : 'Настрой дневную цель в профиле, когда будешь готов(а).'}</small></div><div class="stepper"><button type="button" data-action="adjust-amount" data-delta="-1" aria-label="Уменьшить количество" ${log.amount <= 0 ? 'disabled' : ''}>${icon('minus', 20)}</button><button type="button" data-action="adjust-amount" data-delta="1" aria-label="Добавить количество">${icon('plus', 20)}</button></div></div>
      ${strategy === 'reduce' && target > 0 ? (unknownUseAmountToday ? `<div class="target-caption target-caption-unknown"><span>—</span><span>Нет измерения за сегодня</span><span>${target}</span></div>` : `<div class="target-progress"><div class="target-progress-fill ${pct >= 100 ? 'is-full' : ''}" style="width:${Math.min(100, pct)}%"></div></div><div class="target-caption"><span>0</span><span>${Math.round(pct)}% от выбранной цели</span><span>${target}</span></div>`) : ''}
      <div class="usage-foot">${icon('lock', 14)} Записи хранятся на этом устройстве <button type="button" class="text-action" data-action="open-day" data-date="${currentDate}">Заметка дня ${icon('chevron', 14)}</button>${canMarkNoUse(currentDate) ? `<button type="button" class="text-action" data-action="toggle-no-use" data-date="${currentDate}">${state.dailyLogs[currentDate]?.noUseConfirmed ? 'Снять отметку о дне без употребления' : 'Отметить день без употребления'}</button>` : ''}</div>
    </section>
    <section class="panel-card weekly-card"><div class="panel-heading"><div><p class="eyebrow">ПОСЛЕДНИЕ 7 ДНЕЙ</p><h2>Динамика без оценок</h2></div><span class="chart-legend"><i></i> ${strategy === 'quit' ? 'Записи об употреблении' : 'Твой показатель'}</span></div><div class="week-chart">${weeklyBars}</div><p class="chart-note">График показывает твои записи, а не оценивает, насколько «хорошим» был день.</p></section>
    ${reviewCard}
    ${triggerInsights}
    ${savings !== null ? `<section class="money-card"><span class="money-orb">${icon('money', 21)}</span><div class="money-copy"><p class="eyebrow">ТВОЯ ЦЕЛЬ</p><h2>${formatMoney(savings, state.finance.currency)}</h2><p>Ориентировочная экономия по введённым расходам.</p>${state.finance.goalAmount > 0 ? `<div class="money-progress"><span style="width:${clamp(savings / state.finance.goalAmount * 100, 0, 100)}%"></span></div><small>${esc(state.finance.goalName || 'Цель')} · ${Math.round(clamp(savings / state.finance.goalAmount * 100, 0, 100))}%</small>` : `<button type="button" class="text-action" data-action="go-profile">Добавить финансовую цель ${icon('arrow', 14)}</button>`}</div></section>` : ''}
    <section class="panel-card tasks-card"><div class="panel-heading"><div><p class="eyebrow">НА СЕГОДНЯ</p><h2>Один шаг за другим</h2></div><span class="task-count">${tasksDone.size}/${dailyTasks.length}</span></div><div class="task-list">${completedTaskRows}</div><div class="task-footer">${dailyTasks.every(task => tasksDone.has(task.id)) ? 'Сегодня ты уделил(а) время себе. Этого достаточно.' : 'Необязательно делать всё. Выбери то, что подходит сегодня.'}</div></section>
    <section class="panel-card milestones-card"><div class="panel-heading"><div><p class="eyebrow">ТВОИ ЭТАПЫ</p><h2>Замечай пройденное</h2></div><span class="milestone-count">${MILESTONES.filter(m => Math.max(bestStreak, streak) >= m.days || state.achievements.celebrated.includes(m.days)).length}/${MILESTONES.length}</span></div><div class="milestone-strip">${MILESTONES.map(m => { const unlocked = Math.max(bestStreak, streak) >= m.days || state.achievements.celebrated.includes(m.days); return `<button type="button" class="milestone ${unlocked ? 'unlocked' : ''}" data-action="milestone-info" data-days="${m.days}"><span class="milestone-bubble">${unlocked ? icon('check', 17) : m.days}</span><strong>${esc(m.title)}</strong><small>${m.days} ${plural(m.days, ['день', 'дня', 'дней'])}</small></button>`; }).join('')}</div><p class="chart-note">Этапы отмечают опыт, а не требуют идеальной серии. Сложный день не стирает то, чему ты уже научился(ась).</p></section>
    <section class="reason-card"><div class="reason-top"><span class="reason-icon">${icon('heart', 18)}</span><span class="eyebrow">НАПОМИНАНИЕ СЕБЕ</span><button type="button" class="quiet-icon" data-action="next-reason" aria-label="Другая мысль">${icon('rotate', 17)}</button></div><p>${esc(reason.text)}</p><span class="reason-category">${esc(reason.category)}</span></section>
    <div class="bottom-note">${icon('leaf', 15)} Маленький шаг — тоже движение вперёд.</div>
  `;
}

function renderProgressAnalytics() {
  const range = state.ui.analyticsRange || 'week';
  const metrics = getProgressAnalytics(state, range);
  const unit = getUnitLabel(state);
  const max = Math.max(1, ...metrics.buckets.map(row => row.value == null ? 0 : row.value), metrics.baseline || 0);
  const bars = metrics.buckets.map(row => {
    const known = row.value !== null && Number.isFinite(row.value);
    const height = known ? clamp(row.value / max * 100, row.value === 0 ? 4 : 9, 100) : 3;
    const label = known ? Number(row.value.toFixed(1)).toLocaleString('ru-RU') : '·';
    return `<div class="analytics-column" title="${esc(row.title || '')}: ${known ? `${esc(label)} ${esc(unit)}` : 'нет измерения'}"><div class="analytics-value">${label}</div><div class="analytics-track"><span class="${known ? (row.value === 0 ? 'is-zero' : 'is-value') : 'is-unknown'}" style="height:${height}%"></span></div><small>${esc(row.label)}</small></div>`;
  }).join('');
  const comparison = metrics.deltaPercent == null
    ? 'Укажи исходный показатель в профиле и записывай одну и ту же единицу, чтобы сравнивать динамику.'
    : metrics.deltaPercent > 0.5
      ? `Среднее по отмеченным дням на ${Math.round(metrics.deltaPercent)}% ниже исходной точки.`
      : metrics.deltaPercent < -0.5
        ? `Среднее по отмеченным дням на ${Math.round(Math.abs(metrics.deltaPercent))}% выше исходной точки. Это повод посмотреть на обстоятельства, а не ужесточать план автоматически.`
        : 'Среднее по отмеченным дням примерно на уровне исходной точки.';
  const labels = new Map(TRIGGER_OPTIONS);
  const moods = new Map(EMOTION_OPTIONS);
  const renderCounts = (items, lookup, empty) => items.length
    ? items.map(([id, count]) => `<div class="analytics-insight-row"><span>${esc(lookup.get(id) || id)}</span><strong>${count}</strong></div>`).join('')
    : `<p class="field-help">${empty}</p>`;
  const trendLabel = range === 'week' ? 'Последние 7 дней' : range === 'month' ? 'Последние 30 дней' : 'Весь период с начала пути';
  const averageLabel = metrics.average == null ? '—' : Number(metrics.average.toFixed(1)).toLocaleString('ru-RU');
  const practiceEvidence = metrics.ratedBreathCount
    ? `В ${metrics.lowerAfterBreath} из ${metrics.ratedBreathCount} записей с отмеченным дыханием пользовательская оценка тяги после действия была ниже. Это самооценка, не доказательство причинного эффекта.`
    : 'Если после практики отмечать силу тяги до и после, со временем можно увидеть собственные наблюдения. Пока таких сравнений недостаточно.';
  return `<section class="panel-card analytics-panel" aria-labelledby="analytics-title">
    <div class="panel-heading"><div><p class="eyebrow">ТВОЯ ДИНАМИКА</p><h2 id="analytics-title">Сравнивай себя с собой</h2></div><span class="metric-icon mint">${icon('chart', 19)}</span></div>
    <div class="analytics-range" role="group" aria-label="Период статистики">${[['week','7 дней'],['month','30 дней'],['all','Весь путь']].map(([id,label])=>`<button type="button" class="filter-chip ${range===id?'active':''}" data-action="analytics-range" data-id="${id}" aria-pressed="${range===id}">${label}</button>`).join('')}</div>
    <p class="chart-note">${trendLabel}. График строится только по измерениям выбранной единицы; дни без данных не считаются нулевыми.</p>
    <div class="analytics-chart" role="img" aria-label="График ${esc(trendLabel.toLowerCase())}">${bars}</div>
    <div class="analytics-metric-grid"><article><span>Отмечено дней</span><strong>${metrics.trackedDays}</strong></article><article><span>Среднее значение</span><strong>${averageLabel}</strong><small>${esc(unit)}</small></article><article><span>Эпизодов с контекстом</span><strong>${metrics.daysWithReportedUse}</strong></article></div>
    <div class="analytics-comparison"><span class="analytics-comparison-icon">${icon('target', 17)}</span><p>${esc(comparison)}</p></div>
    <div class="analytics-insights-grid"><section><h3>Повторяющиеся ситуации</h3>${renderCounts(metrics.topTriggers, labels, 'Пока недостаточно отмеченных триггеров.')}</section><section><h3>Эмоциональный фон</h3>${renderCounts(metrics.topMoods, moods, 'Эмоциональное состояние пока не отмечалось.')}</section></div>
    <div class="analytics-practice-link"><div><p class="eyebrow">ПРАКТИКИ И САМООЦЕНКА</p><h3>${metrics.practiceCount} ${plural(metrics.practiceCount,['практика','практики','практик'])} · ${metrics.practiceMinutes} мин</h3><p>${esc(practiceEvidence)}</p></div><span class="analytics-practice-icon">${icon('wind', 19)}</span></div>
    <p class="field-help">Счётчики триггеров суммируют отдельные отметки в дневнике и календаре — это упоминания, а не доказательство причинности. Показатели описывают личные наблюдения, а не медицинский результат. Экономия рассчитывается отдельно по введённым расходам и только там, где есть сопоставимые данные.</p>
  </section>`;
}

function renderCalendar() {
  const year = selectedCalendarMonth.getFullYear();
  const month = selectedCalendarMonth.getMonth();
  const firstDay = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const currentMonth = year === new Date().getFullYear() && month === new Date().getMonth();
  const current = today();
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push('<div class="calendar-blank" aria-hidden="true"></div>');
  let clean = 0, total = 0, recorded = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const status = getStatus(state, date);
    const dayLog = getLog(state, date);
    const amount = dayLog.untracked ? null : Number(dayLog.amount || 0);
    if (status === 'clear') clean++;
    if (status !== 'before' && status !== 'future' && status !== 'untracked' && status !== 'unrecorded') { total += amount || 0; if ((amount || 0) > 0 || state.dailyLogs[date]?.note || status === 'clear') recorded++; }
    const disabled = status === 'future';
    const statusLabel = { before: 'до начала отсчёта', future: 'будущий день', clear: 'день отмечен как без употребления', unrecorded: 'нет измерения за этот день', within: 'в пределах выбранной цели', used: 'есть запись об употреблении', untracked: 'данные указаны в другой единице учёта' }[status];
    cells.push(`<button type="button" class="calendar-day status-${status} ${date === current ? 'is-today' : ''} ${amount > 0 ? 'has-amount' : ''}" data-action="open-day" data-date="${date}" aria-label="${day} ${MONTHS[month]}, ${statusLabel}${amount ? `, ${amount}` : ''}" ${disabled ? 'disabled' : ''}><span class="day-number">${day}</span>${amount > 0 ? `<span class="day-amount">${amount}</span>` : status === 'clear' ? '<span class="day-mark"></span>' : (status === 'untracked' || status === 'unrecorded') ? '<span class="day-amount">·</span>' : ''}</button>`);
  }
  return `
    <section class="page-heading"><div><p class="eyebrow">ИСТОРИЯ И НАБЛЮДЕНИЯ</p><h1>Календарь</h1><p class="page-subtitle">Не отчёт об идеальности, а карта твоего опыта.</p></div><span class="heading-icon">${icon('calendar', 21)}</span></section>
    <section class="panel-card calendar-panel"><div class="month-switcher"><button type="button" class="round-button" data-action="month-prev" aria-label="Предыдущий месяц">${icon('chevron', 19, 'flip-horizontal')}</button><div><h2>${MONTHS_NOM[month]} ${year}</h2><p>${currentMonth ? 'Текущий месяц' : 'История по дням'}</p></div><button type="button" class="round-button" data-action="month-next" aria-label="Следующий месяц" ${currentMonth ? 'disabled' : ''}>${icon('chevron', 19)}</button></div>
      <div class="calendar-grid">${WEEKDAYS.map(d => `<span class="calendar-weekday">${d}</span>`).join('')}${cells.join('')}</div>
      <div class="calendar-legend"><span><i class="legend-dot clear"></i>Отмечено без употребления</span><span><i class="legend-dot used"></i>Есть запись</span><span><i class="legend-dot empty"></i>До начала пути</span><span><i class="legend-dot untracked"></i>Другая единица</span><span><i class="legend-dot unrecorded"></i>Нет измерения</span></div>
    </section>
    ${renderProgressAnalytics()}
    <div class="metric-grid calendar-metrics"><article class="metric-card"><span class="metric-icon mint">${icon('calendar', 19)}</span><span class="metric-label">Дней без записей</span><strong>${clean}</strong><span class="metric-foot">в выбранном месяце</span></article><article class="metric-card"><span class="metric-icon lime">${icon('chart', 19)}</span><span class="metric-label">Записей в месяце</span><strong>${recorded}</strong><span class="metric-foot">${total} ${getUnitLabel(state)} всего</span></article></div>
    <section class="soft-info">${icon('info', 17)}<p>Нажми на дату, чтобы посмотреть или поправить запись. День с употреблением — это данные для понимания привычки, а не оценка тебя.</p></section>
  `;
}

function renderPractices() {
  const totalPractices = state.practiceSessions.filter(session => session.completed !== false).length;
  const range = state.ui.practiceRange || 'month';
  const stats = getPracticeAnalytics(state, range);
  const favorites = new Set(state.practiceSettings?.favorites || []);
  const list = PRACTICES.filter(practice => !practiceFavoritesOnly || favorites.has(practice.id));
  const topPracticeLabels = new Map(PRACTICES.map(practice => [practice.id, practice.name]));
  const history = stats.sessions.slice().sort((a,b) => String(b.finishedAt).localeCompare(String(a.finishedAt))).slice(0, 5);
  const historyMarkup = history.length
    ? `<div class="practice-history-list">${history.map(session => {
      const date = session.date || String(session.finishedAt || '').slice(0,10);
      const practice = PRACTICES.find(item => item.id === session.id);
      const mins = Math.round((Number(session.duration) || 0) / 60);
      return `<div class="practice-history-row"><span class="practice-history-mark">${icon('wind',16)}</span><div><strong>${esc(practice?.name || 'Дыхательная практика')}</strong><small>${esc(date ? formatShortDate(date) : '')} · ${session.completed === false ? 'остановлена раньше' : 'завершена'}</small></div><span class="practice-history-duration">${mins} мин</span></div>`;
    }).join('')}</div>`
    : `<div class="library-empty">${icon('wind',22)}<strong>История пока пуста</strong><span>Завершённая практика появится здесь. Можно начать с одной минуты.</span></div>`;
  const topPractices = stats.topPractices.length
    ? stats.topPractices.map(([id,count])=>`<div class="analytics-insight-row"><span>${esc(topPracticeLabels.get(id)||id)}</span><strong>${count}</strong></div>`).join('')
    : '<p class="field-help">Заверши несколько практик, чтобы увидеть, к каким ты чаще возвращаешься.</p>';
  return `
    <section class="page-heading"><div><p class="eyebrow">ПАУЗА ДЛЯ СЕБЯ</p><h1>Вернись к своему ритму</h1><p class="page-subtitle">Выбери практику, которая подходит именно сейчас. Ритм — ориентир, а не требование.</p></div><span class="heading-icon">${icon('wind', 22)}</span></section>
    <section class="breath-feature"><div class="breath-feature-glow"></div><div class="breath-feature-copy"><span class="dark-kicker">НАЧНИ С МИНУТЫ</span><h2>Вдохни.<br>Отпусти.</h2><p>Мягкий ориентир для внимания и стресса. Не нужно делать глубокие вдохи или терпеть неудобный ритм.</p><button type="button" class="button button-lime" data-action="open-practice" data-id="natural">${icon('play', 16)} Начать практику</button></div><div class="breath-art" aria-hidden="true"><div class="breath-art-orbit orbit-a"></div><div class="breath-art-orbit orbit-b"></div><div class="breath-art-core"><span></span></div><i class="breath-particle p-a"></i><i class="breath-particle p-b"></i><i class="breath-particle p-c"></i></div><div class="breath-feature-foot"><span>${icon('clock', 15)} 1–10 минут на выбор</span><span>${icon('sparkles', 15)} ${totalPractices} ${plural(totalPractices, ['практика', 'практики', 'практик'])} завершено</span></div></section>
    <div class="section-title-row practice-title"><div><p class="eyebrow">БИБЛИОТЕКА ПРАКТИК</p><h2>Выбери, что подходит</h2></div></div>
    <div class="practice-list-filter" role="group" aria-label="Фильтр практик"><button type="button" class="filter-chip ${!practiceFavoritesOnly?'active':''}" data-action="practice-favorites-filter" data-value="all" aria-pressed="${!practiceFavoritesOnly}">Все практики</button><button type="button" class="filter-chip ${practiceFavoritesOnly?'active':''}" data-action="practice-favorites-filter" data-value="favorites" aria-pressed="${practiceFavoritesOnly}">${icon('star',14)} Избранное (${favorites.size})</button></div>
    <div class="practice-list">${list.length ? list.map((practice, index) => `<div class="practice-row-wrap"><button type="button" class="practice-row" data-action="open-practice" data-id="${practice.id}"><span class="practice-number">${String(index+1).padStart(2,'0')}</span><span class="practice-orb-thumb ${practice.tone}"><i></i></span><span class="practice-row-copy"><strong>${esc(practice.name)}</strong><small>${esc(practice.description)}</small><em>${esc(practice.mode)} · ${esc(practice.label)}</em></span><span class="practice-row-end"><small>${state.practiceSettings?.durations?.[practice.id] || Math.round(practice.duration/60)} мин</small>${icon('chevron',18)}</span></button><button type="button" class="practice-favorite ${favorites.has(practice.id)?'is-favorite':''}" data-action="toggle-practice-favorite" data-id="${practice.id}" aria-label="${favorites.has(practice.id)?'Убрать из':'Добавить в'} избранное: ${esc(practice.name)}" aria-pressed="${favorites.has(practice.id)}">${icon('star',17)}</button></div>`).join('') : `<div class="library-empty"><strong>В избранном пока пусто</strong><span>Нажми на звезду у любой практики — она появится здесь.</span></div>`}</div>
    <section class="panel-card practice-analytics"><div class="panel-heading"><div><p class="eyebrow">ТВОЯ ПРАКТИКА</p><h2>Время, которое ты выделил(а) себе</h2></div><span class="metric-icon mint">${icon('activity',19)}</span></div><div class="analytics-range" role="group" aria-label="Период истории практик">${[['week','7 дней'],['month','30 дней'],['all','Весь путь']].map(([id,label])=>`<button type="button" class="filter-chip ${range===id?'active':''}" data-action="practice-range" data-id="${id}" aria-pressed="${range===id}">${label}</button>`).join('')}</div><div class="practice-stat-grid"><article><span>Завершено</span><strong>${stats.completedCount}</strong></article><article><span>Минут практики</span><strong>${stats.minutes}</strong></article><article><span>Остановлено раньше</span><strong>${stats.interruptedCount}</strong></article></div><div class="practice-top-list"><h3>К чему ты чаще возвращался(ась)</h3>${topPractices}</div><div class="practice-history-heading"><h3>Недавние сессии</h3><small>Последние 5</small></div>${historyMarkup}<p class="field-help">История отражает только сохранённые сессии. Практика — дополнительный способ переключить внимание или поддержать спокойствие, но не самостоятельное лечение никотиновой зависимости.</p></section>
    <section class="soft-info safety-info">${icon('info', 17)}<p>Дыши комфортно, не старайся вдыхать глубже обычного. Если почувствуешь головокружение или дискомфорт, остановись и вернись к естественному дыханию. Для стресса NHS рекомендует комфортное дыхание без усилия; это не заменяет помощь при никотиновой зависимости.</p></section>
  `;
}

function renderTips() {
  const normalizedSearch = tipSearch.trim().toLocaleLowerCase('ru-RU');
  const tips = TIPS.filter(tip => {
    const haystack = `${tip.title} ${tip.summary || ''} ${tip.body} ${tip.steps?.join(' ') || ''}`.toLocaleLowerCase('ru-RU');
    return (tipCategory === 'all' || tip.category === tipCategory)
      && (tipLevel === 'all' || tip.level === tipLevel)
      && (tipSituation === 'all' || (tip.situations || []).includes(tipSituation))
      && (!normalizedSearch || haystack.includes(normalizedSearch));
  });
  return `
    <section class="page-heading"><div><p class="eyebrow">ЗНАНИЯ БЕЗ ДАВЛЕНИЯ</p><h1>Библиотека поддержки</h1><p class="page-subtitle">Практические шаги, информация о симптомах и проверенные источники. Выбирай материал под свою ситуацию.</p></div><span class="heading-icon">${icon('book', 21)}</span></section>
    <section class="tips-feature"><div class="tips-feature-icon">${icon('sparkles', 24)}</div><div><p class="eyebrow">ВАЖНО ПОМНИТЬ</p><h2>Поддержка — это не тест на силу воли.</h2><p>Приложение помогает наблюдать за привычками и искать подходящие действия. При необходимости медицинская помощь и консультирование — полноценная часть отказа.</p></div></section>
    <label class="tip-search"><span>${icon('search',17)}</span><input type="search" data-field="tips.search" value="${esc(tipSearch)}" placeholder="Найти тему, ситуацию или совет" aria-label="Поиск по библиотеке"></label>
    <div class="filter-chips" role="group" aria-label="Тема материала">${TIP_CATEGORIES.map(cat => `<button type="button" class="filter-chip ${tipCategory === cat.id ? 'active' : ''}" data-action="tip-category" data-id="${cat.id}" aria-pressed="${tipCategory === cat.id}">${cat.label}</button>`).join('')}</div>
    <div class="tip-filter-row"><label class="form-field"><span>Формат</span><select data-field="tips.level">${TIP_LEVELS.map(item=>`<option value="${item.id}" ${tipLevel===item.id?'selected':''}>${item.label}</option>`).join('')}</select></label><label class="form-field"><span>Ситуация</span><select data-field="tips.situation">${TIP_SITUATIONS.map(item=>`<option value="${item.id}" ${tipSituation===item.id?'selected':''}>${item.label}</option>`).join('')}</select></label></div>
    <div class="tips-results-heading"><strong>${tips.length} ${plural(tips.length,['материал','материала','материалов'])}</strong><span>с источниками</span></div>
    <div class="tips-list">${tips.map(tip => `<article class="tip-card"><div class="tip-card-top"><span class="tip-category-mark">${icon(tip.category === 'now' ? 'wind' : tip.category === 'habits' ? 'rotate' : tip.category === 'support' ? 'heart' : tip.category === 'withdrawal' ? 'activity' : tip.category === 'evidence' ? 'shield' : 'sparkles', 17)}</span><span class="tip-evidence">${esc(tip.evidence)}</span></div><h2>${esc(tip.title)}</h2><p>${esc(tip.summary || tip.body)}</p><div class="tip-card-meta"><span>${icon('clock',14)} ${esc(tip.time)}</span><span>${tip.level === 'quick' ? 'Короткий шаг' : 'Материал'}</span></div><div class="tip-card-foot"><span>${icon('link',14)} Источник указан</span><button type="button" class="text-action" data-action="open-guide" data-id="${tip.id}">Открыть материал ${icon('arrow', 14)}</button></div></article>`).join('') || `<div class="library-empty">${icon('search',22)}<strong>Ничего не найдено</strong><span>Попробуй изменить запрос или фильтры.</span><button type="button" class="button button-secondary" data-action="reset-tip-filters">Сбросить фильтры</button></div>`}</div>
    <section class="professional-card"><span class="professional-icon">${icon('heart', 20)}</span><div><h2>Поддержка специалиста — тоже сильный шаг</h2><p>Руководство ВОЗ для взрослых, употребляющих табак, рассматривает поведенческую поддержку, цифровые инструменты как дополнение и подходящие медицинские варианты. Для вейпинга и конкретной ситуации рекомендации нужно уточнить у специалиста.</p><button type="button" class="button button-dark" data-action="open-support">Что обсудить со специалистом ${icon('arrow', 15)}</button></div></section>
    <section class="sources-panel"><p class="eyebrow">ИСТОЧНИКИ</p><h2>Материалы для самостоятельного чтения</h2><a href="https://www.who.int/campaigns/world-no-tobacco-day/2026/quit-today" target="_blank" rel="noopener noreferrer">ВОЗ · Quit today: пошаговый план отказа от табака и никотина (2026) ${icon('external',14)}</a><a href="https://www.who.int/publications/i/item/9789240096431" target="_blank" rel="noopener noreferrer">ВОЗ · Клиническое руководство по отказу от табака у взрослых (2024) ${icon('external',14)}</a><a href="https://www.who.int/news-room/questions-and-answers/item/how-to-quit-e-cigarettes" target="_blank" rel="noopener noreferrer">ВОЗ · Как отказаться от электронных сигарет ${icon('external',14)}</a><a href="https://www.cdc.gov/tobacco/campaign/tips/quit-smoking/7-common-withdrawal-symptoms/index.html" target="_blank" rel="noopener noreferrer">CDC · Симптомы отмены и способы справляться с тягой ${icon('external',14)}</a><a href="https://www.nhs.uk/mental-health/self-help/guides-tools-and-activities/breathing-exercises-for-stress/" target="_blank" rel="noopener noreferrer">NHS · Дыхательные упражнения при стрессе ${icon('external',14)}</a><p>Краткие материалы в приложении адаптированы своими словами. Руководство ВОЗ посвящено прекращению употребления табака у взрослых и не подменяет индивидуальные рекомендации по электронным сигаретам или лекарствам.</p></section>
    <p class="content-disclaimer">Информация образовательная и не заменяет индивидуальную медицинскую консультацию. При тяжёлых, необычных или сохраняющихся симптомах обратись к медицинскому специалисту.</p>
  `;
}

function renderGuideOverlay(id) {
  const guide = TIPS.find(item => item.id === id);
  if (!guide) return '';
  const steps = (guide.steps || []).map(step => `<li>${esc(step)}</li>`).join('');
  return `<div class="modal-backdrop guide-backdrop" data-action="backdrop-close"><article class="modal sheet-modal guide-modal" role="dialog" aria-modal="true" aria-labelledby="guide-title"><div class="modal-handle"></div><div class="modal-heading"><div><p class="eyebrow">${esc(guide.evidence)}</p><h2 id="guide-title">${esc(guide.title)}</h2><p class="guide-meta">${icon('clock',14)} ${esc(guide.time)} · ${guide.level==='quick'?'короткое действие':'справочный материал'}</p></div><button type="button" class="quiet-icon" data-action="close-overlay" aria-label="Закрыть материал">${icon('close',19)}</button></div><p class="guide-lead">${esc(guide.summary || '')}</p><div class="guide-body"><p>${esc(guide.body)}</p>${steps ? `<h3>Что можно попробовать</h3><ol>${steps}</ol>` : ''}</div><div class="guide-source"><span>${icon('book-open',17)}</span><div><strong>Источник</strong><a href="${esc(guide.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(guide.sourceTitle || 'Открыть источник')} ${icon('external',13)}</a><small>${esc(guide.sourceDate || 'Источник указан для проверки информации')}</small></div></div><div class="guide-actions"><button type="button" class="button button-primary full-button" data-action="guide-action" data-id="${guide.id}">${esc(guide.action || 'Выбрать следующий шаг')} ${icon('arrow',15)}</button><button type="button" class="button button-secondary full-button" data-action="close-overlay">Вернуться в библиотеку</button></div><p class="field-help">Материал не является диагнозом. Дыхательные и поведенческие приёмы могут быть вспомогательными, но не заменяют подходящую медицинскую помощь.</p></article></div>`;
}

function renderProfile() {
  const p = state.plan, tracking = state.tracking, finance = state.finance, prefs = state.preferences;
  const installed = window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
  return `
    <section class="page-heading"><div><p class="eyebrow">ТВОЁ ПРОСТРАНСТВО</p><h1>Профиль</h1><p class="page-subtitle">Настрой «Выдох» под себя. Можно менять решения по ходу пути.</p></div><span class="heading-icon">${icon('user', 21)}</span></section>
    <section class="profile-summary"><span class="profile-avatar">${icon('leaf', 26)}</span><div><p class="eyebrow">ТВОЙ ПОДХОД</p><h2>${p.strategy === 'quit' ? 'Полный отказ' : 'Постепенное сокращение'}</h2><p>${p.strategy === 'quit' ? 'Движение к жизни без никотина' : 'Отслеживание выбранного показателя'}</p></div><span class="profile-summary-status">${icon('check', 15)}</span></section>
    <section class="settings-section"><div class="settings-heading"><span class="settings-heading-icon">${icon('target', 19)}</span><div><h2>Стратегия и цель</h2><p>Можно переключить в любой момент.</p></div></div><div class="form-card">
      <label class="form-field"><span>Мой подход</span><select data-field="plan.strategy"><option value="quit" ${p.strategy === 'quit' ? 'selected' : ''}>Полный отказ</option><option value="reduce" ${p.strategy === 'reduce' ? 'selected' : ''}>Постепенное сокращение</option></select></label>
      <label class="form-field"><span>Дата начала</span><input type="date" data-field="plan.startDate" value="${esc(p.startDate)}" max="${today()}"></label>
      <label class="form-field"><span>Исходный показатель <small>необязательно</small></span><input type="number" min="0" max="99999" step="1" inputmode="numeric" data-field="plan.baseline" value="${p.baseline ?? ''}" placeholder="Например, 40"></label>
      <label class="form-field"><span>Цель на день <small>${p.strategy === 'reduce' ? 'нужна для выбранной стратегии' : 'необязательно'}</small></span><input type="number" min="0" max="99999" step="1" inputmode="numeric" data-field="plan.dailyTarget" value="${p.dailyTarget || ''}" placeholder="Не задана"></label>
    </div></section>
    <section class="settings-section"><div class="settings-heading"><span class="settings-heading-icon">${icon('chart', 19)}</span><div><h2>Как считать употребление</h2><p>Выбирай один показатель, чтобы сравнение было честным.</p></div></div><div class="form-card">
      <label class="form-field"><span>Единица учёта</span><select data-field="tracking.unit"><option value="puffs" ${tracking.unit === 'puffs' ? 'selected' : ''}>Количество затяжек</option><option value="sessions" ${tracking.unit === 'sessions' ? 'selected' : ''}>Количество сеансов</option><option value="pods" ${tracking.unit === 'pods' ? 'selected' : ''}>Картриджи / устройства</option><option value="custom" ${tracking.unit === 'custom' ? 'selected' : ''}>Свой показатель</option></select></label>
      ${tracking.unit === 'custom' ? `<label class="form-field"><span>Название единицы</span><input type="text" maxlength="24" data-field="tracking.unitLabel" value="${esc(tracking.unitLabel || '')}" placeholder="Например, эпизоды"></label>` : ''}
      <p class="field-help">Старые записи сохраняются в исходных единицах — приложение не переводит затяжки в сеансы или картриджи автоматически.</p>
    </div></section>
    <section class="settings-section"><div class="settings-heading"><span class="settings-heading-icon">${icon('money', 19)}</span><div><h2>Деньги и личная цель</h2><p>Расчёт ориентировочный и зависит от введённых данных.</p></div></div><div class="form-card">
      <label class="form-field"><span>Расходы на вейп в неделю</span><input type="number" min="0" max="1000000000" step="0.01" inputmode="decimal" data-field="finance.weeklySpend" value="${finance.weeklySpend ?? ''}" placeholder="Не указаны"></label>
      <label class="form-field"><span>Валюта</span><select data-field="finance.currency">${['€', '₽', '$', '£', '₴', '₸', 'zł'].map(c => `<option value="${c}" ${finance.currency === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
      <label class="form-field"><span>На что коплю</span><input type="text" maxlength="60" data-field="finance.goalName" value="${esc(finance.goalName)}" placeholder="Например, поездка"></label>
      <label class="form-field"><span>Сумма цели</span><input type="number" min="0" max="1000000000" step="0.01" data-field="finance.goalAmount" value="${finance.goalAmount ?? ''}" placeholder="Не задана"></label>
    </div></section>
    <section class="settings-section"><div class="settings-heading"><span class="settings-heading-icon">${icon('clock', 19)}</span><div><h2>Напоминания</h2><p>В локальной версии работают, пока приложение открыто.</p></div></div><div class="form-card">
      <label class="switch-field"><span><strong>Напоминать о паузе</strong><small>Не чаще выбранного расписания</small></span><input type="checkbox" data-field="preferences.remindersEnabled" ${prefs.remindersEnabled ? 'checked' : ''}><i class="switch-ui"></i></label>
      ${prefs.reminderTimes.map((time, i) => `<label class="form-field"><span>${['Утро', 'День', 'Вечер'][i] || `Напоминание ${i + 1}`}</span><input type="time" data-field="preferences.reminderTime.${i}" value="${esc(time)}"></label>`).join('')}
      <button type="button" class="button button-secondary full-button" data-action="test-reminder">${icon('clock', 16)} Проверить уведомления</button>
      <p class="field-help">Push при закрытом приложении не настроен: в архиве нет сервера push. Не включай уведомления, если не хочешь их получать.</p>
    </div></section>
    <section class="settings-section"><div class="settings-heading"><span class="settings-heading-icon">${icon('wind', 19)}</span><div><h2>Дыхательные практики</h2><p>Звук и вибрация — по желанию.</p></div></div><div class="form-card">
      <label class="switch-field"><span><strong>Звуковые сигналы</strong><small>Короткий мягкий тон при смене фазы</small></span><input type="checkbox" data-field="preferences.sound" ${prefs.sound ? 'checked' : ''}><i class="switch-ui"></i></label>
      <label class="switch-field"><span><strong>Вибрация</strong><small>Короткий тактильный сигнал, если устройство поддерживает его</small></span><input type="checkbox" data-field="practiceSettings.vibration" ${state.practiceSettings.vibration ? 'checked' : ''}><i class="switch-ui"></i></label>
      <p class="field-help">Управление доступно и внутри самой практики. Браузер или режим энергосбережения могут ограничивать звук и вибрацию.</p>
    </div></section>
    <section class="settings-section"><div class="settings-heading"><span class="settings-heading-icon">${icon('lock', 19)}</span><div><h2>Твои данные</h2><p>Без аккаунта и обязательной синхронизации.</p></div></div><div class="data-actions">
      <button class="data-action" type="button" data-action="export-data"><span>${icon('download', 19)}</span><strong>Экспортировать резервную копию</strong>${icon('chevron', 17)}</button>
      <button class="data-action" type="button" data-action="import-data"><span>${icon('upload', 19)}</span><strong>Восстановить из файла</strong>${icon('chevron', 17)}</button>
      <div class="data-privacy-note">${icon('lock', 15)} Данные хранятся в браузере на этом устройстве. При очистке данных сайта они могут быть удалены. Сделай резервную копию перед сменой телефона.</div>
    </div></section>
    <section class="about-card"><span class="about-mark">${icon('leaf', 22)}</span><div><h2>Выдох <span>v1.2.0</span></h2><p>Поддержка без давления. Прогресс без сравнения с другими.</p><small>${installed ? 'Приложение установлено' : 'Веб-версия · можно установить из браузера'}</small></div></section>
    <div class="danger-zone"><button type="button" class="text-action danger-text" data-action="reset-data">Сбросить данные приложения</button></div>
  `;
}

function renderOverlay() {
  if (!overlay) return '';
  if (overlay.type === 'onboarding') return renderOnboardingOverlay();
  if (overlay.type === 'day') return renderDayOverlay(overlay.date);
  if (overlay.type === 'practice') return renderPracticeOverlay(overlay.id);
  if (overlay.type === 'practice-result') return renderPracticeResultOverlay();
  if (overlay.type === 'craving') return renderCravingOverlay();
  if (overlay.type === 'slip') return renderSlipOverlay();
  if (overlay.type === 'weekly-review') return renderWeeklyReviewOverlay();
  if (overlay.type === 'support') return renderSupportOverlay();
  if (overlay.type === 'guide') return renderGuideOverlay(overlay.id);
  if (overlay.type === 'reset') return renderResetOverlay();
  if (overlay.type === 'import-confirm') return renderImportConfirmOverlay();
  return '';
}

function renderOnboardingOverlay() {
  return `<div class="modal-backdrop onboarding-backdrop" data-action="backdrop-close"><section class="modal onboarding-modal" role="dialog" aria-modal="true" aria-labelledby="onboarding-title"><div class="onboarding-art"><div class="onboarding-orb orb-one"></div><div class="onboarding-orb orb-two"></div><div class="onboarding-logo">${icon('wind', 29)}</div></div><p class="eyebrow">ДОБРО ПОЖАЛОВАТЬ В «ВЫДОХ»</p><h2 id="onboarding-title">Твой путь.<br><em>Твой собственный ритм.</em></h2><p class="modal-lead">Подстроим поддержку под твою цель. Это займёт меньше минуты — настройки можно изменить позже.</p><form id="onboarding-form" class="onboarding-form"><label class="form-field"><span>С чего хочешь начать?</span><select name="strategy" id="onboard-strategy"><option value="quit" ${state.plan.strategy === 'quit' ? 'selected' : ''}>Полный отказ от никотина</option><option value="reduce" ${state.plan.strategy === 'reduce' ? 'selected' : ''}>Постепенное сокращение</option></select></label><label class="form-field"><span>Дата начала</span><input type="date" name="startDate" value="${esc(state.plan.startDate)}" max="${today()}" required></label><div class="form-field"><span>Что удобно отслеживать?</span><select name="unit"><option value="puffs">Затяжки</option><option value="sessions">Сеансы использования</option><option value="pods">Картриджи / устройства</option><option value="custom">Свой показатель</option></select></div><label class="form-field" id="onboard-target-field"><span>Цель на день <small>можно задать позже</small></span><input type="number" name="target" min="0" max="99999" placeholder="Не задана"></label><button type="submit" class="button button-primary full-button">Начать свой путь ${icon('arrow', 16)}</button></form><p class="onboarding-privacy">${icon('lock', 13)} Без аккаунта. Твои данные остаются на устройстве.</p><button type="button" class="onboarding-skip" data-action="onboarding-skip">Настроить позже</button></section></div>`;
}

function renderDayOverlay(date) {
  const log = getLog(state, date);
  const status = getStatus(state, date);
  const reportedUse = hasReportedUseOnDate(state, date);
  const unknownUseAmount = reportedUse && (log.amount === 0 || log.untracked);
  const statusText = unknownUseAmount ? 'Употребление отмечено; количество не указано' : { before: 'До выбранной даты начала', future: 'Будущий день', clear: state.dailyLogs[date]?.noUseConfirmed ? 'День отмечен как без употребления' : 'Нет записей об употреблении', unrecorded: 'Нет измерения за этот день', within: 'В пределах выбранной цели', used: 'Есть запись об употреблении', untracked: 'Старый показатель учтён в другой единице' }[status];
  const noUseToggle = canMarkNoUse(date) ? `<button type="button" class="button button-secondary full-button" data-action="toggle-no-use" data-date="${date}">${state.dailyLogs[date]?.noUseConfirmed ? 'Снять отметку о дне без употребления' : 'Отметить день без употребления'}</button>` : '';

  return `<div class="modal-backdrop" data-action="backdrop-close"><section class="modal sheet-modal" role="dialog" aria-modal="true" aria-labelledby="day-title"><div class="modal-handle"></div><div class="modal-heading"><div><p class="eyebrow">ЗАПИСЬ ЗА ДЕНЬ</p><h2 id="day-title">${esc(formatLongDate(date))}</h2></div><button type="button" class="quiet-icon" data-action="close-overlay" aria-label="Закрыть">${icon('close', 19)}</button></div><div class="day-status-line"><span class="status-dot status-${status}"></span>${statusText}</div><div class="day-amount-editor"><div><span class="eyebrow">ОТМЕЧЕННЫЙ ПОКАЗАТЕЛЬ</span><strong>${unknownUseAmount ? '—' : log.amount}</strong><small>${unknownUseAmount ? 'количество не указано' : esc(getUnitLabel(state))}</small></div><div class="stepper"><button type="button" data-action="adjust-day-amount" data-date="${date}" data-delta="-1" ${log.amount <= 0 ? 'disabled' : ''} aria-label="Уменьшить">${icon('minus', 19)}</button><button type="button" data-action="adjust-day-amount" data-date="${date}" data-delta="1" aria-label="Увеличить">${icon('plus', 19)}</button></div></div><div class="trigger-field"><div class="trigger-field-heading"><strong>Что могло повлиять?</strong><small>Необязательно · выбери всё подходящее</small></div><div class="trigger-chips" role="group" aria-label="Возможные триггеры">${TRIGGER_OPTIONS.map(([id, label]) => `<button type="button" class="trigger-chip ${(log.triggers || []).includes(id) ? 'selected' : ''}" data-action="toggle-trigger" data-date="${date}" data-id="${id}" aria-pressed="${(log.triggers || []).includes(id)}">${label}</button>`).join('')}</div></div><div class="trigger-field mood-field"><div class="trigger-field-heading"><strong>Как ты себя чувствовал(а)?</strong><small>Одна отметка по желанию</small></div><div class="trigger-chips" role="group" aria-label="Эмоциональное состояние">${EMOTION_OPTIONS.map(([id, label]) => `<button type="button" class="trigger-chip ${(log.mood || '') === id ? 'selected' : ''}" data-action="set-day-mood" data-date="${date}" data-id="${id}" aria-pressed="${(log.mood || '') === id}">${label}</button>`).join('')}</div></div><label class="form-field day-note-field"><span>Заметка</span><textarea rows="4" maxlength="4000" data-field="day.note" data-date="${date}" placeholder="Что происходило? Что помогло? Без оценок — только наблюдения.">${esc(log.note)}</textarea></label><div class="modal-actions">${noUseToggle}<button type="button" class="button button-primary full-button" data-action="close-overlay">Готово</button></div><p class="field-help">Изменения сохраняются на этом устройстве. Прошлые записи не влияют на сегодняшнюю цель автоматически.</p></section></div>`;
}

function renderPracticeOverlay(id) {
  const base = PRACTICES.find(item => item.id === id) || PRACTICES[0];
  if (!activePractice) activePractice = { ...base, duration: (state.practiceSettings?.durations?.[base.id] || Math.round(base.duration / 60)) * 60 };
  const p = activePractice;
  const running = !!practiceTimer && !practicePaused;
  const started = running || practicePaused || practiceElapsedBeforePause > 0;
  const favorites = new Set(state.practiceSettings?.favorites || []);
  return `<div class="modal-backdrop dark-backdrop"><section class="practice-modal" role="dialog" aria-modal="true" aria-labelledby="practice-title"><div class="practice-modal-top"><button type="button" class="dark-icon-button" data-action="close-overlay" aria-label="Закрыть">${icon('close', 20)}</button><span class="dark-kicker">ПРАКТИКА ДЛЯ СЕБЯ</span><div class="practice-top-actions"><button type="button" class="dark-icon-button ${favorites.has(p.id)?'is-favorite':''}" data-action="toggle-practice-favorite" data-id="${p.id}" aria-label="${favorites.has(p.id)?'Убрать из':'Добавить в'} избранное" aria-pressed="${favorites.has(p.id)}">${icon('star',18)}</button><button type="button" class="dark-icon-button" data-action="toggle-sound" aria-label="${state.preferences.sound ? 'Выключить' : 'Включить'} звук" aria-pressed="${state.preferences.sound}">${icon(state.preferences.sound ? 'volume' : 'volumeOff', 19)}</button><button type="button" class="dark-icon-button" data-action="toggle-vibration" aria-label="${state.practiceSettings.vibration?'Выключить':'Включить'} вибрацию" aria-pressed="${state.practiceSettings.vibration}">${icon('activity',18)}</button></div></div><div class="practice-stage"><div class="practice-halo halo-1"></div><div class="practice-halo halo-2"></div><div class="practice-halo halo-3"></div><div id="active-breath-orb" class="active-breath-orb" data-phase="rest"><span></span><i></i></div><div class="practice-stage-caption"><span id="breath-phase" aria-live="polite" aria-atomic="true">${started?'Готов(а) продолжить':'Выбери свой ритм'}</span><small id="breath-instruction" aria-live="polite" aria-atomic="true">${esc(p.guidance || 'Найди удобное положение и дыши комфортно.')}</small></div></div><div class="practice-detail"><p class="dark-kicker">${esc(p.label)}</p><h2 id="practice-title">${esc(p.name)}</h2><p>${esc(p.description)}</p>${!started?`<label class="practice-duration-field"><span>Продолжительность</span><select data-field="practice.duration" aria-label="Продолжительность практики">${[1,3,5,10].map(minutes=>`<option value="${minutes}" ${Math.round(p.duration/60)===minutes?'selected':''}>${minutes} ${plural(minutes,['минута','минуты','минут'])}</option>`).join('')}</select></label>`:`<div class="practice-session-meta"><span>${icon('clock',14)} Сессия ${Math.round(p.duration/60)} мин</span><span>${state.practiceSettings.vibration?icon('activity',14)+' Вибрация включена':''}</span></div>`}<div class="practice-timer" id="practice-timer" aria-live="off">${formatDuration(started?Math.max(0,p.duration-practiceElapsedBeforePause):p.duration)}</div><div class="practice-track"><span id="practice-track-fill" style="width:0%"></span></div><div class="practice-controls"><button type="button" class="button button-lime" id="practice-toggle" data-action="practice-toggle">${icon(running?'pause':'play',17)} ${running?'Пауза':started?'Продолжить':'Начать'}</button><button type="button" class="button button-dark-outline" data-action="practice-stop">${started?'Завершить':'Закрыть'}</button></div><p class="practice-footnote">Дыши без усилия. Задержки необязательны. При головокружении или дискомфорте остановись и вернись к обычному дыханию.</p></div></section></div>`;
}

function renderPracticeResultOverlay() {
  const session = state.practiceSessions.find(item => item.sessionKey === practiceResultSessionKey);
  const practice = PRACTICES.find(item => item.id === session?.id);
  return `<div class="modal-backdrop dark-backdrop"><section class="practice-result-modal" role="dialog" aria-modal="true" aria-labelledby="practice-result-title"><div class="practice-result-orb">${icon('check',26)}</div><p class="dark-kicker">ПАУЗА ЗАВЕРШЕНА</p><h2 id="practice-result-title">Спасибо, что уделил(а) время себе.</h2><p>${esc(practice?.name || 'Практика')} · ${Math.round((session?.duration || 0)/60)} мин. Если тебе подходит, отметь, как ощущается момент сейчас. Это необязательно.</p><div class="practice-result-fields">${ratingScale('practice-feedback','afterRating',practiceResultDraft.afterRating,'Насколько сильна тяга сейчас?')}<div class="dark-field-group"><span>Как ты себя чувствуешь?</span>${choiceChips('practice-feedback','mood',EMOTION_OPTIONS,practiceResultDraft.mood)}</div><label class="form-field dark-form-field"><span>Заметка <small>необязательно</small></span><textarea rows="2" maxlength="500" data-field="practice.feedback.note" placeholder="Что хотелось бы запомнить?">${esc(practiceResultDraft.note)}</textarea></label></div><button type="button" class="button button-lime full-button" data-action="save-practice-feedback">Сохранить наблюдение</button><button type="button" class="craving-secondary-action" data-action="skip-practice-feedback">Пропустить и продолжить</button><p class="practice-footnote">Оценка отражает только твои ощущения и сама по себе не доказывает эффективность техники.</p></section></div>`;
}

function choiceChips(action, field, options, selected, extra = '') {
  return `<div class="choice-chip-grid ${extra}" role="group" aria-label="${esc(field)}">${options.map(([id, label]) => `<button type="button" class="choice-chip ${selected === id ? 'selected' : ''}" data-action="${action}" data-field="${field}" data-value="${id}" aria-pressed="${selected === id}">${esc(label)}</button>`).join('')}</div>`;
}

function ratingScale(action, field, selected, label) {
  return `<div class="rating-field"><div class="rating-field-label"><strong>${esc(label)}</strong><small>1 — почти нет · 5 — очень сильно</small></div><div class="rating-scale" role="group" aria-label="${esc(label)}">${[1, 2, 3, 4, 5].map(n => `<button type="button" class="rating-choice ${Number(selected) === n ? 'selected' : ''}" data-action="${action}" data-field="${field}" data-value="${n}" aria-pressed="${Number(selected) === n}">${n}</button>`).join('')}</div></div>`;
}

function renderCravingOverlay() {
  const started = !!cravingStartedAt;
  return `<div class="modal-backdrop dark-backdrop craving-backdrop" data-action="backdrop-close"><section class="craving-modal craving-diary-modal" role="dialog" aria-modal="true" aria-labelledby="craving-title"><div class="practice-modal-top"><button type="button" class="dark-icon-button" data-action="close-overlay" aria-label="Закрыть">${icon('close', 20)}</button><span class="dark-kicker">МЫ ПРОЙДЁМ ЭТОТ МОМЕНТ</span><span class="craving-step">${started ? 'ПАУЗА' : 'ЗАМЕТИТЬ → ВЫБРАТЬ'}</span></div><div class="craving-visual"><div class="craving-ripple ripple-one"></div><div class="craving-ripple ripple-two"></div><div class="craving-core">${icon('wind', 30)}</div></div><div class="craving-copy"><p class="dark-kicker">СЕЙЧАС ДОСТАТОЧНО ПАУЗЫ</p><h2 id="craving-title">${started ? (cravingRemaining <= 0 ? 'Ты уделил(а) себе время.' : 'Тяга — ощущение, не приказ.') : 'Что происходит прямо сейчас?'}</h2><p>${started ? 'Не нужно прогонять чувство. Заметь, что меняется, и выбери следующий шаг, когда будешь готов(а).' : 'Короткая запись поможет заметить связь между ситуацией, эмоцией и тем, что тебе помогает. Всё необязательно, можно просто начать паузу.'}</p></div>
    ${!started ? `<div class="craving-diary-fields">${ratingScale('craving-choice', 'beforeRating', cravingDraft.beforeRating, 'Насколько сильна тяга?')}<div class="dark-field-group"><span>Что могло её запустить?</span>${choiceChips('craving-choice', 'trigger', TRIGGER_OPTIONS, cravingDraft.trigger)}</div><div class="dark-field-group"><span>Что ты сейчас чувствуешь?</span>${choiceChips('craving-choice', 'emotion', EMOTION_OPTIONS, cravingDraft.emotion)}</div><div class="dark-field-group"><span>Что попробуешь сделать?</span>${choiceChips('craving-choice', 'action', ACTION_OPTIONS, cravingDraft.action)}</div><label class="form-field dark-form-field"><span>Заметка <small>необязательно</small></span><textarea rows="2" maxlength="1000" data-field="craving.note" placeholder="Например, это случилось во время перерыва…">${esc(cravingDraft.note)}</textarea></label></div><button type="button" class="button button-lime full-button" data-action="start-craving">${icon('play', 16)} Начать пятиминутную паузу</button><button type="button" class="craving-secondary-action" data-action="craving-practice">Вместо этого — дыхательная практика ${icon('arrow', 15)}</button><button type="button" class="craving-secondary-action slip-link" data-action="open-slip">${state.plan.strategy === 'reduce' ? 'Употребление уже произошло? Записать контекст' : 'Случился срыв? Разобрать ситуацию без самокритики'}</button>` : `<div class="craving-timer-wrap"><span class="craving-timer-label">Время паузы</span><strong id="craving-timer">${formatDuration(cravingRemaining)}</strong><div class="practice-track"><span id="craving-track-fill" style="width:${Math.max(0, (300 - cravingRemaining) / 300 * 100)}%"></span></div></div><div class="craving-after-fields">${ratingScale('craving-choice', 'afterRating', cravingDraft.afterRating, 'А сейчас насколько сильна тяга?')}<div class="dark-field-group"><span>Как изменилась ситуация?</span>${choiceChips('craving-choice', 'outcome', OUTCOME_OPTIONS, cravingDraft.outcome)}</div></div><div class="craving-next-actions"><button type="button" class="button button-lime full-button" data-action="finish-craving">Сохранить запись и завершить</button><button type="button" class="button button-dark-outline full-button" data-action="craving-practice">Перейти к дыханию</button></div>`}<p class="practice-footnote">Сила тяги и её изменение индивидуальны. Пауза может помочь создать пространство для выбора, но не гарантирует, что желание исчезнет. Если нужна дополнительная помощь, обратись к специалисту.</p></section></div>`;
}

function renderSlipOverlay() {
  const reducing = state.plan.strategy === 'reduce';
  const title = reducing ? 'Давай спокойно разберём ситуацию' : 'Один эпизод не стирает твой путь';
  const eyebrow = reducing ? 'БЕЗ САМООЦЕНКИ' : 'БЕЗ САМОКРИТИКИ';
  const lead = reducing
    ? 'Количество можно отметить отдельно. Здесь достаточно записать контекст, если это поможет понять привычку.'
    : 'Не нужно ждать понедельника или начинать всё заново. Если готов(а), отметь контекст — это поможет подготовить другой вариант на будущее.';
  const reassurance = reducing
    ? 'Цель сокращения — наблюдать за привычкой и менять её постепенно. Эта запись не пересчитывает количество автоматически.'
    : 'Мы сохраняем предыдущую историю, достижения и наблюдения. Ничего не обнуляется.';
  return `<div class="modal-backdrop" data-action="backdrop-close"><section class="modal sheet-modal recovery-modal" role="dialog" aria-modal="true" aria-labelledby="slip-title"><div class="modal-handle"></div><div class="modal-heading"><div><p class="eyebrow">${eyebrow}</p><h2 id="slip-title">${title}</h2></div><button type="button" class="quiet-icon" data-action="close-overlay" aria-label="Закрыть">${icon('close', 19)}</button></div><p class="modal-lead">${lead}</p><div class="recovery-callout">${icon('heart', 20)}<span>${reassurance}</span></div><div class="trigger-field"><div class="trigger-field-heading"><strong>Что было перед этим?</strong><small>Можно выбрать одну ситуацию</small></div>${choiceChips('slip-choice', 'trigger', TRIGGER_OPTIONS, slipDraft.trigger)}</div><div class="trigger-field"><div class="trigger-field-heading"><strong>Что ты чувствовал(а)?</strong><small>Необязательно</small></div>${choiceChips('slip-choice', 'emotion', EMOTION_OPTIONS, slipDraft.emotion)}</div><label class="form-field"><span>Что может помочь в следующий раз?</span><textarea rows="3" maxlength="1000" data-field="slip.note" placeholder="Например: выйти на короткую прогулку вместо привычного перерыва…">${esc(slipDraft.note)}</textarea></label><div class="modal-actions"><button type="button" class="button button-primary full-button" data-action="save-slip">Сохранить наблюдение ${icon('arrow', 15)}</button><button type="button" class="button button-secondary full-button" data-action="close-overlay">Пока не готов(а)</button></div></section></div>`;
}

function renderWeeklyReviewOverlay() {
  const metrics = getWeeklyReviewMetrics(state);
  const key = getWeekStartISO();
  const saved = state.weeklyReviews?.[key] || { focus: '', note: '' };
  const repeatedTriggers = metrics.topTriggers.filter(([, count]) => count >= 2);
  const topTriggerRows = repeatedTriggers.length ? repeatedTriggers.map(([id, count]) => `<div class="review-insight-row"><span>${esc(triggerLabel(id))}</span><strong>${count} ${plural(count, ['отметка', 'отметки', 'отметок'])}</strong></div>`).join('') : `<p class="review-empty">${metrics.topTriggers.length ? 'Пока ни одна ситуация не отмечалась повторно.' : 'Пока нет записей о триггерах.'} Если удобно, продолжай отмечать контекст — мы не делаем выводов по одной записи.</p>`;
  const topEmotionRows = metrics.topEmotions.length ? metrics.topEmotions.map(([id, count]) => `<div class="review-insight-row"><span>${esc(emotionLabel(id))}</span><strong>${count}</strong></div>`).join('') : '<p class="review-empty">Эмоциональное состояние пока не отмечалось — это необязательно.</p>';
  const actions = metrics.helpfulActions.length ? metrics.helpfulActions.map(([id, count]) => `<div class="review-insight-row"><span>${esc(actionLabel(id))}</span><strong>${count} ${plural(count, ['раз отмечалось облегчение', 'раза отмечалось облегчение', 'раз отмечалось облегчение'])}</strong></div>`).join('') : metrics.topActions.length ? metrics.topActions.map(([id, count]) => `<div class="review-insight-row"><span>${esc(actionLabel(id))}</span><strong>${count} ${plural(count, ['выбор', 'выбора', 'выборов'])}</strong></div>`).join('') : '<p class="review-empty">Пока нет записей о выбранных действиях. Можно начать с короткой паузы или дыхания.</p>';
  const trendText = state.plan.strategy === 'reduce' ? ({ down: 'Среднее значение последних доступных дней ниже ранних значений этого периода.', up: 'Среднее значение последних доступных дней выше ранних значений. Посмотри на контекст без самокритики.', steady: 'Показатель примерно стабилен в доступных записях.', unknown: 'Пока недостаточно сопоставимых значений, чтобы сравнить динамику.' })[metrics.trend] : `${metrics.noUseDays} дней с явно отмеченным нулевым показателем. Это отражает записи приложения, а не независимое подтверждение воздержания.`;
  const focusOptions = state.plan.strategy === 'reduce' ? [['trigger-plan','Работа с частым триггером'], ['same-unit','Продолжать один показатель учёта'], ['review-target','Проверить реалистичность цели'], ['pause','Короткие паузы при тяге'], ['support','Обсудить поддержку со специалистом']] : [['trigger-plan','Подготовить ответ на частый триггер'], ['pause','Использовать короткую паузу при тяге'], ['breath','Практиковать спокойное дыхание'], ['support','Обсудить поддержку со специалистом'], ['self-kindness','Мягко вернуться к плану после сложного дня']];
  return `<div class="modal-backdrop" data-action="backdrop-close"><section class="modal sheet-modal weekly-review-modal" role="dialog" aria-modal="true" aria-labelledby="weekly-review-title"><div class="modal-handle"></div><div class="modal-heading"><div><p class="eyebrow">ЛИЧНЫЕ НАБЛЮДЕНИЯ · 7 ДНЕЙ</p><h2 id="weekly-review-title">Неделя без оценок</h2><p class="review-date-range">${esc(formatShortDate(metrics.start))} — ${esc(formatShortDate(metrics.end))}</p></div><button type="button" class="quiet-icon" data-action="close-overlay" aria-label="Закрыть">${icon('close', 19)}</button></div><div class="review-summary-grid"><article><strong>${metrics.cravingCount}</strong><span>эпизодов тяги</span></article><article><strong>${state.plan.strategy === 'reduce' ? metrics.useContextCount : metrics.slipCount}</strong><span>${state.plan.strategy === 'reduce' ? 'эпизодов с контекстом' : 'сложных эпизодов'}</span></article><article><strong>${metrics.practices}</strong><span>практик</span></article><article><strong>${metrics.taskCompletions}</strong><span>шагов отмечено</span></article></div><section class="review-section"><p class="eyebrow">ДИНАМИКА</p><h3>${state.plan.strategy === 'reduce' ? 'Как менялся показатель' : 'Что удалось заметить'}</h3><p>${esc(trendText)}</p><p class="review-coaching">${esc(weeklyReviewMessage(metrics))}</p></section><section class="review-section"><p class="eyebrow">ПОВТОРЯЮЩИЕСЯ СИТУАЦИИ</p><h3>Что чаще запускало тягу?</h3><div class="review-insight-list">${topTriggerRows}</div></section><section class="review-section"><p class="eyebrow">СОСТОЯНИЕ</p><h3>Какие эмоции встречались?</h3><div class="review-insight-list">${topEmotionRows}</div></section><section class="review-section"><p class="eyebrow">ЧТО ПОМОГАЛО</p><h3>${metrics.helpfulActions.length ? 'Что отмечалось как полезное' : 'Какие действия ты выбирал(а)'}</h3><div class="review-insight-list">${actions}</div><p class="field-help">Если выбрано облегчение, это отражает твою собственную оценку после действия, а не доказывает причинно-следственную связь. Если отметок пока мало, список показывает просто частоту выбранных действий.</p></section><section class="review-section review-next-step"><p class="eyebrow">СЛЕДУЮЩИЕ 7 ДНЕЙ</p><h3>Выбери один фокус</h3><p>Один реалистичный шаг полезнее длинного списка обещаний.</p><label class="form-field"><span>Мой фокус на неделю</span><select data-field="weekly.focus"><option value="">Выбрать позже</option>${focusOptions.map(([id, label]) => `<option value="${id}" ${saved.focus === id ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label class="form-field"><span>Что хочу помнить на следующей неделе</span><textarea rows="3" maxlength="2000" data-field="weekly.note" placeholder="Например, в перерыве сначала выйти на улицу без вейпа…">${esc(saved.note || '')}</textarea></label><p class="field-help">Обзор остаётся на устройстве. Он помогает замечать закономерности, но не ставит диагнозов и не обещает результат.</p><button type="button" class="button button-primary full-button" data-action="close-overlay">Готово</button></section></section></div>`;
}

function renderSupportOverlay() {
  return `<div class="modal-backdrop" data-action="backdrop-close"><section class="modal sheet-modal" role="dialog" aria-modal="true" aria-labelledby="support-title"><div class="modal-handle"></div><div class="modal-heading"><div><p class="eyebrow">ПОДДЕРЖКА</p><h2 id="support-title">О чём поговорить со специалистом</h2></div><button type="button" class="quiet-icon" data-action="close-overlay" aria-label="Закрыть">${icon('close', 19)}</button></div><p class="modal-lead">Можно обратиться к врачу или специалисту по отказу от никотина, если самостоятельно справляться трудно.</p><ul class="support-list"><li>Как часто возникает тяга и в каких ситуациях.</li><li>Какие попытки отказа уже были и что в них помогало.</li><li>Какие варианты поведенческой и медицинской поддержки подходят с учётом здоровья.</li><li>Какие побочные эффекты, противопоказания и дальнейшее наблюдение важно обсудить.</li></ul><div class="guide-source"><span>${icon('book-open',17)}</span><div><strong>Проверенный источник</strong><a href="https://www.who.int/publications/i/item/9789240096431" target="_blank" rel="noopener noreferrer">ВОЗ — клиническое руководство по отказу от табака у взрослых (2024) ${icon('external',13)}</a><small>Руководство относится к табачным продуктам; варианты помощи при вейпинге уточняй со специалистом.</small><a href="https://www.who.int/news-room/questions-and-answers/item/how-to-quit-e-cigarettes" target="_blank" rel="noopener noreferrer">ВОЗ — как отказаться от электронных сигарет ${icon('external',13)}</a></div></div><div class="soft-info">${icon('info', 17)}<p>Не начинай и не меняй приём лекарств самостоятельно. Доступные методы различаются в зависимости от страны и индивидуальных обстоятельств.</p></div><button type="button" class="button button-primary full-button" data-action="close-overlay">Понятно</button></section></div>`;
}

function renderResetOverlay() {
  return `<div class="modal-backdrop" data-action="backdrop-close"><section class="modal sheet-modal" role="dialog" aria-modal="true" aria-labelledby="reset-title"><div class="modal-handle"></div><div class="modal-heading"><div><p class="eyebrow">ОСТОРОЖНО</p><h2 id="reset-title">Сбросить данные?</h2></div><button type="button" class="quiet-icon" data-action="close-overlay" aria-label="Закрыть">${icon('close', 19)}</button></div><p class="modal-lead">Текущая история, настройки и достижения будут удалены из активного хранилища этого приложения. Перед сбросом лучше экспортировать резервную копию.</p><div class="modal-actions"><button type="button" class="button button-danger full-button" data-action="confirm-reset">Да, сбросить</button><button type="button" class="button button-secondary full-button" data-action="close-overlay">Оставить как есть</button></div></section></div>`;
}

function renderImportConfirmOverlay() {
  return `<div class="modal-backdrop"><section class="modal sheet-modal" role="dialog" aria-modal="true" aria-labelledby="import-title"><div class="modal-handle"></div><div class="modal-heading"><div><p class="eyebrow">ВОССТАНОВЛЕНИЕ</p><h2 id="import-title">Заменить текущие данные?</h2></div><button type="button" class="quiet-icon" data-action="cancel-import" aria-label="Отмена">${icon('close', 19)}</button></div><p class="modal-lead">Резервная копия подготовлена. Для защиты текущей истории сначала экспортируй её, затем подтверди восстановление.</p><div class="modal-actions"><button type="button" class="button button-primary full-button" data-action="confirm-import">Восстановить копию</button><button type="button" class="button button-secondary full-button" data-action="cancel-import">Отмена</button></div></section></div>`;
}

function updateProfileField(field, value, date = null) {
  const previousState = state;
  state = cloneState();
  const [group, key, sub] = field.split('.');
  if (group === 'day' && key === 'note' && date) {
    if (!state.dailyLogs[date]) state.dailyLogs[date] = { amount: 0, unit: state.tracking.unit, hourly: Array(24).fill(0), note: '', mood: null, triggers: [], measurements: {} };
    state.dailyLogs[date].note = String(value).slice(0, 4000);
    return commitMutation(previousState);
  }
  if (group === 'weekly' && (key === 'focus' || key === 'note')) {
    state.weeklyReviews = state.weeklyReviews || {};
    const reviewKey = getWeekStartISO();
    const existing = state.weeklyReviews[reviewKey] || { focus: '', note: '', updatedAt: null };
    state.weeklyReviews[reviewKey] = { ...existing, [key]: key === 'note' ? String(value).slice(0, 2000) : String(value).slice(0, 40), updatedAt: new Date().toISOString() };
    return commitMutation(previousState);
  }
  if (group === 'plan') {
    if (key === 'strategy') {
      if (value === 'quit' && state.plan.strategy === 'reduce') state.plan.startDate = today();
      state.plan.strategy = value === 'reduce' ? 'reduce' : 'quit';
    } else if (key === 'startDate') {
      if (value && value <= today()) state.plan.startDate = value;
    } else if (key === 'baseline') {
      state.plan.baseline = value === '' ? null : Math.min(99999, Math.max(0, Number(value) || 0));
    } else if (key === 'dailyTarget') {
      state.plan.dailyTarget = Math.min(99999, Math.max(0, Number(value) || 0));
    }
  } else if (group === 'tracking') {
    if (key === 'unit') {
      if (value !== state.tracking.unit) {
        state.plan.baseline = null;
        state.plan.dailyTarget = 0;
      }
      state.tracking.unit = value;
      state.tracking.unitLabel = ({ puffs: 'затяжек', sessions: 'сеансов', pods: 'картриджей', custom: 'единиц' })[value] || 'единиц';
    } else if (key === 'unitLabel') state.tracking.unitLabel = String(value).replace(/[<>\u0026\"'`]/g, '').trim().slice(0, 24) || 'единиц';
  } else if (group === 'finance') {
    if (key === 'weeklySpend' || key === 'goalAmount') state.finance[key] = value === '' ? null : Math.min(1_000_000_000, Math.max(0, Number(value) || 0));
    else if (key === 'currency') state.finance.currency = value;
    else if (key === 'goalName') state.finance.goalName = String(value).slice(0, 60);
  } else if (group === 'preferences') {
    if (key === 'remindersEnabled') {
      if (!value) {
        state.preferences.remindersEnabled = false;
      } else if (!('Notification' in window)) {
        state.preferences.remindersEnabled = false;
        showToast('Этот браузер не поддерживает системные уведомления.');
      } else if (Notification.permission === 'denied') {
        state.preferences.remindersEnabled = false;
        showToast('Уведомления запрещены в настройках браузера.');
      } else {
        state.preferences.remindersEnabled = true;
        if (Notification.permission === 'default') {
          Notification.requestPermission().then(permission => {
            if (permission !== 'granted') {
              state.preferences.remindersEnabled = false;
              persist(); render(); showToast('Разрешение на уведомления не выдано.');
            } else {
              persist(); render(); showToast('Напоминания включены, пока приложение открыто.');
            }
          }).catch(() => {
            state.preferences.remindersEnabled = false;
            persist(); render(); showToast('Не удалось запросить разрешение на уведомления.');
          });
        }
      }
    } else if (key === 'reminderTime' && sub != null) state.preferences.reminderTimes[Number(sub)] = value;
    else if (key === 'sound') state.preferences.sound = value === true;
  } else if (group === 'practiceSettings' && key === 'vibration') {
    state.practiceSettings.vibration = value === true;
  }
  return commitMutation(previousState);
}

function canMarkNoUse(date) {
  if (!date || date < state.plan.startDate || date > today() || hasReportedUseOnDate(state, date)) return false;
  const row = state.dailyLogs?.[date];
  if (row && (Number(row.amount || 0) > 0 || Object.values(row.measurements || {}).some(measure => Number(measure?.amount || 0) > 0))) return false;
  if (getLog(state, date).untracked) return false;
  return true;
}

function toggleNoUse(date) {
  if (!canMarkNoUse(date)) {
    showToast('Нельзя отметить день без употребления, если есть запись об употреблении или данные в другой единице.');
    return;
  }
  const previousState = state;
  state = cloneState();
  const row = state.dailyLogs[date] || { amount: 0, unit: state.tracking.unit, hourly: Array(24).fill(0), note: '', mood: null, triggers: [], measurements: {} };
  const marking = row.noUseConfirmed !== true;
  const measurements = { ...(row.measurements || {}) };
  // Removing an explicit no-use mark must remove the zero measurement created by that action,
  // without touching measurements for other units.
  if (!marking) delete measurements[state.tracking.unit];
  state.dailyLogs[date] = { ...row, amount: 0, unit: state.tracking.unit, hourly: Array(24).fill(0), measurements, noUseConfirmed: marking };
  if (!marking && !state.dailyLogs[date].note && !state.dailyLogs[date].mood && !(state.dailyLogs[date].triggers || []).length && !Object.keys(measurements).length && !Object.values(state.dailyLogs[date]).some(value => Number(value) > 0)) delete state.dailyLogs[date];
  if (!commitMutation(previousState)) return;
  render();
  showToast(marking ? 'День отмечен как без употребления.' : 'Отметка снята. День больше не считается измеренным нулём.');
}

function recordAmount(date, delta) {
  const previousState = state;
  state = cloneState();
  const unit = state.tracking.unit;
  const old = state.dailyLogs[date] || { amount: 0, unit, hourly: Array(24).fill(0), note: '', mood: null, triggers: [], measurements: {} };
  const next = { ...old, unit: old.unit || unit, hourly: Array.isArray(old.hourly) ? [...old.hourly] : Array(24).fill(0), measurements: { ...(old.measurements || {}) } };
  const existingMeasure = next.measurements[unit] || (next.unit === unit ? { amount: next.amount || 0, hourly: next.hourly } : { amount: 0, hourly: Array(24).fill(0) });
  const measure = { amount: Math.max(0, Math.min(99999, Number(existingMeasure.amount || 0) + Number(delta || 0))), hourly: Array.isArray(existingMeasure.hourly) ? [...existingMeasure.hourly] : Array(24).fill(0) };
  if (delta > 0 && date === today()) {
    measure.hourly[new Date().getHours()] = (measure.hourly[new Date().getHours()] || 0) + 1;
    state.lastUseAt = Date.now();
  } else if (delta < 0 && date === today()) {
    const currentHour = new Date().getHours();
    // A decrement edits the most recent available hourly count. Only fall back
    // to no hourly change when this record predates hourly tracking.
    let removed = false;
    for (let offset = 0; offset < 24; offset++) {
      const hour = (currentHour - offset + 24) % 24;
      if (Number(measure.hourly[hour] || 0) > 0) {
        measure.hourly[hour]--;
        removed = true;
        break;
      }
    }
    if (!removed && measure.amount === 0) measure.hourly = Array(24).fill(0);
  }
  next.measurements[unit] = measure;
  if (next.unit === unit) { next.amount = measure.amount; next.hourly = [...measure.hourly]; }
  if (measure.amount > 0) next.noUseConfirmed = false;
  state.dailyLogs[date] = next;
  if (!commitMutation(previousState, { renderMode: 'screen' })) return;
  render();
}

function toggleTask(id) {
  const previousState = state;
  state = cloneState();
  const date = today();
  const activeIds = new Set(getDailyPlanTasks(date).map(task => task.id));
  const current = new Set((state.completedTasks[date] || []).filter(taskId => activeIds.has(taskId)));
  if (!activeIds.has(id)) return;
  current.has(id) ? current.delete(id) : current.add(id);
  state.completedTasks[date] = [...current];
  if (!commitMutation(previousState, { renderMode: 'screen' })) return;
  render();
}

function openDay(date) {
  if (!date || getStatus(state, date) === 'future') return;
  overlay = { type: 'day', date };
  renderOverlayOnly();
}

function renderOverlayOnly() {
  const host = $('#overlay-root');
  if (host) host.innerHTML = renderOverlay();
  if (overlay?.type === 'practice') { lastPracticePhase = null; setPracticePhase(currentPracticeSeconds()); }
  updateCountdownElements();
  if (overlay) focusDialog();
}

function openPractice(id) {
  clearInterval(practiceTimer);
  lastPracticePhase = null;
  const basePractice = PRACTICES.find(item => item.id === id) || PRACTICES[0];
  const minutes = state.practiceSettings?.durations?.[basePractice.id] || Math.round(basePractice.duration / 60);
  activePractice = { ...basePractice, duration: minutes * 60 };
  practiceResultDraft = { afterRating: null, mood: '', note: '' };
  practiceResultSessionKey = '';
  practiceElapsedBeforePause = 0;
  practiceStartedAt = null;
  practicePaused = false;
  practiceTimer = null;
  overlay = { type: 'practice', id: activePractice.id };
  renderOverlayOnly();
}

function setPracticePhase(elapsedSeconds) {
  if (!activePractice) return;
  const phaseNodes = [
    { name: 'Вдох', instruction: 'Мягко вдохни носом', duration: activePractice.inhale, phase: 'inhale' },
    ...(activePractice.hold ? [{ name: 'Пауза', instruction: 'Оставайся в комфорте', duration: activePractice.hold, phase: 'hold' }] : []),
    { name: 'Выдох', instruction: 'Спокойно выдохни', duration: activePractice.exhale, phase: 'exhale' },
    ...(activePractice.pause ? [{ name: 'Пауза', instruction: 'Не задерживай дыхание через силу', duration: activePractice.pause, phase: 'hold' }] : []),
  ];
  const cycle = phaseNodes.reduce((sum, row) => sum + row.duration, 0) || 1;
  let phasePosition = elapsedSeconds % cycle;
  let phase = phaseNodes[0];
  for (const row of phaseNodes) {
    if (phasePosition < row.duration) { phase = row; break; }
    phasePosition -= row.duration;
  }
  const name = $('#breath-phase');
  const instruction = $('#breath-instruction');
  const orb = $('#active-breath-orb');
  if (lastPracticePhase !== phase.phase) {
    if (lastPracticePhase !== null) playBreathCue(phase.phase);
    lastPracticePhase = phase.phase;
    for (const node of [name, instruction]) {
      if (!node) continue;
      node.classList.remove('phase-copy-in');
      // Reflow restarts the short transition only when the breathing phase changes.
      void node.offsetWidth;
      node.classList.add('phase-copy-in');
    }
  }
  if (name) name.textContent = phase.name;
  if (instruction) instruction.textContent = phase.instruction;
  if (orb) orb.dataset.phase = phase.phase;
}


function playBreathCue(phase) {
  if (state.practiceSettings?.vibration && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') { try { navigator.vibrate(phase === 'hold' ? [18] : [28]); } catch (_) {} }
  if (!state.preferences.sound) return;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    soundContext = soundContext || new AudioCtx();
    if (soundContext.state === 'suspended') soundContext.resume();
    const oscillator = soundContext.createOscillator();
    const gain = soundContext.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = phase === 'inhale' ? 440 : phase === 'exhale' ? 330 : 370;
    gain.gain.setValueAtTime(0.0001, soundContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.035, soundContext.currentTime + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, soundContext.currentTime + 0.22);
    oscillator.connect(gain); gain.connect(soundContext.destination);
    oscillator.start(); oscillator.stop(soundContext.currentTime + 0.24);
  } catch (_) { /* audio is optional and may be unavailable */ }
}

function currentPracticeSeconds() {
  return practiceElapsedBeforePause + (practiceStartedAt ? Math.floor((Date.now() - practiceStartedAt) / 1000) : 0);
}

function togglePractice() {
  if (!activePractice) return;
  if (practiceTimer && !practicePaused) {
    practiceElapsedBeforePause = currentPracticeSeconds();
    practicePaused = true;
    practiceStartedAt = null;
    clearInterval(practiceTimer); practiceTimer = null;
    const btn = $('#practice-toggle'); if (btn) btn.innerHTML = `${icon('play', 17)} Продолжить`;
    const phase = $('#breath-phase'); if (phase) phase.textContent = 'Пауза';
    const instruction = $('#breath-instruction'); if (instruction) instruction.textContent = 'Продолжи, когда будешь готов(а)';
    return;
  }
  if (practiceElapsedBeforePause >= activePractice.duration) practiceElapsedBeforePause = 0;
  practicePaused = false;
  practiceStartedAt = Date.now();
  const btn = $('#practice-toggle'); if (btn) btn.innerHTML = `${icon('pause', 17)} Пауза`;
  practiceTimer = setInterval(tickPractice, 250);
  tickPractice();
}

function tickPractice() {
  if (!activePractice || !practiceTimer) return;
  const elapsed = currentPracticeSeconds();
  const remaining = Math.max(0, activePractice.duration - elapsed);
  const timer = $('#practice-timer');
  const fill = $('#practice-track-fill');
  if (timer) timer.textContent = formatDuration(remaining);
  if (fill) fill.style.width = `${clamp(elapsed / activePractice.duration * 100, 0, 100)}%`;
  setPracticePhase(elapsed);
  if (remaining <= 0) finishPractice(true);
}

function finishPractice(completed) {
  const elapsedBeforeCleanup = Math.max(0, Math.min(activePractice?.duration || 7200, currentPracticeSeconds()));
  clearInterval(practiceTimer); practiceTimer = null;
  let sessionSaved = true;
  let savedSessionKey = '';
  if (activePractice && (completed || elapsedBeforeCleanup >= 5)) {
    const previousState = state;
    state = cloneState();
    const finishedAt = new Date().toISOString();
    savedSessionKey = `${finishedAt}|${activePractice.id}`;
    state.practiceSessions.push({
      id: activePractice.id,
      sessionKey: savedSessionKey,
      date: today(),
      finishedAt,
      duration: completed ? activePractice.duration : elapsedBeforeCleanup,
      targetDuration: activePractice.duration,
      completed: !!completed,
      favoriteAtStart: (state.practiceSettings?.favorites || []).includes(activePractice.id),
    });
    state.practiceSessions = state.practiceSessions.slice(-500);
    sessionSaved = commitMutation(previousState);
    if (!sessionSaved) savedSessionKey = '';
  }
  const wasCompleted = !!completed;
  activePractice = null; practiceStartedAt = null; practicePaused = false; practiceElapsedBeforePause = 0;
  if (wasCompleted && sessionSaved && savedSessionKey) {
    practiceResultSessionKey = savedSessionKey;
    practiceResultDraft = { afterRating: null, mood: '', note: '' };
    overlay = { type: 'practice-result', sessionKey: savedSessionKey };
    renderOverlayOnly();
    return;
  }
  overlay = null; practiceFromCraving = false; practiceHandoffAt = ''; render();
  $('#main-content')?.focus({ preventScroll: true }); overlayTrigger = null;
  if (wasCompleted) showToast(sessionSaved ? 'Практика завершена и сохранена.' : 'Практика завершена, но её не удалось сохранить. Проверь место в хранилище и экспортируй данные.');
  else if (elapsedBeforeCleanup >= 5) showToast(sessionSaved ? 'Незавершённая сессия сохранена в истории.' : 'Не удалось сохранить сессию. Исходные данные остались без изменений.');
}

function savePracticeFeedback(skip = false) {
  const previousState = state;
  state = cloneState();
  const session = state.practiceSessions.find(item => item.sessionKey === practiceResultSessionKey);
  if (!session) { overlay = null; render(); return; }
  if (!skip) {
    if (Number.isInteger(practiceResultDraft.afterRating) && practiceResultDraft.afterRating >= 1 && practiceResultDraft.afterRating <= 5) session.afterRating = practiceResultDraft.afterRating;
    if (EMOTION_OPTIONS.some(([id]) => id === practiceResultDraft.mood)) session.moodAfter = practiceResultDraft.mood;
    session.note = String(practiceResultDraft.note || '').slice(0, 500);
    // If this practice directly followed a craving diary, attach the self-rating to the latest handoff entry.
    if (practiceFromCraving && Number.isInteger(practiceResultDraft.afterRating)) {
      const related = state.cravingLogs.find(entry => entry.type === 'practice-handoff' && entry.at === practiceHandoffAt && entry.action === 'breath' && Number.isInteger(entry.beforeRating) && !Number.isInteger(entry.afterRating));
      if (related) {
        related.afterRating = practiceResultDraft.afterRating;
        related.outcome = related.afterRating < related.beforeRating ? 'easier' : related.afterRating > related.beforeRating ? 'stronger' : 'same';
      }
    }
  }
  if (!commitMutation(previousState, { renderMode: 'overlay', message: 'Не удалось сохранить обратную связь. Сессия уже сохранена, можно продолжить без оценки.' })) return;
  overlay = null; practiceFromCraving = false; practiceHandoffAt = ''; practiceResultSessionKey = ''; render();
  showToast(skip ? 'Сессия сохранена. Можно продолжить в своём ритме.' : 'Наблюдение сохранено на этом устройстве.');
}

function saveCravingEntry(type, durationSeconds = 0) {
  const previousState = state;
  state = cloneState();
  state.cravingLogs.push({
    at: new Date().toISOString(),
    date: today(),
    durationSeconds: Math.max(0, Math.min(300, Math.round(durationSeconds || 0))),
    type,
    ...(Number.isInteger(cravingDraft.beforeRating) && cravingDraft.beforeRating >= 1 && cravingDraft.beforeRating <= 5 ? { beforeRating: cravingDraft.beforeRating } : {}),
    ...(Number.isInteger(cravingDraft.afterRating) && cravingDraft.afterRating >= 1 && cravingDraft.afterRating <= 5 ? { afterRating: cravingDraft.afterRating } : {}),
    ...(TRIGGER_OPTIONS.some(([id]) => id === cravingDraft.trigger) ? { trigger: cravingDraft.trigger } : {}),
    ...(EMOTION_OPTIONS.some(([id]) => id === cravingDraft.emotion) ? { emotion: cravingDraft.emotion } : {}),
    ...(ACTION_OPTIONS.some(([id]) => id === cravingDraft.action) ? { action: cravingDraft.action } : {}),
    ...(['easier', 'same', 'stronger'].includes(cravingDraft.outcome) ? { outcome: cravingDraft.outcome } : {}),
    note: String(cravingDraft.note || '').slice(0, 1000),
  });
  state.cravingLogs = state.cravingLogs.slice(-500);
  if (!commitMutation(previousState, { renderMode: 'overlay', message: 'Не удалось сохранить запись о тяге. Исходная история не изменена.' })) return false;
  return true;
}

function saveSlipReview() {
  const previousState = state;
  state = cloneState();
  const currentDate = today();
  if (!state.dailyLogs[currentDate]) state.dailyLogs[currentDate] = { amount: 0, unit: state.tracking.unit, hourly: Array(24).fill(0), note: '', mood: null, triggers: [], measurements: {} };
  const day = state.dailyLogs[currentDate];
  const trigger = TRIGGER_OPTIONS.some(([id]) => id === slipDraft.trigger) ? slipDraft.trigger : '';
  const emotion = EMOTION_OPTIONS.some(([id]) => id === slipDraft.emotion) ? slipDraft.emotion : '';
  if (trigger) day.triggers = [...new Set([...(day.triggers || []), trigger])].slice(0, 20);
  if (emotion) day.mood = emotion;
  const note = String(slipDraft.note || '').trim().slice(0, 1000);
  if (note) day.note = [day.note, `После сложного эпизода: ${note}`].filter(Boolean).join('\n\n').slice(0, 4000);
  const eventType = state.plan.strategy === 'reduce' ? 'use-context' : 'slip';
  state.cravingLogs.push({ at: new Date().toISOString(), date: currentDate, durationSeconds: 0, type: eventType, ...(trigger ? { trigger } : {}), ...(emotion ? { emotion } : {}), note });
  state.cravingLogs = state.cravingLogs.slice(-500);
  if (!commitMutation(previousState, { renderMode: 'overlay', message: 'Не удалось сохранить наблюдение. Исходная история не изменена.' })) return false;
  overlay = null;
  render();
  showToast(state.plan.strategy === 'reduce' ? 'Контекст сохранён. Количество можно отметить отдельно.' : 'Наблюдение сохранено. Предыдущий прогресс и история остались на месте.');
  return true;
}

function openCraving() {
  clearInterval(cravingTimer); cravingTimer = null; cravingStartedAt = null; cravingRemaining = 300;
  cravingDraft = freshCravingDraft();
  overlay = { type: 'craving' };
  renderOverlayOnly();
}

function startCraving() {
  cravingStartedAt = Date.now();
  cravingRemaining = 300;
  renderOverlayOnly();
  cravingTimer = setInterval(tickCraving, 250);
  tickCraving();
}

function tickCraving() {
  if (!cravingStartedAt) return;
  cravingRemaining = Math.max(0, 300 - Math.floor((Date.now() - cravingStartedAt) / 1000));
  const timer = $('#craving-timer');
  if (timer) timer.textContent = formatDuration(cravingRemaining);
  const fill = $('#craving-track-fill');
  if (fill) fill.style.width = `${(300 - cravingRemaining) / 300 * 100}%`;
  if (cravingRemaining <= 0) {
    clearInterval(cravingTimer); cravingTimer = null;
    const title = $('#craving-title'); if (title) title.textContent = 'Ты сделал(а) паузу.';
    const copy = $('.craving-copy p:not(.dark-kicker)'); if (copy) copy.textContent = 'Не нужно оценивать себя. Заметь, что изменилось, и выбери следующий шаг.';
    const timerEl = $('#craving-timer'); if (timerEl) timerEl.textContent = '0:00';
  }
}

function finishCraving() {
  const elapsed = cravingStartedAt ? Math.min(300, Math.floor((Date.now() - cravingStartedAt) / 1000)) : 0;
  if (!saveCravingEntry('craving-checkin', elapsed)) return;
  clearInterval(cravingTimer); cravingTimer = null; cravingStartedAt = null; cravingRemaining = 300;
  cravingDraft = freshCravingDraft();
  overlay = null; render(); showToast('Запись сохранена. Так постепенно становятся заметнее ситуации и действия, которые помогают.');
}

function closeOverlay() {
  if (overlay?.type === 'practice') {
    finishPractice(false);
    return;
  }
  if (overlay?.type === 'craving') {
    clearInterval(cravingTimer); cravingTimer = null; cravingStartedAt = null; cravingRemaining = 300;
  }
  if (overlay?.type === 'practice-result') { practiceFromCraving = false; practiceHandoffAt = ''; practiceResultSessionKey = ''; }
  overlay = null;
  renderOverlayOnly();
  if (overlayTrigger?.isConnected) overlayTrigger.focus({ preventScroll: true });
  else $('#main-content')?.focus({ preventScroll: true });
  overlayTrigger = null;
}

function exportData() {
  try {
    const bundle = exportBundle(state);
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `vydokh-backup-${today()}.json`;
    document.body.appendChild(a); a.click(); a.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    showToast('Резервная копия подготовлена. Храни её в безопасном месте.');
  } catch (_) { showToast('Не удалось создать файл резервной копии.'); }
}

function handleImportFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { showToast('Файл слишком большой. Выбери резервную копию до 5 МБ.'); event.target.value = ''; return; }
  const reader = new FileReader();
  reader.onload = () => {
    try {
      overlay = { type: 'import-confirm', pending: importBundle(JSON.parse(String(reader.result))) };
      renderOverlayOnly();
    } catch (error) {
      showToast(error.message || 'Не удалось прочитать резервную копию.');
    } finally { event.target.value = ''; }
  };
  reader.onerror = () => showToast('Не удалось прочитать выбранный файл.');
  reader.readAsText(file);
}

function checkReminders() {
  if (!state.preferences.remindersEnabled || !('Notification' in window) || Notification.permission !== 'granted') return;
  const now = new Date(); const day = dateISO();
  const sentKey = `vydokh.reminders.${day}`;
  let sent = [];
  try { sent = JSON.parse(sessionStorage.getItem(sentKey) || '[]'); } catch (_) {}
  const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  if (state.preferences.reminderTimes.includes(hm) && !sent.includes(hm)) {
    try { new Notification('Выдох', { body: 'Сделай короткую паузу и проверь, что тебе нужно прямо сейчас.', icon: './icon-192.png' }); sent.push(hm); sessionStorage.setItem(sentKey, JSON.stringify(sent)); }
    catch (_) { /* notifications can be blocked by the platform */ }
  }
}

function setFieldValue(path, value, date) {
  const saved = updateProfileField(path, value, date);
  if (!saved) {
    render();
    showToast('Не удалось сохранить изменения. Текущие данные восстановлены. Проверь доступное место в хранилище.');
    return;
  }
  if (path === 'plan.strategy' || path === 'tracking.unit' || path === 'preferences.remindersEnabled' || path === 'plan.startDate' || path === 'preferences.sound' || path === 'practiceSettings.vibration') render();
  else showToast('Сохранено');
}

root.addEventListener('click', event => {
  const tabButton = event.target.closest('[data-tab]');
  if (tabButton) {
    event.preventDefault();
    activeTab = tabButton.dataset.tab;
    if (!['today', 'calendar', 'practices', 'tips', 'profile'].includes(activeTab)) activeTab = 'today';
    overlay = null; render(); $('#main-content')?.focus({ preventScroll: true }); return;
  }
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (['open-day', 'open-practice', 'open-craving', 'quick-practice', 'open-support', 'open-slip', 'open-weekly-review', 'reset-data', 'import-data'].includes(action)) overlayTrigger = button;
  if (button.classList.contains('modal-backdrop') && action === 'backdrop-close') { if (event.target === button && overlay?.type !== 'onboarding') closeOverlay(); return; }
  switch (action) {
    case 'go-profile': activeTab = 'profile'; overlay = null; render(); break;
    case 'dismiss-hint': { const previousState = state; state = cloneState(); state.ui.showStarterHint = false; if (!commitMutation(previousState, { renderMode: 'screen' })) break; render(); break; }
    case 'open-craving': openCraving(); break;
    case 'quick-practice': openPractice('natural'); break;
    case 'open-practice': openPractice(button.dataset.id); break;
    case 'open-day': openDay(button.dataset.date); break;
    case 'toggle-trigger': {
      const date = button.dataset.date;
      const id = button.dataset.id;
      if (!date || !TRIGGER_OPTIONS.some(([triggerId]) => triggerId === id)) break;
      const previousState = state;
      state = cloneState();
      if (!state.dailyLogs[date]) state.dailyLogs[date] = { amount: 0, unit: state.tracking.unit, hourly: Array(24).fill(0), note: '', mood: null, triggers: [], measurements: {} };
      const selected = new Set(state.dailyLogs[date].triggers || []);
      selected.has(id) ? selected.delete(id) : selected.add(id);
      state.dailyLogs[date].triggers = [...selected];
      if (!commitMutation(previousState, { renderMode: 'overlay' })) break;
      renderOverlayOnly();
      $(`[data-action="toggle-trigger"][data-id="${id}"]`)?.focus({ preventScroll: true });
      break;
    }
    case 'set-day-mood': {
      const date = button.dataset.date; const mood = button.dataset.id;
      if (!date || !EMOTION_OPTIONS.some(([id]) => id === mood)) break;
      const previousState = state; state = cloneState();
      if (!state.dailyLogs[date]) state.dailyLogs[date] = { amount: 0, unit: state.tracking.unit, hourly: Array(24).fill(0), note: '', mood: null, triggers: [], measurements: {} };
      state.dailyLogs[date].mood = state.dailyLogs[date].mood === mood ? null : mood;
      if (!commitMutation(previousState, { renderMode: 'overlay' })) break;
      renderOverlayOnly();
      break;
    }
    case 'craving-choice': {
      const field = button.dataset.field; const value = button.dataset.value;
      if (field === 'beforeRating' || field === 'afterRating') { const rating = Number(value); if (!Number.isInteger(rating) || rating < 1 || rating > 5) break; cravingDraft[field] = rating; }
      else if (field === 'trigger' && TRIGGER_OPTIONS.some(([id]) => id === value)) cravingDraft.trigger = value;
      else if (field === 'emotion' && EMOTION_OPTIONS.some(([id]) => id === value)) cravingDraft.emotion = value;
      else if (field === 'action' && ACTION_OPTIONS.some(([id]) => id === value)) cravingDraft.action = value;
      else if (field === 'outcome' && OUTCOME_OPTIONS.some(([id]) => id === value)) cravingDraft.outcome = value;
      else break;
      renderOverlayOnly();
      $(`[data-action="craving-choice"][data-field="${field}"][data-value="${value}"]`)?.focus({ preventScroll: true });
      break;
    }
    case 'slip-choice': {
      const field = button.dataset.field; const value = button.dataset.value;
      if (field === 'trigger' && TRIGGER_OPTIONS.some(([id]) => id === value)) slipDraft.trigger = value;
      else if (field === 'emotion' && EMOTION_OPTIONS.some(([id]) => id === value)) slipDraft.emotion = value;
      else break;
      renderOverlayOnly();
      $(`[data-action="slip-choice"][data-field="${field}"][data-value="${value}"]`)?.focus({ preventScroll: true });
      break;
    }
    case 'open-weekly-review': overlay = { type: 'weekly-review' }; renderOverlayOnly(); break;
    case 'open-slip': { slipDraft = { ...freshSlipDraft(), trigger: state.dailyLogs[today()]?.triggers?.[0] || '', emotion: state.dailyLogs[today()]?.mood || '' }; overlay = { type: 'slip' }; renderOverlayOnly(); break; }
    case 'save-slip': saveSlipReview(); break;
    case 'adjust-amount': recordAmount(today(), Number(button.dataset.delta)); break;
    case 'adjust-day-amount': recordAmount(button.dataset.date, Number(button.dataset.delta)); overlay = { type: 'day', date: button.dataset.date }; render(); break;
    case 'toggle-no-use': toggleNoUse(button.dataset.date); break;
    case 'toggle-task': toggleTask(button.dataset.id); break;
    case 'next-reason': lastReason = (lastReason + 1) % REASONS.length; render(); break;
    case 'milestone-info': { const item = MILESTONES.find(m => m.days === Number(button.dataset.days)); if (item) showToast(`${item.title}: ${item.description}`); break; }
    case 'month-prev': selectedCalendarMonth = new Date(selectedCalendarMonth.getFullYear(), selectedCalendarMonth.getMonth() - 1, 1); render(); break;
    case 'month-next': selectedCalendarMonth = new Date(selectedCalendarMonth.getFullYear(), selectedCalendarMonth.getMonth() + 1, 1); render(); break;
    case 'tip-category': tipCategory = button.dataset.id; render(); break;
    case 'reset-tip-filters': tipCategory = 'all'; tipLevel = 'all'; tipSituation = 'all'; tipSearch = ''; render(); break;
    case 'open-guide': if (TIPS.some(item => item.id === button.dataset.id)) { overlay = { type: 'guide', id: button.dataset.id }; renderOverlayOnly(); } break;
    case 'guide-action': {
      const tip = TIPS.find(item => item.id === button.dataset.id);
      if (!tip) break;
      overlay = null;
      if (['urge-wave', 'four-d'].includes(tip.id)) openCraving();
      else if (tip.id === 'trigger-map' || tip.id === 'small-environment') { activeTab = 'calendar'; render(); }
      else if (['professional', 'treatment', 'withdrawal', 'support-network', 'vaping-support'].includes(tip.id)) { overlay = { type: 'support' }; renderOverlayOnly(); }
      else if (tip.id === 'slip') { slipDraft = freshSlipDraft(); overlay = { type: 'slip' }; renderOverlayOnly(); }
      else if (tip.id === 'breathing') { activeTab = 'practices'; render(); }
      else if (tip.id === 'small-goals' || tip.id === 'make-easy') { activeTab = 'profile'; render(); }
      else { activeTab = 'today'; render(); }
      break;
    }
    case 'analytics-range': {
      const id = button.dataset.id;
      if (!['week','month','all'].includes(id)) break;
      const previous = state; state = cloneState(); state.ui.analyticsRange = id;
      if (commitMutation(previous, { renderMode: 'screen' })) render();
      break;
    }
    case 'practice-range': {
      const id = button.dataset.id;
      if (!['week','month','all'].includes(id)) break;
      const previous = state; state = cloneState(); state.ui.practiceRange = id;
      if (commitMutation(previous, { renderMode: 'screen' })) render();
      break;
    }
    case 'practice-favorites-filter': practiceFavoritesOnly = button.dataset.value === 'favorites'; render(); break;
    case 'toggle-practice-favorite': {
      const id = button.dataset.id;
      if (!PRACTICES.some(item => item.id === id)) break;
      const previous = state; state = cloneState();
      const favorites = new Set(state.practiceSettings.favorites || []);
      favorites.has(id) ? favorites.delete(id) : favorites.add(id);
      state.practiceSettings.favorites = [...favorites];
      if (!commitMutation(previous, { renderMode: overlay?.type === 'practice' ? 'overlay' : 'screen' })) break;
      if (overlay?.type === 'practice') renderOverlayOnly(); else render();
      showToast(favorites.has(id) ? 'Практика добавлена в избранное.' : 'Практика убрана из избранного.');
      break;
    }
    case 'toggle-vibration': {
      const previous = state; state = cloneState();
      state.practiceSettings.vibration = !state.practiceSettings.vibration;
      if (!commitMutation(previous, { renderMode: 'overlay' })) break;
      renderOverlayOnly(); showToast(state.practiceSettings.vibration ? 'Вибрация включена.' : 'Вибрация выключена.');
      break;
    }
    case 'practice-feedback': {
      const field = button.dataset.field, value = button.dataset.value;
      if (field === 'afterRating') { const rating = Number(value); if (Number.isInteger(rating) && rating >= 1 && rating <= 5) practiceResultDraft.afterRating = rating; else break; }
      else if (field === 'mood' && EMOTION_OPTIONS.some(([id]) => id === value)) practiceResultDraft.mood = practiceResultDraft.mood === value ? '' : value;
      else break;
      renderOverlayOnly();
      $(`[data-action="practice-feedback"][data-field="${field}"][data-value="${value}"]`)?.focus({ preventScroll: true });
      break;
    }
    case 'save-practice-feedback': savePracticeFeedback(false); break;
    case 'skip-practice-feedback': savePracticeFeedback(true); break;
    case 'tip-action': {
      const tip = TIPS.find(x => x.id === button.dataset.id);
      if (tip?.id === 'urge-wave' || tip?.id === 'four-d') openCraving();
      else if (tip?.id === 'trigger-map') { activeTab = 'calendar'; render(); }
      else if (tip?.id === 'professional' || tip?.id === 'vaping-support') { overlay = { type: 'support' }; renderOverlayOnly(); }
      else if (tip?.id === 'slip') { slipDraft = freshSlipDraft(); overlay = { type: 'slip' }; renderOverlayOnly(); }
      else { activeTab = 'profile'; render(); }
      break;
    }
    case 'open-support': overlay = { type: 'support' }; renderOverlayOnly(); break;
    case 'close-overlay': closeOverlay(); break;
    case 'practice-toggle': togglePractice(); break;
    case 'practice-stop': finishPractice(false); break;
    case 'toggle-sound': {
      const previousState = state;
      state = cloneState();
      state.preferences.sound = !state.preferences.sound;
      if (!commitMutation(previousState, { renderMode: 'overlay' })) break;
      if (state.preferences.sound) { try { const AudioCtx = window.AudioContext || window.webkitAudioContext; if (AudioCtx) { soundContext = soundContext || new AudioCtx(); soundContext.resume(); } } catch (_) {} }
      renderOverlayOnly(); showToast(state.preferences.sound ? 'Звуковые сигналы включены.' : 'Звуковые сигналы выключены.'); break;
    }
    case 'start-craving': startCraving(); break;
    case 'finish-craving': finishCraving(); break;
    case 'craving-practice': {
      const elapsed = cravingStartedAt ? Math.min(300, Math.floor((Date.now() - cravingStartedAt) / 1000)) : 0;
      cravingDraft.action = 'breath';
      if (!saveCravingEntry('practice-handoff', elapsed)) break;
      practiceHandoffAt = state.cravingLogs.at(-1)?.at || '';
      practiceFromCraving = true;
      clearInterval(cravingTimer); cravingTimer = null; cravingStartedAt = null; cravingRemaining = 300; overlay = null; openPractice('calm-46'); break;
    }
    case 'test-reminder': {
      if (!('Notification' in window)) { showToast('Этот браузер не поддерживает системные уведомления.'); break; }
      if (Notification.permission === 'granted') { try { new Notification('Выдох', { body: 'Так выглядит мягкое напоминание о паузе.', icon: './icon-192.png' }); showToast('Тестовое уведомление отправлено.'); } catch (_) { showToast('Браузер не разрешил показать уведомление.'); } }
      else Notification.requestPermission().then(p => { if (p === 'granted') showToast('Разрешение получено. Нажми проверку ещё раз.'); else showToast('Разрешение не выдано.'); });
      break;
    }
    case 'export-data': exportData(); break;
    case 'import-data': $('#import-file')?.click(); break;
    case 'cancel-import': overlay = null; renderOverlayOnly(); break;
    case 'confirm-import': if (overlay?.pending) {
      const previous = state;
      state = overlay.pending;
      if (!persist({ notify: false })) { state = previous; overlay = null; render(); showToast('Не удалось сохранить резервную копию. Текущие данные оставлены без изменений.'); break; }
      overlay = null; activeTab = 'today'; render(); showToast('Резервная копия восстановлена.');
    } break;
    case 'reset-data': overlay = { type: 'reset' }; renderOverlayOnly(); break;
    case 'confirm-reset': {
      const previous = state;
      state = createDefaultState();
      if (!persist({ notify: false })) { state = previous; overlay = { type: 'reset' }; render(); showToast('Не удалось сохранить сброс. Текущие данные оставлены без изменений.'); break; }
      clearInterval(practiceTimer); practiceTimer = null; clearInterval(cravingTimer); cravingTimer = null;
      activePractice = null; practiceStartedAt = null; practiceElapsedBeforePause = 0; practicePaused = false; cravingStartedAt = null; cravingRemaining = 300;
      activeTab = 'today'; overlay = { type: 'onboarding' }; render(); showToast('Активные данные сброшены. Старая резервная копия v1 не изменялась.');
      break;
    }
    case 'onboarding-skip': { const previousState = state; state = cloneState(); state.onboardingComplete = true; if (!commitMutation(previousState, { renderMode: 'overlay' })) break; overlay = null; render(); $('#main-content')?.focus({ preventScroll: true }); break; }
    case 'backdrop-close': if (event.target === button) closeOverlay(); break;
    default: break;
  }
});

root.addEventListener('change', event => {
  const field = event.target.closest('[data-field]');
  if (!field) return;
  const value = field.type === 'checkbox' ? field.checked : field.value;
  if (field.dataset.field === 'tips.level') { tipLevel = TIP_LEVELS.some(item => item.id === value) ? value : 'all'; render(); return; }
  if (field.dataset.field === 'tips.situation') { tipSituation = TIP_SITUATIONS.some(item => item.id === value) ? value : 'all'; render(); return; }
  if (field.dataset.field === 'practice.duration') {
    const minutes = Number(value);
    if (![1, 3, 5, 10].includes(minutes) || !activePractice || overlay?.type !== 'practice' || practiceTimer || practicePaused || practiceElapsedBeforePause > 0) { renderOverlayOnly(); return; }
    const previousState = state; state = cloneState(); state.practiceSettings.durations[activePractice.id] = minutes;
    const previousDuration = activePractice.duration; activePractice.duration = minutes * 60;
    if (!commitMutation(previousState)) { activePractice.duration = previousDuration; renderOverlayOnly(); showToast('Не удалось сохранить длительность.'); return; }
    renderOverlayOnly(); showToast('Длительность сохранена.'); return;
  }
  if (field.dataset.field === 'tracking.unit' && value !== state.tracking.unit && (Object.keys(state.dailyLogs).length || state.plan.baseline != null || state.plan.dailyTarget > 0)) {
    const accepted = window.confirm('Сменить показатель учёта? Исторические записи останутся в исходной единице без пересчёта. Исходный показатель и дневная цель будут очищены, потому что относятся к старой единице. Их можно задать заново.');
    if (!accepted) { render(); return; }
  }
  if (field.dataset.field === 'plan.strategy' && value === 'quit' && state.plan.strategy === 'reduce') {
    const accepted = window.confirm('Перейти к полному отказу и начать новый отсчёт с сегодняшнего дня? Вся прежняя история останется в календаре.');
    if (!accepted) { render(); return; }
  }
  setFieldValue(field.dataset.field, value, field.dataset.date || null);
});

root.addEventListener('input', event => {
  const field = event.target.closest('[data-field]');
  if (!field) return;
  if (field.dataset.field === 'tips.search') {
    const caret = field.selectionStart;
    tipSearch = String(field.value || '').slice(0, 100);
    render();
    const next = $('[data-field="tips.search"]');
    if (next) { next.focus({ preventScroll: true }); try { next.setSelectionRange(caret, caret); } catch (_) {} }
  } else if (field.dataset.field === 'practice.feedback.note') {
    practiceResultDraft.note = String(field.value || '').slice(0, 500);
  } else if (field.dataset.field === 'day.note') {
    const saved = updateProfileField(field.dataset.field, field.value, field.dataset.date || null);
    if (!saved) field.value = state.dailyLogs[field.dataset.date]?.note || '';
  } else if (field.dataset.field === 'weekly.note') {
    updateProfileField(field.dataset.field, field.value, null);
  } else if (field.dataset.field === 'craving.note') {
    cravingDraft.note = String(field.value).slice(0, 1000);
  } else if (field.dataset.field === 'slip.note') {
    slipDraft.note = String(field.value).slice(0, 1000);
  }
});

root.addEventListener('submit', event => {
  if (event.target.id !== 'onboarding-form') return;
  event.preventDefault();
  const form = new FormData(event.target);
  const previous = state;
  state = JSON.parse(JSON.stringify(state));
  state.plan.strategy = form.get('strategy') === 'reduce' ? 'reduce' : 'quit';
  const startDate = String(form.get('startDate') || today());
  state.plan.startDate = startDate <= today() ? startDate : today();
  state.tracking.unit = String(form.get('unit') || 'puffs');
  state.tracking.unitLabel = ({ puffs: 'затяжек', sessions: 'сеансов', pods: 'картриджей', custom: 'единиц' })[state.tracking.unit] || 'единиц';
  const target = String(form.get('target') || '');
  if (state.plan.strategy === 'reduce' && target !== '') state.plan.dailyTarget = Math.min(99999, Math.max(0, Number(target) || 0));
  state.onboardingComplete = true; state.ui.showStarterHint = true;
  if (!persist({ notify: false })) { state = previous; renderOverlayOnly(); showToast('Не удалось сохранить настройки. Попробуй освободить место в хранилище и повторить.'); return; }
  overlay = null; activeTab = 'today'; render(); showToast('Готово. Начнём с одного небольшого шага.');
});

root.addEventListener('change', event => {
  if (event.target.id === 'onboard-strategy') {
    const label = $('#onboard-target-field');
    if (label) label.classList.toggle('is-highlighted', event.target.value === 'reduce');
  }
});

function focusDialog() {
  const dialog = $('#overlay-root [role="dialog"]');
  if (!dialog) return;
  if (dialog.contains(document.activeElement)) return;
  const target = dialog.querySelector('input:not([type="hidden"]), select, textarea, button, [href], [tabindex]:not([tabindex="-1"])');
  (target || dialog).focus?.({ preventScroll: true });
}

document.addEventListener('keydown', event => {
  if (!overlay) return;
  if (event.key === 'Escape') {
    if (overlay.type !== 'onboarding') closeOverlay();
    return;
  }
  if (event.key !== 'Tab') return;
  const dialog = $('#overlay-root [role="dialog"]');
  if (!dialog) return;
  const focusables = Array.from(dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'))
    .filter(element => element.offsetParent !== null);
  if (!focusables.length) { event.preventDefault(); dialog.focus?.(); return; }
  const first = focusables[0], last = focusables[focusables.length - 1];
  if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});

function updateCountdownElements() {
  if (overlay?.type === 'practice' && activePractice) {
    const timer = $('#practice-timer');
    if (timer) timer.textContent = formatDuration(Math.max(0, activePractice.duration - practiceElapsedBeforePause));
  }
}

// Local notifications can be evaluated only while this client is open; no server is required for core features.
setInterval(checkReminders, 30000);

render();
if (!state.onboardingComplete && loaded.source === 'fresh') {
  overlay = { type: 'onboarding' };
  renderOverlayOnly();
} else if (loaded.migrated) {
  showToast(['v3', 'v2'].includes(loaded.source) ? 'Данные предыдущей версии перенесены в новый формат. Старый ключ сохранён.' : 'История v1 перенесена в новый формат. Исходный ключ сохранён без изменений.');
}
