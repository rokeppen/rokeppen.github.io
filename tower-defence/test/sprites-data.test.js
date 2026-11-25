import test from 'node:test';
import assert from 'node:assert/strict';
import { isImageSprite, textureKey, collectImageUrls } from '../game/sprites-data.js';

test('isImageSprite detects http(s) URLs only', () => {
  assert.equal(isImageSprite('http://x.test/a.png'), true);
  assert.equal(isImageSprite('https://x.test/a.png'), true);
  assert.equal(isImageSprite('🍷'), false);
  assert.equal(isImageSprite(''), false);
  assert.equal(isImageSprite(undefined), false);
});

test('textureKey is stable and prefixed', () => {
  assert.equal(textureKey('https://x.test/a.png'), 'img:https://x.test/a.png');
});

test('collectImageUrls dedupes and includes barSprite, skipping emoji', () => {
  const data = {
    weapons: [{ sprite: 'https://x/a.png' }, { sprite: '🍷' }],
    enemies: [{ sprite: 'https://x/a.png' }, { sprite: 'https://x/b.png' }],
    levels: [{ barSprite: 'https://x/c.png' }, { barSprite: '🍺' }, {}],
  };
  assert.deepEqual(collectImageUrls(data), ['https://x/a.png', 'https://x/b.png', 'https://x/c.png']);
});
