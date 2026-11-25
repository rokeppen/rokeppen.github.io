import test from 'node:test';
import assert from 'node:assert/strict';
import { isPathValid, validateLevel, prepareGameData } from '../shared/model.js';

const catalog = {
  weapons: [{ id: 'a' }, { id: 'b' }],
  enemies: [{ id: 'e' }],
};

function makeLevel(overrides = {}) {
  return {
    id: 'level-1', name: 'One', sortOrder: 1, published: true,
    cols: 3, rows: 3,
    start: { x: 0, y: 0 }, end: { x: 2, y: 0 },
    path: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }],
    blocked: [],
    weaponIds: ['a'],
    startingCorks: 100, startingWine: 5,
    waves: [[{ enemyId: 'e', count: 2, intervalS: 1, delayS: 0 }]],
    ...overrides,
  };
}

test('isPathValid accepts an orthogonal chain from start to end', () => {
  assert.equal(isPathValid([{x:0,y:0},{x:1,y:0},{x:1,y:1}], {x:0,y:0}, {x:1,y:1}, 3, 3), true);
});

test('isPathValid rejects diagonal steps, gaps, repeats, out of bounds and wrong ends', () => {
  assert.equal(isPathValid([{x:0,y:0},{x:1,y:1}], {x:0,y:0}, {x:1,y:1}, 3, 3), false);
  assert.equal(isPathValid([{x:0,y:0},{x:2,y:0}], {x:0,y:0}, {x:2,y:0}, 3, 3), false);
  assert.equal(isPathValid([{x:0,y:0},{x:1,y:0},{x:0,y:0}], {x:0,y:0}, {x:0,y:0}, 3, 3), false);
  assert.equal(isPathValid([{x:2,y:0},{x:3,y:0}], {x:2,y:0}, {x:3,y:0}, 3, 3), false);
  assert.equal(isPathValid([{x:0,y:0},{x:1,y:0}], {x:0,y:0}, {x:2,y:0}, 3, 3), false);
});

test('isPathValid rejects too-short or non-array paths', () => {
  assert.equal(isPathValid([{x:0,y:0}], {x:0,y:0}, {x:0,y:0}, 3, 3), false);
  assert.equal(isPathValid(undefined, {x:0,y:0}, {x:1,y:0}, 3, 3), false);
});

test('validateLevel returns a clean level untouched with no errors', () => {
  const level = makeLevel();
  const { level: out, errors } = validateLevel(level, catalog);
  assert.deepEqual(out, level);
  assert.deepEqual(errors, []);
});

test('validateLevel drops unknown weapons and enemy groups but keeps the level', () => {
  const level = makeLevel({
    weaponIds: ['a', 'gone'],
    waves: [[
      { enemyId: 'e', count: 1, intervalS: 1, delayS: 0 },
      { enemyId: 'gone', count: 1, intervalS: 1, delayS: 0 },
    ]],
  });
  const { level: out, errors } = validateLevel(level, catalog);
  assert.deepEqual(out.weaponIds, ['a']);
  assert.equal(out.waves.length, 1);
  assert.equal(out.waves[0].length, 1);
  assert.equal(out.waves[0][0].enemyId, 'e');
  assert.equal(errors.length, 2);
  assert.ok(errors.every(e => typeof e === 'string'));
});

test('validateLevel drops groups with count < 1 and waves left empty', () => {
  const level = makeLevel({
    waves: [
      [{ enemyId: 'e', count: 0, intervalS: 1, delayS: 0 }],
      [{ enemyId: 'e', count: 3, intervalS: 1, delayS: 0 }],
    ],
  });
  const { level: out, errors } = validateLevel(level, catalog);
  assert.equal(out.waves.length, 1);
  assert.equal(out.waves[0][0].count, 3);
  assert.ok(errors.length >= 1);
});

test('validateLevel returns null for a broken path, no weapons, or no waves', () => {
  const broken = validateLevel(makeLevel({ path: [{x:0,y:0},{x:2,y:0}] }), catalog);
  assert.equal(broken.level, null);
  assert.ok(broken.errors.length >= 1);

  const noWeapons = validateLevel(makeLevel({ weaponIds: ['gone'] }), catalog);
  assert.equal(noWeapons.level, null);
  assert.ok(noWeapons.errors.length >= 1);

  const noWaves = validateLevel(makeLevel({ waves: [[{ enemyId: 'gone', count: 1, intervalS: 1, delayS: 0 }]] }), catalog);
  assert.equal(noWaves.level, null);
  assert.ok(noWaves.errors.length >= 1);
});

test('validateLevel drops blocked tiles on the path or out of bounds', () => {
  const level = makeLevel({
    blocked: [{x:1,y:0}, {x:5,y:5}, {x:-1,y:0}, {x:1,y:1}],
  });
  const { level: out, errors } = validateLevel(level, catalog);
  assert.deepEqual(out.blocked, [{x:1,y:1}]);
  assert.equal(errors.length, 3);
});

test('validateLevel does not mutate its input', () => {
  const level = makeLevel({ weaponIds: ['a', 'gone'], blocked: [{x:1,y:0}] });
  const snapshot = structuredClone(level);
  validateLevel(level, catalog);
  assert.deepEqual(level, snapshot);
});

test('prepareGameData hides unpublished levels unless includeUnpublished and sorts by sortOrder', () => {
  const raw = {
    ...catalog,
    levels: [
      makeLevel({ id: 'l3', sortOrder: 3 }),
      makeLevel({ id: 'l1', sortOrder: 1 }),
      makeLevel({ id: 'l2', sortOrder: 2, published: false }),
    ],
  };
  const snapshot = structuredClone(raw);
  const pub = prepareGameData(raw);
  assert.deepEqual(pub.levels.map(l => l.id), ['l1', 'l3']);
  const all = prepareGameData(raw, { includeUnpublished: true });
  assert.deepEqual(all.levels.map(l => l.id), ['l1', 'l2', 'l3']);
  assert.deepEqual(pub.weapons, raw.weapons);
  assert.deepEqual(pub.enemies, raw.enemies);
  assert.deepEqual(raw, snapshot);
});

test('prepareGameData drops levels that fail validation', () => {
  const raw = {
    ...catalog,
    levels: [makeLevel({ id: 'bad', weaponIds: [] }), makeLevel({ id: 'ok' })],
  };
  assert.deepEqual(prepareGameData(raw).levels.map(l => l.id), ['ok']);
});
