import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PALETTE as P, contrast, css, rgba } from '../game/theme.js';

test('contrast() matches known WCAG values', () => {
  assert.equal(Math.round(contrast(0x000000, 0xffffff) * 10) / 10, 21);
  assert.equal(contrast(0x123456, 0x123456), 1);
});

test('css() and rgba() format colours', () => {
  assert.equal(css(0x0a0b0c), '#0a0b0c');
  assert.equal(rgba(0x28466e, 0.5), 'rgba(40,70,110,0.5)');
});

// Readability: path, furniture and pieces must stand out from the floor (and pieces from the
// path) by at least 3:1. White pieces read through their outline on the floor and through
// their face on the path.
test('board readability: key pairs reach 3:1', () => {
  const pairs = [
    ['path vs floor tile', P.path, P.floor],
    ['path vs board frame', P.path, P.board],
    ['furniture vs floor', P.blocked, P.floor],
    ['piece outline vs floor', P.pieceOutline, P.floor],
    ['tower face vs path', P.towerTop, P.path],
    ['guest face vs path', P.guest, P.path],
  ];
  for (const [name, a, b] of pairs) {
    assert.ok(contrast(a, b) >= 3, `${name}: ${contrast(a, b).toFixed(2)}`);
  }
});

test('UI text on white cards reaches 4.5:1 (muted 3.5:1)', () => {
  assert.ok(contrast(P.text, P.card) >= 4.5);
  assert.ok(contrast(P.white, P.navy) >= 4.5);
  assert.ok(contrast(P.goldText, P.gold) >= 4.5);
  assert.ok(contrast(P.danger, P.card) >= 4.5);
  assert.ok(contrast(P.goodText, P.card) >= 4.5);
  assert.ok(contrast(P.muted, P.card) >= 3.5);
});
