import test from 'node:test';
import assert from 'node:assert/strict';
import { PRACTICES, PRACTICE_CATEGORIES, TIPS, HOME_TIPS, TIP_CATEGORIES, TIP_LEVELS, TIP_SITUATIONS } from '../src/content.js';

test('breathing library has several distinct, comfort-first modes', () => {
  assert.equal(PRACTICES.length, 10, 'the practice library contains ten distinct methods');
  assert.deepEqual(PRACTICE_CATEGORIES.map(item => item.id), ['all', 'craving', 'calm', 'focus', 'structured']);
  assert.equal(new Set(PRACTICES.map(item => item.id)).size, PRACTICES.length);
  for (const practice of PRACTICES) {
    assert.ok(practice.duration >= 60 && practice.duration <= 600, `${practice.id} has an expected duration`);
    assert.ok(practice.name && practice.description && practice.guidance);
    assert.ok(practice.sourceTitle && /^https:\/\//.test(practice.sourceUrl), `${practice.id} names a traceable source`);
    assert.ok(practice.sourceNote && practice.mode && practice.tag, `${practice.id} explains intent and adaptation`);
    assert.ok(PRACTICE_CATEGORIES.some(item => item.id === practice.category), `${practice.id} has a category`);
    assert.match(practice.guidance, /комфорт|естествен|останов|не нужно|счёт|счёт|замечай|вдыхай/i);
    assert.ok(Number(practice.inhale) > 0 && Number(practice.exhale) > 0);
  }
  assert.ok(PRACTICES.some(item => item.hold > 0), 'there is an optional structured/box mode');
  assert.ok(PRACTICES.some(item => item.hold === 0 && item.pause === 0), 'there are no-hold modes');
});


test('all ten practices use reputable sources and frame breathing as supportive rather than nicotine treatment', () => {
  const trustedDomains = ['nhs.uk', 'veteranshealthlibrary.va.gov', 'health.clevelandclinic.org', 'smokefree.gov'];
  assert.equal(PRACTICES.length, 10);
  for (const practice of PRACTICES) {
    assert.ok(trustedDomains.some(domain => new URL(practice.sourceUrl).hostname === domain || new URL(practice.sourceUrl).hostname.endsWith(`.${domain}`)), `${practice.id} links to a listed source`);
    assert.match(practice.sourceNote, /ориентир|адаптац|вспомогатель|не заяв|не является|не заменя|не гарантия|не индивидуальн/i, `${practice.id} explains limits of the method`);
  }
  assert.ok(PRACTICES.some(item => item.id === 'craving-breath' && item.sourceUrl.includes('quit-vaping-resources/dealing-with-vape-cravings')));
  assert.ok(PRACTICES.some(item => item.id === 'diaphragmatic' && new URL(item.sourceUrl).hostname.includes('veteranshealthlibrary.va.gov')));
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


test('homepage advice rotation has exactly 50 distinct, non-empty local tips', () => {
  assert.equal(HOME_TIPS.length, 50);
  assert.equal(new Set(HOME_TIPS.map(item => item.id)).size, 50);
  for (const tip of HOME_TIPS) {
    assert.ok(/^home-\d{2}$/.test(tip.id), `${tip.id} has a stable local id`);
    assert.ok(tip.category && tip.text && tip.text.length >= 40, `${tip.id} has category and useful text`);
  }
});


test('advice page has at least 30 visible long-form tips plus the 50 rotating homepage prompts', () => {
  const healthOnlyIds = new Set(['professional', 'support-network', 'withdrawal', 'breathing', 'treatment', 'who-quit-today', 'vaping-support']);
  const visible = TIPS.filter(tip => !healthOnlyIds.has(tip.id));
  assert.equal(visible.length, 34);
  assert.ok(HOME_TIPS.length >= 30);
  assert.equal(new Set(TIPS.map(tip => tip.id)).size, TIPS.length);
  assert.ok(visible.every(tip => tip.title && tip.summary && tip.body && tip.steps.length > 0));
});
