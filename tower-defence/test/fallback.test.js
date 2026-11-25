import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateLevel, prepareGameData } from '../shared/model.js';

const raw = JSON.parse(readFileSync(new URL('../fallback-data.json', import.meta.url), 'utf8'));

test('fallback data yields two valid levels', () => {
  const data = prepareGameData(raw);
  assert.equal(data.levels.length, 2);
  for (const l of raw.levels) {
    const { errors } = validateLevel(l, { weapons: raw.weapons, enemies: raw.enemies });
    assert.deepEqual(errors, [], l.id);
  }
});

test('every weapon has 2 upgrades and everything has description and sprite', () => {
  assert.equal(raw.weapons.length, 5);
  assert.equal(raw.enemies.length, 4);
  for (const w of raw.weapons) { assert.equal(w.upgrades.length, 2, w.id); assert.ok(w.description && w.sprite, w.id); }
  for (const e of raw.enemies) assert.ok(e.description && e.sprite, e.id);
});
