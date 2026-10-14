import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { advanceParticleRadius, createBreathVisual, getParticleColor } from '../src/breath-visual.js';

const visualSource = await readFile(new URL('../src/breath-visual.js', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const styleSource = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

test('particle field streams inward on inhale and outward on exhale', () => {
  const radius = 0.34;
  assert.ok(advanceParticleRadius(radius, 'inhale', 0.1, 1) < radius);
  assert.ok(advanceParticleRadius(radius, 'exhale', 0.1, 1) > radius);
  assert.equal(advanceParticleRadius(radius, 'hold', 0.1, 1), radius);
});

test('particle flow clamps to the core and outer halo instead of wrapping across the scene', () => {
  assert.equal(advanceParticleRadius(0.08, 'inhale', 1, 1), 0.075);
  assert.equal(advanceParticleRadius(0.49, 'exhale', 1, 1), 0.5);
});

test('radial speed is normalized and follows the phase duration instead of canvas pixel size', () => {
  assert.match(visualSource, /const radialSpeed = RADIAL_SPAN \/ phaseLength/);
  assert.match(visualSource, /const speed = radialSpeed \* particle\.speed/);
  assert.doesNotMatch(visualSource, /const speed = radius \/ Math\.max/);
  assert.match(appSource, /phaseDuration = String\(Math\.max\(0\.5, phase\.duration\)\)/);
});

test('animated sphere observes hidden tabs and reduced-motion preferences', () => {
  assert.match(visualSource, /prefers-reduced-motion: reduce/);
  assert.match(visualSource, /document\.hidden/);
  assert.match(visualSource, /cancelAnimationFrame\(raf\)/);
  assert.match(visualSource, /observer\?\.disconnect\(\)/);
});

test('practice page includes both ambient and in-session particle canvas with accessible fallback instructions', () => {
  assert.match(appSource, /class="breath-particle-canvas hero-breath-canvas" data-breath-canvas data-phase="ambient"/);
  assert.match(appSource, /id="practice-particle-canvas" class="breath-particle-canvas practice-particle-canvas"/);
  assert.match(appSource, /Дыши без усилия\. Задержки необязательны/);
  assert.match(appSource, /NHS — дыхательные упражнения при стрессе/);
});

test('sphere CSS includes phase states and respects reduced motion', () => {
  assert.match(styleSource, /active-breath-orb\[data-phase="inhale"\]/);
  assert.match(styleSource, /active-breath-orb\[data-phase="exhale"\]/);
  assert.match(styleSource, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styleSource, /practice-modal-v2/);
});

test('canvas sphere mounts, updates both breathing phases and cleans up browser resources', () => {
  const original = {
    window: globalThis.window,
    document: globalThis.document,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
    ResizeObserver: globalThis.ResizeObserver,
  };
  const rafs = new Map();
  let nextRaf = 1;
  let strokeCount = 0;
  let gradientCount = 0;
  const gradient = { addColorStop() {} };
  const noop = () => {};
  const ctx = {
    clearRect: noop, setTransform: noop, createRadialGradient() { gradientCount += 1; return gradient; }, fillRect: noop,
    save: noop, translate: noop, restore: noop, beginPath: noop, ellipse: noop,
    stroke() { strokeCount += 1; }, arc: noop, moveTo: noop, lineTo: noop,
    quadraticCurveTo: noop, fill: noop,
  };
  const canvas = {
    dataset: { phase: 'ambient' }, clientWidth: 280, clientHeight: 280, width: 0, height: 0,
    getBoundingClientRect: () => ({ width: 280, height: 280 }),
    getContext: () => ctx,
  };
  globalThis.window = {
    devicePixelRatio: 1,
    matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }),
    addEventListener: noop, removeEventListener: noop,
  };
  globalThis.document = { hidden: false, addEventListener: noop, removeEventListener: noop };
  globalThis.requestAnimationFrame = callback => { const id = nextRaf++; rafs.set(id, callback); return id; };
  globalThis.cancelAnimationFrame = id => rafs.delete(id);
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  let visual;
  try {
    visual = createBreathVisual(canvas, { ambient: true });
    const gradientsAfterInitialResize = gradientCount;
    assert.equal(gradientsAfterInitialResize, 8, 'four outer and four core phase gradients are cached on resize');
    visual.setPhase('inhale', 4);
    const firstId = [...rafs.keys()].at(-1);
    const first = rafs.get(firstId); rafs.delete(firstId); first(1000);
    const secondId = [...rafs.keys()].at(-1);
    const second = rafs.get(secondId); rafs.delete(secondId); second(1033);
    visual.setPhase('exhale', 5);
    const thirdId = [...rafs.keys()].at(-1);
    const third = rafs.get(thirdId); rafs.delete(thirdId); third(1066);
    assert.ok(strokeCount > 15, 'renderer draws the orb filaments and particle trails');
    assert.equal(canvas.dataset.phase, 'exhale');
    assert.equal(gradientCount, gradientsAfterInitialResize, 'phase transitions and animation frames do not allocate gradients');
  } finally {
    visual?.destroy();
    globalThis.window = original.window;
    globalThis.document = original.document;
    globalThis.requestAnimationFrame = original.requestAnimationFrame;
    globalThis.cancelAnimationFrame = original.cancelAnimationFrame;
    globalThis.ResizeObserver = original.ResizeObserver;
  }
});


test('particle colors transition smoothly over time and respond to breathing phase', () => {
  const first = getParticleColor(0, 0, 'inhale');
  const later = getParticleColor(13, 0, 'inhale');
  const exhale = getParticleColor(0, 0, 'exhale');
  assert.match(first, /^\d{1,3},\d{1,3},\d{1,3}$/);
  assert.notEqual(first, later, 'the palette changes during a session');
  assert.notEqual(first, exhale, 'phase adds a subtle hue offset');
  for (const color of [first, later, exhale]) {
    assert.ok(color.split(',').map(Number).every(channel => channel >= 0 && channel <= 255));
  }
});

test('session sphere uses compositor-friendly transform layers instead of repainting gradient backgrounds', () => {
  assert.match(styleSource, /background-position: center, center, center/);
  assert.match(styleSource, /is-session-running \.active-breath-orb\s*\{[\s\S]*animation:\s*none/);
  assert.doesNotMatch(styleSource, /@keyframes orb-spectrum-flow/);
  assert.match(styleSource, /is-session-running \.active-breath-orb::after[\s\S]*animation:\s*orb-spectrum-turn/);
  assert.match(styleSource, /@keyframes orb-spectrum-turn/);
  assert.match(styleSource, /is-session-paused \.active-breath-orb[\s\S]*animation-play-state:\s*paused/);
  assert.match(styleSource, /prefers-reduced-motion: reduce[\s\S]*active-breath-orb \{ background-position/);
  assert.match(appSource, /function syncPracticeVisualState\(\)/);
  assert.match(appSource, /syncPracticeVisualState\(\);\s*tickPractice\(\)/);
});

test('DOM morph preserves intrinsic canvas bitmap dimensions so re-rendering duration cannot reset it', () => {
  assert.match(appSource, /const isCanvas = current\.nodeName === 'CANVAS'/);
  assert.match(appSource, /new Set\(\['width', 'height'\]\)/);
  assert.match(appSource, /canvasRuntimeAttributes\?\.has\(attr\.name\)/);
  assert.match(appSource, /resets the bitmap to the browser default/);
});

test('fluff greeting and decorative heading sparkle are removed from active screens', () => {
  assert.doesNotMatch(appSource, /Привет, это твой день/);
  assert.doesNotMatch(appSource, /Пусть сегодня будет чуть легче/);
  assert.doesNotMatch(appSource, /heading-spark/);
  assert.doesNotMatch(appSource, /Маленькие шаги складываются/);
});


test('active sphere shifts hue in the Canvas renderer while CSS keeps the visual layer compositor-friendly', () => {
  assert.match(visualSource, /const PHASE_COLOR_OFFSET = \{ inhale: 0, hold: 0\.8, exhale: 1\.65/);
  assert.match(visualSource, /const colorDelta = circularColorDelta/);
  assert.match(styleSource, /practice-modal-v2 \.active-breath-orb \{[\s\S]*filter: none/);
  assert.doesNotMatch(styleSource, /practice-modal-v2\.is-session-running \.active-breath-orb\[data-phase="(?:inhale|exhale|hold)"\] \{[\s\S]*hue-rotate/);
  assert.match(styleSource, /practice-visual-universe::before[\s\S]*background: conic-gradient/);
  assert.match(styleSource, /@keyframes universe-light-pass/);
  assert.match(styleSource, /prefers-reduced-motion: reduce[\s\S]*practice-visual-universe::before[\s\S]*animation: none !important/);
});

test('canvas redraw stays centered after a responsive resize and phase-duration update', () => {
  const original = {
    window: globalThis.window,
    document: globalThis.document,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
    ResizeObserver: globalThis.ResizeObserver,
  };
  const rafs = new Map();
  let nextRaf = 1;
  let resizeCallback;
  let rect = { width: 280, height: 280 };
  const arcCenters = [];
  const gradient = { addColorStop() {} };
  const noop = () => {};
  const ctx = {
    clearRect: noop, setTransform: noop, createRadialGradient: () => gradient, fillRect: noop,
    save: noop, translate: noop, restore: noop, beginPath: noop, ellipse: noop,
    stroke: noop, arc(x, y) { arcCenters.push([x, y]); }, moveTo: noop, lineTo: noop,
    quadraticCurveTo: noop, fill: noop,
  };
  const canvas = {
    dataset: { phase: 'rest' }, clientWidth: 280, clientHeight: 280, width: 0, height: 0,
    getBoundingClientRect: () => rect,
    getContext: () => ctx,
  };
  globalThis.window = {
    devicePixelRatio: 1.5,
    matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }),
    addEventListener: noop, removeEventListener: noop,
  };
  globalThis.document = { hidden: false, addEventListener: noop, removeEventListener: noop };
  globalThis.requestAnimationFrame = callback => { const id = nextRaf++; rafs.set(id, callback); return id; };
  globalThis.cancelAnimationFrame = id => rafs.delete(id);
  globalThis.ResizeObserver = class { constructor(callback) { resizeCallback = callback; } observe() {} disconnect() {} };
  let visual;
  try {
    visual = createBreathVisual(canvas);
    assert.equal(canvas.width, 420);
    assert.equal(canvas.height, 420);
    const beforeResize = arcCenters.length;
    rect = { width: 240, height: 300 };
    resizeCallback();
    assert.equal(canvas.width, 360);
    assert.equal(canvas.height, 450);
    assert.deepEqual(arcCenters[beforeResize], [120, 150], 'the first ring after resize remains centred in the new canvas bounds');
    visual.setPhase('inhale', 10);
    assert.equal(canvas.width, 360, 'changing phase duration must not reset the canvas bitmap');
    assert.equal(canvas.height, 450, 'changing phase duration must not reset the canvas bitmap');
  } finally {
    visual?.destroy();
    globalThis.window = original.window;
    globalThis.document = original.document;
    globalThis.requestAnimationFrame = original.requestAnimationFrame;
    globalThis.cancelAnimationFrame = original.cancelAnimationFrame;
    globalThis.ResizeObserver = original.ResizeObserver;
  }
});

test('phase tint interpolates instead of snapping and particle trails fade through edge recycling', () => {
  assert.match(visualSource, /const colorDelta = circularColorDelta\(phaseColorShift, phaseColorTargetShift\)/);
  assert.match(visualSource, /1 - Math\.exp\(-dt \* 1\.35\)/);
  assert.match(visualSource, /particle\.respawnFade = Math\.max\(0, particle\.respawnFade - dt \* 2\.6\)/);
  assert.match(visualSource, /motion === 'inhale' && particle\.radius <= INNER_RADIUS \+ 0\.002/);
  assert.match(visualSource, /motion === 'exhale' && particle\.radius >= OUTER_RADIUS - 0\.002/);
  assert.match(visualSource, /edgeFade \* \(1 - particle\.respawnFade\)/);
});

test('particle sphere can pause and resume without resetting particle state', () => {
  assert.match(visualSource, /manuallyPaused = false/);
  assert.match(visualSource, /pause\(\) \{\s*manuallyPaused = true/);
  assert.match(visualSource, /resume\(\) \{\s*manuallyPaused = false/);
  assert.match(visualSource, /destroyed \|\| document\.hidden \|\| reducedMotion\(\) \|\| manuallyPaused/);
  assert.match(appSource, /breathVisualInstances\.get\(\$\('#practice-particle-canvas'\)\)\?\.pause\(\)/);
  assert.match(appSource, /breathVisualInstances\.get\(\$\('#practice-particle-canvas'\)\)\?\.resume\(\)/);
});

test('duration selection is collapsed and disabled as soon as a practice starts, without replacing the visualizer', () => {
  assert.match(appSource, /<div class="practice-duration-slot"><label class="practice-duration-field" aria-hidden="\$\{started\}"/);
  assert.match(appSource, /durationSelect\.disabled = started/);
  assert.match(styleSource, /practice-modal-v2\.is-session-running \.practice-duration-field,[\s\S]*max-height: 0/);
  assert.match(styleSource, /practice-modal-v2\.is-session-paused \.practice-duration-field/);
  assert.match(styleSource, /practice-modal-v2\.is-session-running \.practice-session-meta,[\s\S]*max-height: 48px/);
  assert.match(styleSource, /practice-modal-v2\.is-session-running \.practice-stage-v2,[\s\S]*height: clamp\(290px, 40dvh, 350px\)/);
});

test('liquid light layers drift independently and freeze during pause', () => {
  assert.match(appSource, /class="orb-liquid-cloud cloud-a"/);
  assert.match(appSource, /class="orb-liquid-cloud cloud-b"/);
  assert.match(styleSource, /@keyframes orb-cloud-wander-a/);
  assert.match(styleSource, /@keyframes orb-cloud-wander-b/);
  assert.match(styleSource, /is-session-paused \.active-breath-orb \.orb-liquid-cloud[\s\S]*animation-play-state: paused/);
});


test('rest and hold particles orbit around a stable radius anchor instead of accumulating drift', () => {
  assert.match(visualSource, /idleAnchorRadius: radius/);
  assert.match(visualSource, /particle\.idleAnchorRadius = particle\.radius/);
  assert.match(visualSource, /particle\.radius = particle\.idleAnchorRadius[\s\S]*Math\.sin\(elapsed/);
  assert.doesNotMatch(visualSource, /particle\.radius \+= \(turbulence \* 0\.0025/);
});


test('ambient particle canvases pause behind any overlay to prioritize the active practice', () => {
  assert.match(appSource, /if \(canvas\.dataset\.phase === 'ambient'\)[\s\S]*if \(overlay\) instance\.pause\(\);[\s\S]*else instance\.resume\(\)/);
  assert.match(styleSource, /practice-modal-v2\.is-session-paused \.practice-halo \{ animation-play-state: paused !important/);
});


test('particle renderer targets 60fps and caches particle glow rather than shadow-blurring every mote', () => {
  assert.match(visualSource, /const FRAME_INTERVAL = 1000 \/ 60/);
  assert.match(visualSource, /timestamp - lastFrame < FRAME_INTERVAL/);
  assert.match(visualSource, /const glowSprites = \[\]/);
  assert.match(visualSource, /ctx\.drawImage\(glowSprite/);
  assert.match(visualSource, /const count = Math\.min\(132, Math\.max\(64/);
  assert.doesNotMatch(visualSource, /timestamp - lastFrame < 30/);
});


test('particle rendering caches phase gradients and avoids per-path shadow blur in the frame loop', () => {
  assert.match(visualSource, /function rebuildGradients\(\)/);
  assert.match(visualSource, /rebuildGradients\(\);[\s\S]*draw\(0, true\)/);
  assert.match(visualSource, /const glow = outerGlowGradients\[gradientKey\]/);
  assert.match(visualSource, /const coreGlow = coreGlowGradients\[gradientKey\]/);
  assert.equal((visualSource.match(/createRadialGradient\(/g) || []).length, 3, 'only the six sprites and cached phase gradients create gradients');
  assert.match(visualSource, /dpr = Math\.min\(1\.5, window\.devicePixelRatio \|\| 1\)/);
  assert.doesNotMatch(visualSource, /ctx\.shadowBlur = staticFrame \? 0 : 7/);
});

test('advice filters expose all article categories while health-only content stays in Health', () => {
  assert.match(appSource, /const allowedCategories = \['all', \.\.\.TIP_CATEGORIES\.map\(category => category\.id\)/);
  assert.match(appSource, /if \(HEALTH_TIP_IDS\.has\(tip\.id\)\) return false/);
});


test('profile data remains local and settings provide an explicit back path with reset kept last', () => {
  const start = appSource.indexOf('function renderProfile()');
  const end = appSource.indexOf('function renderProfileSettings()', start);
  const profile = appSource.slice(start, end);
  assert.match(profile, /data-field="profile\.displayName"/);
  assert.match(profile, /data-field="profile\.personalReason"/);
  assert.match(profile, /Профиль хранится на этом устройстве/);
  assert.match(profile, /data-action="open-profile-settings"/);
  assert.match(appSource, /data-action="back-profile-settings"/);
  assert.match(appSource, /data-action="reset-data"/);
});

test('all visible advice categories can be selected in the advice filter', () => {
  const start = appSource.indexOf('function renderTips()');
  const end = appSource.indexOf('function renderHealth()', start);
  const tipsRenderer = appSource.slice(start, end);
  assert.match(tipsRenderer, /TIP_CATEGORIES\.map\(category => category\.id\)/);
  assert.match(tipsRenderer, /TIP_CATEGORIES\.filter\(category => allowedCategories\.includes\(category\.id\)\)/);
  assert.match(tipsRenderer, /if \(HEALTH_TIP_IDS\.has\(tip\.id\)\) return false/);
});
