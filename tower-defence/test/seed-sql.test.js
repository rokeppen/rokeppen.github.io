import test from 'node:test';
import assert from 'node:assert/strict';
import { toSeedSql, sqlLiteral } from '../shared/seed-sql.js';

const data = {
  weapons: [{
    id: 'wine-tasting', name: "Robin's Wine Tasting", description: 'Distracts', sprite: 'wine',
    cost: 50, range: 2.5, damage: 0, fireRate: 1,
    effect: 'distract', effectStrength: 0.5, effectDuration: 3,
    upgrades: [{ cost: 40, range: 3 }],
  }],
  enemies: [{
    id: 'recruiter', name: 'Recruiter', description: "Won't leave", sprite: 'rec',
    hp: 30, speed: 1.2, reward: 10, wineDamage: 1,
  }],
  levels: [{
    id: 'level-1', name: 'One', sortOrder: 1, published: true, cols: 3, rows: 3,
    start: { x: 0, y: 0 }, end: { x: 2, y: 0 },
    path: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }],
    blocked: [], weaponIds: ['wine-tasting', "o'clock"], startingCorks: 100, startingWine: 5,
    waves: [[{ enemyId: 'recruiter', count: 2, intervalS: 1, delayS: 0 }]],
  }],
};

test('sqlLiteral escapes and types values', () => {
  assert.equal(sqlLiteral("it's"), "'it''s'");
  assert.equal(sqlLiteral(3.5), '3.5');
  assert.equal(sqlLiteral(true), 'true');
  assert.equal(sqlLiteral(null), 'null');
  assert.equal(sqlLiteral(undefined), 'null');
  assert.equal(sqlLiteral(['a', "b'c"], { textArray: true }), "array['a', 'b''c']::text[]");
  assert.equal(sqlLiteral([], { textArray: true }), "array[]::text[]");
  assert.equal(sqlLiteral([]), "'[]'::jsonb");
  assert.equal(sqlLiteral(['a']), `'["a"]'::jsonb`);
  assert.equal(sqlLiteral({ x: "y'z" }), `'{"x":"y''z"}'::jsonb`);
});

test('toSeedSql upserts every row on id with snake_case columns', () => {
  const sql = toSeedSql(data);
  const inserts = sql.match(/insert into/g) ?? [];
  assert.equal(inserts.length, 3);
  assert.equal((sql.match(/on conflict \(id\) do update set/g) ?? []).length, 3);

  assert.match(sql, /insert into public\.weapons \(id, name, description, sprite, cost, range, damage, fire_rate, effect, effect_strength, effect_duration, upgrades\)/);
  assert.match(sql, /insert into public\.enemies \([^)]*wine_damage\)/);
  assert.match(sql, /insert into public\.levels \(id, name, sort_order, published, cols, rows, start, "end", path, blocked, weapon_ids, starting_corks, starting_wine, waves\)/);
  assert.match(sql, /fire_rate = excluded\.fire_rate/);
  assert.match(sql, /"end" = excluded\."end"/);
  assert.doesNotMatch(sql, /id = excluded\.id/);
});

test('toSeedSql escapes quotes and writes jsonb and text[] literals', () => {
  const sql = toSeedSql(data);
  assert.ok(sql.includes("'Robin''s Wine Tasting'"));
  assert.ok(sql.includes("'Won''t leave'"));
  assert.ok(sql.includes(`'[{"cost":40,"range":3}]'::jsonb`));
  assert.ok(sql.includes("array['wine-tasting', 'o''clock']::text[]"));
  assert.ok(sql.includes(`'[[{"enemyId":"recruiter","count":2,"intervalS":1,"delayS":0}]]'::jsonb`));
  assert.ok(sql.includes(`'{"x":0,"y":0}'::jsonb`));
  // empty jsonb arrays (blocked: []) must stay jsonb, not text[]
  assert.ok(sql.includes(`'[]'::jsonb`));
  assert.doesNotMatch(sql, /array\[\]::text\[\]/);
});

test('toSeedSql inserts weapons and enemies before levels', () => {
  const sql = toSeedSql(data);
  assert.ok(sql.indexOf('public.weapons') < sql.indexOf('public.levels'));
  assert.ok(sql.indexOf('public.enemies') < sql.indexOf('public.levels'));
});
