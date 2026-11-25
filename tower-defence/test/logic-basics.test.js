import test from 'node:test';
import assert from 'node:assert/strict';
import { pathLength, positionAt } from '../game/logic/path.js';
import { buildSpawnSchedule } from '../game/logic/waves.js';
import { weaponStats, upgradeCost } from '../game/logic/stats.js';

const path = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }];

test('pathLength counts segments', () => {
  assert.equal(pathLength(path), 2);
  assert.equal(pathLength([]), 0);
});

test('positionAt interpolates tile centres and clamps', () => {
  assert.deepEqual(positionAt(path, 1), { x: 1.5, y: 0.5 });
  assert.deepEqual(positionAt(path, 1.5), { x: 1.5, y: 1 });
  assert.deepEqual(positionAt(path, -1), { x: 0.5, y: 0.5 });
  assert.deepEqual(positionAt(path, 99), { x: 1.5, y: 1.5 });
  assert.deepEqual(positionAt([{ x: 2, y: 3 }], 5), { x: 2.5, y: 3.5 });
  assert.deepEqual(positionAt([], 1), { x: 0, y: 0 });
});

test('buildSpawnSchedule merges groups sorted by time', () => {
  const s = buildSpawnSchedule([
    { enemyId: 'a', count: 2, intervalS: 1, delayS: 0 },
    { enemyId: 'b', count: 1, intervalS: 1, delayS: 0.5 },
  ]);
  assert.deepEqual(s, [
    { time: 0, enemyId: 'a' },
    { time: 0.5, enemyId: 'b' },
    { time: 1, enemyId: 'a' },
  ]);
  assert.deepEqual(buildSpawnSchedule([{ enemyId: 'a', count: 0, intervalS: 1, delayS: 0 }]), []);
});

test('buildSpawnSchedule keeps group order on ties', () => {
  const s = buildSpawnSchedule([
    { enemyId: 'a', count: 1, intervalS: 1, delayS: 1 },
    { enemyId: 'b', count: 1, intervalS: 1, delayS: 1 },
  ]);
  assert.deepEqual(s.map((e) => e.enemyId), ['a', 'b']);
});

const weapon = {
  damage: 1, range: 2, fireRate: 1, effectStrength: 0,
  upgrades: [{ cost: 10, damage: 5 }, { cost: 20, range: 3 }],
};

test('weaponStats applies upgrades in order', () => {
  assert.deepEqual(weaponStats(weapon, 0), { damage: 1, range: 2, fireRate: 1, effectStrength: 0 });
  assert.deepEqual(weaponStats(weapon, 1), { damage: 5, range: 2, fireRate: 1, effectStrength: 0 });
  const t2 = weaponStats(weapon, 2);
  assert.equal(t2.damage, 5);
  assert.equal(t2.range, 3);
  assert.deepEqual(weaponStats(weapon, 9), t2);
});

test('upgradeCost returns next cost or null at max', () => {
  assert.equal(upgradeCost(weapon, 0), 10);
  assert.equal(upgradeCost(weapon, 1), 20);
  assert.equal(upgradeCost(weapon, 2), null);
});
