import test from 'node:test';
import assert from 'node:assert/strict';
import {
  weaponFromRow, weaponToRow, enemyFromRow, enemyToRow, levelFromRow, levelToRow,
} from '../shared/mapping.js';

const weapon = {
  id: 'wine-tasting', name: 'Wine Tasting', description: 'Distracts', sprite: 'wine',
  cost: 50, range: 2.5, damage: 0, fireRate: 1,
  effect: 'distract', effectStrength: 0.5, effectDuration: 3,
  upgrades: [{ cost: 40, range: 3, effectStrength: 0.7 }],
};
const enemy = {
  id: 'recruiter', name: 'Recruiter', description: 'Pesky', sprite: 'rec',
  hp: 30, speed: 1.2, reward: 10, wineDamage: 1,
};
const level = {
  id: 'level-1', name: 'One', sortOrder: 1, published: true, cols: 10, rows: 6,
  start: { x: 0, y: 0 }, end: { x: 2, y: 0 },
  path: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }],
  blocked: [{ x: 1, y: 1 }], weaponIds: ['wine-tasting'],
  startingCorks: 100, startingWine: 5,
  waves: [[{ enemyId: 'recruiter', count: 3, intervalS: 1, delayS: 0 }]],
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
