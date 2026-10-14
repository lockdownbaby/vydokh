import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = file => readFile(new URL(`../${file}`, import.meta.url));
const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const sw = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
const manifest = JSON.parse(await readFile(new URL('../manifest.webmanifest', import.meta.url), 'utf8'));

function pngDimensions(buffer) {
  assert.equal(buffer.toString('ascii', 1, 4), 'PNG');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

test('wave logo mark is a vector asset with outer ring and three wave strokes', async () => {
  const svg = (await read('brand-mark.svg')).toString('utf8');
  assert.match(svg, /<svg[^>]+viewBox="0 0 100 100"/);
  assert.match(svg, /linearGradient id="wave"/);
  assert.equal((svg.match(/<path d=/g) || []).length, 5);
  assert.match(svg, /M15\.8 47\.5/);
  assert.match(svg, /M23\.5 64\.8/);
});

test('active UI uses the selected wave logo in header, onboarding and about card', () => {
  assert.match(app, /class="brand-symbol"><img src="\.\/brand-mark\.svg"/);
  assert.match(app, /class="onboarding-logo"><img src="\.\/brand-mark\.svg"/);
  assert.match(app, /class="about-mark"><img src="\.\/brand-mark\.svg"/);
  assert.match(app, /<span class="brand-word">ВЫДОХ<\/span>/);
  assert.match(app, /<h2>ВЫДОХ <span>v2\.0\.1<\/span><\/h2><p>Сила в твоём дыхании<\/p>/);
});

test('app icon assets use correct dimensions for install surfaces', async () => {
  for (const [file, size] of [['icon-180.png', 180], ['icon-192.png', 192], ['icon-512.png', 512], ['icon-maskable-512.png', 512]]) {
    const dimensions = pngDimensions(await read(file));
    assert.deepEqual(dimensions, { width: size, height: size }, `${file} dimensions`);
  }
});

test('manifest points to all branded app icon sizes and preserves PWA scope', () => {
  assert.equal(manifest.short_name, 'Выдох');
  assert.match(manifest.name, /сила в твоём дыхании/i);
  assert.equal(manifest.scope, './');
  assert.equal(manifest.start_url, './');
  for (const file of ['icon-180.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png']) {
    assert.ok(manifest.icons.some(icon => icon.src === file), `${file} is in the manifest`);
  }
});

test('favicon and branding SVGs are included in the active service worker cache', () => {
  assert.match(html, /rel="icon" href="\.\/favicon\.svg"/);
  assert.match(html, /apple-touch-icon" href="\.\/icon-180\.png"/);
  assert.match(sw, /vydokh-redesign-2\.0\.1/);
  for (const asset of ['./brand-mark.svg', './brand-app-icon.svg', './brand-lockup.svg']) assert.ok(sw.includes(asset), `${asset} cached`);
});

test('brand styling has one consistent mark surface without legacy CSS wave pseudo-elements', () => {
  assert.match(styles, /\.brand-symbol img\s*\{[^}]*object-fit: contain/s);
  assert.match(styles, /\.about-mark img\s*\{[^}]*object-fit: contain/s);
  assert.match(styles, /\.onboarding-logo img\s*\{[^}]*object-fit: contain/s);
  assert.match(styles, /\.brand-symbol::before, \.brand-symbol::after \{ display: none/);
});
