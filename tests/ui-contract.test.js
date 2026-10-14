import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

 test('app shell is mounted once and subsequent screen updates reconcile existing DOM', () => {
  assert.equal((app.match(/root\.innerHTML\s*=/g) || []).length, 1, 'the application shell must only be mounted in renderShell');
  assert.match(app, /morphChildren\(main, htmlFragment\(content\)\)/, 'screen updates should reuse existing nodes');
  assert.match(app, /function morphNode\(/);
  assert.match(styles, /\.main-content\.quiet-update[\s\S]*animation:\s*none\s*!important/);
});

test('navigation changes and repeated active-tab taps scroll to the page top', () => {
  assert.match(app, /function scrollPageToTop\(\)/);
  assert.match(app, /if \(screenChanged\)[\s\S]*scrollPageToTop\(\)/);
  assert.match(app, /else \{\s*scrollPageToTop\(\);\s*\}/);
});

test('Health navigation provides a dropdown for Health and Practices', () => {
  assert.match(app, /data-action="toggle-health-menu"/);
  assert.match(app, /data-section="health"/);
  assert.match(app, /data-section="practices"/);
  assert.match(app, /aria-haspopup="menu"/);
  assert.match(app, /healthTrigger\.setAttribute\('aria-expanded', String\(healthMenuOpen\)\)/);
});

test('home journey range switch has Today, Week and Month without temporal-dead-zone redeclaration', () => {
  assert.match(app, /\['today', 'week', 'month'\]/);
  assert.match(app, /const selectedRange = range === 'week' \? 'week' : 'month'/);
  assert.doesNotMatch(app, /const range = range ===/);
});

test('daily mood, triggers and note editor live in Health rather than the calendar day dialog', () => {
  const healthStart = app.indexOf('function renderHealth()');
  const healthEnd = app.indexOf('function renderGuideOverlay(', healthStart);
  const dayStart = app.indexOf('function renderDayOverlay(');
  const dayEnd = app.indexOf('function renderPracticeOverlay(', dayStart);
  const health = app.slice(healthStart, healthEnd);
  const day = app.slice(dayStart, dayEnd);
  assert.match(health, /data-field="health\.date"/);
  assert.match(health, /data-action="toggle-trigger"/);
  assert.match(health, /data-action="set-day-mood"/);
  assert.match(health, /data-field="day\.note"/);
  assert.doesNotMatch(day, /data-action="toggle-trigger"/);
  assert.doesNotMatch(day, /data-action="set-day-mood"/);
  assert.doesNotMatch(day, /data-field="day\.note"/);
});

test('home tips rotate on a 15-second interval without re-rendering the entire app', () => {
  assert.match(app, /homeTipTimer = setInterval\(\(\) => \{[\s\S]*activeTab === 'today'[\s\S]*chooseNextHomeTip\(\);[\s\S]*\}, 15000\)/);
  assert.match(app, /function renderHomeTipOnly\(\)[\s\S]*host\.innerHTML = renderHomeTipMarkup\(\)/);
});

test('Health check-in styling keeps the new section visually distinct and responsive', () => {
  assert.match(styles, /\.health-checkin-card\s*\{/);
  assert.match(styles, /\.health-checkin-date\s*\{/);
  assert.match(styles, /@media \(max-width: 480px\)[\s\S]*\.day-health-teaser/);
});


test('a modal with the same identity is reconciled in place; a different identity replaces the single active overlay', () => {
  assert.match(app, /function renderOverlayOnly\(\)[\s\S]*if \(nextKey !== lastOverlayKey\) host\.innerHTML = markup;\s*else morphChildren\(host, htmlFragment\(markup\)\)/);
  assert.equal((app.match(/let overlay = null/g) || []).length, 1, 'there is one active overlay state rather than a stack');
});

test('closed Health dropdown is removed from keyboard focus', () => {
  assert.match(app, /healthMenu\.inert = !healthMenuOpen/);
  assert.match(app, /healthMenu\.setAttribute\('aria-hidden', String\(!healthMenuOpen\)\)/);
});


test('profile separates personal details from settings, and reset remains at the end of settings', () => {
  assert.match(app, /function renderProfile\(\)[\s\S]*profile\.displayName/);
  assert.match(app, /data-field="profile\.personalReason"/);
  assert.match(app, /data-action="open-profile-settings"/);
  assert.match(app, /function renderProfileSettings\(\)[\s\S]*Настройки/);
  assert.match(app, /data-action="back-profile-settings"/);
  const settingsStart = app.indexOf('function renderProfileSettings()');
  const settingsEnd = app.indexOf('function renderOverlay()', settingsStart);
  const settings = app.slice(settingsStart, settingsEnd);
  assert.ok(settings.lastIndexOf('data-action="reset-data"') > settings.lastIndexOf('data-action="export-data"'));
  assert.ok(settings.includes('v2.0.1'));
});

test('shared cards and panels have stronger outline tokens across the app', () => {
  assert.match(styles, /--surface-outline:/);
  assert.match(styles, /\.health-insight-card/);
  assert.match(styles, /\.profile-hero-card/);
  assert.match(styles, /\.profile-settings-link/);
});


test('theme preference updates state inside the preferences handler and is included in the theme selection', () => {
  assert.match(app, /data-field="preferences\.theme"/);
  assert.match(app, /else if \(key === 'theme'\) state\.preferences\.theme = \['light', 'dark', 'system'\]/);
});
