import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { icon } from '../src/icons.js';

const srcDir = new URL('../src/', import.meta.url);
const iconsSource = await readFile(new URL('../src/icons.js', import.meta.url), 'utf8');
const pathBlock = iconsSource.slice(iconsSource.indexOf('const paths = {'), iconsSource.indexOf('\n};'));
const knownPaths = new Set([...pathBlock.matchAll(/^\s{2}([A-Za-z][A-Za-z0-9]*):/gm)].map(match => match[1]));
const aliasBlock = iconsSource.slice(iconsSource.indexOf('const aliases = {'), iconsSource.indexOf('};', iconsSource.indexOf('const aliases = {')));
const aliases = new Map([...aliasBlock.matchAll(/'([^']+)': '([A-Za-z0-9]+)'/g)].map(match => [match[1], match[2]]));

test('all direct icon references in source resolve to a known icon or alias', async () => {
  const files = (await readdir(srcDir)).filter(file => file.endsWith('.js'));
  const unknown = [];
  for (const file of files) {
    const source = await readFile(new URL(`../src/${file}`, import.meta.url), 'utf8');
    for (const match of source.matchAll(/icon\(['"]([^'"]+)['"]/g)) {
      const name = match[1];
      const resolved = aliases.get(name) || name;
      if (!knownPaths.has(resolved)) unknown.push(`${file}: ${name}`);
    }
  }
  assert.deepEqual(unknown, [], 'unknown names silently fell back to a decorative sparkle before this test');
});

test('user-round resolves to a person glyph and unknown future names do not render decorative sparkles', () => {
  assert.equal(icon('user-round').includes('M20.5 3.5C12'), false);
  assert.match(icon('user-round'), /<circle cx="12" cy="8" r="4"/);
  assert.match(icon('missing-future-icon'), /<circle cx="12" cy="12" r="9"/);
  assert.doesNotMatch(icon('missing-future-icon'), /m12 3 1\.5 5\.5/);
});
