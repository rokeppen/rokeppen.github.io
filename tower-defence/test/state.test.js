import test from 'node:test';
import assert from 'node:assert/strict';
import { GameState, sellRefund } from '../game/logic/state.js';

// 5x3 level: straight path along row 1, one wave of 2 guests.
function makeLevel(overrides = {}) {
  return {
    id: 'test-level', name: 'Test', sortOrder: 1, published: true,
    cols: 5, rows: 3,
    start: { x: 0, y: 1 }, end: { x: 4, y: 1 },
    path: [{ x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }],
    blocked: [{ x: 0, y: 0 }],
    weaponIds: ['cannon', 'pizza', 'gold'],
    startingCorks: 100,
    startingWine: 10,
    waves: [[{ enemyId: 'guest', count: 2, intervalS: 1, delayS: 0 }]],
    ...overrides,
  };
}

const weapons = [
  { id: 'cannon', name: 'Cannon', cost: 31, range: 2, damage: 100, fireRate: 5,
    effect: 'none', effectStrength: 0, effectDuration: 0, upgrades: [{ cost: 20, damage: 200 }] },
  { id: 'pizza', name: 'Pizza', cost: 10, range: 5, damage: 0, fireRate: 10,
    effect: 'lure', effectStrength: 0, effectDuration: 5, upgrades: [] },
  { id: 'gold', name: 'Gold', cost: 1000, range: 2, damage: 1, fireRate: 1,
    effect: 'none', effectStrength: 0, effectDuration: 0, upgrades: [] },
  { id: 'banned', name: 'Banned', cost: 1, range: 2, damage: 1, fireRate: 1,
    effect: 'none', effectStrength: 0, effectDuration: 0, upgrades: [] },
];
const enemies = [{ id: 'guest', name: 'Guest', hp: 10, speed: 1, reward: 5, wineDamage: 3 }];

function makeState(overrides) {
  return new GameState(makeLevel(overrides), { weapons, enemies });
}

function run(state, seconds) {
  for (let t = 0; t < seconds; t += 0.25) state.tick(0.25);
}

test('initial state and tile types', () => {
  const s = makeState();
  assert.equal(s.corks, 100);
  assert.equal(s.wine, 10);
  assert.equal(s.phase, 'build');
  assert.equal(s.waveIndex, 0);
  assert.equal(s.totalWaves, 1);
  assert.equal(s.bellUsed, false);
  assert.equal(s.tileType(1, 1), 'path');
  assert.equal(s.tileType(0, 0), 'blocked');
  assert.equal(s.tileType(2, 0), 'buildable');
  assert.equal(s.tileType(5, 0), 'outside');
  assert.equal(s.tileType(-1, 0), 'outside');
  assert.ok(s.placeTower(2, 0, 'cannon').ok);
  assert.equal(s.tileType(2, 0), 'tower');
});

test('placeTower rejects path, blocked and occupied tiles, and missing corks (RF4)', () => {
  const s = makeState();
  assert.deepEqual(s.placeTower(1, 1, 'cannon'), { ok: false, reason: 'not-buildable' });
  assert.deepEqual(s.placeTower(0, 0, 'cannon'), { ok: false, reason: 'not-buildable' });
  assert.deepEqual(s.placeTower(9, 9, 'cannon'), { ok: false, reason: 'not-buildable' });
  assert.deepEqual(s.placeTower(2, 0, 'cannon'), { ok: true });
  assert.equal(s.corks, 69);
  assert.deepEqual(s.placeTower(2, 0, 'cannon'), { ok: false, reason: 'not-buildable' });
  assert.deepEqual(s.placeTower(3, 0, 'gold'), { ok: false, reason: 'no-corks' });
  assert.equal(s.corks, 69);
  assert.equal(s.towers.length, 1);
});

test('placeTower rejects weapons not in the level', () => {
  const s = makeState();
  assert.deepEqual(s.placeTower(2, 0, 'banned'), { ok: false, reason: 'not-in-level' });
  assert.equal(s.corks, 100);
});

test('upgrade max-tier, bell used twice, wave already running (RF4)', () => {
  const s = makeState();
  s.placeTower(2, 0, 'cannon');
  const id = s.towers[0].id;
  assert.deepEqual(s.upgradeTower(id), { ok: true });
  assert.equal(s.towers[0].tier, 1);
  assert.deepEqual(s.upgradeTower(id), { ok: false, reason: 'max-tier' });
  assert.deepEqual(s.upgradeTower('nope'), { ok: false, reason: 'unknown' });
  assert.deepEqual(s.ringBell(), { ok: true });
  assert.deepEqual(s.ringBell(), { ok: false, reason: 'used' });
  assert.deepEqual(s.startNextWave(), { ok: true });
  assert.equal(s.phase, 'wave');
  assert.deepEqual(s.startNextWave(), { ok: false, reason: 'wave-running' });
});

test('upgrade without enough corks is refused', () => {
  const s = makeState({ startingCorks: 40 });
  s.placeTower(2, 0, 'cannon');
  assert.deepEqual(s.upgradeTower(s.towers[0].id), { ok: false, reason: 'no-corks' });
  assert.equal(s.corks, 9);
  assert.equal(s.towers[0].tier, 0);
});

test('without towers enemies leak and drain wine; won if wine remains', () => {
  const s = makeState();
  s.startNextWave();
  run(s, 10);
  assert.equal(s.wine, 4);
  assert.equal(s.enemies.length, 0);
  assert.equal(s.phase, 'won');
  const types = s.drainEvents().map((e) => e.type);
  assert.equal(types.filter((t) => t === 'spawn').length, 2);
  assert.equal(types.filter((t) => t === 'leak').length, 2);
  assert.ok(types.includes('won'));
  assert.deepEqual(s.drainEvents(), []);
  assert.deepEqual(s.startNextWave(), { ok: false, reason: 'game-over' });
  assert.deepEqual(s.placeTower(2, 0, 'cannon'), { ok: false, reason: 'game-over' });
});

test('phase becomes lost when wine reaches 0', () => {
  const s = makeState({ startingWine: 6 });
  s.startNextWave();
  run(s, 10);
  assert.equal(s.wine, 0);
  assert.equal(s.phase, 'lost');
  assert.ok(s.drainEvents().some((e) => e.type === 'lost'));
});

test('a strong tower kills both enemies and the only wave is won', () => {
  const s = makeState();
  s.placeTower(2, 0, 'cannon');
  s.startNextWave();
  run(s, 10);
  assert.equal(s.corks, 100 - 31 + 2 * 5);
  assert.equal(s.wine, 10);
  assert.equal(s.phase, 'won');
  const events = s.drainEvents();
  const kills = events.filter((e) => e.type === 'kill');
  assert.equal(kills.length, 2);
  assert.equal(kills[0].reward, 5);
  assert.equal(kills[0].enemyId, 'guest');
  assert.ok(events.some((e) => e.type === 'shot'));
});

test('a single huge tick is capped at 0.25 s (RF5)', () => {
  const s = makeState();
  s.startNextWave();
  s.tick(10);
  assert.equal(s.enemies.length, 1);
  assert.ok(s.enemies[0].distance <= 1 * 0.25 + 1e-9, `distance ${s.enemies[0].distance}`);
  assert.ok(s.time <= 0.25 + 1e-9);
});

test('lure stalls every enemy in range and they do not move', () => {
  const s = makeState();
  s.placeTower(2, 0, 'pizza');
  s.startNextWave();
  run(s, 1.5);
  assert.equal(s.enemies.length, 2);
  for (const e of s.enemies) assert.ok(e.stallUntil > s.time);
  const before = s.enemies.map((e) => e.distance);
  run(s, 1);
  assert.deepEqual(s.enemies.map((e) => e.distance), before);
  assert.ok(s.drainEvents().some((e) => e.type === 'shot' && e.targetIds.length === 2));
});

test('ringBell mid-wave clears enemies and pays rewards', () => {
  const s = makeState();
  s.startNextWave();
  run(s, 1.5);
  assert.equal(s.enemies.length, 2);
  assert.deepEqual(s.ringBell(), { ok: true });
  assert.equal(s.enemies.length, 0);
  assert.equal(s.corks, 110);
  assert.equal(s.bellUsed, true);
  assert.ok(s.drainEvents().some((e) => e.type === 'bell'));
  s.tick(0.1);
  assert.equal(s.phase, 'won');
});

test('sellTower after one upgrade refunds half of total spent', () => {
  const s = makeState();
  s.placeTower(2, 0, 'cannon');
  const id = s.towers[0].id;
  s.upgradeTower(id);
  assert.equal(s.corks, 49);
  assert.deepEqual(s.sellTower(id), { ok: true, refund: Math.floor((31 + 20) / 2) });
  assert.equal(s.corks, 74);
  assert.equal(s.towers.length, 0);
  assert.equal(s.tileType(2, 0), 'buildable');
});

test('sellRefund is half of spent rounded down and matches sellTower', () => {
  assert.equal(sellRefund({ spent: 0 }), 0);
  assert.equal(sellRefund({ spent: 51 }), 25);
  assert.equal(sellRefund({ spent: 170 }), 85);
  const s = makeState();
  s.placeTower(2, 0, 'cannon');
  const tower = s.towers[0];
  s.upgradeTower(tower.id);
  const expected = sellRefund(tower);
  assert.equal(s.sellTower(tower.id).refund, expected);
});

test('wave-cleared between waves, then next wave can start', () => {
  const wave = [{ enemyId: 'guest', count: 1, intervalS: 1, delayS: 0 }];
  const s = makeState({ waves: [wave, wave] });
  s.placeTower(2, 0, 'cannon');
  assert.deepEqual(s.startNextWave(), { ok: true });
  run(s, 5);
  assert.equal(s.phase, 'build');
  assert.equal(s.waveIndex, 1);
  assert.ok(s.drainEvents().some((e) => e.type === 'wave-cleared'));
  assert.deepEqual(s.startNextWave(), { ok: true });
  run(s, 5);
  assert.equal(s.phase, 'won');
});

test('slow and splash effects', () => {
  const extra = [
    { id: 'ice', name: 'Ice', cost: 10, range: 5, damage: 0, fireRate: 10,
      effect: 'slow', effectStrength: 0.5, effectDuration: 5, upgrades: [] },
    { id: 'bomb', name: 'Bomb', cost: 10, range: 5, damage: 4, fireRate: 1,
      effect: 'splash', effectStrength: 2, effectDuration: 0, upgrades: [] },
  ];
  const level = makeLevel({ weaponIds: ['ice', 'bomb'] });
  const slow = new GameState(level, { weapons: extra, enemies });
  slow.placeTower(2, 0, 'ice');
  slow.startNextWave();
  slow.tick(0.25);
  assert.equal(slow.enemies[0].slowFactor, 0.5);
  assert.ok(slow.enemies[0].distance < 0.25);

  const splash = new GameState(level, { weapons: extra, enemies });
  splash.placeTower(2, 0, 'bomb');
  splash.startNextWave();
  run(splash, 2.5); // three bombs: the leader (10 hp) dies, the follower survives
  assert.equal(splash.enemies.length, 1);
  // The follower is never the direct target (the leader is further along),
  // so any damage it took came from splash.
  const second = splash.enemies[0];
  const shots = splash.drainEvents().filter((e) => e.type === 'shot');
  assert.ok(shots.every((sh) => !sh.targetIds.includes(second.id)));
  assert.ok(second.hp < second.maxHp);
});

test('kill and leak events carry the enemy instance id', () => {
  const killed = makeState();
  killed.placeTower(2, 0, 'cannon');
  killed.startNextWave();
  run(killed, 10);
  const killEvents = killed.drainEvents();
  const killSpawns = killEvents.filter((e) => e.type === 'spawn').map((e) => e.id);
  const kills = killEvents.filter((e) => e.type === 'kill');
  assert.equal(kills.length, 2);
  assert.deepEqual(kills.map((e) => e.id).sort(), killSpawns.sort());
  assert.equal(kills[0].enemyId, 'guest');

  const leaked = makeState();
  leaked.startNextWave();
  run(leaked, 10);
  const leakEvents = leaked.drainEvents();
  const leakSpawns = leakEvents.filter((e) => e.type === 'spawn').map((e) => e.id);
  const leaks = leakEvents.filter((e) => e.type === 'leak');
  assert.equal(leaks.length, 2);
  assert.deepEqual(leaks.map((e) => e.id).sort(), leakSpawns.sort());
  assert.equal(leaks[0].enemyId, 'guest');
  assert.equal(leaks[0].wineDamage, 3);
});
