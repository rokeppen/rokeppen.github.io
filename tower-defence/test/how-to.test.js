import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { howToPlay, CAFE_STATUS } from '../game/how-to.js';

const raw = JSON.parse(readFileSync(new URL('../fallback-data.json', import.meta.url), 'utf8'));
const guest = (id, name, immuneTo = []) => ({ id, name, sprite: '🙂', fallbackSprite: '🙂', immuneTo });
const immuneRow = (rows) => rows.find(([, text]) => /immune/i.test(text));

test('how-to names the guests that are immune to distraction, from the data', () => {
  const row = immuneRow(howToPlay(raw));
  assert.ok(row, 'an immunity line');
  assert.match(row[1], /Wine Snob/);
  const snob = raw.enemies.find((e) => e.id === 'wine-snob');
  assert.deepEqual(row[0], { enemy: 'wine-snob', fallback: snob.fallbackSprite });
});

test('how-to: other immune guests are listed; none immune drops the line', () => {
  const two = howToPlay({
    enemies: [guest('a', 'Auditor', ['distract']), guest('b', 'Boss', ['distract', 'slow']), guest('c', 'Clerk', ['slow'])],
  });
  const row = immuneRow(two);
  assert.match(row[1], /^Auditor and Boss:/);
  assert.doesNotMatch(row[1], /Clerk|Wine Snob/);
  assert.equal(row[0].enemy, 'a');
  const three = immuneRow(howToPlay({
    enemies: [guest('a', 'A', ['distract']), guest('b', 'B', ['distract']), guest('c', 'C', ['distract'])],
  }));
  assert.match(three[1], /^A, B and C:/);
  const none = howToPlay({ enemies: [guest('c', 'Clerk', ['slow'])] });
  assert.equal(immuneRow(none), undefined);
  assert.equal(none.length, two.length - 1);
  assert.ok(howToPlay(undefined).length > 0);
});

test("how-to: the Café row's fallback and the distracted status are not the beer bar's 🍻", () => {
  const cafeRow = howToPlay(raw).find(([spec]) => spec?.weapon === 'cafe');
  assert.ok(cafeRow);
  assert.notEqual(cafeRow[0].fallback, '🍻');
  assert.equal(cafeRow[0].fallback, raw.weapons.find((w) => w.id === 'cafe').fallbackSprite);
  assert.notEqual(CAFE_STATUS, '🍻');
});
