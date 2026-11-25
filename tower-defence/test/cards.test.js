import test from 'node:test';
import assert from 'node:assert/strict';
import { GameState } from '../game/logic/state.js';
import { rollCard, startingHand, cardTitle, CARD_WEIGHTS, HAND_START, HAND_MAX } from '../game/logic/cards.js';

function lcg(seed) {
  let x = seed >>> 0;
  return () => {
    x = (x * 1664525 + 1013904223) >>> 0;
    return x / 2 ** 32;
  };
}

const path = Array.from({ length: 5 }, (_, x) => ({ x, y: 1 }));
const up = { id: 'up', name: 'Up', cost: 30, range: 2, damage: 100, fireRate: 5, effect: 'none',
  effectStrength: 0, effectDuration: 0, upgrades: [{ cost: 20, damage: 200 }] };
const flat = { id: 'flat', name: 'Flat', cost: 10, range: 2, damage: 1, fireRate: 1, effect: 'none',
  effectStrength: 0, effectDuration: 0, upgrades: [] };
const guest = { id: 'guest', name: 'Guest', hp: 10, speed: 1, reward: 5, wineDamage: 3 };

function makeState({ weaponIds = ['up', 'flat'], waves, wine = 10, seed = 7 } = {}) {
  const level = {
    id: 'l', name: 'L', sortOrder: 1, published: true, cols: 5, rows: 3,
    start: path[0], end: path[4], path, blocked: [], weaponIds,
    startingCorks: 50, startingWine: wine,
    waves: waves || [[{ enemyId: 'guest', count: 1, intervalS: 1, delayS: 0 }]],
  };
  return new GameState(level, { weapons: [up, flat], enemies: [guest] }, { rng: lcg(seed) });
}

// Puts exactly these cards in the hand (ids 101, 102, ...).
function giveHand(s, cards) {
  s.hand = cards.map((c, i) => ({ id: 101 + i, ...c }));
}

test('rollCard follows the weights within ±3 %', () => {
  const rng = lcg(1);
  const counts = { build: 0, upgrade: 0, sell: 0, bell: 0 };
  const N = 2000;
  for (let i = 0; i < N; i++) counts[rollCard(rng, [up, flat]).kind] += 1;
  for (const k of Object.keys(CARD_WEIGHTS)) {
    assert.ok(Math.abs(counts[k] / N - CARD_WEIGHTS[k]) < 0.03, `${k}: ${counts[k] / N}`);
  }
});

test('rollCard: build and upgrade carry a weapon; upgrade only weapons with upgrades', () => {
  const rng = lcg(2);
  for (let i = 0; i < 500; i++) {
    const c = rollCard(rng, [up, flat]);
    if (c.kind === 'upgrade') assert.equal(c.weaponId, 'up');
    else if (c.kind === 'build') assert.ok(['up', 'flat'].includes(c.weaponId));
    else assert.equal(c.weaponId, undefined);
  }
});

test('rollCard never returns upgrade when no weapon has upgrades', () => {
  const rng = lcg(3);
  for (let i = 0; i < 500; i++) assert.notEqual(rollCard(rng, [flat]).kind, 'upgrade');
});

test('startingHand: 3 cards, the first two builds with different weapons', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const hand = startingHand(lcg(seed), [up, flat]);
    assert.equal(hand.length, HAND_START);
    assert.equal(hand[0].kind, 'build');
    assert.equal(hand[1].kind, 'build');
    assert.notEqual(hand[0].weaponId, hand[1].weaponId);
  }
  const single = startingHand(lcg(1), [flat]);
  assert.equal(single[0].weaponId, 'flat');
  assert.equal(single[1].weaponId, 'flat');
});

test('cardTitle names the action', () => {
  const defs = new Map([['up', up]]);
  assert.equal(cardTitle({ kind: 'build', weaponId: 'up' }, defs), 'Build Up');
  assert.equal(cardTitle({ kind: 'upgrade', weaponId: 'up' }, defs), 'Upgrade Up');
  assert.equal(cardTitle({ kind: 'sell' }, defs), 'Sell a weapon');
  assert.equal(cardTitle({ kind: 'bell' }, defs), 'Ring the bell');
});

test('a new game has 3 cards with unique ids and no card played', () => {
  const s = makeState();
  assert.equal(s.hand.length, 3);
  assert.equal(new Set(s.hand.map((c) => c.id)).size, 3);
  assert.equal(s.cardPlayedThisTurn, false);
  assert.equal(s.actionsLeft, undefined);
  assert.equal(s.bellUsed, undefined);
});

test('playCard build places a tower without spending caps', () => {
  const s = makeState();
  giveHand(s, [{ kind: 'build', weaponId: 'up' }, { kind: 'sell' }]);
  assert.deepEqual(s.playCard(101, { x: 2, y: 0 }), { ok: true });
  assert.equal(s.corks, 50);
  assert.equal(s.towers.length, 1);
  assert.equal(s.towers[0].weaponId, 'up');
  assert.deepEqual(s.hand.map((c) => c.id), [102]);
  assert.equal(s.cardPlayedThisTurn, true);
});

test('a second card in the same turn is refused and changes nothing', () => {
  const s = makeState();
  giveHand(s, [{ kind: 'build', weaponId: 'up' }, { kind: 'build', weaponId: 'flat' }]);
  s.playCard(101, { x: 2, y: 0 });
  assert.deepEqual(s.playCard(102, { x: 3, y: 0 }), { ok: false, reason: 'card-played' });
  assert.equal(s.towers.length, 1);
  assert.equal(s.hand.length, 1);
});

test('failed plays leave hand and state unchanged', () => {
  const s = makeState();
  s.placeTower(3, 0, 'flat');
  s.placeTower(4, 0, 'up');
  s.upgradeTower(s.towers[1].id);
  giveHand(s, [{ kind: 'build', weaponId: 'up' }, { kind: 'upgrade', weaponId: 'up' }, { kind: 'sell' }]);
  const before = JSON.stringify({ h: s.hand, t: s.towers, c: s.corks });
  assert.deepEqual(s.playCard(101, { x: 1, y: 1 }), { ok: false, reason: 'not-buildable' });
  assert.deepEqual(s.playCard(101), { ok: false, reason: 'no-target' });
  assert.deepEqual(s.playCard(102, { towerId: s.towers[0].id }), { ok: false, reason: 'wrong-weapon' });
  assert.deepEqual(s.playCard(102, { towerId: s.towers[1].id }), { ok: false, reason: 'max-tier' });
  assert.deepEqual(s.playCard(102, { towerId: 999 }), { ok: false, reason: 'no-target' });
  assert.deepEqual(s.playCard(103), { ok: false, reason: 'no-target' });
  assert.deepEqual(s.playCard(999), { ok: false, reason: 'unknown-card' });
  assert.equal(JSON.stringify({ h: s.hand, t: s.towers, c: s.corks }), before);
  assert.equal(s.cardPlayedThisTurn, false);
});

test('upgrade card upgrades a tower of its weapon, free', () => {
  const s = makeState();
  s.placeTower(2, 0, 'up');
  giveHand(s, [{ kind: 'upgrade', weaponId: 'up' }]);
  assert.deepEqual(s.playCard(101, { towerId: s.towers[0].id }), { ok: true });
  assert.equal(s.towers[0].tier, 1);
  assert.equal(s.corks, 50);
});

test('sell card refunds 50 % of spent into caps', () => {
  const s = makeState();
  s.placeTower(2, 0, 'up');
  s.upgradeTower(s.towers[0].id);
  giveHand(s, [{ kind: 'sell' }]);
  assert.deepEqual(s.playCard(101, { towerId: s.towers[0].id }), { ok: true, refund: 25 });
  assert.equal(s.corks, 75);
  assert.equal(s.towers.length, 0);
});

test('bell card: refused with no guests, clears guests and pays when present, can be rung again', () => {
  const s = makeState({ waves: [[{ enemyId: 'guest', count: 4, intervalS: 2, delayS: 0 }]] });
  giveHand(s, [{ kind: 'bell' }, { kind: 'bell' }]);
  assert.deepEqual(s.playCard(101), { ok: false, reason: 'no-target' });
  s.endTurn();
  s.hand = s.hand.filter((c) => c.kind === 'bell');
  assert.equal(s.enemies.length, 1);
  const r = s.playCard(101);
  assert.equal(r.ok, true);
  assert.equal(r.events[0].type, 'bell');
  assert.equal(s.enemies.length, 0);
  assert.equal(s.corks, 55);
  s.endTurn();
  s.endTurn();
  assert.ok(s.enemies.length > 0);
  assert.equal(s.playCard(102).ok, true);
});

test('endTurn draws one card and emits draw; at the hand limit nothing is drawn', () => {
  // The only guest arrives late, so the game outlasts filling the hand.
  const s = makeState({ waves: [[{ enemyId: 'guest', count: 1, intervalS: 1, delayS: 20 }]] });
  const { events } = s.endTurn();
  assert.equal(s.hand.length, 4);
  const draws = events.filter((e) => e.type === 'draw');
  assert.equal(draws.length, 1);
  assert.deepEqual(draws[0].card, s.hand[3]);
  for (let i = 0; i < 20 && s.hand.length < HAND_MAX; i++) s.endTurn();
  assert.equal(s.over, false);
  const full = s.endTurn();
  assert.equal(s.hand.length, HAND_MAX);
  assert.equal(full.events.filter((e) => e.type === 'draw').length, 0);
});

test('no draw after the game ends', () => {
  const s = makeState({ wine: 1 });
  let last;
  while (!s.over) last = s.endTurn();
  assert.equal(s.phase, 'lost');
  assert.equal(last.events.filter((e) => e.type === 'draw').length, 0);
  const n = s.hand.length;
  assert.equal(s.endTurn().ok, false);
  assert.equal(s.hand.length, n);
});

test('cardPlayable: per kind, and false for all after a card is played until next turn', () => {
  const s = makeState({ waves: [[{ enemyId: 'guest', count: 1, intervalS: 1, delayS: 20 }]] });
  giveHand(s, [{ kind: 'build', weaponId: 'flat' }, { kind: 'upgrade', weaponId: 'up' },
    { kind: 'sell' }, { kind: 'bell' }, { kind: 'build', weaponId: 'up' }]);
  const playable = () => s.hand.map((c) => s.cardPlayable(c));
  assert.deepEqual(playable(), [true, false, false, false, true]);
  s.playCard(105, { x: 2, y: 0 });
  assert.deepEqual(playable(), [false, false, false, false]);
  s.endTurn();
  assert.deepEqual(playable().slice(0, 4), [true, true, true, false]);
});

test('ending a turn pays no bonus', () => {
  const s = makeState({ waves: [[{ enemyId: 'guest', count: 1, intervalS: 1, delayS: 5 }]] });
  const { events } = s.endTurn();
  assert.equal(events.filter((e) => e.type === 'bonus').length, 0);
  assert.equal(s.corks, 50);
});
