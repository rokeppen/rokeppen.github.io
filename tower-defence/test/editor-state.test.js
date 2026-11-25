import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newLevel, setStart, setEnd, extendPath, toggleBlocked, resizeLevel, canSave,
  eraseTile, duplicateLevel, applyTool,
  setWeapons, addWave, removeWave, moveWave, addGroup, updateGroup, removeGroup,
  waveSummary, prepareForEditor,
} from '../admin/editor-state.js';
import { readFileSync } from 'node:fs';

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

// ---------- Task 10: weapons, waves, settings ----------

const enemies = [
  { id: 'e', sprite: '🧑‍💼' },
  { id: 'q', sprite: '❓' },
];
const cat2 = { weapons: [{ id: 'w' }, { id: 'w2' }], enemies };

test('setWeapons replaces the weapon list (deduped) without mutating input', () => {
  const l = drawn();
  const next = setWeapons(l, ['w2', 'w', 'w2']);
  assert.deepEqual(next.weaponIds, ['w2', 'w']);
  assert.deepEqual(l.weaponIds, ['w']);
});

test('addWave on an empty level creates one wave with one default group', () => {
  const l = drawn({ waves: [] });
  const next = addWave(l, 'e');
  assert.deepEqual(next.waves, [[{ enemyId: 'e', count: 5, intervalS: 1, delayS: 0 }]]);
  assert.deepEqual(l.waves, []);
});

test('addWave copies the previous wave deeply', () => {
  const l = drawn({ waves: [[{ enemyId: 'q', count: 2, intervalS: 3, delayS: 1 }]] });
  const next = addWave(l, 'e');
  assert.equal(next.waves.length, 2);
  assert.deepEqual(next.waves[1], l.waves[0]);
  next.waves[1][0].count = 9;
  assert.equal(next.waves[0][0].count, 2);
});

test('addWave without any enemy on an empty level leaves it unchanged', () => {
  const l = drawn({ waves: [] });
  assert.equal(addWave(l, undefined), l);
});

test('removeWave removes the wave at an index', () => {
  const a = [{ enemyId: 'e', count: 1, intervalS: 1, delayS: 0 }];
  const b = [{ enemyId: 'q', count: 2, intervalS: 1, delayS: 0 }];
  const l = drawn({ waves: [a, b] });
  assert.deepEqual(removeWave(l, 0).waves, [b]);
  assert.equal(removeWave(l, 5), l);
  assert.equal(l.waves.length, 2);
});

test('moveWave swaps the order', () => {
  const a = [{ enemyId: 'e', count: 1, intervalS: 1, delayS: 0 }];
  const b = [{ enemyId: 'q', count: 2, intervalS: 1, delayS: 0 }];
  const l = drawn({ waves: [a, b] });
  assert.deepEqual(moveWave(l, 0, 1).waves, [b, a]);
  assert.deepEqual(moveWave(l, 1, -1).waves, [b, a]);
  assert.equal(moveWave(l, 0, -1), l, 'cannot move the first wave up');
  assert.equal(moveWave(l, 1, 1), l, 'cannot move the last wave down');
  assert.deepEqual(l.waves, [a, b]);
});

test('addGroup / updateGroup / removeGroup edit one wave', () => {
  const l = drawn();
  const added = addGroup(l, 0, 'q');
  assert.deepEqual(added.waves[0][1], { enemyId: 'q', count: 5, intervalS: 1, delayS: 0 });
  const updated = updateGroup(added, 0, 1, { count: 3, delayS: 2 });
  assert.deepEqual(updated.waves[0][1], { enemyId: 'q', count: 3, intervalS: 1, delayS: 2 });
  assert.equal(added.waves[0][1].count, 5, 'input not mutated');
  const removed = removeGroup(updated, 0, 0);
  assert.deepEqual(removed.waves[0], [updated.waves[0][1]]);
  assert.equal(updated.waves[0].length, 2);
  assert.equal(updateGroup(l, 4, 0, { count: 2 }), l, 'unknown wave');
  assert.equal(removeGroup(l, 0, 7), l, 'unknown group');
});

test('updateGroup with count 0 makes canSave fail', () => {
  const l = updateGroup(drawn(), 0, 0, { count: 0 });
  const res = canSave(l, catalog);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => /count/i.test(e)), res.errors.join('; '));
});

test('canSave rejects bad interval, delay, starting corks/wine and empty waves', () => {
  const g = (p) => drawn({ waves: [[{ enemyId: 'e', count: 1, intervalS: 1, delayS: 0, ...p }]] });
  assert.equal(canSave(g({ intervalS: 0 }), catalog).ok, false);
  assert.equal(canSave(g({ delayS: -1 }), catalog).ok, false);
  assert.equal(canSave(g({ count: 1.5 }), catalog).ok, false);
  assert.equal(canSave(drawn({ startingCorks: 0 }), catalog).ok, false);
  assert.equal(canSave(drawn({ startingWine: 2.5 }), catalog).ok, false);
  assert.equal(canSave(drawn({ waves: [[]] }), catalog).ok, false);
});

test('canSave surfaces validateLevel errors instead of swallowing them (RF2)', () => {
  // The weapon was deleted from the catalog while the level still uses it.
  const res = canSave(drawn({ weaponIds: ['w', 'gone'] }), catalog);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes('gone')), res.errors.join('; '));
  const enemyGone = canSave(drawn({ waves: [[{ enemyId: 'zzz', count: 1, intervalS: 1, delayS: 0 }]] }), catalog);
  assert.equal(enemyGone.ok, false);
  assert.ok(enemyGone.errors.some((e) => e.includes('zzz')), enemyGone.errors.join('; '));
});

test('waveSummary totals guests per enemy using their sprites', () => {
  const wave = [
    { enemyId: 'e', count: 4, intervalS: 1, delayS: 0 },
    { enemyId: 'q', count: 2, intervalS: 1, delayS: 0 },
    { enemyId: 'e', count: 2, intervalS: 1, delayS: 0 },
  ];
  assert.equal(waveSummary(wave, enemies), '6 🧑‍💼 + 2 ❓');
  assert.equal(waveSummary([], enemies), 'no guests');
  assert.equal(waveSummary([{ enemyId: 'zzz', count: 1 }], enemies), '1 ?');
});

test('prepareForEditor drops groups of deleted enemies with a warning (RF2)', () => {
  const raw = drawn({
    waves: [
      [{ enemyId: 'e', count: 1, intervalS: 1, delayS: 0 }],
      [{ enemyId: 'xyz', count: 3, intervalS: 1, delayS: 0 }, { enemyId: 'q', count: 2, intervalS: 1, delayS: 0 }],
    ],
  });
  const { level, warnings } = prepareForEditor(raw, cat2);
  assert.deepEqual(level.waves[1], [{ enemyId: 'q', count: 2, intervalS: 1, delayS: 0 }]);
  assert.ok(warnings.some((w) => /Wave 2/.test(w) && w.includes("'xyz'") && /no longer exists/.test(w)), warnings.join('; '));
  assert.equal(raw.waves[1].length, 2, 'input not mutated');
});

test('prepareForEditor drops deleted weapons and waves left empty, with warnings', () => {
  const raw = drawn({ weaponIds: ['w', 'old'], waves: [[{ enemyId: 'xyz', count: 1, intervalS: 1, delayS: 0 }], [{ enemyId: 'e', count: 1, intervalS: 1, delayS: 0 }]] });
  const { level, warnings } = prepareForEditor(raw, cat2);
  assert.deepEqual(level.weaponIds, ['w']);
  assert.equal(level.waves.length, 1);
  assert.ok(warnings.some((w) => w.includes("'old'")));
  assert.ok(warnings.some((w) => /Wave 1/.test(w) && /removed/.test(w)));
});

test('prepareForEditor sanitises malformed path/blocked/waves/weaponIds without throwing', () => {
  const raw = {
    id: 'x', name: null, sortOrder: null, published: null, cols: 16, rows: 10,
    start: { x: '1', y: 0 }, end: 'nope',
    path: [null, 5, { x: 0, y: 0 }, { x: 1.5, y: 0 }, { x: 1, y: 0 }],
    blocked: { x: 1, y: 1 },
    weaponIds: 'w',
    startingCorks: '50', startingWine: null,
    waves: [null, 'x', [null, { enemyId: 'e', count: '2', intervalS: 1, delayS: 0 }]],
  };
  const { level, warnings } = prepareForEditor(raw, cat2);
  assert.deepEqual(level.path, [{ x: 0, y: 0 }, { x: 1, y: 0 }]);
  assert.deepEqual(level.blocked, []);
  assert.equal(level.start, null);
  assert.equal(level.end, null);
  assert.deepEqual(level.weaponIds, []);
  assert.equal(level.name, '');
  assert.equal(level.sortOrder, 0);
  assert.equal(level.published, false);
  assert.equal(level.startingCorks, 50);
  assert.equal(level.startingWine, 20);
  assert.deepEqual(level.waves, [[{ enemyId: 'e', count: 2, intervalS: 1, delayS: 0 }]]);
  assert.ok(warnings.length > 0);
  // The editor's map operations work on the result.
  assert.doesNotThrow(() => toggleBlocked(level, { x: 5, y: 5 }));
  assert.doesNotThrow(() => extendPath(level, { x: 2, y: 0 }));
});

test('prepareForEditor leaves a valid level identical (same JSON) with no warnings', () => {
  const data = JSON.parse(readFileSync(new URL('../fallback-data.json', import.meta.url), 'utf8'));
  for (const raw of data.levels) {
    const { level, warnings } = prepareForEditor(raw, data);
    assert.deepEqual(warnings, [], raw.id);
    assert.equal(JSON.stringify(level), JSON.stringify(raw), raw.id);
    assert.equal(canSave(level, data).ok, true, raw.id);
  }
});

test('extendPath refuses to extend past the end tile', () => {
  const l = drawn(); // path ends on E (3,0)
  assert.equal(extendPath(l, { x: 4, y: 0 }), l);
  assert.equal(extendPath(l, { x: 3, y: 1 }), l);
});

test('duplicateLevel of a nameless level is "Untitled (copy)"', () => {
  assert.equal(duplicateLevel(drawn({ name: null })).name, 'Untitled (copy)');
  assert.equal(duplicateLevel(drawn({ name: '  ' })).name, 'Untitled (copy)');
});
