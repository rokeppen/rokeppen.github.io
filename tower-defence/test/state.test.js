import test from 'node:test';
import assert from 'node:assert/strict';
import { GameState, sellRefund } from '../game/logic/state.js';

// --- fixtures ---

// A straight path along row 1 of a `len`-wide, 3-high level.
function row(len) {
  return Array.from({ length: len }, (_, x) => ({ x, y: 1 }));
}

function makeLevel(overrides = {}) {
  const len = overrides.len || 5;
  const path = row(len);
  const { len: _ignored, ...rest } = overrides;
  return {
    id: 'test-level', name: 'Test', sortOrder: 1, published: true,
    cols: len, rows: 3,
    start: path[0], end: path[len - 1],
    path,
    blocked: [{ x: 0, y: 0 }],
    weaponIds: ['cannon', 'pizza', 'gold'],
    startingCorks: 100,
    startingWine: 10,
    waves: [[{ enemyId: 'guest', count: 2, intervalS: 1, delayS: 0 }]],
    ...rest,
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
const guest = { id: 'guest', name: 'Guest', hp: 10, speed: 1, reward: 5, wineDamage: 3 };
const enemies = [guest];

function makeState(overrides, opts) {
  return new GameState(makeLevel(overrides), { weapons, enemies }, opts);
}

// A custom game: one weapon list, one enemy list, one wave.
function custom({ weaponList = [], enemyList = [guest], wave, waves, len = 5, opts, ...rest }) {
  const level = makeLevel({ len, weaponIds: weaponList.map((w) => w.id), waves: waves || [wave], ...rest });
  return new GameState(level, { weapons: weaponList, enemies: enemyList }, opts);
}

const one = (enemyId = 'guest', extra = {}) => [{ enemyId, count: 1, intervalS: 1, delayS: 0, ...extra }];
const ofType = (events, type) => events.filter((e) => e.type === type);
const stepsOf = (events, id) => events.filter((e) => e.type === 'step' && e.id === id).length;

function weapon(id, fields) {
  return { id, name: id, cost: 1, range: 1, damage: 0, fireRate: 1,
    effect: 'none', effectStrength: 0, effectDuration: 0, upgrades: [], ...fields };
}

// --- tiles and player actions ---

test('initial state and tile types', () => {
  const s = makeState();
  assert.equal(s.corks, 100);
  assert.equal(s.wine, 10);
  assert.equal(s.turn, 1);
  assert.equal(s.phase, 'player');
  assert.equal(s.endReason, null);
  assert.equal(s.actionsLeft, 3);
  assert.equal(s.waveIndex, 0);
  assert.equal(s.totalWaves, 1);
  assert.equal(s.nextWaveIn, 0);
  assert.equal(s.bellUsed, false);
  assert.equal(s.tileType(1, 1), 'path');
  assert.equal(s.tileType(0, 0), 'blocked');
  assert.equal(s.tileType(2, 0), 'buildable');
  assert.equal(s.tileType(5, 0), 'outside');
  assert.equal(s.tileType(-1, 0), 'outside');
  assert.ok(s.placeTower(2, 0, 'cannon').ok);
  assert.equal(s.tileType(2, 0), 'tower');
  assert.equal(s.actionsLeft, 2);
  assert.equal(typeof s.tick, 'undefined');
  assert.equal(typeof s.startNextWave, 'undefined');
});

test('placeTower rejects path, blocked, occupied, missing corks and foreign weapons; refusals cost no action', () => {
  const s = makeState();
  assert.deepEqual(s.placeTower(1, 1, 'cannon'), { ok: false, reason: 'not-buildable' });
  assert.deepEqual(s.placeTower(0, 0, 'cannon'), { ok: false, reason: 'not-buildable' });
  assert.deepEqual(s.placeTower(9, 9, 'cannon'), { ok: false, reason: 'not-buildable' });
  assert.deepEqual(s.placeTower(2, 0, 'banned'), { ok: false, reason: 'not-in-level' });
  assert.equal(s.actionsLeft, 3);
  assert.deepEqual(s.placeTower(2, 0, 'cannon'), { ok: true });
  assert.equal(s.corks, 69);
  assert.deepEqual(s.placeTower(2, 0, 'cannon'), { ok: false, reason: 'not-buildable' });
  assert.deepEqual(s.placeTower(3, 0, 'gold'), { ok: false, reason: 'no-corks' });
  assert.equal(s.corks, 69);
  assert.equal(s.towers.length, 1);
  assert.equal(s.actionsLeft, 2);
});

test('upgrade: max-tier, unknown, no-corks', () => {
  const s = makeState();
  s.placeTower(2, 0, 'cannon');
  const id = s.towers[0].id;
  assert.deepEqual(s.upgradeTower(id), { ok: true });
  assert.equal(s.towers[0].tier, 1);
  assert.equal(s.towers[0].spent, 51);
  assert.deepEqual(s.upgradeTower(id), { ok: false, reason: 'max-tier' });
  assert.deepEqual(s.upgradeTower('nope'), { ok: false, reason: 'unknown' });
  const poor = makeState({ startingCorks: 40 });
  poor.placeTower(2, 0, 'cannon');
  assert.deepEqual(poor.upgradeTower(poor.towers[0].id), { ok: false, reason: 'no-corks' });
  assert.equal(poor.corks, 9);
});

test('sellTower refunds half of spent and costs an action', () => {
  const s = makeState();
  s.placeTower(2, 0, 'cannon');
  const id = s.towers[0].id;
  s.upgradeTower(id);
  assert.equal(s.corks, 49);
  assert.deepEqual(s.sellTower(id), { ok: true, refund: Math.floor((31 + 20) / 2) });
  assert.equal(s.corks, 74);
  assert.equal(s.towers.length, 0);
  assert.equal(s.actionsLeft, 0);
  assert.equal(s.tileType(2, 0), 'buildable');
});

test('sellRefund is half of spent rounded down', () => {
  assert.equal(sellRefund({ spent: 0 }), 0);
  assert.equal(sellRefund({ spent: 51 }), 25);
  assert.equal(sellRefund({ spent: 170 }), 85);
});

test('RF4: a 4th action is refused with no-actions and changes nothing', () => {
  const s = makeState({ startingCorks: 500 });
  assert.ok(s.placeTower(2, 0, 'cannon').ok);
  assert.ok(s.placeTower(3, 0, 'cannon').ok);
  assert.ok(s.upgradeTower(s.towers[0].id).ok);
  const corks = s.corks;
  assert.deepEqual(s.placeTower(4, 0, 'cannon'), { ok: false, reason: 'no-actions' });
  assert.deepEqual(s.upgradeTower(s.towers[1].id), { ok: false, reason: 'no-actions' });
  assert.deepEqual(s.sellTower(s.towers[1].id), { ok: false, reason: 'no-actions' });
  assert.equal(s.corks, corks);
  assert.equal(s.towers.length, 2);
  assert.equal(s.towers[1].tier, 0);
});

test('RF4: endTurn with 2 unused actions pays 20 caps, bonus event first; actions reset', () => {
  const g = makeState({ len: 9, waves: [one(), one()] });
  assert.ok(g.placeTower(2, 0, 'cannon').ok);
  const corks = g.corks;
  const r = g.endTurn();
  assert.equal(r.ok, true);
  assert.deepEqual(r.events[0], { type: 'bonus', round: -1, caps: 20 });
  const killReward = ofType(r.events, 'kill').reduce((n, e) => n + e.reward, 0);
  assert.equal(g.corks, corks + 20 + killReward);
  assert.equal(g.turn, 2);
  assert.equal(g.actionsLeft, 3);
  assert.equal(g.phase, 'player');
});

test('RF4: actions after won or lost return game-over', () => {
  const s = makeState({ startingWine: 3, waves: [one()] });
  let r;
  for (let i = 0; i < 20 && !s.over; i++) r = s.endTurn();
  assert.equal(s.phase, 'lost');
  assert.equal(s.endReason, 'kegs');
  assert.deepEqual(ofType(r.events, 'lost').map((e) => e.reason), ['kegs']);
  assert.deepEqual(s.placeTower(2, 0, 'cannon'), { ok: false, reason: 'game-over' });
  assert.deepEqual(s.upgradeTower(1), { ok: false, reason: 'game-over' });
  assert.deepEqual(s.sellTower(1), { ok: false, reason: 'game-over' });
  assert.equal(s.ringBell().reason, 'game-over');
  assert.equal(s.endTurn().reason, 'game-over');
});

test('RF4: the bell is free, works once, second ring is refused with used', () => {
  const s = makeState({ len: 9, waves: [[{ enemyId: 'guest', count: 2, intervalS: 0, delayS: 0 }]] });
  s.endTurn();
  assert.equal(s.enemies.length, 2);
  const corks = s.corks;
  const r = s.ringBell();
  assert.equal(r.ok, true);
  assert.equal(s.actionsLeft, 3);
  const bell = ofType(r.events, 'bell');
  assert.equal(bell.length, 1);
  assert.equal(bell[0].count, 2);
  assert.equal(bell[0].reward, 10);
  assert.equal(bell[0].ids.length, 2);
  assert.equal(s.corks, corks + 10);
  assert.equal(s.enemies.length, 0);
  assert.equal(s.bellUsed, true);
  const again = s.ringBell();
  assert.equal(again.ok, false);
  assert.equal(again.reason, 'used');
  assert.deepEqual(again.events, []);
  // The cleared last wave counts as won at the end of the next guests' turn.
  const end = s.endTurn();
  assert.equal(s.phase, 'won');
  assert.ok(ofType(end.events, 'won').length === 1);
});

// --- speed ---

test('a speed-3 guest advances 3 tiles per turn', () => {
  const s = custom({ enemyList: [{ ...guest, speed: 3 }], wave: one(), len: 12 });
  s.endTurn();
  assert.equal(s.enemies[0].pathIndex, 3);
  s.endTurn();
  assert.equal(s.enemies[0].pathIndex, 6);
});

test('a speed-0.6 guest steps [0, 1, 0, 1, 1] over 5 turns', () => {
  const s = custom({ enemyList: [{ ...guest, speed: 0.6 }], wave: one(), len: 12 });
  const steps = [];
  for (let i = 0; i < 5; i++) steps.push(stepsOf(s.endTurn().events, 1));
  assert.deepEqual(steps, [0, 1, 0, 1, 1]);
});

test('a speed-0 guest is clamped to 0.1 and arrives eventually', () => {
  const s = custom({ enemyList: [{ ...guest, speed: 0 }], wave: one(), len: 3 });
  assert.equal(s.previewSteps({ ...s.enemies[0], enemyId: 'guest', credit: 0.9, stalledTurns: 0, slowFactor: 1 }), 1);
  let leaked = 0;
  for (let i = 0; i < 40 && !s.over; i++) leaked += ofType(s.endTurn().events, 'leak').length;
  assert.equal(leaked, 1);
  assert.equal(s.phase, 'won');
  assert.ok(s.turn <= 21, `turn ${s.turn}`);
});

test('a guest landing on the bar tile leaks immediately and is not shot there', () => {
  // Tower covers only the last tile (index 4).
  const s = custom({ weaponList: [weapon('w', { damage: 1, fireRate: 5 })], wave: one(), len: 5,
    enemyList: [{ ...guest, speed: 4 }] });
  assert.ok(s.placeTower(4, 0, 'w').ok);
  const ev = s.endTurn().events;
  assert.equal(ofType(ev, 'shot').length, 0);
  const leak = ofType(ev, 'leak');
  assert.equal(leak.length, 1);
  assert.equal(leak[0].wineDamage, 3);
  assert.equal(leak[0].enemyId, 'guest');
  assert.equal(s.wine, 7);
  assert.equal(s.enemies.length, 0);
});

// --- fire rate ---

test('fireRate 0.45 fires [0, 0, 1, 0] over 4 turns', () => {
  const w = weapon('w', { range: 30, damage: 0, fireRate: 0.45 });
  const s = custom({ weaponList: [w], enemyList: [{ ...guest, speed: 0.1 }], wave: one(), len: 12 });
  s.placeTower(0, 2, 'w');
  const shots = [];
  for (let i = 0; i < 4; i++) shots.push(ofType(s.endTurn().events, 'shot').length);
  assert.deepEqual(shots, [0, 0, 1, 0]);
  assert.ok(Math.abs(s.towers[0].shotCredit - 0.8) < 1e-9);
});

test('upgrading to a higher fireRate gives more shots from the next guests turn', () => {
  const w = weapon('w', { range: 30, damage: 0, fireRate: 1, upgrades: [{ cost: 1, fireRate: 3 }] });
  const s = custom({ weaponList: [w], enemyList: [{ ...guest, speed: 0.1 }], wave: one(), len: 12 });
  s.placeTower(0, 2, 'w');
  assert.equal(ofType(s.endTurn().events, 'shot').length, 1);
  s.upgradeTower(s.towers[0].id);
  assert.equal(ofType(s.endTurn().events, 'shot').length, 3);
});

test('a tower fires at most once per round; a guest standing still takes all its shots', () => {
  const w = weapon('w', { range: 30, damage: 1, fireRate: 4 });
  const s = custom({ weaponList: [w], enemyList: [{ ...guest, hp: 100, speed: 0.1 }], wave: one(), len: 12 });
  s.placeTower(0, 2, 'w');
  const ev = s.endTurn().events;
  const shots = ofType(ev, 'shot');
  assert.equal(shots.length, 4);
  assert.equal(new Set(shots.map((e) => e.round)).size, 4);
  assert.equal(stepsOf(ev, 1), 0);
  assert.equal(s.enemies[0].hp, 96);

  // A walking guest: still at most one shot per tower per round.
  const fast = custom({ weaponList: [w], enemyList: [{ ...guest, hp: 100, speed: 3 }], wave: one(), len: 12 });
  fast.placeTower(0, 2, 'w');
  const ev2 = fast.endTurn().events;
  const rounds = ofType(ev2, 'shot').map((e) => e.round);
  assert.equal(rounds.length, 4);
  assert.equal(new Set(rounds).size, 4);
});

test('RF1: a speed-6 guest crossing a 1-tile range is shot exactly once', () => {
  const w = weapon('w', { range: 1, damage: 1, fireRate: 1 });
  const s = custom({ weaponList: [w], enemyList: [{ ...guest, hp: 100, speed: 6 }], wave: one(), len: 7 });
  assert.ok(s.placeTower(3, 0, 'w').ok); // covers only path tile 3
  const ev = s.endTurn().events;
  const shots = ofType(ev, 'shot');
  assert.equal(shots.length, 1);
  assert.equal(shots[0].x, 3.5);
  assert.equal(shots[0].y, 1.5);
  assert.equal(ofType(ev, 'leak').length, 1);
});

// --- stall ---

test('stall: hit in T cancels the rest of T, then ceil(d) turns without steps, then steps resume', () => {
  const w = weapon('d', { range: 1, damage: 0, fireRate: 1, effect: 'distract', effectDuration: 2.5 });
  const s = custom({ weaponList: [w], enemyList: [{ ...guest, hp: 100, speed: 3 }], wave: one(), len: 20 });
  s.placeTower(2, 0, 'd'); // covers only path tile 2
  const t1 = s.endTurn().events;
  assert.equal(s.enemies[0].pathIndex, 2);
  assert.deepEqual(ofType(t1, 'effect').map(({ id, kind, turns }) => ({ id, kind, turns })),
    [{ id: 1, kind: 'stall', turns: 3 }]);
  assert.equal(s.previewSteps(s.enemies[0]), 0);
  const steps = [];
  for (let i = 0; i < 4; i++) steps.push(stepsOf(s.endTurn().events, 1));
  assert.deepEqual(steps, [0, 0, 0, 3]);
});

test('stall immunity: no new stall for ceil(0.5 d) turns after a stall ends', () => {
  const w = weapon('l', { range: 30, damage: 0, fireRate: 1, effect: 'lure', effectDuration: 3 });
  const s = custom({ weaponList: [w], enemyList: [{ ...guest, hp: 100, speed: 1 }], wave: one(), len: 20 });
  s.placeTower(0, 2, 'l');
  const steps = [];
  const stalls = [];
  for (let i = 0; i < 12; i++) {
    const ev = s.endTurn().events;
    steps.push(stepsOf(ev, 1));
    stalls.push(ofType(ev, 'effect').length);
  }
  // T1 hit; T2-4 stalled; T5-6 immune (shot, no effect); T7 hit again; ...
  assert.deepEqual(steps, [0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1]);
  assert.deepEqual(stalls, [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0]);
});

test('RF2: a distract tower with fireRate 1 and duration 3 cannot pin a guest', () => {
  const w = weapon('d', { range: 30, damage: 0, fireRate: 1, effect: 'distract', effectDuration: 3 });
  const s = custom({ weaponList: [w], wave: one(), len: 7 });
  s.placeTower(0, 2, 'd');
  for (let i = 0; i < 50 && !s.over; i++) s.endTurn();
  assert.equal(s.phase, 'won');
  assert.equal(s.wine, 7);
});

// --- slow ---

test('slow: a hit in T leaves T alone and reduces T+1..T+ceil(d)', () => {
  const w = weapon('i', { range: 30, damage: 0, fireRate: 1, effect: 'slow', effectStrength: 0.5, effectDuration: 1.5 });
  const s = custom({ weaponList: [w], enemyList: [{ ...guest, hp: 100, speed: 2 }], wave: one(), len: 20 });
  s.placeTower(0, 2, 'i');
  const t1 = s.endTurn().events;
  assert.equal(stepsOf(t1, 1), 2);
  assert.deepEqual(ofType(t1, 'effect').map(({ kind, turns }) => ({ kind, turns })), [{ kind: 'slow', turns: 2 }]);
  assert.equal(s.enemies[0].slowFactor, 0.5);
  assert.equal(s.previewSteps(s.enemies[0]), 1);
  s.sellTower(s.towers[0].id);
  const steps = [];
  for (let i = 0; i < 3; i++) steps.push(stepsOf(s.endTurn().events, 1));
  assert.deepEqual(steps, [1, 1, 2]);
  assert.equal(s.enemies[0].slowFactor, 1);
});

// --- immunity ---

test('immune-to-distract guest keeps stepping and takes damage', () => {
  const w = weapon('d', { range: 30, damage: 1, fireRate: 1, effect: 'distract', effectDuration: 3 });
  const s = custom({ weaponList: [w], enemyList: [{ ...guest, hp: 100, immuneTo: ['distract'] }], wave: one(), len: 12 });
  s.placeTower(0, 2, 'd');
  const ev = s.endTurn().events;
  assert.equal(stepsOf(ev, 1), 1);
  assert.equal(ofType(ev, 'effect').length, 0);
  assert.equal(s.enemies[0].hp, 99);
  assert.equal(s.enemies[0].stalledTurns, 0);
});

test('lure: an immune guest walks on while its non-immune neighbour is stalled', () => {
  const defs = [
    { id: 'tough', name: 'T', hp: 100, speed: 1, reward: 1, wineDamage: 1, immuneTo: ['lure'] },
    { id: 'soft', name: 'S', hp: 100, speed: 1, reward: 1, wineDamage: 1 },
  ];
  const w = weapon('l', { range: 30, damage: 1, fireRate: 1, effect: 'lure', effectDuration: 3 });
  const s = custom({ weaponList: [w], enemyList: defs, len: 12,
    wave: [{ enemyId: 'tough', count: 1, intervalS: 1, delayS: 0 }, { enemyId: 'soft', count: 1, intervalS: 1, delayS: 0 }] });
  s.placeTower(0, 2, 'l');
  const ev = s.endTurn().events;
  const tough = s.enemies.find((e) => e.enemyId === 'tough');
  const soft = s.enemies.find((e) => e.enemyId === 'soft');
  assert.equal(ofType(ev, 'shot')[0].targetIds.length, 2);
  assert.equal(tough.pathIndex, 1);
  assert.equal(tough.hp, 99);
  assert.equal(soft.pathIndex, 0);
  assert.equal(soft.hp, 99);
  assert.equal(soft.stalledTurns, 3);
});

test('splash damages guests around the target, not only the target', () => {
  const w = weapon('b', { range: 30, damage: 4, fireRate: 1, effect: 'splash', effectStrength: 1.5 });
  const s = custom({ weaponList: [w], enemyList: [{ ...guest, hp: 100, speed: 1 }], len: 12,
    wave: [{ enemyId: 'guest', count: 2, intervalS: 1, delayS: 0 }] });
  s.placeTower(0, 2, 'b');
  s.endTurn();
  s.endTurn(); // turn 2: leader at 1 (round 0 shot), follower spawns at 0
  const [lead, follow] = s.enemies;
  assert.ok(follow.hp < 100, 'follower took splash');
  assert.ok(lead.hp < follow.hp);
});

// --- spawns ---

test('group {count 3, interval 0.5} spawns 2 guests in the first guests turn, 1 in the second', () => {
  const s = custom({ enemyList: [{ ...guest, speed: 0.1 }], len: 12,
    wave: [{ enemyId: 'guest', count: 3, intervalS: 0.5, delayS: 0 }] });
  const a = s.endTurn().events;
  assert.equal(ofType(a, 'spawn').length, 2);
  assert.deepEqual(ofType(a, 'spawn')[0], { type: 'spawn', round: 0, id: 1, enemyId: 'guest', pathIndex: 0 });
  assert.equal(ofType(s.endTurn().events, 'spawn').length, 1);
  assert.equal(ofType(s.endTurn().events, 'spawn').length, 0);
});

test('a spawned guest can be shot in round 0 on the door and moves the same turn', () => {
  const w = weapon('w', { range: 1, damage: 1, fireRate: 1 });
  const s = custom({ weaponList: [w], enemyList: [{ ...guest, hp: 100 }], wave: one(), len: 12 });
  s.placeTower(0, 2, 'w'); // covers door (0,1) only
  const ev = s.endTurn().events;
  const shot = ofType(ev, 'shot');
  assert.equal(shot.length, 1);
  assert.equal(shot[0].round, 0);
  assert.deepEqual(shot[0].targetIds, [1]);
  assert.deepEqual(ofType(ev, 'step').map(({ id, from, to, round }) => ({ id, from, to, round })),
    [{ id: 1, from: 0, to: 1, round: 1 }]);
});

test('ties move in spawn order', () => {
  const s = custom({ len: 12, wave: [{ enemyId: 'guest', count: 3, intervalS: 0, delayS: 0 }] });
  const steps = ofType(s.endTurn().events, 'step');
  assert.deepEqual(steps.map((e) => e.id), [1, 2, 3]);
  assert.deepEqual(s.enemies.map((e) => e.spawnOrder), [1, 2, 3]);
});

// --- waves, win, lose ---

test('wave 1 starts in turn 1; the next wave starts 2 guests turns after clearing', () => {
  const s = makeState({ len: 9, waves: [one(), one()] });
  s.placeTower(1, 0, 'cannon'); // covers the door: kills on spawn
  assert.equal(s.nextWaveIn, 0);
  const t1 = s.endTurn().events;
  assert.deepEqual(ofType(t1, 'wave-start').map((e) => e.wave), [1]);
  assert.equal(ofType(t1, 'kill').length, 1);
  const cleared = ofType(t1, 'wave-cleared');
  assert.equal(cleared.length, 1);
  assert.equal(cleared[0].wave, 1);
  assert.equal(cleared[0].nextWaveIn, 2);
  assert.equal(s.waveIndex, 1);
  assert.equal(s.turn, 2);
  assert.equal(s.nextWaveIn, 1);
  const t2 = s.endTurn().events;
  assert.equal(ofType(t2, 'wave-start').length, 0);
  assert.equal(s.nextWaveIn, 0);
  const t3 = s.endTurn().events;
  assert.deepEqual(ofType(t3, 'wave-start').map((e) => e.wave), [2]);
  assert.equal(ofType(t3, 'won').length, 1);
  assert.equal(ofType(t3, 'wave-cleared').length, 0);
  assert.equal(s.phase, 'won');
  assert.equal(s.nextWaveIn, null);
  assert.equal(s.turn, 3);
});

test('nextWaveIn is null while a wave runs', () => {
  const s = makeState({ len: 9, waves: [one(), one()] });
  s.endTurn();
  assert.equal(s.nextWaveIn, null);
});

test('a strong tower kills both guests: won, rewards paid, kill events carry ids', () => {
  const s = makeState({ len: 9 });
  s.placeTower(1, 0, 'cannon'); // covers the door
  const events = [];
  for (let i = 0; i < 10 && !s.over; i++) events.push(...s.endTurn().events);
  assert.equal(s.phase, 'won');
  assert.equal(s.endReason, null);
  assert.equal(s.wine, 10);
  const kills = ofType(events, 'kill');
  assert.deepEqual(kills.map((e) => e.id), [1, 2]);
  assert.equal(kills[0].reward, 5);
  assert.equal(kills[0].x, 0.5);
  assert.equal(kills[0].y, 1.5);
  const bonus = ofType(events, 'bonus').reduce((n, e) => n + e.caps, 0);
  assert.equal(s.corks, 100 - 31 + 10 + bonus);
});

test('without towers guests leak; won if kegs remain, lost with kegs reason otherwise', () => {
  const s = makeState();
  const events = [];
  for (let i = 0; i < 20 && !s.over; i++) events.push(...s.endTurn().events);
  assert.equal(s.phase, 'won');
  assert.equal(s.wine, 4);
  assert.deepEqual(ofType(events, 'leak').map((e) => e.id), [1, 2]);

  const l = makeState({ startingWine: 6 });
  for (let i = 0; i < 20 && !l.over; i++) l.endTurn();
  assert.equal(l.phase, 'lost');
  assert.equal(l.endReason, 'kegs');
  assert.equal(l.wine, 0);
});

test('RF3: a game that cannot end by itself is lost as too-long at turn 500', () => {
  const s = makeState({ startingWine: 100, waves: [[{ enemyId: 'guest', count: 2, intervalS: 1000, delayS: 0 }]] });
  let last;
  for (let i = 0; i < 600 && !s.over; i++) last = s.endTurn();
  assert.equal(s.phase, 'lost');
  assert.equal(s.endReason, 'too-long');
  assert.equal(s.turn, 500);
  assert.deepEqual(ofType(last.events, 'lost').map((e) => e.reason), ['too-long']);
});

// --- quotes ---

const quoted = { id: 'q', name: 'Q', hp: 1000, speed: 1, reward: 1, wineDamage: 1, quotes: ['hi', 'yo'] };

test('rng 0: exactly one quote in the spawn turn even with several quoted guests', () => {
  const s = custom({ enemyList: [quoted], len: 30, opts: { rng: () => 0 },
    wave: [{ enemyId: 'q', count: 4, intervalS: 0, delayS: 0 }] });
  const qs = ofType(s.endTurn().events, 'quote');
  assert.equal(qs.length, 1);
  assert.equal(qs[0].enemyId, 'q');
  assert.equal(qs[0].id, 1);
  assert.equal(qs[0].text, 'hi');
});

test('rng 0.99: no quotes', () => {
  const s = custom({ enemyList: [quoted], len: 30, opts: { rng: () => 0.99 },
    wave: [{ enemyId: 'q', count: 3, intervalS: 0, delayS: 0 }] });
  let n = 0;
  for (let i = 0; i < 10; i++) n += ofType(s.endTurn().events, 'quote').length;
  assert.equal(n, 0);
});

test('at most 2 quotes per guest; guests without quotes never speak', () => {
  const s = custom({ enemyList: [quoted], len: 30, opts: { rng: () => 0 }, wave: one('q') });
  let n = 0;
  for (let i = 0; i < 10; i++) n += ofType(s.endTurn().events, 'quote').length;
  assert.equal(n, 2);
  assert.equal(s.enemies[0].quotesLeft, 0);

  const mute = custom({ enemyList: [{ ...quoted, quotes: [] }], len: 30, opts: { rng: () => 0 }, wave: one('q') });
  let m = 0;
  for (let i = 0; i < 5; i++) m += ofType(mute.endTurn().events, 'quote').length;
  assert.equal(m, 0);
});

// --- determinism and event shape ---

function lcg(seed) {
  let x = seed >>> 0;
  return () => {
    x = (x * 1664525 + 1013904223) >>> 0;
    return x / 2 ** 32;
  };
}

function playScripted(seed) {
  const w = weapon('w', { range: 2, damage: 3, fireRate: 1.3 });
  const s = custom({ weaponList: [w], enemyList: [quoted, { ...guest, speed: 1.7, quotes: ['a', 'b', 'c'] }],
    len: 15, opts: { rng: lcg(seed) },
    waves: [[{ enemyId: 'q', count: 3, intervalS: 0.7, delayS: 0 }, { enemyId: 'guest', count: 4, intervalS: 0.4, delayS: 1 }]] });
  s.placeTower(5, 0, 'w');
  const log = [];
  for (let i = 0; i < 60 && !s.over; i++) log.push(s.endTurn().events);
  return log;
}

test('the same rng sequence gives identical event lists', () => {
  assert.deepEqual(playScripted(42), playScripted(42));
});

test('events are ordered by round, with bonus first at round -1', () => {
  for (const events of playScripted(7)) {
    const rounds = events.map((e) => e.round);
    for (let i = 1; i < rounds.length; i++) assert.ok(rounds[i] >= rounds[i - 1], JSON.stringify(events));
    for (const e of events) assert.equal(typeof e.round, 'number');
  }
});

// --- review fixes: splash hitIds, slow floor ---

test('splash shot events list every damaged guest in hitIds (targetIds stays the target)', () => {
  const w = weapon('b', { range: 30, damage: 4, fireRate: 1, effect: 'splash', effectStrength: 1.5 });
  const s = custom({ weaponList: [w], enemyList: [{ ...guest, hp: 100, speed: 1 }], len: 12,
    wave: [{ enemyId: 'guest', count: 2, intervalS: 1, delayS: 0 }] });
  s.placeTower(0, 2, 'b');
  s.endTurn();
  const shots = ofType(s.endTurn().events, 'shot');
  const splashShot = shots.find((e) => e.hitIds.length === 2);
  assert.ok(splashShot, 'a shot hit both guests');
  assert.deepEqual(splashShot.targetIds, [1]);
  assert.deepEqual([...splashShot.hitIds].sort(), [1, 2]);
});

test('single-target shot events carry hitIds equal to targetIds', () => {
  const w = weapon('c', { range: 30, damage: 1, fireRate: 1 });
  const s = custom({ weaponList: [w], enemyList: [{ ...guest, hp: 100 }], wave: one(), len: 12 });
  s.placeTower(0, 2, 'c');
  const [shot] = ofType(s.endTurn().events, 'shot');
  assert.deepEqual(shot.hitIds, shot.targetIds);
});

test('a full-strength slow cannot pin: effective speed never drops below 0.1', () => {
  const w = weapon('i', { range: 30, damage: 0, fireRate: 1, effect: 'slow', effectStrength: 1, effectDuration: 100 });
  const s = custom({ weaponList: [w], enemyList: [{ ...guest, hp: 100, speed: 1 }], wave: one(), len: 30 });
  s.placeTower(0, 2, 'i');
  s.endTurn();
  assert.equal(s.enemies[0].slowFactor, 0);
  let steps = 0;
  for (let i = 0; i < 10; i++) steps += stepsOf(s.endTurn().events, 1);
  assert.equal(steps, 1, '10 turns at 0.1 tiles per turn');
  s.enemies[0].credit = 0.95;
  assert.equal(s.previewSteps(s.enemies[0]), 1);
});
