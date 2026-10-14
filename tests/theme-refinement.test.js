import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const sw = await readFile(new URL('../sw.js', import.meta.url), 'utf8');

function luminance(hex) {
  const rgb = hex.replace('#', '').match(/.{2}/g).map(value => parseInt(value, 16) / 255);
  const linear = rgb.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}
function contrast(a, b) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test('dark theme refinement uses a distinct wave-brand palette and four surface levels', () => {
  assert.match(styles, /--ivory:\s*#071714/i);
  assert.match(styles, /--paper:\s*#0d2722/i);
  assert.match(styles, /--white:\s*#14342d/i);
  assert.match(styles, /--surface-outline:\s*rgba\(106, 197, 177, \.28\)/i);
  assert.match(styles, /background:\s*linear-gradient\(145deg, #102b25 0%, #0d241f 58%, #0b211d 100%\)/i);
  assert.match(styles, /background:\s*linear-gradient\(145deg, #14342d, #102b26\)/i);
});

test('cards have visible borders and elevation distinct from the page and nested panels', () => {
  assert.match(styles, /html\[data-theme="dark"\] :is\([\s\S]*\.panel-card[\s\S]*\.practice-card[\s\S]*\)\s*\{[\s\S]*border:\s*1px solid #2a554b/i);
  assert.match(styles, /box-shadow:\s*0 12px 30px rgba\(0, 0, 0, \.23\), inset 0 1px 0 rgba\(218, 255, 242, \.045\)/i);
  assert.match(styles, /\.profile-settings-link:hover\s*\{[\s\S]*border-color:\s*#5aa58d/i);
});

test('modals use an elevated dark surface, a clearer border and a strong dimmed backdrop', () => {
  assert.match(styles, /html\[data-theme="dark"\] \.modal-backdrop\s*\{[\s\S]*background:\s*rgba\(1, 10, 9, \.82\)/i);
  assert.match(styles, /html\[data-theme="dark"\] \.modal,[\s\S]*\.practice-modal-v2[\s\S]*\{[\s\S]*border:\s*1px solid #397365/i);
  assert.match(styles, /box-shadow:\s*0 28px 90px rgba\(0,0,0,\.56\), inset 0 1px 0 rgba\(218,255,243,\.075\)/i);
});

test('legacy light cards, tips, forms and practice surfaces have explicit dark variants', () => {
  for (const selector of [
    '.reason-card', '.weekly-review-teaser', '.analytics-insights-grid > section',
    '.slip-support-card', '.practice-duration-field select', '.home-profile-link',
    '.health-article-mark', '.practice-result-modal .rating-choice', '.tips-filter-dropdowns select'
  ]) assert.ok(styles.includes(`html[data-theme="dark"] ${selector}`), `missing dark-theme rule for ${selector}`);
});

test('active practice uses mint-cyan rather than the old acidic lime sphere palette', () => {
  assert.match(styles, /html\[data-theme="dark"\] \.practice-modal-v2 \.active-breath-orb\s*\{[\s\S]*#baf8e8[\s\S]*#38bba9/i);
  assert.match(styles, /html\[data-theme="dark"\] \.practice-modal-v2 \.active-breath-orb\[data-phase="inhale"\]/i);
  assert.match(styles, /html\[data-theme="dark"\] \.practice-modal-v2 \.active-breath-orb\[data-phase="exhale"\]/i);
});

test('initial and runtime browser chrome colors stay synchronized with the refined dark surface', () => {
  assert.match(index, /startupTheme === 'dark' \? '#071714' : '#f4f6f0'/);
  assert.match(app, /resolved === 'dark' \? '#071714' : '#f4f6f0'/);
  assert.match(sw, /vydokh-redesign-2\.0\.1/);
});

test('chosen text, secondary text and wave accents meet WCAG AA contrast against intended surfaces', () => {
  assert.ok(contrast('#eaf8f3', '#071714') >= 7, 'primary text / page background');
  assert.ok(contrast('#a6c4ba', '#102b25') >= 4.5, 'secondary text / card background');
  assert.ok(contrast('#86e5d2', '#071714') >= 4.5, 'wave accent / page background');
  assert.ok(contrast('#b6f5e5', '#05211c') >= 4.5, 'primary button / button label');
});
