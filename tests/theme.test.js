import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDefaultState, importBundle } from '../src/storage.js';

const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const worker = await readFile(new URL('../sw.js', import.meta.url), 'utf8');

test('theme preference defaults to light and supports dark and system', () => {
  const state = createDefaultState();
  assert.equal(state.preferences.theme, 'light');
  const dark = importBundle({ exportVersion: 1, state: { ...state, preferences: { ...state.preferences, theme: 'dark' } } });
  const system = importBundle({ exportVersion: 1, state: { ...state, preferences: { ...state.preferences, theme: 'system' } } });
  const invalid = importBundle({ exportVersion: 1, state: { ...state, preferences: { ...state.preferences, theme: 'hacker-mode' } } });
  assert.equal(dark.preferences.theme, 'dark');
  assert.equal(system.preferences.theme, 'system');
  assert.equal(invalid.preferences.theme, 'light');
});

test('theme can be changed from profile settings and is applied to document root', () => {
  assert.match(app, /data-field="preferences\.theme"/);
  assert.match(app, /function applyTheme\(\)/);
  assert.match(app, /document\.documentElement\.dataset\.theme = resolved/);
  assert.match(app, /path === 'preferences\.theme'/);
  assert.match(app, /else if \(key === 'theme'\) state\.preferences\.theme = \['light', 'dark', 'system'\]/);
});

test('system theme follows the system appearance preference', () => {
  assert.match(app, /matchMedia\?\.\('\(prefers-color-scheme: dark\)'\)[\s\S]*addEventListener\?\.\('change'/);
  assert.match(app, /preference === 'system' \? \(systemDark \? 'dark' : 'light'\) : preference/);
});

test('dark palette follows the wave brand: deep green-black with mint and cyan accents', () => {
  assert.match(styles, /html\[data-theme="dark"\][\s\S]*--ivory:\s*#071714/i);
  assert.match(styles, /--mint:\s*#a4f0dc/i);
  assert.match(styles, /--lime:\s*#67d9ce/i);
  assert.match(styles, /html\[data-theme="dark"\] \.bottom-nav/);
  assert.match(styles, /html\[data-theme="dark"\] \.modal/);
  assert.match(styles, /html\[data-theme="dark"\] \.form-card/);
});

test('theme color updates in browser and service worker cache is versioned', () => {
  assert.match(index, /name="theme-color"/);
  assert.match(index, /name="color-scheme" content="light dark"/);
  assert.match(index, /savedThemeState = JSON\.parse\(localStorage\.getItem\('vydokh\.v4'/);
  assert.match(app, /const themeColor = resolved === 'dark' \? '#071714' : '#f4f6f0'/);
  assert.match(app, /setAttribute\('content', themeColor\)/);
  assert.match(worker, /vydokh-redesign-2\.0\.1/);
});

test('manifest startup surface matches default light theme while runtime can switch theme-color', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(manifest.background_color, '#f4f6f0');
  assert.equal(manifest.theme_color, '#f4f6f0');
  assert.match(app, /const themeColor = resolved === 'dark' \? '#071714' : '#f4f6f0'/);
});
