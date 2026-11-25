import test from 'node:test';
import assert from 'node:assert/strict';
import { createDataSource } from '../shared/data.js';
import { weaponToRow, enemyToRow, levelToRow } from '../shared/mapping.js';

const weapon = {
  id: 'wine-tasting', name: 'Wine Tasting', description: 'Distracts', sprite: 'wine',
  cost: 50, range: 2.5, damage: 0, fireRate: 1,
  effect: 'distract', effectStrength: 0.5, effectDuration: 3, upgrades: [], fallbackSprite: 'wine',
};
const enemy = {
  id: 'recruiter', name: 'Recruiter', description: 'Pesky', sprite: 'rec',
  hp: 30, speed: 1.2, reward: 10, wineDamage: 1,
  quotes: ['Got a minute?'], immuneTo: [], fallbackSprite: 'rec',
};
function makeLevel(overrides = {}) {
  return {
    id: 'level-1', name: 'One', sortOrder: 1, published: true, cols: 3, rows: 3,
    start: { x: 0, y: 0 }, end: { x: 2, y: 0 },
    path: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }],
    blocked: [], weaponIds: ['wine-tasting'], startingCorks: 100, startingWine: 5,
    waves: [[{ enemyId: 'recruiter', count: 2, intervalS: 1, delayS: 0 }]],
    enemyIds: ['recruiter'], barSprite: '🍻',
    ...overrides,
  };
}

const fallbackRaw = {
  weapons: [weapon],
  enemies: [enemy],
  levels: [makeLevel({ id: 'fallback-level', name: 'Fallback' })],
};
const fetchFallback = async () => structuredClone(fallbackRaw);

// Minimal fake shaped like the supabase-js v2 calls data.js makes.
function fakeClient({ rows = {}, selectImpl, writeError = null } = {}) {
  const calls = [];
  const client = {
    calls,
    from(table) {
      return {
        select(cols) {
          calls.push({ op: 'select', table, cols });
          if (selectImpl) return selectImpl(table);
          return Promise.resolve({ data: structuredClone(rows[table] ?? []), error: null });
        },
        upsert(row) {
          calls.push({ op: 'upsert', table, row });
          return Promise.resolve({ error: writeError });
        },
        delete() {
          return {
            eq(col, val) {
              calls.push({ op: 'delete', table, col, val });
              return Promise.resolve({ error: writeError });
            },
          };
        },
      };
    },
  };
  return client;
}

const dbRows = (levels) => ({
  weapons: [weaponToRow(weapon)],
  enemies: [enemyToRow(enemy)],
  levels: levels.map(levelToRow),
});

// Silence and capture console.warn per test.
function captureWarn(t) {
  const warnings = [];
  const orig = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  t.after(() => { console.warn = orig; });
  return warnings;
}

test('valid DB rows give source "db" in app shape', async (t) => {
  const warnings = captureWarn(t);
  const ds = createDataSource({ client: fakeClient({ rows: dbRows([makeLevel()]) }), fetchFallback });
  const data = await ds.loadGameData();
  assert.equal(data.source, 'db');
  assert.deepEqual(data.weapons, [weapon]);
  assert.deepEqual(data.enemies, [enemy]);
  assert.equal(data.levels.length, 1);
  assert.equal(data.levels[0].id, 'level-1');
  assert.deepEqual(data.levels[0].weaponIds, ['wine-tasting']);
  assert.deepEqual(warnings, []);
});

test('a rejecting DB falls back and warns', async (t) => {
  const warnings = captureWarn(t);
  const client = fakeClient({ selectImpl: () => Promise.reject(new Error('network down')) });
  const data = await createDataSource({ client, fetchFallback }).loadGameData();
  assert.equal(data.source, 'fallback');
  assert.equal(data.levels[0].id, 'fallback-level');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /network down/);
});

test('a DB returning { error } falls back', async (t) => {
  const warnings = captureWarn(t);
  const client = fakeClient({ selectImpl: () => Promise.resolve({ data: null, error: { message: 'permission denied' } }) });
  const data = await createDataSource({ client, fetchFallback }).loadGameData();
  assert.equal(data.source, 'fallback');
  assert.match(warnings[0], /permission denied/);
});

test('a DB that never resolves falls back within 200 ms', async (t) => {
  const warnings = captureWarn(t);
  const client = fakeClient({ selectImpl: () => new Promise(() => {}) });
  const started = Date.now();
  const data = await createDataSource({ client, fetchFallback, timeoutMs: 20 }).loadGameData();
  assert.equal(data.source, 'fallback');
  assert.ok(Date.now() - started < 200, `took ${Date.now() - started} ms`);
  assert.match(warnings[0], /timed out/i);
});

test('a DB with only invalid or unpublished levels falls back', async (t) => {
  const warnings = captureWarn(t);
  const rows = dbRows([
    makeLevel({ id: 'draft', published: false }),
    makeLevel({ id: 'broken', path: [{ x: 0, y: 0 }] }),
  ]);
  const data = await createDataSource({ client: fakeClient({ rows }), fetchFallback }).loadGameData();
  assert.equal(data.source, 'fallback');
  assert.equal(data.levels[0].id, 'fallback-level');
  assert.match(warnings[0], /no valid/i);
});

test('includeUnpublished returns unpublished DB levels', async (t) => {
  captureWarn(t);
  const rows = dbRows([makeLevel({ id: 'draft', published: false })]);
  const ds = createDataSource({ client: fakeClient({ rows }), fetchFallback });
  const data = await ds.loadGameData({ includeUnpublished: true });
  assert.equal(data.source, 'db');
  assert.deepEqual(data.levels.map(l => l.id), ['draft']);
  const published = await ds.loadGameData();
  assert.equal(published.source, 'fallback');
});

test('loadGameData rejects when both DB and fallback fail', async (t) => {
  captureWarn(t);
  const client = fakeClient({ selectImpl: () => Promise.reject(new Error('db down')) });
  const ds = createDataSource({ client, fetchFallback: async () => { throw new Error('404'); } });
  await assert.rejects(ds.loadGameData(), /404/);
});

test('save functions upsert snake_case rows and return { ok: true }', async () => {
  const client = fakeClient();
  const ds = createDataSource({ client, fetchFallback });
  const level = makeLevel();
  assert.deepEqual(await ds.saveLevel(level), { ok: true });
  assert.deepEqual(await ds.saveWeapon(weapon), { ok: true });
  assert.deepEqual(await ds.saveEnemy(enemy), { ok: true });
  assert.deepEqual(client.calls, [
    { op: 'upsert', table: 'levels', row: levelToRow(level) },
    { op: 'upsert', table: 'weapons', row: weaponToRow(weapon) },
    { op: 'upsert', table: 'enemies', row: enemyToRow(enemy) },
  ]);
});

test('delete functions delete by id and return { ok: true }', async () => {
  const client = fakeClient();
  const ds = createDataSource({ client, fetchFallback });
  assert.deepEqual(await ds.deleteLevel('level-1'), { ok: true });
  assert.deepEqual(await ds.deleteWeapon('wine-tasting'), { ok: true });
  assert.deepEqual(await ds.deleteEnemy('recruiter'), { ok: true });
  assert.deepEqual(client.calls, [
    { op: 'delete', table: 'levels', col: 'id', val: 'level-1' },
    { op: 'delete', table: 'weapons', col: 'id', val: 'wine-tasting' },
    { op: 'delete', table: 'enemies', col: 'id', val: 'recruiter' },
  ]);
});

test('writes report { ok: false, error } instead of throwing', async () => {
  const ds = createDataSource({ client: fakeClient({ writeError: { message: 'not admin' } }), fetchFallback });
  assert.deepEqual(await ds.saveLevel(makeLevel()), { ok: false, error: 'not admin' });
  assert.deepEqual(await ds.deleteEnemy('recruiter'), { ok: false, error: 'not admin' });

  const throwing = {
    from() {
      return {
        upsert() { return Promise.reject(new Error('offline')); },
        delete() { throw new Error('boom'); },
      };
    },
  };
  const ds2 = createDataSource({ client: throwing, fetchFallback });
  assert.deepEqual(await ds2.saveWeapon(weapon), { ok: false, error: 'offline' });
  assert.deepEqual(await ds2.deleteWeapon('x'), { ok: false, error: 'boom' });
});

test('exportJson pretty-prints app-shape data including unpublished levels', async () => {
  const levels = [
    makeLevel({ id: 'level-2', sortOrder: 2, published: false }),
    makeLevel({ id: 'level-1', sortOrder: 1 }),
  ];
  const ds = createDataSource({ client: fakeClient({ rows: dbRows(levels) }), fetchFallback });
  const json = await ds.exportJson();
  assert.match(json, /\n  "weapons"/);
  const parsed = JSON.parse(json);
  assert.deepEqual(Object.keys(parsed), ['weapons', 'enemies', 'levels']);
  assert.deepEqual(parsed.weapons, [weapon]);
  assert.deepEqual(parsed.enemies, [enemy]);
  assert.deepEqual(parsed.levels, [levels[1], levels[0]]);
});

test('fallbackReason distinguishes unreachable from no-valid-levels', async (t) => {
  captureWarn(t);
  const down = fakeClient({ selectImpl: () => Promise.reject(new Error('network down')) });
  assert.equal((await createDataSource({ client: down, fetchFallback }).loadGameData()).fallbackReason, 'unreachable');
  const rows = dbRows([makeLevel({ id: 'broken', path: [{ x: 0, y: 0 }] })]);
  const empty = await createDataSource({ client: fakeClient({ rows }), fetchFallback }).loadGameData();
  assert.equal(empty.fallbackReason, 'no-valid-levels');
  const ok = await createDataSource({ client: fakeClient({ rows: dbRows([makeLevel({ id: 'level-1' })]) }), fetchFallback }).loadGameData();
  assert.equal(ok.fallbackReason, undefined);
});

test('includeInvalid returns DB rows including invalid levels, no fallback', async (t) => {
  const warnings = captureWarn(t);
  const rows = dbRows([makeLevel({ id: 'broken', path: [{ x: 0, y: 0 }] })]);
  const data = await createDataSource({ client: fakeClient({ rows }), fetchFallback }).loadGameData({ includeUnpublished: true, includeInvalid: true });
  assert.equal(data.source, 'db');
  assert.deepEqual(data.levels.map(l => l.id), ['broken']);
  assert.deepEqual(warnings, []);
});

test('includeInvalid still falls back when the DB is unreachable', async (t) => {
  captureWarn(t);
  const client = fakeClient({ selectImpl: () => Promise.reject(new Error('down')) });
  const data = await createDataSource({ client, fetchFallback }).loadGameData({ includeInvalid: true });
  assert.equal(data.source, 'fallback');
  assert.equal(data.fallbackReason, 'unreachable');
});
