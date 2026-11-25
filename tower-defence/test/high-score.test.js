import test from 'node:test';
import assert from 'node:assert/strict';

function fakeStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), keys: () => [...m.keys()] };
}

const fresh = async () => {
  globalThis.window = { localStorage: fakeStorage() };
  return import('../game/progress.js');
};

test('high score: none until a level is cleared', async () => {
  const { loadHighScore } = await fresh();
  assert.equal(loadHighScore('level-1'), null);
});

test('high score: the first cleared run sets it, only higher scores replace it', async () => {
  const { loadHighScore, recordHighScore } = await fresh();
  assert.deepEqual(recordHighScore('level-1', 120), { best: 120, previous: null, isNew: true });
  assert.deepEqual(recordHighScore('level-1', 90), { best: 120, previous: 120, isNew: false });
  assert.deepEqual(recordHighScore('level-1', 120), { best: 120, previous: 120, isNew: false });
  assert.deepEqual(recordHighScore('level-1', 150), { best: 150, previous: 120, isNew: true });
  assert.equal(loadHighScore('level-1'), 150);
  assert.equal(loadHighScore('level-2'), null);
  assert.ok(window.localStorage.keys().includes('friday-drinks:v2:score:level-1'));
});

test('high score: junk in storage reads as no score', async () => {
  const { loadHighScore, recordHighScore } = await fresh();
  window.localStorage.setItem('friday-drinks:v2:score:level-1', 'not json');
  assert.equal(loadHighScore('level-1'), null);
  window.localStorage.setItem('friday-drinks:v2:score:level-1', JSON.stringify({ score: -5 }));
  assert.equal(loadHighScore('level-1'), null);
  assert.equal(recordHighScore('level-1', 10).isNew, true);
});

test('high score: blocked storage never throws', async () => {
  globalThis.window = { get localStorage() { throw new Error('blocked'); } };
  const { loadHighScore, recordHighScore } = await import('../game/progress.js');
  assert.equal(loadHighScore('level-1'), null);
  assert.deepEqual(recordHighScore('level-1', 50), { best: 50, previous: null, isNew: true });
});

test('high score line: new record, beaten record, or nothing on a loss', async () => {
  const { highScoreLine } = await fresh();
  assert.equal(highScoreLine({ best: 120, previous: null, isNew: true }), '🏅 New high score! First clear.');
  assert.equal(highScoreLine({ best: 150, previous: 120, isNew: true }), '🏅 New high score! Beat 120 🧢 by 30.');
  assert.equal(highScoreLine({ best: 150, previous: 150, isNew: false }), 'High score: 150 🧢');
  assert.equal(highScoreLine(null), '');
});
