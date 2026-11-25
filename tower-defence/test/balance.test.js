// Balance check (RF3, RF5): the starter levels are won by a sensible scripted player
// and lost by one that only ends turns. The bot never rings the Victory Bell, so a win
// is earned by towers alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareGameData } from '../shared/model.js';
import { runGame, playSensibly, weaponScore } from '../game/logic/bot.js';
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

for (const level of data.levels) {
  for (const seed of SEEDS) {
    test(`${level.id}: the sensible bot wins in under 300 turns (seed ${seed})`, () => {
      const r = runGame(level, catalog, { bot: 'sensible', rng: lcg(seed) });
      assert.equal(r.phase, 'won', JSON.stringify(r));
      assert.ok(r.turn < 300, `took ${r.turn} turns`);
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
