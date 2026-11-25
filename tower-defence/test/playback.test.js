import test from 'node:test';
import assert from 'node:assert/strict';
import { planPlayback, scaleMs, STEP_MS, FIRE_MS, OPEN_MS, FAST_FACTOR, WALK_CAP_MS, MIN_STEP_MS } from '../game/playback.js';

const ev = (type, round, extra = {}) => ({ type, round, ...extra });

// A typical guests' turn: wave start + spawn in round 0 with a shot, two walking rounds
// (one with a leak), a firing-only round and the end-of-turn event.
const turn = [
  ev('bonus', -1, { caps: 20 }),
  ev('wave-start', 0, { wave: 1 }),
  ev('spawn', 0, { id: 1 }),
  ev('quote', 0, { id: 1, text: 'Hi' }),
  ev('shot', 0, { towerId: 1, targetIds: [1] }),
  ev('step', 1, { id: 1, from: 0, to: 1 }),
  ev('shot', 1, { towerId: 1, targetIds: [1] }),
  ev('effect', 1, { id: 1, kind: 'slow', turns: 2 }),
  ev('step', 2, { id: 1, from: 1, to: 2 }),
  ev('leak', 2, { id: 1, wineDamage: 1 }),
  ev('shot', 3, { towerId: 2, targetIds: [2] }),
  ev('kill', 3, { id: 2, reward: 5, x: 1.5, y: 1.5 }),
  ev('wave-cleared', 4, { wave: 1, nextWaveIn: 2 }),
];

test('playback: events are grouped by round, in order, moves before shots', () => {
  const beats = planPlayback(turn);
  assert.deepEqual(beats.map((b) => [b.round, b.kind]), [
    [-1, 'open'], [0, 'open'], [0, 'fire'], [1, 'move'], [1, 'fire'], [2, 'move'], [3, 'fire'], [4, 'open'],
  ]);
  // Every event is played exactly once and in the engine's order.
  assert.deepEqual(beats.flatMap((b) => b.events), turn);
  assert.deepEqual(beats[1].events.map((e) => e.type), ['wave-start', 'spawn', 'quote']);
  assert.deepEqual(beats[5].events.map((e) => e.type), ['step', 'leak']);
});

test('playback: bonus comes first even when listed later; rounds sort numerically', () => {
  const shuffled = [ev('step', 10, { id: 1 }), ev('step', 2, { id: 1 }), ev('bonus', -1, { caps: 10 })];
  const beats = planPlayback(shuffled);
  assert.equal(beats[0].events[0].type, 'bonus');
  assert.deepEqual(beats.map((b) => b.round), [-1, 2, 10]);
});

test('playback: step durations scale with fast-forward', () => {
  const slow = planPlayback(turn);
  const fast = planPlayback(turn, { fast: true });
  const move = slow.find((b) => b.kind === 'move');
  const fire = slow.find((b) => b.kind === 'fire' && b.ms > 0);
  assert.equal(move.ms, STEP_MS);
  assert.equal(fire.ms, FIRE_MS);
  assert.equal(slow[1].ms, OPEN_MS, 'a beat with spawns pauses so the guest is seen arriving');
  slow.forEach((b, i) => assert.equal(fast[i].ms, scaleMs(b.ms, true)));
  assert.equal(scaleMs(STEP_MS, true), Math.round(STEP_MS / FAST_FACTOR));
  assert.equal(scaleMs(STEP_MS, false), STEP_MS);
  const total = (beats) => beats.reduce((n, b) => n + b.ms, 0);
  assert.ok(total(fast) * 2.5 < total(slow) && total(fast) * 3.5 > total(slow));
});

test('playback: beats without anything to watch take no time; no events, no beats', () => {
  const beats = planPlayback([ev('effect', 1, { id: 1, kind: 'stall', turns: 1 }), ev('won', 2)]);
  assert.deepEqual(beats.map((b) => b.ms), [0, 0]);
  assert.deepEqual(planPlayback([]), []);
});

test('playback: long walks get shorter steps, the walk stays within the cap', () => {
  const walk = (n) => Array.from({ length: n }, (_, i) => ev('step', i + 1, { id: 1, from: i, to: i + 1 }));
  const short = planPlayback(walk(3));
  assert.ok(short.every((b) => b.ms === STEP_MS && b.stepMs === STEP_MS), 'short walks keep 120 ms steps');
  for (const n of [6, 10, 16]) {
    const beats = planPlayback(walk(n));
    const total = beats.reduce((t, b) => t + b.ms, 0);
    assert.ok(total <= WALK_CAP_MS, `${n} steps take ${total} ms`);
    assert.ok(beats.every((b) => b.stepMs === b.ms && b.ms >= MIN_STEP_MS && b.ms < STEP_MS));
  }
  // Fast-forward scales the shortened steps too.
  const fast = planPlayback(walk(10), { fast: true });
  assert.equal(fast[0].stepMs, scaleMs(Math.floor(WALK_CAP_MS / 10), true));
  // Several guests stepping in the same round count as one round of walking.
  const crowd = [...walk(4), ...walk(4).map((e) => ({ ...e, id: 2 }))];
  assert.ok(planPlayback(crowd).every((b) => b.ms === STEP_MS));
});
