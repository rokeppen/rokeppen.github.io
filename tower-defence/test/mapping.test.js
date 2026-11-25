import test from 'node:test';
import assert from 'node:assert/strict';
import {
  weaponFromRow, weaponToRow, enemyFromRow, enemyToRow, levelFromRow, levelToRow,
} from '../shared/mapping.js';

const weapon = {
  id: 'wine-tasting', name: 'Wine Tasting', description: 'Distracts', sprite: 'wine',
  cost: 50, range: 2.5, damage: 0, fireRate: 1,
  effect: 'distract', effectStrength: 0.5, effectDuration: 3,
  upgrades: [{ cost: 40, range: 3, effectStrength: 0.7 }], fallbackSprite: '🍷',
};
const enemy = {
  id: 'recruiter', name: 'Recruiter', description: 'Pesky', sprite: 'rec',
  hp: 30, speed: 1.2, reward: 10, wineDamage: 1,
  quotes: ['Got a minute?', "It's a great opportunity"], immuneTo: ['distract'], fallbackSprite: '🕴️',
};
const level = {
  id: 'level-1', name: 'One', sortOrder: 1, published: true, cols: 10, rows: 6,
  start: { x: 0, y: 0 }, end: { x: 2, y: 0 },
  path: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }],
  blocked: [{ x: 1, y: 1 }], weaponIds: ['wine-tasting'],
  startingCorks: 100, startingWine: 5,
  waves: [[{ enemyId: 'recruiter', count: 3, intervalS: 1, delayS: 0 }]],
  enemyIds: ['recruiter'], barSprite: 'https://example.test/bar.png',
};

test('weapon round-trips through row form', () => {
  assert.deepEqual(weaponFromRow(weaponToRow(weapon)), weapon);
  assert.equal(weaponToRow(weapon).fire_rate, weapon.fireRate);
});

test('enemy round-trips through row form', () => {
  assert.deepEqual(enemyFromRow(enemyToRow(enemy)), enemy);
  assert.equal(enemyToRow(enemy).wine_damage, enemy.wineDamage);
});

test('level round-trips through row form', () => {
  assert.deepEqual(levelFromRow(levelToRow(level)), level);
  assert.equal(levelToRow(level).starting_corks, level.startingCorks);
  assert.equal(levelToRow(level).starting_wine, level.startingWine);
  assert.equal(levelToRow(level).sort_order, level.sortOrder);
});

test('FromRow defaults missing arrays to []', () => {
  assert.deepEqual(weaponFromRow({ id: 'w' }).upgrades, []);
  const l = levelFromRow({ id: 'l' });
  assert.deepEqual([l.path, l.blocked, l.weaponIds, l.waves], [[], [], [], []]);
});

test('new columns map to snake_case', () => {
  assert.equal(weaponToRow(weapon).fallback_sprite, '🍷');
  const er = enemyToRow(enemy);
  assert.deepEqual(er.quotes, enemy.quotes);
  assert.deepEqual(er.immune_to, ['distract']);
  assert.equal(er.fallback_sprite, '🕴️');
  const lr = levelToRow(level);
  assert.deepEqual(lr.enemy_ids, ['recruiter']);
  assert.equal(lr.bar_sprite, 'https://example.test/bar.png');
});

test('legacy rows without the new columns get defaults', () => {
  const e = enemyFromRow({ id: 'e', sprite: '🍷', hp: 1 });
  assert.deepEqual(e.quotes, []);
  assert.deepEqual(e.immuneTo, []);
  assert.equal(e.fallbackSprite, '🍷');
  assert.equal(weaponFromRow({ id: 'w', sprite: '🧀' }).fallbackSprite, '🧀');
  const l = levelFromRow({ id: 'l' });
  assert.equal(l.enemyIds, null);
  assert.equal(l.barSprite, '🍻');
});

test('a URL sprite without fallback gets the default emoji', () => {
  assert.equal(enemyFromRow({ id: 'e', sprite: 'https://x.test/a.png' }).fallbackSprite, '👤');
  assert.equal(weaponFromRow({ id: 'w', sprite: 'http://x.test/a.png' }).fallbackSprite, '❔');
  assert.equal(enemyFromRow({ id: 'e', sprite: 'https://x.test/a.png', fallback_sprite: '🐸' }).fallbackSprite, '🐸');
});

test('ToRow fills defaults for app objects missing the new fields', () => {
  const w = weaponToRow({ id: 'w', sprite: 'https://x.test/a.png' });
  assert.equal(w.fallback_sprite, '❔');
  const e = enemyToRow({ id: 'e', sprite: '🍷' });
  assert.deepEqual([e.quotes, e.immune_to, e.fallback_sprite], [[], [], '🍷']);
  const l = levelToRow({ id: 'l' });
  assert.equal(l.enemy_ids, null);
  assert.equal(l.bar_sprite, '🍻');
});
