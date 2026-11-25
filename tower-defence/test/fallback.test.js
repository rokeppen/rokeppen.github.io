import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateLevel, prepareGameData } from '../shared/model.js';
import { validateWeapon, validateEnemy } from '../admin/catalog-validate.js';

const raw = JSON.parse(readFileSync(new URL('../fallback-data.json', import.meta.url), 'utf8'));
const catalog = { weapons: raw.weapons, enemies: raw.enemies };

test('fallback data yields two valid levels with zero errors', () => {
  const data = prepareGameData(raw);
  assert.equal(data.levels.length, 2);
  for (const l of raw.levels) {
    const { errors } = validateLevel(l, catalog);
    assert.deepEqual(errors, [], l.id);
    assert.ok(Array.isArray(l.enemyIds) && l.enemyIds.length > 0, `${l.id} enemyIds`);
    assert.ok(l.barSprite, `${l.id} barSprite`);
  }
});

test('every weapon has 2 upgrades and everything has description and sprite', () => {
  assert.equal(raw.weapons.length, 5);
  assert.equal(raw.enemies.length, 5);
  for (const w of raw.weapons) { assert.equal(w.upgrades.length, 2, w.id); assert.ok(w.description && w.sprite, w.id); }
  for (const e of raw.enemies) assert.ok(e.description && e.sprite, e.id);
});

test('cafe and wine-snob exist, wine-tasting does not', () => {
  const w = (id) => raw.weapons.find(x => x.id === id);
  assert.ok(w('cafe'));
  assert.equal(w('cafe').effect, 'distract');
  assert.equal(w('wine-tasting'), undefined);
  const snob = raw.enemies.find(e => e.id === 'wine-snob');
  assert.ok(snob);
  assert.deepEqual(snob.immuneTo, ['distract']);
  assert.ok(snob.quotes.includes("This beer party isn't fun."));
  assert.ok(snob.quotes.includes('Is there no Pinot?'));
});

test('level-2 uses cafe and wine-snob', () => {
  const l2 = raw.levels.find(l => l.id === 'level-2');
  assert.ok(l2.weaponIds.includes('cafe'));
  assert.ok(!l2.weaponIds.includes('wine-tasting'));
  assert.ok(l2.enemyIds.includes('wine-snob'));
  for (const wave of l2.waves.slice(-3)) assert.ok(wave.some(g => g.enemyId === 'wine-snob'));
});

test('every enemy has at least 2 quotes', () => {
  for (const e of raw.enemies) assert.ok(Array.isArray(e.quotes) && e.quotes.length >= 2, e.id);
});

test('every weapon and enemy passes catalog validation', () => {
  for (const w of raw.weapons) assert.deepEqual(validateWeapon(w), [], w.id);
  for (const e of raw.enemies) assert.deepEqual(validateEnemy(e), [], e.id);
});

test('splash weapons carry no effect duration (it would be ignored)', () => {
  for (const w of raw.weapons.filter(x => x.effect === 'splash')) assert.equal(w.effectDuration, 0, w.id);
});

test('distract and lure towers never keep a permanent stall (fireRate x duration < 1)', () => {
  for (const w of raw.weapons.filter(x => x.effect === 'distract' || x.effect === 'lure')) {
    let fr = w.fireRate;
    assert.ok(fr * w.effectDuration < 1, `${w.id} base`);
    w.upgrades.forEach((u, i) => {
      if (u.fireRate !== undefined) fr = u.fireRate;
      assert.ok(fr * w.effectDuration < 1, `${w.id} tier ${i + 1}`);
    });
  }
});

test('no player-facing string mentions wine tables, corks or Wine Tasting', () => {
  const bad = /wine table|cork|wine tasting/i;
  const strings = [];
  for (const w of raw.weapons) strings.push(w.name, w.description);
  for (const e of raw.enemies) {
    if (e.id === 'wine-snob') continue;
    strings.push(e.name, e.description, ...(e.quotes ?? []));
  }
  for (const l of raw.levels) strings.push(l.name);
  for (const s of strings) assert.ok(!bad.test(s), s);
});
