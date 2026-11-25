// Balance check (RF3, RF5): the starter levels are won by a sensible scripted player
// and lost by one that only ends turns. The bot never rings the Victory Bell, so a win
// is earned by towers alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareGameData } from '../shared/model.js';
import { runGame, playSensibly, playMixed, pickSupport, weaponScore, pathCoverage, supportTileFor } from '../game/logic/bot.js';
import { GameState } from '../game/logic/state.js';

const raw = JSON.parse(readFileSync(new URL('../fallback-data.json', import.meta.url), 'utf8'));
const data = prepareGameData(raw);
const catalog = { weapons: data.weapons, enemies: data.enemies };
const SEEDS = [1, 2, 3, 42, 1234];

function lcg(seed) {
  let x = seed >>> 0;
  return () => {
    x = (x * 1664525 + 1013904223) >>> 0;
    return x / 2 ** 32;
  };
}

test('there are two starter levels to check', () => {
  assert.deepEqual(data.levels.map((l) => l.id), ['level-1', 'level-2']);
});

// Demo pacing: a judge clicks End turn every round, so games must stay short.
const MAX_WIN_TURNS = { 'level-1': 40, 'level-2': 70 };

for (const level of data.levels) {
  for (const seed of SEEDS) {
    test(`${level.id}: the sensible bot wins within ${MAX_WIN_TURNS[level.id]} turns (seed ${seed})`, () => {
      const r = runGame(level, catalog, { bot: 'sensible', rng: lcg(seed) });
      assert.equal(r.phase, 'won', JSON.stringify(r));
      assert.ok(r.turn < 300, `took ${r.turn} turns`);
      assert.ok(r.turn <= MAX_WIN_TURNS[level.id], `took ${r.turn} turns`);
    });

    test(`${level.id}: the idle bot loses on kegs in under 300 turns (seed ${seed})`, () => {
      const r = runGame(level, catalog, { bot: 'idle', rng: lcg(seed) });
      assert.equal(r.phase, 'lost');
      assert.equal(r.endReason, 'kegs');
      assert.ok(r.turn < 300, `took ${r.turn} turns`);
    });
  }
}

test('level 1 is easier than level 2: the bot keeps a larger share of its kegs', () => {
  const [l1, l2] = data.levels;
  const share = (level) => {
    let sum = 0;
    for (const seed of SEEDS) sum += runGame(level, catalog, { rng: lcg(seed) }).wine / level.startingWine;
    return sum / SEEDS.length;
  };
  assert.ok(share(l1) > share(l2), `${share(l1)} vs ${share(l2)}`);
});

test('level 2 has tension: the sensible bot loses at least 1 keg in a late wave', () => {
  const l2 = data.levels.find((l) => l.id === 'level-2');
  for (const seed of SEEDS) {
    const { kegsLostByWave } = runGame(l2, catalog, { rng: lcg(seed) });
    const late = kegsLostByWave.slice(Math.floor(kegsLostByWave.length / 2));
    assert.ok(late.reduce((a, b) => a + b, 0) >= 1, JSON.stringify(kegsLostByWave));
  }
});

// --- economy: support and splash are worth buying ---

const level1 = data.levels.find((l) => l.id === 'level-1');
const level2 = data.levels.find((l) => l.id === 'level-2');

// Free towers placed before turn 1 (the first on the best-covered tile, a `near` one as a
// support next to the first), then only End turn with endless kegs. Returns the hp removed.
function damageDealt(level, placements, { dropFirst = false } = {}) {
  const s = new GameState({ ...level, startingWine: 1e6 }, catalog, { rng: () => 0.5 });
  s.corks = 1e9;
  for (const p of placements) {
    const w = s.weaponDefs.get(p.id);
    let tile = null;
    if (p.near) tile = supportTileFor(s, s.towers[0], w);
    else {
      for (let y = 0; y < level.rows; y++) {
        for (let x = 0; x < level.cols; x++) {
          if (s.tileType(x, y) !== 'buildable') continue;
          const cover = pathCoverage(s, x, y, w.range);
          if (cover > 0 && (!tile || cover > tile.cover)) tile = { x, y, cover };
        }
      }
    }
    s.actionsLeft = 3;
    assert.ok(s.placeTower(tile.x, tile.y, p.id).ok, p.id);
  }
  if (dropFirst) s.towers.shift(); // the support alone, on the tile it had next to the damage tower
  const maxHp = new Map();
  const left = new Map();
  while (!s.over) {
    const { events } = s.endTurn();
    for (const e of events) if (e.type === 'spawn') maxHp.set(e.id, s.enemyDefs.get(e.enemyId).hp);
    for (const e of events) if (e.type === 'kill') left.set(e.id, 0);
    for (const g of s.enemies) left.set(g.id, Math.max(0, g.hp));
  }
  let dealt = 0;
  for (const [id, hp] of maxHp) dealt += hp - (left.has(id) ? left.get(id) : hp);
  return dealt;
}

test('on level 2 the mixed bot beats the best single-weapon bot (HR Talk only)', () => {
  for (const seed of SEEDS) {
    const single = runGame(level2, catalog, { only: ['hr-talk'], rng: lcg(seed) });
    const mixed = runGame(level2, catalog, { bot: 'mixed', rng: lcg(seed) });
    assert.equal(mixed.phase, 'won', JSON.stringify(mixed));
    assert.ok(Object.keys(mixed.towers).length >= 2, `mixed builds a mix: ${JSON.stringify(mixed.towers)}`);
    assert.ok(mixed.wine > single.wine || (mixed.wine === single.wine && mixed.turn < single.turn),
      `mixed ${JSON.stringify(mixed)} vs HR only ${JSON.stringify(single)}`);
  }
});

test('the mixed bot backs splash with the Café and single-target towers with Pizza Hut', () => {
  const ws = (...ids) => ids.map((id) => catalog.weapons.find((w) => w.id === id));
  const all = ws('out-of-office', 'coffee-machine', 'cafe', 'pizza-hut', 'hr-talk');
  assert.equal(pickSupport(all, ws('hr-talk')[0]).id, 'cafe');
  assert.equal(pickSupport(all, ws('out-of-office')[0]).id, 'pizza-hut');
  assert.equal(pickSupport(ws('hr-talk', 'coffee-machine'), ws('hr-talk')[0]).id, 'coffee-machine', 'falls back');
});

test('HR Talk alone wins level 1 within its turn target', () => {
  for (const seed of SEEDS) {
    const r = runGame(level1, catalog, { only: ['hr-talk'], rng: lcg(seed) });
    assert.equal(r.phase, 'won', JSON.stringify(r));
    assert.ok(r.turn <= MAX_WIN_TURNS['level-1'], `took ${r.turn} turns`);
    assert.deepEqual(Object.keys(r.towers), ['hr-talk']);
  }
});

test('against a crowd, HR Talk deals more damage than Out-of-Office for the same caps', () => {
  const crowd = { ...level2, waves: [level2.waves[level2.waves.length - 1]] };
  const hr = catalog.weapons.find((w) => w.id === 'hr-talk');
  const ooo = catalog.weapons.find((w) => w.id === 'out-of-office');
  const n = Math.floor(hr.cost / ooo.cost);
  assert.ok(n >= 1);
  const hrDamage = damageDealt(crowd, [{ id: 'hr-talk' }]);
  const oooDamage = damageDealt(crowd, Array.from({ length: n }, (_, i) => ({ id: 'out-of-office', near: i > 0 })));
  assert.ok(hrDamage > oooDamage, `HR ${hrDamage} vs ${n} OOO ${oooDamage}`);
});

// The tough guests of level 2 walking level 2's path.
const tanks = { ...level2, waves: [
  [{ enemyId: 'facilities-guy', count: 6, intervalS: 1, delayS: 0 }],
  [{ enemyId: 'wine-snob', count: 6, intervalS: 0.5, delayS: 0 }],
] };

for (const support of ['coffee-machine', 'cafe', 'pizza-hut']) {
  for (const damage of ['out-of-office', 'hr-talk']) {
    test(`${support} next to ${damage} adds more damage than it deals by itself`, () => {
      const alone = damageDealt(tanks, [{ id: damage }]);
      const supportOnly = damageDealt(tanks, [{ id: damage }, { id: support, near: true }], { dropFirst: true });
      const pair = damageDealt(tanks, [{ id: damage }, { id: support, near: true }]);
      assert.ok(pair - supportOnly > alone, `${damage} ${alone}, ${support} alone ${supportOnly}, together ${pair}`);
    });
  }
}

test('the mixed bot builds 1 support after every 2 damage towers', () => {
  const s = new GameState(level2, catalog, { rng: () => 0.5 });
  s.corks = 10000;
  for (let i = 0; i < 2; i++) { playMixed(s); s.actionsLeft = 3; }
  const kinds = s.towers.map((t) => catalog.weapons.find((w) => w.id === t.weaponId).effect);
  const supports = kinds.filter((k) => ['slow', 'distract', 'lure'].includes(k)).length;
  assert.equal(s.towers.length, 6);
  assert.equal(supports, 2, kinds.join(','));
  assert.equal(s.bellUsed, false);
});

test('crowding: no starter-level group spawns more than 5 guests per turn (intervalS >= 0.2)', () => {
  for (const level of data.levels) {
    for (const wave of level.waves) for (const g of wave) assert.ok(g.intervalS >= 0.2, `${level.id} ${g.enemyId} ${g.intervalS}`);
  }
});

// --- bot heuristic ---

test('weaponScore: damage x fireRate / cost; damage-0 weapons count 0.5 per effect second', () => {
  assert.equal(weaponScore({ damage: 10, fireRate: 2, cost: 40 }), 0.5);
  assert.equal(weaponScore({ damage: 0, fireRate: 1, cost: 10, effectDuration: 4 }), 0.2);
});

test('the bot builds on the tile covering the most path, then upgrades, and never rings the bell', () => {
  const path = Array.from({ length: 7 }, (_, x) => ({ x, y: 1 }));
  const level = {
    id: 't', name: 'T', sortOrder: 1, published: true, cols: 7, rows: 3,
    start: path[0], end: path[6], path, blocked: [],
    weaponIds: ['cheap', 'dear'], startingCorks: 50, startingWine: 5,
    waves: [[{ enemyId: 'g', count: 1, intervalS: 1, delayS: 0 }]],
  };
  const weapons = [
    { id: 'cheap', name: 'C', cost: 20, range: 1.5, damage: 2, fireRate: 1, effect: 'none',
      effectStrength: 0, effectDuration: 0, upgrades: [{ cost: 25, damage: 3 }] },
    { id: 'dear', name: 'D', cost: 100, range: 1, damage: 3, fireRate: 1, effect: 'none',
      effectStrength: 0, effectDuration: 0, upgrades: [] },
  ];
  const s = new GameState(level, { weapons, enemies: [{ id: 'g', name: 'G', hp: 5, speed: 1, reward: 1, wineDamage: 1 }] });
  playSensibly(s);
  // range 1.5 covers 3 path tiles from (1..5, 0); first two builds take (1,0) and (2,0).
  assert.deepEqual(s.towers.map((t) => [t.x, t.y, t.weaponId, t.tier]), [[1, 0, 'cheap', 0], [2, 0, 'cheap', 0]]);
  assert.equal(s.corks, 10);
  assert.equal(s.actionsLeft, 1, 'cannot afford a third tower or an upgrade');
  assert.equal(s.bellUsed, false);
});
