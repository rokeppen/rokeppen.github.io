// Balance check (RF3, RF5): the starter levels are won by a sensible scripted player who
// plays one card per turn, and lost by one that only ends turns. The bots never play Sell
// or Bell cards, so a win is earned by towers alone. Cards are free, so nothing here is
// about caps.
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

// With free cards a sensible player keeps every keg on both starter levels, so difficulty
// shows in how long the towers take: level 2 needs clearly more turns.
test('level 1 is easier than level 2: the bot wins it in fewer turns on average', () => {
  const [l1, l2] = data.levels;
  const turns = (level) => {
    let sum = 0;
    for (const seed of SEEDS) sum += runGame(level, catalog, { rng: lcg(seed) }).turn;
    return sum / SEEDS.length;
  };
  assert.ok(turns(l1) * 1.5 < turns(l2), `${turns(l1)} vs ${turns(l2)}`);
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

test('the mixed bot backs splash with the Café and single-target towers with Pizza Hut', () => {
  const ws = (...ids) => ids.map((id) => catalog.weapons.find((w) => w.id === id));
  const all = ws('out-of-office', 'coffee-machine', 'cafe', 'pizza-hut', 'hr-talk');
  assert.equal(pickSupport(all, ws('hr-talk')[0]).id, 'cafe');
  assert.equal(pickSupport(all, ws('out-of-office')[0]).id, 'pizza-hut');
  assert.equal(pickSupport(ws('hr-talk', 'coffee-machine'), ws('hr-talk')[0]).id, 'coffee-machine', 'falls back');
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
  const s = new GameState(level2, catalog, { rng: lcg(5) });
  const effectOf = (id) => catalog.weapons.find((w) => w.id === id).effect;
  for (let i = 0; i < 40 && s.towers.length < 6; i++) {
    // Deal a hand that holds every level weapon, so only the bot's rule decides.
    s.hand = level2.weaponIds.map((weaponId, k) => ({ id: 1000 * (i + 1) + k, kind: 'build', weaponId }));
    s.cardPlayedThisTurn = false;
    playMixed(s);
  }
  const kinds = s.towers.map((t) => effectOf(t.weaponId));
  assert.deepEqual(kinds.map((k) => ['slow', 'distract', 'lure'].includes(k)),
    [false, false, true, false, false, true], kinds.join(','));
});

test('bots play at most one card per turn and never Sell or Bell', () => {
  for (const bot of ['sensible', 'mixed']) {
    for (const level of data.levels) {
      const s = new GameState(level, catalog, { rng: lcg(9) });
      const play = bot === 'sensible' ? playSensibly : playMixed;
      while (!s.over) {
        const before = [...s.hand];
        play(s);
        const gone = before.filter((c) => !s.hand.includes(c));
        assert.ok(gone.length <= 1, `${bot} played ${gone.length} cards`);
        for (const c of gone) assert.ok(c.kind === 'build' || c.kind === 'upgrade', `${bot} played ${c.kind}`);
        s.endTurn();
      }
    }
  }
});

test('crowding: no starter-level group spawns more than 5 guests per turn (intervalS >= 0.2)', () => {
  for (const level of data.levels) {
    for (const wave of level.waves) for (const g of wave) assert.ok(g.intervalS >= 0.2, `${level.id} ${g.enemyId} ${g.intervalS}`);
  }
});

// --- bot heuristic ---

test('weaponScore: damage x fireRate (cost ignored); damage-0 weapons count 0.5 per effect turn', () => {
  assert.equal(weaponScore({ damage: 10, fireRate: 2, cost: 40 }), 20);
  assert.equal(weaponScore({ damage: 0, fireRate: 1, cost: 10, effectDuration: 4 }), 2);
});

test('the bot builds its best card on the tile covering the most path, else upgrades', () => {
  const path = Array.from({ length: 7 }, (_, x) => ({ x, y: 1 }));
  const level = {
    id: 't', name: 'T', sortOrder: 1, published: true, cols: 7, rows: 3,
    start: path[0], end: path[6], path, blocked: [],
    weaponIds: ['weak', 'strong'], startingCorks: 50, startingWine: 5,
    waves: [[{ enemyId: 'g', count: 1, intervalS: 1, delayS: 30 }]],
  };
  const weapons = [
    { id: 'weak', name: 'W', cost: 1, range: 1.5, damage: 2, fireRate: 1, effect: 'none',
      effectStrength: 0, effectDuration: 0, upgrades: [{ cost: 25, damage: 3 }] },
    { id: 'strong', name: 'S', cost: 999, range: 1, damage: 3, fireRate: 1, effect: 'none',
      effectStrength: 0, effectDuration: 0, upgrades: [] },
  ];
  const s = new GameState(level, { weapons, enemies: [{ id: 'g', name: 'G', hp: 5, speed: 1, reward: 1, wineDamage: 1 }] });
  const deal = (cards) => {
    s.hand = cards.map((c, i) => ({ id: 500 + s.turn * 10 + i, ...c }));
    s.cardPlayedThisTurn = false;
  };
  deal([{ kind: 'build', weaponId: 'weak' }, { kind: 'build', weaponId: 'strong' }, { kind: 'sell' }, { kind: 'bell' }]);
  playSensibly(s);
  // The strong card wins (cost ignored); range 1 covers 1 path tile, first such tile is (0, 0).
  assert.deepEqual(s.towers.map((t) => [t.x, t.y, t.weaponId]), [[0, 0, 'strong']]);
  assert.equal(s.hand.length, 3);
  deal([{ kind: 'upgrade', weaponId: 'weak' }, { kind: 'sell' }]);
  playSensibly(s);
  assert.equal(s.hand.length, 2, 'no weak tower: the upgrade card is unplayable, sell is never played');
  s.placeTower(3, 0, 'weak');
  playSensibly(s);
  assert.equal(s.towers.find((t) => t.weaponId === 'weak').tier, 1);
});
