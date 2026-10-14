import { icon } from './icons.js';
import { createBreathVisual } from './breath-visual.js';
import { PRACTICES, PRACTICE_CATEGORIES, TIP_CATEGORIES, TIP_LEVELS, TIP_SITUATIONS, TIPS, REASONS, MILESTONES, HOME_TIPS } from './content.js';
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
let profileSubpage = 'main';
let lastRenderedTab = null;
let tipCategory = 'all';
let tipSearch = '';
let tipLevel = 'all';
let tipSituation = 'all';
let practiceFavoritesOnly = false;
let practiceCategory = 'all';
const breathVisualInstances = new Map();
let selectedCalendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let overlay = null;
let lastOverlayKey = '';
let healthMenuOpen = false;
let homeStatsRange = 'today';
let healthCheckinDate = today();
let homeTipTimer = null;
let lastHomeTipId = '';
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
const HEALTH_TIP_IDS = new Set(['professional', 'support-network', 'withdrawal', 'breathing', 'treatment', 'who-quit-today', 'vaping-support']);
function syncBreathVisuals() {
  const canvases = new Set($$('[data-breath-canvas]'));
  for (const [canvas, instance] of breathVisualInstances) {
    if (!canvases.has(canvas) || !canvas.isConnected) {
      instance.destroy();
      breathVisualInstances.delete(canvas);
    }
  }
  for (const canvas of canvases) {
    let instance = breathVisualInstances.get(canvas);
    if (!instance) {
      instance = createBreathVisual(canvas, { ambient: canvas.dataset.phase === 'ambient' });
      breathVisualInstances.set(canvas, instance);
    }
    if (canvas.dataset.phase === 'ambient') {
      // Decorative background visuals sit behind a modal while a practice is
      // active; pause them to reserve animation budget for the focused session.
      if (overlay) instance.pause();
      else instance.resume();
    } else if (canvas.dataset.phase) {
      instance.setPhase(canvas.dataset.phase, Number(canvas.dataset.phaseDuration) || 4);
    }
  }
}

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

function healthNavItem() {
  const active = activeTab === 'health' || activeTab === 'practices';
  return `<div class="health-nav-wrap"><button type="button" class="nav-item health-nav-trigger ${active ? 'active' : ''}" data-action="toggle-health-menu" aria-haspopup="menu" aria-expanded="${healthMenuOpen}" aria-controls="health-nav-menu" aria-current="${activeTab === 'health' ? 'page' : 'false'}">${icon('heart-pulse', 21)}<span>Здоровье</span><span class="nav-chevron" aria-hidden="true">${icon('chevron', 12, healthMenuOpen ? 'rotate-270' : '')}</span></button><div id="health-nav-menu" class="health-nav-menu ${healthMenuOpen ? 'is-open' : ''}" role="menu" aria-label="Разделы здоровья" aria-hidden="${!healthMenuOpen}"><button type="button" class="health-nav-option ${activeTab === 'health' ? 'active' : ''}" data-action="select-health-section" data-section="health" role="menuitem" aria-current="${activeTab === 'health' ? 'page' : 'false'}">${icon('heart-pulse', 18)}<span><strong>Здоровье</strong><small>Сведения и наблюдения</small></span><span class="health-option-check">${activeTab === 'health' ? icon('check', 16) : ''}</span></button><button type="button" class="health-nav-option ${activeTab === 'practices' ? 'active' : ''}" data-action="select-health-section" data-section="practices" role="menuitem" aria-current="${activeTab === 'practices' ? 'page' : 'false'}">${icon('wind', 18)}<span><strong>Практики</strong><small>Дыхание и паузы</small></span><span class="health-option-check">${activeTab === 'practices' ? icon('check', 16) : ''}</span></button></div></div>`;
}

function overlayKey() {
  if (!overlay) return '';
  return [overlay.type || '', overlay.id || '', overlay.date || '', overlay.sessionKey || ''].join(':');
}

function htmlFragment(markup) {
  const template = document.createElement('template');
  template.innerHTML = markup;
  return template.content;
}

function nodeKey(node) {
  return node?.nodeType === 1 ? node.getAttribute('data-key') : null;
}

function compatibleNodes(current, next) {
  return !!current && !!next && current.nodeType === next.nodeType && current.nodeName === next.nodeName && current.namespaceURI === next.namespaceURI;
}

// Reconcile existing DOM nodes instead of replacing the app shell on every click.
// This preserves focus, scrollable hosts, the nav/toast nodes and running CSS animations.
function morphNode(current, next) {
  if (!compatibleNodes(current, next)) {
    current.replaceWith(next);
    return next;
  }
  if (current.nodeType === Node.TEXT_NODE || current.nodeType === Node.COMMENT_NODE) {
    if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue;
    return current;
  }
  if (current.nodeType !== Node.ELEMENT_NODE) return current;

  const isFormControl = current.matches('input, textarea, select');
  const isFocused = current === document.activeElement;
  const oldValue = isFormControl ? current.value : undefined;
  const oldChecked = isFormControl && 'checked' in current ? current.checked : undefined;
  const selectionStart = isFocused && typeof current.selectionStart === 'number' ? current.selectionStart : null;
  const selectionEnd = isFocused && typeof current.selectionEnd === 'number' ? current.selectionEnd : null;

  const isCanvas = current.nodeName === 'CANVAS';
  // The renderer owns a canvas' intrinsic width/height. Removing either attribute
  // resets the bitmap to the browser default (300×150) while the animation still
  // believes it has the old dimensions — the sphere then appears to jump/drift.
  const canvasRuntimeAttributes = isCanvas ? new Set(['width', 'height']) : null;
  for (const attr of Array.from(current.attributes)) {
    if (canvasRuntimeAttributes?.has(attr.name)) continue;
    if (!next.hasAttribute(attr.name)) current.removeAttribute(attr.name);
  }
  for (const attr of Array.from(next.attributes)) {
    if (canvasRuntimeAttributes?.has(attr.name)) continue;
    if (current.getAttribute(attr.name) !== attr.value) current.setAttribute(attr.name, attr.value);
  }
  morphChildren(current, next);

  if (isFormControl) {
    if (current.type === 'checkbox' || current.type === 'radio') {
      current.checked = isFocused ? oldChecked : next.checked;
    } else if (isFocused) {
      if (current.value !== oldValue) current.value = oldValue;
      if (selectionStart !== null && typeof current.setSelectionRange === 'function') {
        try { current.setSelectionRange(selectionStart, selectionEnd); } catch (_) { /* select/number inputs do not expose selection ranges */ }
      }
    } else if (current.value !== next.value) {
      current.value = next.value;
    }
  }
  return current;
}

function morphChildren(parent, nextParent) {
  const nextNodes = Array.from(nextParent.childNodes);
  const used = new Set();
  for (let index = 0; index < nextNodes.length; index++) {
    const next = nextNodes[index];
    let current = parent.childNodes[index] || null;
    const key = nodeKey(next);
    if (key) {
      const keyed = Array.from(parent.children).find(child => nodeKey(child) === key && !used.has(child));
      if (keyed && keyed !== current) {
        parent.insertBefore(keyed, current);
        current = keyed;
      }
    }
    if (!current) {
      parent.appendChild(next);
      used.add(next);
    } else {
      const result = morphNode(current, next);
      used.add(result);
    }
  }
  while (parent.childNodes.length > nextNodes.length) parent.removeChild(parent.lastChild);
}

function syncNavigation() {
  for (const button of $$('.nav-item[data-tab]')) {
    const active = button.dataset.tab === activeTab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-current', active ? 'page' : 'false');
  }
  const healthTrigger = $('[data-action="toggle-health-menu"]');
  if (healthTrigger) {
    const active = activeTab === 'health' || activeTab === 'practices';
    healthTrigger.classList.toggle('active', active);
    healthTrigger.setAttribute('aria-expanded', String(healthMenuOpen));
    healthTrigger.setAttribute('aria-current', activeTab === 'health' ? 'page' : 'false');
    const chevron = $('.nav-chevron .icon', healthTrigger);
    chevron?.classList.toggle('rotate-270', healthMenuOpen);
  }
  const healthMenu = $('#health-nav-menu');
  if (healthMenu) {
    healthMenu.classList.toggle('is-open', healthMenuOpen);
    healthMenu.setAttribute('aria-hidden', String(!healthMenuOpen));
    healthMenu.inert = !healthMenuOpen;
    healthMenu.querySelectorAll('[data-section]').forEach(option => {
      const selected = option.dataset.section === activeTab;
      option.classList.toggle('active', selected);
      option.setAttribute('aria-current', selected ? 'page' : 'false');
      const indicator = $('.health-option-check', option);
      if (indicator) indicator.innerHTML = selected ? icon('check', 16) : '';
    });
  }
}

function scrollPageToTop() {
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
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
        ${navItem('today', 'Главная', 'home')}
        ${navItem('calendar', 'Календарь', 'calendar')}
        ${healthNavItem()}
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
  lastOverlayKey = overlayKey();
  syncNavigation();
  updateCountdownElements();
}

function render() {
  const screens = {
    today: renderToday,
    calendar: renderCalendar,
    practices: renderPractices,
    tips: renderTips,
    profile: renderProfile,
    health: renderHealth,
  };
  const content = (screens[activeTab] || renderToday)();
  if (!$('#main-content')) {
    renderShell(content);
    lastRenderedTab = activeTab;
    syncBreathVisuals();
    return;
  }

  const main = $('#main-content');
  const screenChanged = lastRenderedTab !== null && lastRenderedTab !== activeTab;
  main.dataset.screen = activeTab;
  main.classList.remove('screen-enter', 'quiet-update');
  morphChildren(main, htmlFragment(content));
  if (screenChanged) {
    void main.offsetWidth;
    if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) main.classList.add('screen-enter');
    scrollPageToTop();
  } else {
    main.classList.add('quiet-update');
  }
  lastRenderedTab = activeTab;
  syncNavigation();
  if (overlay || overlayKey() !== lastOverlayKey) renderOverlayOnly();
  else updateCountdownElements();
  if (overlay) focusDialog();
  syncBreathVisuals();
}

function progressRing(percent, caption, value, sublabel = '') {
  return `<div class="progress-ring" style="--progress:${clamp(percent, 0, 100)}%; --progress-deg:${clamp(percent, 0, 100) * 3.6 - 90}deg" role="img" aria-label="${esc(caption)}: ${esc(value)}">
    <span class="ring-marker" aria-hidden="true"></span><div class="progress-ring-inner"><span class="ring-value">${value}</span><span class="ring-caption">${caption}</span>${sublabel ? `<span class="ring-sublabel">${sublabel}</span>` : ''}</div>
  </div>`;
}

function getCurrentHomeTip() {
  if (!HOME_TIPS.length) return { id: 'empty-tip', category: 'Маленький шаг', text: 'Выбери одно небольшое действие, которое подходит тебе сейчас.' };
  let current = HOME_TIPS.find(item => item.id === lastHomeTipId);
  if (!current) {
    current = HOME_TIPS[Math.floor(Math.random() * HOME_TIPS.length)];
    lastHomeTipId = current.id;
  }
  return current;
}

function chooseNextHomeTip() {
  if (!HOME_TIPS.length) return getCurrentHomeTip();
  const choices = HOME_TIPS.filter(item => item.id !== lastHomeTipId);
  const pool = choices.length ? choices : HOME_TIPS;
  const next = pool[Math.floor(Math.random() * pool.length)];
  lastHomeTipId = next.id;
  renderHomeTipOnly();
  return next;
}

function renderHomeTipMarkup() {
  const tip = getCurrentHomeTip();
  return `<article class="home-tip-entry" data-tip-id="${esc(tip.id)}"><div class="home-tip-entry-mark">${icon('lightbulb', 20)}</div><div class="home-tip-entry-copy"><p class="eyebrow">${esc(tip.category)}</p><p class="home-tip-text">${esc(tip.text)}</p><div class="home-tip-entry-foot"><span>${HOME_TIPS.findIndex(item => item.id === tip.id) + 1} из ${HOME_TIPS.length}</span><button class="text-action" type="button" data-action="next-home-tip">Другой совет ${icon('rotate', 14)}</button></div></div></article>`;
}

function renderHomeTipOnly() {
  const host = $('#home-tip-content');
  if (host) host.innerHTML = renderHomeTipMarkup();
}

function renderHomeJourneyStats() {
  const range = ['today', 'week', 'month'].includes(homeStatsRange) ? homeStatsRange : 'today';
  const date = today();
  const unit = getUnitLabel(state);
  let metricsMarkup = '';
  let note = '';
  if (range === 'today') {
    const row = state.dailyLogs[date];
    const log = getLog(state, date);
    const measured = hasRecordedMeasurement(state, row, log) && !log.untracked;
    const reported = hasReportedUseOnDate(state, date);
    const amount = log.untracked || (reported && !measured) || !measured ? '—' : String(log.amount);
    const tasks = getDailyPlanTasks(date);
    const done = new Set((state.completedTasks[date] || []).filter(id => tasks.some(task => task.id === id))).size;
    const journeyValue = state.plan.strategy === 'quit' ? String(getStreak(state)) : (state.plan.dailyTarget ? String(state.plan.dailyTarget) : '—');
    const journeyCaption = state.plan.strategy === 'quit' ? 'дней текущей серии' : `${unit} — цель на день`;
    metricsMarkup = `<div class="home-stat-grid"><article class="home-stat-card home-stat-feature"><span class="home-stat-label">УЧЁТ СЕГОДНЯ</span><strong>${esc(amount)}</strong><small>${measured ? esc(unit) : reported ? 'эпизод отмечен, количество не указано' : log.untracked ? 'есть запись в другой единице' : 'пока нет измерения'}</small></article><article class="home-stat-card"><span class="home-stat-label">${state.plan.strategy === 'quit' ? 'ТЕКУЩИЙ ПУТЬ' : 'ДНЕВНАЯ ЦЕЛЬ'}</span><strong>${esc(journeyValue)}</strong><small>${esc(journeyCaption)}</small></article><article class="home-stat-card"><span class="home-stat-label">ШАГИ НА СЕГОДНЯ</span><strong>${done}<span class="home-stat-divider">/</span>${tasks.length}</strong><small>отмечено по желанию</small></article></div>`;
    note = measured ? `Сегодня записано ${log.amount} ${unit}. Счётчик ниже позволяет добавлять новые записи одним нажатием.` : reported ? 'Ты отметил(а) эпизод без количества. Если удобно, укажи значение в счётчике ниже.' : 'Неизмеренный день остаётся неизвестным в аналитике. Добавь значение ниже, когда это удобно.';
  } else {
    const selectedRange = range === 'week' ? 'week' : 'month';
    const metrics = getProgressAnalytics(state, selectedRange);
    const rangeLabel = selectedRange === 'week' ? 'За последние 7 дней' : 'За последние 30 дней';
    const average = metrics.average == null ? '—' : Number(metrics.average.toFixed(1)).toLocaleString('ru-RU');
    const total = metrics.trackedDays ? Number(metrics.totalRecorded.toFixed(1)).toLocaleString('ru-RU') : '—';
    metricsMarkup = `<div class="home-stat-grid"><article class="home-stat-card home-stat-feature"><span class="home-stat-label">ДНЕЙ С ИЗМЕРЕНИЕМ</span><strong>${metrics.trackedDays}</strong><small>из ${selectedRange === 'week' ? 7 : 30} календарных дней</small></article><article class="home-stat-card"><span class="home-stat-label">СРЕДНЕЕ ЗНАЧЕНИЕ</span><strong>${esc(average)}</strong><small>${esc(unit)} за измеренный день</small></article><article class="home-stat-card"><span class="home-stat-label">СУММА ЗАПИСЕЙ</span><strong>${esc(total)}</strong><small>${esc(unit)} за период</small></article></div>`;
    note = metrics.trackedDays ? `${rangeLabel}. Сравниваются только дни с измерением в выбранной единице; пропущенные дни не считаются нулевыми.` : `${rangeLabel}. Пока нет сопоставимых измерений. Счётчик ниже поможет начать фиксировать динамику.`;
  }
  return `<section class="home-journey-card panel-card" aria-labelledby="home-journey-title"><div class="home-section-heading"><div><h2 id="home-journey-title">Твой путь</h2></div><span class="home-section-icon">${icon('chart-no-axes-combined', 19)}</span></div><div class="home-range-switch" role="group" aria-label="Период статистики">${[['today','Сегодня'],['week','Неделя'],['month','Месяц']].map(([id,label]) => `<button type="button" data-action="home-stats-range" data-id="${id}" class="home-range-option ${range === id ? 'active' : ''}" aria-pressed="${range === id}">${label}</button>`).join('')}</div><div id="home-journey-metrics">${metricsMarkup}</div><p class="home-stat-note">${esc(note)}</p></section>`;
}

function homeReviewText(metrics, strategy) {
  if (strategy === 'reduce') {
    if (metrics.trend === 'down') return 'В сопоставимых записях поздние значения ниже ранних. Посмотри, какой небольшой шаг стоит повторить.';
    if (metrics.trend === 'up') return 'Поздние значения выше ранних. Это повод проверить контекст и реалистичность цели, а не автоматически ужесточать ограничения.';
    if (metrics.trend === 'steady') return 'Показатель выглядит примерно стабильным по доступным записям. Продолжай наблюдать и реши, нужна ли корректировка плана.';
    return 'Пока недостаточно сопоставимых измерений. Продолжай записывать одну и ту же единицу — выводы станут полезнее.';
  }
  if (metrics.noUseDays > 0) return `За неделю есть ${metrics.noUseDays} явно отмеченных дней с нулевым значением и ${metrics.trackedDays} измеренных дней. История остаётся целой, даже если были сложные моменты.`;
  return `${metrics.trackedDays} дней содержат сопоставимые измерения. Неизвестные дни не считаются нулями — так обзор остаётся честным.`;
}

function renderToday() {
  const currentDate = today();
  const log = getLog(state, currentDate);
  const reportedUseToday = hasReportedUseOnDate(state, currentDate);
  const hasMeasurementToday = hasRecordedMeasurement(state, state.dailyLogs?.[currentDate], log) && !log.untracked;
  const strategy = state.plan.strategy;
  const unit = getUnitLabel(state);
  const target = Number(state.plan.dailyTarget) || 0;
  const currentAmountUnknown = log.untracked || (reportedUseToday && !hasMeasurementToday);
  const counterAmount = currentAmountUnknown ? '—' : String(Number(log.amount) || 0);
  const week = getWeeklyStats(state);
  const maxWeekly = Math.max(1, ...week.map(d => d.amount == null ? 0 : Number(d.amount)), target || 0);
  const bestStreak = getBestStreak(state);
  const streak = getStreak(state);
  const dailyTasks = getDailyPlanTasks(currentDate);
  const taskIds = new Set(dailyTasks.map(task => task.id));
  const tasksDone = new Set((state.completedTasks[currentDate] || []).filter(id => taskIds.has(id)));
  const reviewMetrics = getWeeklyReviewMetrics(state);
  const reviewKey = getWeekStartISO(currentDate);
  const savedReview = state.weeklyReviews?.[reviewKey] || {};
  const weeklyBars = week.map(row => {
    const known = row.amount !== null && Number.isFinite(Number(row.amount));
    const value = known ? Number(row.amount) : null;
    const height = !known ? 5 : value === 0 ? 7 : clamp(value / maxWeekly * 100, 12, 100);
    const colorClass = !known ? 'bar-before' : value === 0 ? 'bar-clear' : (strategy === 'reduce' && target > 0 && value <= target ? 'bar-within' : 'bar-used');
    return `<div class="week-column"><div class="week-value">${known ? esc(value) : '·'}</div><div class="week-track"><div class="week-bar ${colorClass}" style="height:${height}%"></div></div><span class="week-label ${row.today ? 'today' : ''}">${WEEKDAYS[(new Date(`${row.date}T12:00:00`).getDay() + 6) % 7]}</span><span class="week-date">${row.date.slice(-2).replace(/^0/, '')}</span></div>`;
  }).join('');
  const completedTaskRows = dailyTasks.map(task => `<button class="task-row ${tasksDone.has(task.id) ? 'is-done' : ''}" type="button" data-action="toggle-task" data-id="${task.id}" aria-pressed="${tasksDone.has(task.id)}"><span class="task-check">${tasksDone.has(task.id) ? icon('check', 17) : ''}</span><span class="task-copy"><strong>${esc(task.title)}</strong><small>${esc(task.subtitle)}</small></span><span class="task-plus">${tasksDone.has(task.id) ? 'Готово' : 'Отметить'}</span></button>`).join('');
  const amountStatus = currentAmountUnknown ? 'Без количества' : hasMeasurementToday ? 'Записано' : '';
  const savedText = savedReview.focus ? `Фокус недели: ${({ 'trigger-plan': 'работа с триггером', 'same-unit': 'единый показатель', 'review-target': 'реалистичная цель', pause: 'короткая пауза', support: 'поддержка', breath: 'дыхание', 'self-kindness': 'возвращение к плану' })[savedReview.focus] || 'твой выбор'}.` : '';

  return `
    <section class="page-heading home-greeting"><div><p class="eyebrow">${esc(dateHeading())}</p><h1>Сегодня</h1></div><button class="heading-action" type="button" data-action="go-profile" aria-label="Настройки профиля">${icon('settings', 20)}</button></section>
    ${renderHomeJourneyStats()}
    <section class="home-counter-card ${strategy === 'quit' ? 'counter-quit' : 'counter-reduce'}" aria-labelledby="home-counter-title">
      <div class="home-counter-top"><div><h2 id="home-counter-title">${strategy === 'quit' ? 'Счётчик употребления' : 'Учёт на сегодня'}</h2></div>${amountStatus ? `<span class="home-counter-status ${currentAmountUnknown ? 'is-unknown' : hasMeasurementToday && log.amount > 0 ? 'has-value' : ''}" role="status">${esc(amountStatus)}</span>` : ''}</div>
      <div class="home-counter-main"><div class="home-counter-number-wrap"><strong id="home-counter-value" aria-live="polite">${esc(counterAmount)}</strong><span>${esc(unit)}</span></div><button class="home-counter-add" type="button" data-action="adjust-amount" data-delta="1" aria-label="Добавить одну запись: +1 ${esc(unit)}"><span class="counter-add-icon">${icon('plus', 23)}</span><span>Добавить</span><small>+1 ${esc(unit)}</small></button></div>
      ${strategy === 'reduce' && target > 0 ? `<div class="home-counter-target"><div class="home-target-track"><span style="width:${hasMeasurementToday ? Math.min(100, log.amount / target * 100) : 0}%"></span></div><div><span>Цель на день</span><strong>${target} ${esc(unit)}</strong></div></div>` : ''}
      <div class="home-counter-bottom"><button type="button" class="counter-undo" data-action="adjust-amount" data-delta="-1" ${Number(log.amount || 0) <= 0 || currentAmountUnknown ? 'disabled' : ''}>${icon('undo-2', 15)} Отменить последнее</button><button type="button" class="counter-detail" data-action="open-day" data-date="${currentDate}">Детали дня ${icon('arrow-up-right', 15)}</button></div>
      <div class="home-counter-help"><button type="button" data-action="open-craving">${icon('wind', 16)} Сейчас тянет — нужна пауза?</button>${strategy === 'quit' && (Number(log.amount || 0) > 0 || reportedUseToday) ? `<button type="button" data-action="open-slip">${icon('heart', 15)} Разобрать эпизод без самокритики</button>` : ''}</div>
    </section>
    <section class="home-tip-card" aria-labelledby="home-tip-title"><div class="home-tip-header"><div><h2 id="home-tip-title">Совет</h2></div></div><div id="home-tip-content">${renderHomeTipMarkup()}</div></section>
    <section class="home-dynamics panel-card"><div class="home-section-heading"><div><h2>Динамика за 7 дней</h2></div><button type="button" class="text-action" data-tab="calendar">Вся история ${icon('arrow', 14)}</button></div><p class="chart-note">${strategy === 'quit' ? 'График показывает только твои записи об употреблении.' : `График показывает записи в единице «${esc(unit)}».` } Неизвестный день не считается нулём.</p><div class="week-chart home-week-chart">${weeklyBars}</div></section>
    <section class="home-overview panel-card"><div class="home-section-heading"><div><h2>Обзор</h2></div><span class="home-section-icon">${icon('calendar-check', 19)}</span></div><p class="home-overview-summary">${esc(homeReviewText(reviewMetrics, strategy))}</p><div class="home-overview-metrics"><div><strong>${reviewMetrics.trackedDays}/7</strong><span>дней с измерением</span></div><div><strong>${tasksDone.size}/${dailyTasks.length}</strong><span>шагов сегодня</span></div><div><strong>${bestStreak}</strong><span>лучшая серия</span></div></div><div class="task-list home-task-list">${completedTaskRows}</div><div class="home-overview-footer"><span>${icon('lock', 14)} Локальные данные</span><button type="button" class="text-action" data-action="open-weekly-review">Подробнее в «Здоровье» ${icon('arrow', 14)}</button></div>${savedText ? `<p class="home-saved-focus">${esc(savedText)}</p>` : ''}</section>
    <section class="panel-card milestones-card home-milestones"><div class="panel-heading"><div><h2>Этапы</h2></div><span class="milestone-count">${MILESTONES.filter(m => Math.max(bestStreak, streak) >= m.days || state.achievements.celebrated.includes(m.days)).length}/${MILESTONES.length}</span></div><div class="milestone-strip">${MILESTONES.map(m => { const unlocked = Math.max(bestStreak, streak) >= m.days || state.achievements.celebrated.includes(m.days); return `<button type="button" class="milestone ${unlocked ? 'unlocked' : ''}" data-action="milestone-info" data-days="${m.days}"><span class="milestone-bubble">${unlocked ? icon('check', 17) : m.days}</span><strong>${esc(m.title)}</strong><small>${m.days} ${plural(m.days, ['день', 'дня', 'дней'])}</small></button>`; }).join('')}</div></section>
    <section class="home-profile-teaser"><div class="home-profile-avatar">${icon('user-round', 21)}</div><div class="home-profile-copy"><h2>Профиль</h2><p>Цели, предпочтения и личные данные.</p></div><button type="button" class="home-profile-link" data-action="go-profile" aria-label="Перейти в профиль">${icon('arrow-up-right', 19)}</button></section>
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
  const trendLabel = range === 'week' ? 'Последние 7 дней' : range === 'month' ? 'Последние 30 дней' : 'Весь период с начала пути';
  const averageLabel = metrics.average == null ? '—' : Number(metrics.average.toFixed(1)).toLocaleString('ru-RU');
  return `<section class="panel-card analytics-panel" aria-labelledby="analytics-title">
    <div class="panel-heading"><div><p class="eyebrow">ТВОЯ ДИНАМИКА</p><h2 id="analytics-title">Сравнивай себя с собой</h2></div><span class="metric-icon mint">${icon('chart', 19)}</span></div>
    <div class="analytics-range" role="group" aria-label="Период статистики">${[['week','7 дней'],['month','30 дней'],['all','Весь путь']].map(([id,label])=>`<button type="button" class="filter-chip ${range===id?'active':''}" data-action="analytics-range" data-id="${id}" aria-pressed="${range===id}">${label}</button>`).join('')}</div>
    <p class="chart-note">${trendLabel}. График строится только по измерениям выбранной единицы; дни без данных не считаются нулевыми.</p>
    <div class="analytics-chart" role="img" aria-label="График ${esc(trendLabel.toLowerCase())}">${bars}</div>
    <div class="analytics-metric-grid"><article><span>Отмечено дней</span><strong>${metrics.trackedDays}</strong></article><article><span>Среднее значение</span><strong>${averageLabel}</strong><small>${esc(unit)}</small></article><article><span>Эпизодов с контекстом</span><strong>${metrics.daysWithReportedUse}</strong></article></div>
    <div class="analytics-comparison"><span class="analytics-comparison-icon">${icon('target', 17)}</span><p>${esc(comparison)}</p></div>
    <p class="field-help">График описывает личные записи, а не медицинский результат. Ситуации, эмоциональные отметки и связь с практиками вынесены во вкладку «Здоровье», чтобы не смешивать оздоровительные наблюдения с учётом употребления.</p>
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
    <section class="page-heading"><div><h1>Календарь</h1><p class="page-subtitle">История употребления по дням.</p></div><span class="heading-icon">${icon('calendar', 21)}</span></section>
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
  const allowedCategory = PRACTICE_CATEGORIES.some(item => item.id === practiceCategory) ? practiceCategory : 'all';
  const list = PRACTICES.filter(practice => (!practiceFavoritesOnly || favorites.has(practice.id)) && (allowedCategory === 'all' || practice.category === allowedCategory));
  const topPracticeLabels = new Map(PRACTICES.map(practice => [practice.id, practice.name]));
  const history = stats.sessions.slice().sort((a,b) => String(b.finishedAt).localeCompare(String(a.finishedAt))).slice(0, 5);
  const historyMarkup = history.length
    ? `<div class="practice-history-list">${history.map(session => {
      const date = session.date || String(session.finishedAt || '').slice(0,10);
      const practice = PRACTICES.find(item => item.id === session.id);
      const mins = Math.round((Number(session.duration) || 0) / 60);
      return `<div class="practice-history-row"><span class="practice-history-mark">${icon('wind',16)}</span><div><strong>${esc(practice?.name || 'Дыхательная практика')}</strong><small>${esc(date ? formatShortDate(date) : '')} · ${session.completed === false ? 'остановлена раньше' : 'завершена'}</small></div><span class="practice-history-duration">${mins} мин</span></div>`;
    }).join('')}</div>`
    : `<div class="library-empty">${icon('wind',22)}<strong>История пока пуста</strong><span>Первая сохранённая сессия появится здесь. Можно начать с одной минуты.</span></div>`;
  const topPractices = stats.topPractices.length
    ? stats.topPractices.map(([id,count])=>`<div class="analytics-insight-row"><span>${esc(topPracticeLabels.get(id)||id)}</span><strong>${count}</strong></div>`).join('')
    : '<p class="field-help">Заверши несколько практик, чтобы увидеть, к каким ты чаще возвращаешься.</p>';
  const cards = list.map((practice, index) => `
    <article class="practice-card practice-tone-${practice.tone}">
      <button type="button" class="practice-card-main" data-action="open-practice" data-id="${practice.id}" aria-label="Открыть практику: ${esc(practice.name)}">
        <div class="practice-card-visual"><span class="practice-card-orbit orbit-one"></span><span class="practice-card-orbit orbit-two"></span><span class="practice-card-core"></span><span class="practice-card-spark spark-one"></span><span class="practice-card-spark spark-two"></span><span class="practice-card-spark spark-three"></span><span class="practice-card-index">${String(index + 1).padStart(2,'0')}</span></div>
        <div class="practice-card-copy"><span class="practice-card-tag">${esc(practice.tag)}</span><h3>${esc(practice.name)}</h3><p>${esc(practice.description)}</p><div class="practice-card-meta"><span>${icon('clock',13)} ${state.practiceSettings?.durations?.[practice.id] || Math.round(practice.duration/60)} мин</span><span>${esc(practice.label)}</span></div></div>
        <span class="practice-card-open">${icon('arrow-up-right',17)}</span>
      </button>
      <button type="button" class="practice-card-favorite ${favorites.has(practice.id)?'is-favorite':''}" data-action="toggle-practice-favorite" data-id="${practice.id}" aria-label="${favorites.has(practice.id)?'Убрать из':'Добавить в'} избранное: ${esc(practice.name)}" aria-pressed="${favorites.has(practice.id)}">${icon('star',17)}</button>
    </article>`).join('');
  return `
    <section class="page-heading practices-page-heading"><div><h1>Практики</h1><p class="page-subtitle">Выбери технику и удобную длительность.</p></div><span class="heading-icon">${icon('wind', 22)}</span></section>
    <section class="breath-feature breath-feature-v2"><div class="breath-feature-glow"></div><div class="breath-feature-copy"><h2>Дыши<br><em>в своём ритме.</em></h2><div class="breath-feature-actions"><button type="button" class="button button-lime" data-action="open-practice" data-id="natural">${icon('play', 16)} Начать мягко</button><button type="button" class="button button-glass" data-action="open-practice" data-id="craving-breath">${icon('wind', 16)} При тяге</button></div></div><div class="breath-art breath-art-v2" aria-hidden="true"><span class="breath-art-orbit orbit-a"></span><span class="breath-art-orbit orbit-b"></span><span class="breath-art-orbit orbit-c"></span><div class="breath-art-core"><span class="core-ribbon ribbon-a"></span><span class="core-ribbon ribbon-b"></span><i class="core-star"></i></div><canvas class="breath-particle-canvas hero-breath-canvas" data-breath-canvas data-phase="ambient" aria-hidden="true"></canvas><span class="breath-art-aura aura-a"></span><span class="breath-art-aura aura-b"></span></div><div class="breath-feature-foot"><span>${icon('clock', 15)} 1–10 минут</span><span>${icon('activity', 15)} ${totalPractices} ${plural(totalPractices, ['сессия', 'сессии', 'сессий'])}</span></div></section>
    <section class="practice-library-section"><div class="section-title-row practice-title"><div><h2>Выбери практику</h2></div><button type="button" class="practice-favorites-toggle ${practiceFavoritesOnly?'is-active':''}" data-action="practice-favorites-filter" data-value="${practiceFavoritesOnly?'all':'favorites'}" aria-pressed="${practiceFavoritesOnly}">${icon('star',15)} ${practiceFavoritesOnly?'Все':'Избранное'} <span>${favorites.size}</span></button></div>
      <div class="practice-category-filters" role="group" aria-label="Категория практик">${PRACTICE_CATEGORIES.map(item=>`<button type="button" class="practice-category-chip ${allowedCategory===item.id?'active':''}" data-action="practice-category-filter" data-value="${item.id}" aria-pressed="${allowedCategory===item.id}">${esc(item.label)}</button>`).join('')}</div>
      <div class="practice-library-grid">${cards || `<div class="library-empty practice-empty-state">${icon('star',23)}<strong>Пока нет подходящих практик</strong><span>Убери фильтр избранного или сохрани звёздочкой подходящую технику.</span><button type="button" class="button button-secondary" data-action="practice-favorites-filter" data-value="all">Показать все практики</button></div>`}</div>
    </section>
    <section class="panel-card practice-analytics practice-analytics-v2"><div class="panel-heading"><div><h2>История практик</h2></div><span class="metric-icon mint">${icon('activity',19)}</span></div><div class="analytics-range" role="group" aria-label="Период истории практик">${[['week','7 дней'],['month','30 дней'],['all','Весь путь']].map(([id,label])=>`<button type="button" class="filter-chip ${range===id?'active':''}" data-action="practice-range" data-id="${id}" aria-pressed="${range===id}">${label}</button>`).join('')}</div><div class="practice-stat-grid"><article><span>Завершено</span><strong>${stats.completedCount}</strong></article><article><span>Минут практики</span><strong>${stats.minutes}</strong></article><article><span>Остановлено раньше</span><strong>${stats.interruptedCount}</strong></article></div><div class="practice-top-list"><h3>Часто выбираемые</h3>${topPractices}</div><div class="practice-history-heading"><h3>Недавние сессии</h3><small>Последние 5</small></div>${historyMarkup}<p class="field-help">История хранится на устройстве. Оценки отражают только твои ощущения.</p></section>
    <section class="practice-evidence-note">${icon('book-open',17)}<div><strong>На чём основаны практики</strong><p>В основе — комфортное дыхание NHS, диафрагмальное дыхание Veterans Affairs, квадратный ритм Cleveland Clinic и советы Smokefree по тяге и осознанности. Отдельные схемы счёта — мягкие варианты, а не самостоятельные доказанные методы лечения зависимости.</p><div class="practice-source-links"><a href="https://www.nhs.uk/mental-health/self-help/guides-tools-and-activities/breathing-exercises-for-stress/" target="_blank" rel="noopener noreferrer">NHS</a><a href="https://veteranshealthlibrary.va.gov/encyclopedia/142%2C82451_VA" target="_blank" rel="noopener noreferrer">Veterans Affairs</a><a href="https://health.clevelandclinic.org/box-breathing-benefits" target="_blank" rel="noopener noreferrer">Cleveland Clinic</a><a href="https://smokefree.gov/quit-vaping-resources/dealing-with-vape-cravings" target="_blank" rel="noopener noreferrer">Smokefree.gov</a></div></div></section>
    <section class="soft-info safety-info">${icon('info', 17)}<p>Дыши комфортно и не старайся вдыхать глубже обычного. Если почувствуешь головокружение, нехватку воздуха или дискомфорт, остановись и вернись к естественному дыханию. Практики могут поддерживать спокойствие и переключение внимания, но не заменяют доказательную помощь при никотиновой зависимости.</p></section>
  `;
}

function renderTips() {
  const normalizedSearch = tipSearch.trim().toLocaleLowerCase('ru-RU');
  const allowedCategories = ['all', ...TIP_CATEGORIES.map(category => category.id).filter(id => id !== 'all')];
  if (!allowedCategories.includes(tipCategory)) tipCategory = 'all';
  const tips = TIPS.filter(tip => {
    if (HEALTH_TIP_IDS.has(tip.id)) return false;
    const haystack = `${tip.title} ${tip.summary || ''} ${tip.body} ${tip.steps?.join(' ') || ''}`.toLocaleLowerCase('ru-RU');
    return (tipCategory === 'all' || tip.category === tipCategory)
      && (tipLevel === 'all' || tip.level === tipLevel)
      && (tipSituation === 'all' || (tip.situations || []).includes(tipSituation))
      && (!normalizedSearch || haystack.includes(normalizedSearch));
  });
  const categories = TIP_CATEGORIES.filter(category => allowedCategories.includes(category.id));
  return `
    <section class="page-heading"><div><h1>Советы</h1><p class="page-subtitle">Рекомендации по ситуациям и привычкам.</p></div><span class="heading-icon">${icon('book', 21)}</span></section>
    <label class="tip-search"><span>${icon('search',17)}</span><input type="search" data-field="tips.search" value="${esc(tipSearch)}" placeholder="Найти совет или ситуацию" aria-label="Поиск по советам"></label>
    <div class="tips-filter-dropdowns"><label class="form-field"><span>Тема</span><select data-field="tips.category">${categories.map(item=>`<option value="${item.id}" ${tipCategory===item.id?'selected':''}>${esc(item.label)}</option>`).join('')}</select></label><label class="form-field"><span>Формат</span><select data-field="tips.level">${TIP_LEVELS.map(item=>`<option value="${item.id}" ${tipLevel===item.id?'selected':''}>${esc(item.label)}</option>`).join('')}</select></label><label class="form-field"><span>Ситуация</span><select data-field="tips.situation">${TIP_SITUATIONS.map(item=>`<option value="${item.id}" ${tipSituation===item.id?'selected':''}>${esc(item.label)}</option>`).join('')}</select></label></div>
    <div class="tips-results-heading"><strong>${tips.length} ${plural(tips.length,['совет','совета','советов'])}</strong><span>из библиотеки</span></div>
    <div class="tips-list">${tips.map(tip => `<article class="tip-card minimalist-tip-card"><div class="tip-card-top"><span class="tip-category-mark">${icon(tip.category === 'now' ? 'wind' : tip.category === 'habits' ? 'rotate' : tip.category === 'support' ? 'heart' : 'sparkles', 17)}</span><span class="tip-evidence">${esc(tip.evidence)}</span></div><h2>${esc(tip.title)}</h2><p>${esc(tip.summary || tip.body)}</p><div class="tip-card-meta"><span>${icon('clock',14)} ${esc(tip.time)}</span><span>${tip.level === 'quick' ? 'Короткий шаг' : 'Материал'}</span></div><div class="tip-card-foot"><span>${icon('bookmark',14)} ${esc(tip.category === 'now' ? 'Когда тянет' : tip.category === 'habits' ? 'Привычки' : tip.category === 'plan' ? 'Планирование' : 'Поддержка')}</span><button type="button" class="text-action" data-action="open-guide" data-id="${tip.id}">Подробнее ${icon('arrow', 14)}</button></div></article>`).join('') || `<div class="library-empty">${icon('search',22)}<strong>Ничего не найдено</strong><span>Попробуй изменить запрос или фильтры.</span><button type="button" class="button button-secondary" data-action="reset-tip-filters">Сбросить фильтры</button></div>`}</div>
    <section class="health-library-teaser"><span class="health-library-teaser-icon">${icon('heart-pulse', 19)}</span><div><strong>Информация о здоровье — отдельно</strong><p>Материалы о симптомах отмены, доказательных способах помощи и обращении к специалисту собраны во вкладке «Здоровье».</p></div><button type="button" class="button button-secondary" data-action="go-health">Открыть ${icon('arrow', 14)}</button></section>
    <p class="content-disclaimer">Советы носят образовательный характер и не заменяют индивидуальную медицинскую консультацию.</p>
  `;
}

function renderHealth() {
  const metrics = getProgressAnalytics(state, 'month');
  const practiceStats = getPracticeAnalytics(state, 'month');
  const review = getWeeklyReviewMetrics(state);
  const checkinDate = healthCheckinDate <= today() ? healthCheckinDate : today();
  const checkin = state.dailyLogs?.[checkinDate] || {};
  const triggerLabels = new Map(TRIGGER_OPTIONS);
  const moodLabels = new Map(EMOTION_OPTIONS);
  const renderRows = (items, labels, empty) => items.length
    ? `<div class="health-insight-list">${items.slice(0, 4).map(([id, count]) => `<div class="health-insight-row"><span>${esc(labels.get(id) || id)}</span><strong>${count}</strong><small>${plural(count, ['отметка', 'отметки', 'отметок'])}</small></div>`).join('')}</div>`
    : `<p class="health-empty-note">${empty}</p>`;
  const articles = TIPS.filter(item => HEALTH_TIP_IDS.has(item.id));
  const breathEvidence = metrics.ratedBreathCount
    ? `В ${metrics.lowerAfterBreath} из ${metrics.ratedBreathCount} записей пользовательская оценка тяги после практики была ниже оценки до неё. Это личное наблюдение, не доказательство причинного эффекта.`
    : 'Если оценивать тягу до и после практики, можно наблюдать личные изменения. Пока сравнений недостаточно для вывода.';
  return `
    <section class="page-heading health-page-heading"><div><h1>Здоровье</h1><p class="page-subtitle">Самочувствие и помощь.</p></div><span class="heading-icon">${icon('heart-pulse', 22)}</span></section>
    <section class="health-hero"><div class="health-hero-orb">${icon('heart-pulse', 29)}</div><div><p class="eyebrow">ТВОЁ САМОЧУВСТВИЕ</p><h2>Самочувствие и триггеры</h2><p>Отмечай ситуации и эмоции, чтобы замечать повторения. Записи не являются диагнозом.</p></div><button type="button" class="button button-lime" data-action="open-support">Варианты помощи ${icon('arrow', 15)}</button></section>
    <section class="health-checkin-card" aria-labelledby="health-checkin-title">
      <div class="home-section-heading"><div><p class="eyebrow">ЛИЧНЫЙ ДНЕВНИК</p><h2 id="health-checkin-title">Как ты себя чувствуешь?</h2></div><span class="home-section-icon">${icon('heart', 19)}</span></div>
      <label class="form-field health-checkin-date"><span>Дата наблюдения</span><input type="date" data-field="health.date" value="${esc(checkinDate)}" max="${today()}"></label>
      <div class="trigger-field"><div class="trigger-field-heading"><strong>Какие ситуации влияли?</strong><small>Необязательно · можно выбрать несколько</small></div><div class="trigger-chips" role="group" aria-label="Ситуации и триггеры">${TRIGGER_OPTIONS.map(([id,label]) => `<button type="button" class="trigger-chip ${(checkin.triggers || []).includes(id) ? 'selected' : ''}" data-action="toggle-trigger" data-date="${checkinDate}" data-id="${id}" aria-pressed="${(checkin.triggers || []).includes(id)}">${esc(label)}</button>`).join('')}</div></div>
      <div class="trigger-field mood-field"><div class="trigger-field-heading"><strong>Какое состояние было ближе?</strong><small>Одна отметка по желанию</small></div><div class="trigger-chips" role="group" aria-label="Эмоциональное состояние">${EMOTION_OPTIONS.map(([id,label]) => `<button type="button" class="trigger-chip ${(checkin.mood || '') === id ? 'selected' : ''}" data-action="set-day-mood" data-date="${checkinDate}" data-id="${id}" aria-pressed="${(checkin.mood || '') === id}">${esc(label)}</button>`).join('')}</div></div>
      <label class="form-field day-note-field"><span>Заметка к наблюдению</span><textarea rows="3" maxlength="4000" data-field="day.note" data-date="${checkinDate}" placeholder="Что происходило? Что помогло? Можно оставить поле пустым.">${esc(checkin.note || '')}</textarea></label>
      <p class="field-help">Записи сохраняются на этом устройстве. Это личные наблюдения, а не диагноз и не доказательство причины.</p>
    </section>
    <section class="health-section-grid">
      <article class="health-insight-card"><div class="health-insight-heading"><span>${icon('message-circle', 18)}</span><div><h2>Ситуации</h2><p>За последние 30 дней</p></div></div>${renderRows(metrics.topTriggers, triggerLabels, 'Пока мало отмеченных ситуаций. Если захочешь, фиксируй триггеры в дневнике тяги или календаре.')}</article>
      <article class="health-insight-card"><div class="health-insight-heading"><span>${icon('heart', 18)}</span><div><h2>Эмоциональный фон</h2><p>По твоим отметкам</p></div></div>${renderRows(metrics.topMoods, moodLabels, 'Эмоциональные состояния пока не отмечались. Можно оставить этот раздел пустым.')}</article>
      <article class="health-insight-card"><div class="health-insight-heading"><span>${icon('wind', 18)}</span><div><h2>Практики и тяга</h2><p>Личные наблюдения</p></div></div><div class="health-practice-stat"><strong>${practiceStats.completedCount}</strong><span>завершено</span><strong>${practiceStats.minutes}</strong><span>минут</span></div><p>${esc(breathEvidence)}</p><button type="button" class="text-action" data-action="select-health-section" data-section="practices">Открыть практики ${icon('arrow', 14)}</button></article>
      <article class="health-insight-card"><div class="health-insight-heading"><span>${icon('calendar-check', 18)}</span><div><h2>Неделя</h2><p>Наблюдения без оценок</p></div></div><p>${esc(weeklyReviewMessage(review))}</p><button type="button" class="button button-secondary full-button" data-action="open-weekly-review">Посмотреть недельный обзор ${icon('arrow', 14)}</button></article>
    </section>
    <section class="health-library-section"><div class="home-section-heading"><div><p class="eyebrow">ПРОВЕРЕННАЯ ИНФОРМАЦИЯ</p><h2>Что может помочь</h2></div><span class="home-section-icon">${icon('book-open', 19)}</span></div><div class="health-article-list">${articles.map(article => `<article class="health-article-row"><span class="health-article-mark">${icon(article.id === 'breathing' ? 'wind' : article.id === 'professional' || article.id === 'support-network' ? 'heart-handshake' : 'shield-check', 18)}</span><div><p class="eyebrow">${esc(article.evidence)}</p><h3>${esc(article.title)}</h3><p>${esc(article.summary)}</p><button type="button" class="text-action" data-action="open-guide" data-id="${article.id}">Читать материал ${icon('arrow', 14)}</button></div></article>`).join('')}</div></section>
    <section class="health-sources-card"><p class="eyebrow">ОФИЦИАЛЬНЫЕ ИСТОЧНИКИ</p><h2>Материалы для самостоятельного чтения</h2><a href="https://www.who.int/campaigns/world-no-tobacco-day/2026/quit-today" target="_blank" rel="noopener noreferrer">ВОЗ · Пошаговый план отказа от табака и никотина (2026) ${icon('external',14)}</a><a href="https://www.who.int/news-room/questions-and-answers/item/how-to-quit-e-cigarettes" target="_blank" rel="noopener noreferrer">ВОЗ · Как отказаться от электронных сигарет ${icon('external',14)}</a><a href="https://www.who.int/publications/i/item/9789240096431" target="_blank" rel="noopener noreferrer">ВОЗ · Клиническое руководство по отказу от табака у взрослых (2024) ${icon('external',14)}</a><a href="https://www.nhs.uk/mental-health/self-help/guides-tools-and-activities/breathing-exercises-for-stress/" target="_blank" rel="noopener noreferrer">NHS · Дыхательные упражнения при стрессе ${icon('external',14)}</a><p>Рекомендации для отказа от табака у взрослых не следует автоматически переносить на каждый случай вейпинга, лекарства или индивидуальные медицинские решения. При необходимости обсуди подходящие варианты со специалистом.</p></section>
    <p class="content-disclaimer">Информация носит образовательный характер. Если симптомы выраженные, необычные или долго мешают повседневной жизни, обратись к медицинскому специалисту.</p>
  `;
}

function renderGuideOverlay(id) {
  const guide = TIPS.find(item => item.id === id);
  if (!guide) return '';
  const steps = (guide.steps || []).map(step => `<li>${esc(step)}</li>`).join('');
  return `<div class="modal-backdrop guide-backdrop" data-action="backdrop-close"><article class="modal sheet-modal guide-modal" role="dialog" aria-modal="true" aria-labelledby="guide-title"><div class="modal-handle"></div><div class="modal-heading"><div><p class="eyebrow">${esc(guide.evidence)}</p><h2 id="guide-title">${esc(guide.title)}</h2><p class="guide-meta">${icon('clock',14)} ${esc(guide.time)} · ${guide.level==='quick'?'короткое действие':'справочный материал'}</p></div><button type="button" class="quiet-icon" data-action="close-overlay" aria-label="Закрыть материал">${icon('close',19)}</button></div><p class="guide-lead">${esc(guide.summary || '')}</p><div class="guide-body"><p>${esc(guide.body)}</p>${steps ? `<h3>Что можно попробовать</h3><ol>${steps}</ol>` : ''}</div><div class="guide-source"><span>${icon('book-open',17)}</span><div><strong>Источник</strong><a href="${esc(guide.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(guide.sourceTitle || 'Открыть источник')} ${icon('external',13)}</a><small>${esc(guide.sourceDate || 'Источник указан для проверки информации')}</small></div></div><div class="guide-actions"><button type="button" class="button button-primary full-button" data-action="guide-action" data-id="${guide.id}">${esc(guide.action || 'Выбрать следующий шаг')} ${icon('arrow',15)}</button><button type="button" class="button button-secondary full-button" data-action="close-overlay">Вернуться в библиотеку</button></div><p class="field-help">Материал не является диагнозом. Дыхательные и поведенческие приёмы могут быть вспомогательными, но не заменяют подходящую медицинскую помощь.</p></article></div>`;
}

function renderProfile() {
  if (profileSubpage === 'settings') return renderProfileSettings();
  const profile = state.profile || { displayName: '', personalReason: '' };
  const name = String(profile.displayName || '').trim();
  const initial = name ? esc(Array.from(name)[0].toLocaleUpperCase('ru-RU')) : icon('user', 26);
  const sessions = state.practiceSessions.filter(item => item.completed !== false).length;
  const loggedDays = Object.keys(state.dailyLogs || {}).filter(date => date <= today()).length;
  const goal = state.plan.strategy === 'quit' ? 'Полный отказ' : 'Постепенное сокращение';
  const unit = getUnitLabel(state);
  return `
    <section class="page-heading"><div><h1>Профиль</h1><p class="page-subtitle">Личные данные и твой путь.</p></div><span class="heading-icon">${icon('user', 21)}</span></section>
    <section class="profile-hero-card panel-card">
      <div class="profile-hero-top"><span class="profile-avatar profile-avatar-large">${initial}</span><div class="profile-hero-copy"><p class="eyebrow">ЛИЧНЫЙ ПРОФИЛЬ</p><h2>${name ? esc(name) : 'Твой профиль'}</h2><p>${esc(goal)}</p></div><span class="profile-local-badge">${icon('lock', 13)} На устройстве</span></div>
      <div class="profile-edit-fields">
        <label class="form-field"><span>Как к тебе обращаться?</span><input type="text" maxlength="48" autocomplete="nickname" data-field="profile.displayName" value="${esc(profile.displayName || '')}" placeholder="Имя или короткое обращение"></label>
        <label class="form-field"><span>Почему для тебя это важно?</span><textarea rows="3" maxlength="240" data-field="profile.personalReason" placeholder="Личная причина — по желанию">${esc(profile.personalReason || '')}</textarea><small class="field-help">Текст виден только в твоём локальном профиле.</small></label>
      </div>
    </section>
    ${profile.personalReason ? `<section class="profile-reason-card"><span>${icon('heart', 18)}</span><div><strong>Твоя причина</strong><p>${esc(profile.personalReason)}</p></div></section>` : ''}
    <section class="profile-stats-grid" aria-label="Твоя активность">
      <article class="profile-stat-card"><span>${icon('calendar-check', 18)}</span><strong>${loggedDays}</strong><small>дней с записями</small></article>
      <article class="profile-stat-card"><span>${icon('wind', 18)}</span><strong>${sessions}</strong><small>завершённых практик</small></article>
      <article class="profile-stat-card"><span>${icon('activity', 18)}</span><strong>${state.cravingLogs.length}</strong><small>записей о тяге</small></article>
    </section>
    <section class="profile-goal-card panel-card"><div class="profile-goal-mark">${icon('target', 20)}</div><div><p class="eyebrow">ТЕКУЩИЙ ПЛАН</p><h2>${esc(goal)}</h2><p>${state.plan.strategy === 'quit' ? `Отсчёт с ${esc(formatShortDate(state.plan.startDate))}` : `Отслеживаешь: ${esc(unit)}`}</p>${state.plan.strategy === 'reduce' && state.plan.dailyTarget > 0 ? `<div class="profile-goal-target">Цель на день: <strong>${state.plan.dailyTarget} ${esc(unit)}</strong></div>` : ''}</div></section>
    <button class="profile-settings-link" type="button" data-action="open-profile-settings"><span class="profile-settings-icon">${icon('settings', 21)}</span><span class="profile-settings-copy"><strong>Настройки приложения</strong><small>Стратегия, единицы учёта, напоминания, практики и резервные копии</small></span>${icon('chevron', 18)}</button>
    <p class="profile-privacy-note">${icon('lock', 14)} Профиль хранится на этом устройстве. Аккаунт не нужен.</p>
  `;
}

function renderProfileSettings() {
  const p = state.plan, tracking = state.tracking, finance = state.finance, prefs = state.preferences;
  const installed = window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
  return `
    <section class="page-heading settings-page-heading"><div><button class="profile-back-link" type="button" data-action="back-profile-settings">${icon('chevron', 14)} Профиль</button><h1>Настройки</h1><p class="page-subtitle">Стратегия, учёт и параметры приложения.</p></div><span class="heading-icon">${icon('settings', 21)}</span></section>
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
    <section class="about-card"><span class="about-mark">${icon('leaf', 22)}</span><div><h2>Выдох <span>v1.8.1</span></h2><small>${installed ? 'Приложение установлено' : 'Веб-версия · можно установить из браузера'}</small></div></section>
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

  return `<div class="modal-backdrop" data-action="backdrop-close"><section class="modal sheet-modal" role="dialog" aria-modal="true" aria-labelledby="day-title"><div class="modal-handle"></div><div class="modal-heading"><div><p class="eyebrow">ЗАПИСЬ ЗА ДЕНЬ</p><h2 id="day-title">${esc(formatLongDate(date))}</h2></div><button type="button" class="quiet-icon" data-action="close-overlay" aria-label="Закрыть">${icon('close', 19)}</button></div><div class="day-status-line"><span class="status-dot status-${status}"></span>${statusText}</div><div class="day-amount-editor"><div><span class="eyebrow">ОТМЕЧЕННЫЙ ПОКАЗАТЕЛЬ</span><strong>${unknownUseAmount ? '—' : log.amount}</strong><small>${unknownUseAmount ? 'количество не указано' : esc(getUnitLabel(state))}</small></div><div class="stepper"><button type="button" data-action="adjust-day-amount" data-date="${date}" data-delta="-1" ${log.amount <= 0 ? 'disabled' : ''} aria-label="Уменьшить">${icon('minus', 19)}</button><button type="button" data-action="adjust-day-amount" data-date="${date}" data-delta="1" aria-label="Увеличить">${icon('plus', 19)}</button></div></div><div class="health-library-teaser day-health-teaser"><span class="health-library-teaser-icon">${icon('heart-pulse', 18)}</span><div><strong>Самочувствие и триггеры</strong><p>Заметки, эмоции и ситуации теперь собраны в разделе «Здоровье».</p></div><button type="button" class="button button-secondary" data-action="go-health">Открыть</button></div><div class="modal-actions">${noUseToggle}<button type="button" class="button button-primary full-button" data-action="close-overlay">Готово</button></div><p class="field-help">История употребления остаётся в календаре. Самочувствие, триггеры и заметки редактируются в разделе «Здоровье» с выбором даты.</p></section></div>`;
}

function renderPracticeOverlay(id) {
  const base = PRACTICES.find(item => item.id === id) || PRACTICES[0];
  if (!activePractice) activePractice = { ...base, duration: (state.practiceSettings?.durations?.[base.id] || Math.round(base.duration / 60)) * 60 };
  const p = activePractice;
  const running = !!practiceTimer && !practicePaused;
  const started = running || practicePaused || practiceElapsedBeforePause > 0;
  const favorites = new Set(state.practiceSettings?.favorites || []);
  const phaseName = running ? 'Практика идёт' : practicePaused ? 'Пауза' : started ? 'Продолжить' : 'Готово к началу';
  return `<div class="modal-backdrop dark-backdrop practice-backdrop"><section class="practice-modal practice-modal-v2 ${running ? 'is-session-running' : practicePaused ? 'is-session-paused' : 'is-session-ready'}" data-session-state="${running ? 'running' : practicePaused ? 'paused' : 'ready'}" role="dialog" aria-modal="true" aria-labelledby="practice-title"><div class="practice-modal-top"><button type="button" class="dark-icon-button" data-action="close-overlay" aria-label="Закрыть">${icon('close', 20)}</button><span class="dark-kicker"><span class="live-dot"></span> ПРАКТИКА</span><div class="practice-top-actions"><button type="button" class="dark-icon-button ${favorites.has(p.id)?'is-favorite':''}" data-action="toggle-practice-favorite" data-id="${p.id}" aria-label="${favorites.has(p.id)?'Убрать из':'Добавить в'} избранное" aria-pressed="${favorites.has(p.id)}">${icon('star',18)}</button><button type="button" class="dark-icon-button" data-action="toggle-sound" aria-label="${state.preferences.sound ? 'Выключить' : 'Включить'} звук" aria-pressed="${state.preferences.sound}">${icon(state.preferences.sound ? 'volume' : 'volumeOff', 19)}</button><button type="button" class="dark-icon-button" data-action="toggle-vibration" aria-label="${state.practiceSettings.vibration?'Выключить':'Включить'} вибрацию" aria-pressed="${state.practiceSettings.vibration}">${icon('activity',18)}</button></div></div>
    <div class="practice-modal-heading"><span class="practice-modal-category">${esc(p.tag || p.mode)}</span><h2 id="practice-title">${esc(p.name)}</h2><p>${esc(p.description)}</p></div>
    <div class="practice-stage practice-stage-v2"><div class="practice-visual-universe"><div class="practice-halo halo-1"></div><div class="practice-halo halo-2"></div><div class="practice-halo halo-3"></div><div class="practice-halo halo-4"></div><div id="active-breath-orb" class="active-breath-orb" data-phase="rest"><span class="orb-liquid-cloud cloud-a" aria-hidden="true"></span><span class="orb-liquid-cloud cloud-b" aria-hidden="true"></span><span class="orb-inner-ribbon ribbon-a"></span><span class="orb-inner-ribbon ribbon-b"></span><i></i></div><canvas id="practice-particle-canvas" class="breath-particle-canvas practice-particle-canvas" data-breath-canvas data-phase="rest" data-phase-duration="4" aria-hidden="true"></canvas></div><div class="practice-stage-caption"><span id="breath-phase" aria-live="polite" aria-atomic="true">${phaseName}</span><small id="breath-instruction" aria-live="polite" aria-atomic="true">${esc(p.guidance || 'Найди удобное положение и дыши комфортно.')}</small></div></div>
    <div class="practice-detail practice-detail-v2"><div class="practice-pattern-pills"><span>${icon('wind',13)} ${esc(p.label)}</span><span data-practice-duration-label>${icon('clock',13)} ${Math.round(p.duration/60)} мин</span><span>${esc(p.mode)}</span></div><div class="practice-duration-slot"><label class="practice-duration-field" aria-hidden="${started}" ${started?'inert':''}><span>Продолжительность</span><select data-field="practice.duration" aria-label="Продолжительность практики" ${started?'disabled':''}>${[1,3,5,10].map(minutes=>`<option value="${minutes}" ${Math.round(p.duration/60)===minutes?'selected':''}>${minutes} ${plural(minutes,['минута','минуты','минут'])}</option>`).join('')}</select></label><div class="practice-session-meta" aria-hidden="${!started}"><span>${icon('clock',14)} Сессия ${Math.round(p.duration/60)} мин</span><span>${state.practiceSettings.vibration?icon('activity',14)+' Вибрация включена':''}</span></div></div><div class="practice-timer" id="practice-timer" aria-live="off">${formatDuration(started?Math.max(0,p.duration-practiceElapsedBeforePause):p.duration)}</div><div class="practice-track"><span id="practice-track-fill" style="width:0%"></span></div><div class="practice-controls"><button type="button" class="button button-lime" id="practice-toggle" data-action="practice-toggle">${icon(running?'pause':'play',17)} ${running?'Пауза':started?'Продолжить':'Начать практику'}</button><button type="button" class="button button-dark-outline" data-action="practice-stop">${started?'Завершить':'Закрыть'}</button></div><p class="practice-footnote">Дыши без усилия. Задержки необязательны. Если появятся головокружение, нехватка воздуха или дискомфорт, остановись и вернись к обычному дыханию.</p><div class="practice-source-card"><span>${icon('book-open',15)}</span><div><strong>Источник и адаптация</strong><p>${esc(p.sourceNote || 'Практика — вспомогательный способ поддержать спокойствие и внимание.')}</p><a href="${esc(p.sourceUrl || 'https://www.nhs.uk/mental-health/self-help/guides-tools-and-activities/breathing-exercises-for-stress/')}" target="_blank" rel="noopener noreferrer">${esc(p.sourceTitle || 'NHS — дыхательные упражнения при стрессе')} ${icon('arrow-up-right',13)}</a></div></div></div>
  </section></div>`;
}

function renderPracticeResultOverlay() {
  const session = state.practiceSessions.find(item => item.sessionKey === practiceResultSessionKey);
  const practice = PRACTICES.find(item => item.id === session?.id);
  return `<div class="modal-backdrop dark-backdrop"><section class="practice-result-modal" role="dialog" aria-modal="true" aria-labelledby="practice-result-title"><div class="practice-result-orb">${icon('check',26)}</div><h2 id="practice-result-title">Практика завершена</h2><p>${esc(practice?.name || 'Практика')} · ${Math.round((session?.duration || 0)/60)} мин. Если тебе подходит, отметь, как ощущается момент сейчас. Это необязательно.</p><div class="practice-result-fields">${ratingScale('practice-feedback','afterRating',practiceResultDraft.afterRating,'Насколько сильна тяга сейчас?')}<div class="dark-field-group"><span>Как ты себя чувствуешь?</span>${choiceChips('practice-feedback','mood',EMOTION_OPTIONS,practiceResultDraft.mood)}</div><label class="form-field dark-form-field"><span>Заметка <small>необязательно</small></span><textarea rows="2" maxlength="500" data-field="practice.feedback.note" placeholder="Что хотелось бы запомнить?">${esc(practiceResultDraft.note)}</textarea></label></div><button type="button" class="button button-lime full-button" data-action="save-practice-feedback">Сохранить наблюдение</button><button type="button" class="craving-secondary-action" data-action="skip-practice-feedback">Пропустить и продолжить</button><p class="practice-footnote">Оценка отражает только твои ощущения и сама по себе не доказывает эффективность техники.</p></section></div>`;
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
  if (group === 'profile') {
    if (key === 'displayName') state.profile.displayName = String(value).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 48);
    else if (key === 'personalReason') state.profile.personalReason = String(value).replace(/\u0000/g, '').slice(0, 240);
  } else if (group === 'day' && key === 'note' && date) {
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
  if (!host) return;
  const nextKey = overlayKey();
  const markup = renderOverlay();
  if (nextKey !== lastOverlayKey) host.innerHTML = markup;
  else morphChildren(host, htmlFragment(markup));
  lastOverlayKey = nextKey;
  if (overlay?.type === 'practice') {
    if (practiceTimer || practicePaused || practiceElapsedBeforePause > 0) setPracticePhase(currentPracticeSeconds());
    else {
      const phase = $('#breath-phase'); if (phase) phase.textContent = 'Найди комфортный ритм';
      const instruction = $('#breath-instruction'); if (instruction && activePractice) instruction.textContent = activePractice.guidance || 'Дыши комфортно; счёт можно пропустить.';
      const orb = $('#active-breath-orb'); if (orb) orb.dataset.phase = 'rest';
      const canvas = $('#practice-particle-canvas'); if (canvas) { canvas.dataset.phase = 'rest'; breathVisualInstances.get(canvas)?.setPhase('rest'); }
    }
  }
  updateCountdownElements();
  syncPracticeVisualState();
  if (overlay) focusDialog();
  syncBreathVisuals();
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
    { name: 'Вдох', instruction: activePractice.inhaleCue || 'Мягко вдохни носом', duration: activePractice.inhale, phase: 'inhale' },
    ...(activePractice.hold ? [{ name: 'Пауза', instruction: activePractice.holdCue || 'Оставайся в комфорте', duration: activePractice.hold, phase: 'hold' }] : []),
    { name: 'Выдох', instruction: activePractice.exhaleCue || 'Спокойно выдохни', duration: activePractice.exhale, phase: 'exhale' },
    ...(activePractice.pause ? [{ name: 'Пауза', instruction: activePractice.holdCue || 'Не задерживай дыхание через силу', duration: activePractice.pause, phase: 'hold' }] : []),
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
  const particleCanvas = $('#practice-particle-canvas');
  if (particleCanvas) { particleCanvas.dataset.phase = phase.phase; particleCanvas.dataset.phaseDuration = String(Math.max(0.5, phase.duration)); breathVisualInstances.get(particleCanvas)?.setPhase(phase.phase, Math.max(0.5, phase.duration)); }
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

function syncPracticeVisualState() {
  const modal = $('.practice-modal-v2');
  if (!modal) return;
  const visualState = practiceTimer && !practicePaused ? 'running' : practicePaused ? 'paused' : 'ready';
  const started = visualState !== 'ready';
  modal.dataset.sessionState = visualState;
  modal.classList.toggle('is-session-running', visualState === 'running');
  modal.classList.toggle('is-session-paused', visualState === 'paused');
  modal.classList.toggle('is-session-ready', visualState === 'ready');

  // Keep duration selection available only before a session starts. Hiding it by
  // collapsing the control (rather than replacing the modal) avoids layout jumps
  // around the visualizer and keeps the Canvas animation instance alive.
  const durationField = $('.practice-duration-field', modal);
  const durationSelect = $('select[data-field="practice.duration"]', modal);
  const sessionMeta = $('.practice-session-meta', modal);
  if (durationField) {
    durationField.setAttribute('aria-hidden', String(started));
    durationField.inert = started;
  }
  if (durationSelect) durationSelect.disabled = started;
  if (sessionMeta) sessionMeta.setAttribute('aria-hidden', String(!started));
  const durationLabel = $('[data-practice-duration-label]', modal);
  if (durationLabel && activePractice) durationLabel.innerHTML = `${icon('clock', 13)} ${Math.round(activePractice.duration / 60)} мин`;
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
    breathVisualInstances.get($('#practice-particle-canvas'))?.pause();
    syncPracticeVisualState();
    return;
  }
  if (practiceElapsedBeforePause >= activePractice.duration) practiceElapsedBeforePause = 0;
  practicePaused = false;
  practiceStartedAt = Date.now();
  const btn = $('#practice-toggle'); if (btn) btn.innerHTML = `${icon('pause', 17)} Пауза`;
  practiceTimer = setInterval(tickPractice, 250);
  breathVisualInstances.get($('#practice-particle-canvas'))?.resume();
  syncPracticeVisualState();
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
  if (path === 'plan.strategy' || path === 'tracking.unit' || path === 'preferences.remindersEnabled' || path === 'plan.startDate' || path === 'preferences.sound' || path === 'practiceSettings.vibration' || path.startsWith('profile.')) render();
  else showToast('Сохранено');
}

root.addEventListener('click', event => {
  if (healthMenuOpen && !event.target.closest('#health-nav-menu') && !event.target.closest('[data-action="toggle-health-menu"]')) {
    healthMenuOpen = false;
    syncNavigation();
  }
  const tabButton = event.target.closest('[data-tab]');
  if (tabButton) {
    event.preventDefault();
    const requestedTab = tabButton.dataset.tab;
    const allowedTabs = ['today', 'calendar', 'practices', 'tips', 'profile', 'health'];
    if (!allowedTabs.includes(requestedTab)) return;
    healthMenuOpen = false;
    const returningToProfile = requestedTab === 'profile' && profileSubpage !== 'main';
    if (requestedTab === 'profile') profileSubpage = 'main';
    if (requestedTab !== activeTab || returningToProfile) {
      activeTab = requestedTab;
      overlay = null;
      render();
    } else {
      scrollPageToTop();
    }
    $('#main-content')?.focus({ preventScroll: true });
    return;
  }
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'toggle-health-menu') {
    healthMenuOpen = !healthMenuOpen;
    syncNavigation();
    return;
  }
  if (action === 'select-health-section') {
    const requestedTab = button.dataset.section;
    if (!['health', 'practices'].includes(requestedTab)) return;
    healthMenuOpen = false;
    if (requestedTab !== activeTab) {
      activeTab = requestedTab;
      overlay = null;
      render();
    } else {
      syncNavigation();
      scrollPageToTop();
    }
    $('#main-content')?.focus({ preventScroll: true });
    return;
  }
  if (['open-day', 'open-practice', 'open-craving', 'quick-practice', 'open-support', 'open-slip', 'open-weekly-review', 'reset-data', 'import-data'].includes(action)) overlayTrigger = button;
  if (button.classList.contains('modal-backdrop') && action === 'backdrop-close') { if (event.target === button && overlay?.type !== 'onboarding') closeOverlay(); return; }
  switch (action) {
    case 'go-profile': { const changed = activeTab !== 'profile' || profileSubpage !== 'main'; activeTab = 'profile'; profileSubpage = 'main'; overlay = null; healthMenuOpen = false; render(); if (!changed) scrollPageToTop(); break; }
    case 'open-profile-settings': profileSubpage = 'settings'; render(); scrollPageToTop(); break;
    case 'back-profile-settings': profileSubpage = 'main'; render(); scrollPageToTop(); break;
    case 'go-health': { if (overlay?.type === 'day' && overlay.date <= today()) healthCheckinDate = overlay.date; const changed = activeTab !== 'health'; activeTab = 'health'; overlay = null; healthMenuOpen = false; render(); if (!changed) scrollPageToTop(); break; }
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
      if (!commitMutation(previousState)) break;
      if (overlay) renderOverlayOnly(); else render();
      $(`[data-action="toggle-trigger"][data-date="${date}"][data-id="${id}"]`)?.focus({ preventScroll: true });
      break;
    }
    case 'set-day-mood': {
      const date = button.dataset.date; const mood = button.dataset.id;
      if (!date || !EMOTION_OPTIONS.some(([id]) => id === mood)) break;
      const previousState = state; state = cloneState();
      if (!state.dailyLogs[date]) state.dailyLogs[date] = { amount: 0, unit: state.tracking.unit, hourly: Array(24).fill(0), note: '', mood: null, triggers: [], measurements: {} };
      state.dailyLogs[date].mood = state.dailyLogs[date].mood === mood ? null : mood;
      if (!commitMutation(previousState)) break;
      if (overlay) renderOverlayOnly(); else render();
      $(`[data-action="set-day-mood"][data-date="${date}"][data-id="${mood}"]`)?.focus({ preventScroll: true });
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
    case 'open-weekly-review': activeTab = 'health'; healthMenuOpen = false; overlay = { type: 'weekly-review' }; render(); scrollPageToTop(); break;
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
    case 'home-stats-range': {
      const id = button.dataset.id;
      if (!['today', 'week', 'month'].includes(id)) break;
      homeStatsRange = id;
      render();
      break;
    }
    case 'next-home-tip': chooseNextHomeTip(); break;
    case 'reset-tip-filters': tipCategory = 'all'; tipLevel = 'all'; tipSituation = 'all'; tipSearch = ''; render(); break;
    case 'open-guide': if (TIPS.some(item => item.id === button.dataset.id)) { if (HEALTH_TIP_IDS.has(button.dataset.id)) activeTab = 'health'; healthMenuOpen = false; overlay = { type: 'guide', id: button.dataset.id }; render(); } break;
    case 'guide-action': {
      const tip = TIPS.find(item => item.id === button.dataset.id);
      if (!tip) break;
      overlay = null;
      if (['urge-wave', 'four-d'].includes(tip.id)) openCraving();
      else if (tip.id === 'trigger-map' || tip.id === 'small-environment') { activeTab = 'calendar'; render(); }
      else if (['professional', 'treatment', 'withdrawal', 'support-network', 'vaping-support', 'who-quit-today'].includes(tip.id)) { activeTab = 'health'; overlay = { type: 'support' }; render(); }
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
    case 'practice-category-filter': { const category = button.dataset.value; if (!PRACTICE_CATEGORIES.some(item => item.id === category)) break; practiceCategory = category; render(); break; }
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
  if (field.dataset.field === 'health.date') {
    const date = String(value || '');
    healthCheckinDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today() ? date : today();
    render();
    return;
  }
  if (field.dataset.field === 'tips.category') { tipCategory = ['all', 'now', 'habits', 'plan', 'support'].includes(value) ? value : 'all'; render(); return; }
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
  if (event.key === 'Escape' && healthMenuOpen) {
    healthMenuOpen = false;
    syncNavigation();
    $('[data-action="toggle-health-menu"]')?.focus({ preventScroll: true });
    return;
  }
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
homeTipTimer = setInterval(() => {
  if (!document.hidden && activeTab === 'today' && !overlay) chooseNextHomeTip();
}, 15000);

render();
if (!state.onboardingComplete && loaded.source === 'fresh') {
  overlay = { type: 'onboarding' };
  renderOverlayOnly();
} else if (loaded.migrated) {
  showToast(['v3', 'v2'].includes(loaded.source) ? 'Данные предыдущей версии перенесены в новый формат. Старый ключ сохранён.' : 'История v1 перенесена в новый формат. Исходный ключ сохранён без изменений.');
}
