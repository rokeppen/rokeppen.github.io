import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newLevel, setStart, setEnd, extendPath, toggleBlocked, resizeLevel, canSave,
  eraseTile, duplicateLevel, applyTool,
} from '../admin/editor-state.js';

const catalog = { weapons: [{ id: 'w' }], enemies: [{ id: 'e' }] };

// 16x10 level with a straight path along row 0 from (0,0) to (3,0).
function drawn(overrides = {}) {
  return {
    ...newLevel(),
    name: 'Test',
    start: { x: 0, y: 0 },
    end: { x: 3, y: 0 },
    path: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }],
    weaponIds: ['w'],
    waves: [[{ enemyId: 'e', count: 1, intervalS: 1, delayS: 0 }]],
    ...overrides,
  };
}

test('newLevel is an empty unpublished 16x10 level with defaults', () => {
  const l = newLevel();
  assert.equal(typeof l.id, 'string');
  assert.ok(l.id.length > 0);
  assert.notEqual(newLevel().id, l.id);
  assert.equal(l.cols, 16);
  assert.equal(l.rows, 10);
  assert.equal(l.start, null);
  assert.equal(l.end, null);
  assert.deepEqual(l.path, []);
  assert.deepEqual(l.blocked, []);
  assert.deepEqual(l.waves, []);
  assert.equal(l.startingCorks, 100);
  assert.equal(l.startingWine, 20);
  assert.equal(l.published, false);
});

test('setStart / setEnd set the tile and clear the path when they change', () => {
  const l = drawn();
  const s = setStart(l, { x: 0, y: 1 });
  assert.deepEqual(s.start, { x: 0, y: 1 });
  assert.deepEqual(s.path, []);
  const e = setEnd(l, { x: 5, y: 5 });
  assert.deepEqual(e.end, { x: 5, y: 5 });
  assert.deepEqual(e.path, []);
  assert.equal(l.path.length, 4, 'input not mutated');
  assert.equal(setStart(l, { x: 0, y: 0 }).path.length, 4, 'same tile keeps the path');
});

test('setStart removes the tile from blocked', () => {
  const l = setStart(drawn({ blocked: [{ x: 5, y: 5 }] }), { x: 5, y: 5 });
  assert.deepEqual(l.blocked, []);
});

test('extendPath refuses a non-start first tile', () => {
  const l = drawn({ path: [] });
  assert.equal(extendPath(l, { x: 1, y: 0 }), l);
  assert.deepEqual(extendPath(l, { x: 0, y: 0 }).path, [{ x: 0, y: 0 }]);
});

test('extendPath refuses a diagonal tile', () => {
  const l = drawn({ path: [{ x: 0, y: 0 }] });
  assert.equal(extendPath(l, { x: 1, y: 1 }), l);
});

test('extendPath refuses a repeat tile', () => {
  const l = drawn({ path: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] });
  assert.equal(extendPath(l, { x: 0, y: 0 }), l);
});

test('extendPath refuses an out-of-bounds tile', () => {
  const l = drawn({ path: [{ x: 0, y: 0 }] });
  assert.equal(extendPath(l, { x: -1, y: 0 }), l);
});

test('extendPath appends an adjacent tile and unblocks it, without mutating input', () => {
  const l = drawn({ path: [{ x: 0, y: 0 }], blocked: [{ x: 0, y: 1 }, { x: 9, y: 9 }] });
  const next = extendPath(l, { x: 0, y: 1 });
  assert.deepEqual(next.path, [{ x: 0, y: 0 }, { x: 0, y: 1 }]);
  assert.deepEqual(next.blocked, [{ x: 9, y: 9 }]);
  assert.equal(l.path.length, 1);
  assert.equal(l.blocked.length, 2);
});

test('extendPath removes the last tile when it is clicked again', () => {
  const l = drawn();
  const next = extendPath(l, { x: 3, y: 0 });
  assert.deepEqual(next.path, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }]);
  assert.equal(l.path.length, 4);
});

test('toggleBlocked on a path tile leaves the level unchanged', () => {
  const l = drawn();
  assert.equal(toggleBlocked(l, { x: 1, y: 0 }), l);
});

test('toggleBlocked ignores start and end tiles', () => {
  const l = drawn({ path: [] });
  assert.equal(toggleBlocked(l, { x: 0, y: 0 }), l);
  assert.equal(toggleBlocked(l, { x: 3, y: 0 }), l);
});

test('toggleBlocked adds then removes a free tile', () => {
  const l = drawn();
  const on = toggleBlocked(l, { x: 5, y: 5 });
  assert.deepEqual(on.blocked, [{ x: 5, y: 5 }]);
  assert.deepEqual(toggleBlocked(on, { x: 5, y: 5 }).blocked, []);
  assert.deepEqual(l.blocked, []);
});

test('resizeLevel 16x10 -> 8x10 with end at x=15 clears end and path and warns (RF3)', () => {
  const path = [];
  for (let x = 0; x <= 15; x++) path.push({ x, y: 0 });
  const l = drawn({ end: { x: 15, y: 0 }, path });
  const { level, warnings } = resizeLevel(l, 8, 10);
  assert.equal(level.cols, 8);
  assert.equal(level.end, null);
  assert.deepEqual(level.path, []);
  assert.ok(warnings.length > 0);
  assert.equal(l.cols, 16, 'input not mutated');
});

test('resizeLevel truncates the path at the first out-of-bounds tile', () => {
  // start (0,0) -> right to (5,0) -> down to (5,2) -> left to end (0,2)
  const path = [];
  for (let x = 0; x <= 5; x++) path.push({ x, y: 0 });
  path.push({ x: 5, y: 1 }, { x: 5, y: 2 });
  for (let x = 4; x >= 0; x--) path.push({ x, y: 2 });
  const l = drawn({ end: { x: 0, y: 2 }, path });
  const { level, warnings } = resizeLevel(l, 5, 10);
  assert.deepEqual(level.path, path.slice(0, 5));
  assert.deepEqual(level.end, { x: 0, y: 2 });
  assert.equal(warnings.length, 1);
});

test('resizeLevel drops out-of-bounds blocked tiles with one warning', () => {
  const l = drawn({ blocked: [{ x: 10, y: 9 }, { x: 12, y: 1 }, { x: 1, y: 1 }] });
  const { level, warnings } = resizeLevel(l, 8, 8);
  assert.deepEqual(level.blocked, [{ x: 1, y: 1 }]);
  assert.equal(warnings.length, 1);
});

test('resizeLevel growing the grid loses nothing', () => {
  const { level, warnings } = resizeLevel(drawn(), 20, 12);
  assert.equal(level.cols, 20);
  assert.equal(level.rows, 12);
  assert.equal(level.path.length, 4);
  assert.deepEqual(warnings, []);
});

test('canSave accepts a complete level', () => {
  assert.deepEqual(canSave(drawn(), catalog), { ok: true, errors: [] });
});

test('canSave rejects a path with a gap (RF2)', () => {
  const l = drawn({ path: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 3, y: 0 }] });
  const res = canSave(l, catalog);
  assert.equal(res.ok, false);
  assert.ok(res.errors.length > 0);
});

test('canSave lists reasons for a level without waves or weapons', () => {
  const res = canSave(drawn({ waves: [], weaponIds: [] }), catalog);
  assert.equal(res.ok, false);
  assert.ok(res.errors.length > 0);
});

test('canSave requires a name', () => {
  assert.equal(canSave(drawn({ name: '  ' }), catalog).ok, false);
});

test('eraseTile unblocks a tile, truncates the path from a path tile, clears start/end with the path', () => {
  const l = drawn({ blocked: [{ x: 5, y: 5 }] });
  assert.deepEqual(eraseTile(l, { x: 5, y: 5 }).blocked, []);
  assert.deepEqual(eraseTile(l, { x: 2, y: 0 }).path, [{ x: 0, y: 0 }, { x: 1, y: 0 }]);
  const noStart = eraseTile(l, { x: 0, y: 0 });
  assert.equal(noStart.start, null);
  assert.deepEqual(noStart.path, []);
  const noEnd = eraseTile(l, { x: 3, y: 0 });
  assert.equal(noEnd.end, null);
  assert.deepEqual(noEnd.path, []);
  assert.equal(eraseTile(l, { x: 9, y: 9 }), l);
});

test('duplicateLevel copies deeply with a new id, "(copy)" name and unpublished', () => {
  const l = drawn({ published: true });
  const d = duplicateLevel(l);
  assert.notEqual(d.id, l.id);
  assert.equal(d.name, 'Test (copy)');
  assert.equal(d.published, false);
  assert.deepEqual(d.path, l.path);
  d.path.push({ x: 4, y: 0 });
  d.waves[0][0].count = 99;
  assert.equal(l.path.length, 4);
  assert.equal(l.waves[0][0].count, 1);
});

test('applyTool dispatches to the matching edit', () => {
  const l = drawn({ path: [] });
  assert.deepEqual(applyTool(l, 'start', { x: 1, y: 1 }).start, { x: 1, y: 1 });
  assert.deepEqual(applyTool(l, 'end', { x: 2, y: 2 }).end, { x: 2, y: 2 });
  assert.deepEqual(applyTool(l, 'path', { x: 0, y: 0 }).path, [{ x: 0, y: 0 }]);
  assert.deepEqual(applyTool(l, 'blocked', { x: 5, y: 5 }).blocked, [{ x: 5, y: 5 }]);
  assert.equal(applyTool(l, 'nonsense', { x: 5, y: 5 }), l);
});
