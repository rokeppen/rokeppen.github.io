import test from 'node:test';
import assert from 'node:assert/strict';

function fakeStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), keys: () => [...m.keys()] };
}

test('progress uses v2 keys and ignores old real-time results', async () => {
  globalThis.window = { localStorage: fakeStorage() };
  window.localStorage.setItem('friday-drinks:best:level-1', JSON.stringify({ wave: 6, cleared: true }));
  const { loadBest, recordBest } = await import('../game/progress.js');
  assert.equal(loadBest('level-1')?.cleared ?? false, false);
  recordBest('level-1', 3, false);
  assert.ok(window.localStorage.keys().includes('friday-drinks:v2:best:level-1'));
  assert.equal(loadBest('level-1').wave, 3);
});
