import test from 'node:test';
import assert from 'node:assert/strict';
import { PRACTICES, TIPS, TIP_CATEGORIES, TIP_LEVELS, TIP_SITUATIONS } from '../src/content.js';

test('breathing library has several distinct, comfort-first modes', () => {
  assert.ok(PRACTICES.length >= 5);
  assert.equal(new Set(PRACTICES.map(item => item.id)).size, PRACTICES.length);
  for (const practice of PRACTICES) {
    assert.ok(practice.duration >= 60 && practice.duration <= 600, `${practice.id} has an expected duration`);
    assert.ok(practice.name && practice.description && practice.guidance);
    assert.match(practice.guidance, /комфорт|естествен|останов|не нужно|счёт|счёт|замечай|вдыхай/i);
    assert.ok(Number(practice.inhale) > 0 && Number(practice.exhale) > 0);
  }
  assert.ok(PRACTICES.some(item => item.hold > 0), 'there is an optional structured/box mode');
  assert.ok(PRACTICES.some(item => item.hold === 0 && item.pause === 0), 'there are no-hold modes');
});

test('all help library entries have unique IDs, valid categories and traceable official sources', () => {
  const categoryIds = new Set(TIP_CATEGORIES.map(item => item.id));
  const levelIds = new Set(TIP_LEVELS.map(item => item.id));
  const situationIds = new Set(TIP_SITUATIONS.map(item => item.id));
  assert.ok(TIPS.length >= 12);
  assert.equal(new Set(TIPS.map(item => item.id)).size, TIPS.length);
  for (const tip of TIPS) {
    assert.ok(categoryIds.has(tip.category), `${tip.id} has a category`);
    assert.ok(levelIds.has(tip.level), `${tip.id} has a reading level`);
    assert.ok(tip.situations.length > 0 && tip.situations.every(id => situationIds.has(id)), `${tip.id} has valid situations`);
    assert.ok(tip.title && tip.summary && tip.body && tip.steps?.length, `${tip.id} has useful content`);
    assert.match(tip.sourceUrl, /^https:\/\//, `${tip.id} has an HTTPS source`);
    assert.ok(tip.sourceTitle && tip.sourceDate, `${tip.id} names its source and date`);
  }
});

test('vaping-specific advice links to WHO vaping information and does not prescribe medicine', () => {
  const tip = TIPS.find(item => item.id === 'vaping-support');
  assert.ok(tip);
  assert.match(tip.sourceUrl, /who\.int\/news-room\/questions-and-answers\/item\/how-to-quit-e-cigarettes/);
  assert.match(tip.body, /специалист/);
  assert.match(tip.body, /Не меняй лекарства/);
});

test('breathing material explicitly states it is not nicotine-dependence treatment', () => {
  const tip = TIPS.find(item => item.id === 'breathing');
  assert.ok(tip);
  assert.match(tip.body, /не доказанное самостоятельное лечение никотиновой зависимости/);
  assert.match(tip.sourceUrl, /nhs\.uk\/mental-health\/self-help\/guides-tools-and-activities\/breathing-exercises-for-stress/);
});


test('help library includes WHO 2026 step-by-step guide for tobacco and nicotine products', () => {
  const tip = TIPS.find(item => item.id === 'who-quit-today');
  assert.ok(tip);
  assert.match(tip.sourceUrl, /who\.int\/campaigns\/world-no-tobacco-day\/2026\/quit-today/);
  assert.match(tip.body, /электронные сигареты/);
  assert.match(tip.body, /не индивидуальное назначение/);
  assert.match(tip.steps.join(' '), /триггер/i);
});
