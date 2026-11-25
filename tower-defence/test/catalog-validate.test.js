import test from 'node:test';
import assert from 'node:assert/strict';
import { validateWeapon, validateEnemy, levelsUsing, levelsHiddenByDelete, IMMUNITY_EFFECTS } from '../admin/catalog-validate.js';

const weapon = (o = {}) => ({
  id: 'w1', name: 'Cannon', description: '', sprite: 'x', cost: 50, range: 2.5, damage: 8, fireRate: 1.5,
  effect: 'none', effectStrength: 0, effectDuration: 0, upgrades: [], fallbackSprite: '❔', ...o,
});
const enemy = (o = {}) => ({ id: 'e1', name: 'Guest', description: '', sprite: 'x', hp: 10, speed: 1, reward: 5, wineDamage: 1,
  quotes: ['Cheers!'], immuneTo: ['distract'], fallbackSprite: '👤', ...o });

test('valid weapon and enemy pass', () => {
  assert.deepEqual(validateWeapon(weapon()), []);
  assert.deepEqual(validateEnemy(enemy()), []);
});

test('weapon requires id and name', () => {
  assert.ok(validateWeapon(weapon({ name: '  ' })).length);
  assert.ok(validateWeapon(weapon({ id: '' })).length);
});

test('weapon numbers: > 0 except damage and effectStrength', () => {
  for (const k of ['cost', 'range', 'fireRate']) {
    assert.ok(validateWeapon(weapon({ [k]: 0 })).length, k);
    assert.ok(validateWeapon(weapon({ [k]: NaN })).length, k);
  }
  assert.deepEqual(validateWeapon(weapon({ damage: 0 })), []);
  assert.ok(validateWeapon(weapon({ damage: -1 })).length);
  assert.ok(validateWeapon(weapon({ effectStrength: -0.1 })).length);
});

test('weapon cost must be an integer', () => {
  assert.ok(validateWeapon(weapon({ cost: 10.5 })).length);
});

test('effect must be known; non-none effects need a duration', () => {
  assert.ok(validateWeapon(weapon({ effect: 'explode' })).length);
  assert.ok(validateWeapon(weapon({ effect: 'distract', effectDuration: 0 })).length);
  assert.deepEqual(validateWeapon(weapon({ effect: 'distract', effectDuration: 3 })), []);
});

test('slow strength must be below 1', () => {
  assert.ok(validateWeapon(weapon({ effect: 'slow', effectStrength: 1, effectDuration: 2 })).length);
  assert.deepEqual(validateWeapon(weapon({ effect: 'slow', effectStrength: 0.4, effectDuration: 2 })), []);
});

test('upgrade tiers', () => {
  assert.deepEqual(validateWeapon(weapon({ upgrades: [{ cost: 40, damage: 0, range: 3 }] })), []);
  assert.ok(validateWeapon(weapon({ upgrades: [{ damage: 5 }] })).length, 'missing cost');
  assert.ok(validateWeapon(weapon({ upgrades: [{ cost: 0 }] })).length);
  assert.ok(validateWeapon(weapon({ upgrades: [{ cost: 4.5 }] })).length);
  assert.ok(validateWeapon(weapon({ upgrades: [{ cost: 5, bogus: 1 }] })).length);
  assert.ok(validateWeapon(weapon({ upgrades: [{ cost: 5, range: 0 }] })).length);
  assert.ok(validateWeapon(weapon({ upgrades: [{ cost: 5, damage: -1 }] })).length);
  assert.ok(validateWeapon(weapon({ effect: 'slow', effectDuration: 2, effectStrength: 0.4, upgrades: [{ cost: 5, effectStrength: 1 }] })).length);
});

test('enemy numbers', () => {
  assert.ok(validateEnemy(enemy({ name: '' })).length);
  assert.ok(validateEnemy(enemy({ id: '' })).length);
  for (const k of ['hp', 'speed', 'reward', 'wineDamage']) assert.ok(validateEnemy(enemy({ [k]: 0 })).length, k);
  assert.ok(validateEnemy(enemy({ reward: 1.5 })).length);
  assert.ok(validateEnemy(enemy({ wineDamage: 1.5 })).length);
  assert.deepEqual(validateEnemy(enemy({ hp: 12.5, speed: 0.9 })), []);
});

test('levelsUsing finds weapon and enemy users and survives malformed levels', () => {
  const levels = [
    { id: 'a', name: 'A', weaponIds: ['w1'], waves: [[{ enemyId: 'e1' }]] },
    { id: 'b', name: 'B', weaponIds: ['w2'], waves: [[{ enemyId: 'e2' }, null]] },
    { id: 'c', name: 'C' },
    { id: 'd', name: 'D', weaponIds: 'nope', waves: [null, 'x', [null, { enemyId: 'e1' }]] },
    null,
    { id: 'e', weaponIds: ['w1'], waves: {} },
  ];
  assert.deepEqual(levelsUsing(levels, { weaponId: 'w1' }), ['A', 'e']);
  assert.deepEqual(levelsUsing(levels, { enemyId: 'e1' }), ['A', 'D']);
  assert.deepEqual(levelsUsing(levels, { enemyId: 'zzz' }), []);
  assert.deepEqual(levelsUsing(undefined, { weaponId: 'w1' }), []);
});

test('levelsHiddenByDelete lists levels left with no weapons or no waves', () => {
  const lvl = (o) => ({
    cols: 3, rows: 1, start: { x: 0, y: 0 }, end: { x: 2, y: 0 },
    path: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }], blocked: [],
    startingCorks: 10, startingWine: 5, ...o,
  });
  const g = (enemyId) => ({ enemyId, count: 1, intervalS: 1, delayS: 0 });
  const catalog = { weapons: [{ id: 'w1' }, { id: 'w2' }], enemies: [{ id: 'e1' }, { id: 'e2' }] };
  const levels = [
    lvl({ id: 'only-w1', name: 'Only W1', weaponIds: ['w1'], waves: [[g('e1')]] }),
    lvl({ id: 'both', name: 'Both', weaponIds: ['w1', 'w2'], waves: [[g('e1')], [g('e2')]] }),
    lvl({ id: 'w1-gone-w', name: 'W1 + ghost', weaponIds: ['w1', 'ghost'], waves: [[g('e1'), g('e2')]] }),
    lvl({ id: 'broken', name: 'Broken', weaponIds: ['w1'], waves: [[g('e1')]], path: [] }),
  ];
  assert.deepEqual(levelsHiddenByDelete(levels, catalog, { weaponId: 'w1' }), ['Only W1', 'W1 + ghost']);
  assert.deepEqual(levelsHiddenByDelete(levels, catalog, { weaponId: 'w2' }), []);
  // 'both' keeps wave 2 (e2); 'W1 + ghost' keeps e2 in its only wave.
  assert.deepEqual(levelsHiddenByDelete(levels, catalog, { enemyId: 'e1' }), ['Only W1']);
  assert.deepEqual(levelsHiddenByDelete(undefined, catalog, { enemyId: 'e1' }), []);
});

test('IMMUNITY_EFFECTS lists the effects a guest can ignore', () => {
  assert.deepEqual(IMMUNITY_EFFECTS, ['slow', 'distract', 'lure']);
});

test('enemy immuneTo must be a subset of IMMUNITY_EFFECTS', () => {
  assert.ok(validateEnemy(enemy({ immuneTo: ['splash'] })).length);
  assert.ok(validateEnemy(enemy({ immuneTo: 'slow' })).length);
  assert.deepEqual(validateEnemy(enemy({ immuneTo: ['slow', 'distract', 'lure'] })), []);
  assert.deepEqual(validateEnemy(enemy({ immuneTo: [] })), []);
});

test('enemy quotes: up to 10 non-empty strings of at most 120 chars', () => {
  assert.ok(validateEnemy(enemy({ quotes: ['x'.repeat(121)] })).length);
  assert.deepEqual(validateEnemy(enemy({ quotes: ['x'.repeat(120)] })), []);
  assert.ok(validateEnemy(enemy({ quotes: ['  '] })).length);
  assert.ok(validateEnemy(enemy({ quotes: [3] })).length);
  assert.ok(validateEnemy(enemy({ quotes: 'hi' })).length);
  assert.ok(validateEnemy(enemy({ quotes: Array(11).fill('hi') })).length);
  assert.deepEqual(validateEnemy(enemy({ quotes: Array(10).fill('hi') })), []);
  assert.deepEqual(validateEnemy(enemy({ quotes: [] })), []);
});

test('fallbackSprite must be a non-empty emoji, not a URL', () => {
  assert.ok(validateEnemy(enemy({ fallbackSprite: 'https://x.test/a.png' })).length);
  assert.ok(validateEnemy(enemy({ fallbackSprite: '' })).length);
  assert.ok(validateEnemy(enemy({ fallbackSprite: undefined })).length);
  assert.ok(validateWeapon(weapon({ fallbackSprite: 'http://x.test/a.png' })).length);
  assert.ok(validateWeapon(weapon({ fallbackSprite: ' ' })).length);
  assert.deepEqual(validateWeapon(weapon({ sprite: 'https://x.test/a.png', fallbackSprite: '🍺' })), []);
});

test('sprite: required; an image URL must have a host', () => {
  for (const [check, mk] of [[validateWeapon, weapon], [validateEnemy, enemy]]) {
    assert.deepEqual(check(mk({ sprite: 'https://x.supabase.co/storage/v1/object/public/sprites/a.png' })), []);
    assert.deepEqual(check(mk({ sprite: '🍺' })), []);
    assert.ok(check(mk({ sprite: 'http://' })).length);
    assert.ok(check(mk({ sprite: 'https:// spaces .png' })).length);
    assert.ok(check(mk({ sprite: '' })).length);
    assert.ok(check(mk({ sprite: undefined })).length);
  }
});

test('levelsUsing counts a guest on a level guest list (enemyIds), not only in waves', () => {
  const levels = [
    { id: 'a', name: 'A', enemyIds: ['e1', 'e2'], waves: [[{ enemyId: 'e2' }]] },
    { id: 'b', name: 'B', enemyIds: ['e3'], waves: [] },
    { id: 'c', name: 'C', enemyIds: 'bogus', waves: [[{ enemyId: 'e1' }]] },
    { id: 'd', name: 'D', enemyIds: null, waves: [] },
  ];
  assert.deepEqual(levelsUsing(levels, { enemyId: 'e1' }), ['A', 'C']);
  assert.deepEqual(levelsUsing(levels, { enemyId: 'e3' }), ['B']);
  assert.deepEqual(levelsUsing(levels, { enemyId: 'e2' }), ['A']);
});

test('levelsHiddenByDelete accounts for the guest list (enemyIds) losing the deleted guest', () => {
  const lvl = (o) => ({
    cols: 3, rows: 1, start: { x: 0, y: 0 }, end: { x: 2, y: 0 },
    path: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }], blocked: [],
    startingCorks: 10, startingWine: 5, weaponIds: ['w1'], ...o,
  });
  const g = (enemyId) => ({ enemyId, count: 1, intervalS: 1, delayS: 0 });
  const catalog = { weapons: [{ id: 'w1' }], enemies: [{ id: 'e1' }, { id: 'e2' }] };
  const levels = [
    lvl({ id: 'solo', name: 'Solo', enemyIds: ['e1'], waves: [[g('e1')]] }),
    lvl({ id: 'pair', name: 'Pair', enemyIds: ['e1', 'e2'], waves: [[g('e1')], [g('e2')]] }),
    lvl({ id: 'legacy', name: 'Legacy', enemyIds: null, waves: [[g('e2')]] }),
    lvl({ id: 'spare', name: 'Spare', enemyIds: ['e1', 'e2'], waves: [[g('e2')]] }),
  ];
  // Solo's guest list becomes empty; Pair and Spare keep e2.
  assert.deepEqual(levelsHiddenByDelete(levels, catalog, { enemyId: 'e1' }), ['Solo']);
  assert.deepEqual(levelsHiddenByDelete(levels, catalog, { enemyId: 'e2' }), ['Legacy', 'Spare']);
  // Deleting a weapon leaves guest lists alone.
  const twoWeapons = { ...catalog, weapons: [{ id: 'w1' }, { id: 'w2' }] };
  assert.deepEqual(levelsHiddenByDelete(levels, twoWeapons, { weaponId: 'w2' }), []);
});
