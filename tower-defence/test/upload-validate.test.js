import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_BYTES, ALLOWED_TYPES, validateImageFile, objectPathFor, storagePathFromUrl } from '../admin/upload-validate.js';

const BASE = 'https://abc.supabase.co/storage/v1/object/public/sprites/';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

test('constants match the sprites bucket', () => {
  assert.equal(MAX_BYTES, 1048576);
  assert.deepEqual(ALLOWED_TYPES, ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp']);
});

test('validateImageFile rejects gif and oversize, accepts exactly 1 MB png', () => {
  assert.equal(typeof validateImageFile({ type: 'image/gif', size: 10 }), 'string');
  assert.equal(typeof validateImageFile({ type: 'image/png', size: 1048577 }), 'string');
  assert.equal(validateImageFile({ type: 'image/png', size: 1048576 }), null);
  for (const type of ALLOWED_TYPES) assert.equal(validateImageFile({ type, size: 1 }), null, type);
  assert.equal(typeof validateImageFile({ type: '', size: 1 }), 'string');
  assert.equal(typeof validateImageFile({ type: 'image/png', size: 0 }), 'string');
  assert.equal(typeof validateImageFile(null), 'string');
});

test('objectPathFor is <uuid>.<ext> with the extension from the MIME type', () => {
  const cases = [['image/png', 'png'], ['image/jpeg', 'jpg'], ['image/svg+xml', 'svg'], ['image/webp', 'webp']];
  for (const [type, ext] of cases) {
    assert.match(objectPathFor({ type, name: 'whatever.bin' }), new RegExp(`^${UUID}\\.${ext}$`), type);
  }
  assert.notEqual(objectPathFor({ type: 'image/png' }), objectPathFor({ type: 'image/png' }));
});

test('objectPathFor falls back to a known filename extension only', () => {
  assert.match(objectPathFor({ type: '', name: 'Guest.PNG' }), new RegExp(`^${UUID}\\.png$`));
  assert.match(objectPathFor({ type: '', name: 'pic.jpeg' }), new RegExp(`^${UUID}\\.jpg$`));
  assert.match(objectPathFor({ type: '', name: 'evil.html' }), new RegExp(`^${UUID}$`));
  assert.match(objectPathFor({ type: '', name: 'noext' }), new RegExp(`^${UUID}$`));
});

test('storagePathFromUrl round-trips a getPublicUrl-style URL', () => {
  const path = objectPathFor({ type: 'image/webp' });
  assert.equal(storagePathFromUrl(BASE + path), path);
  assert.equal(storagePathFromUrl(BASE + 'abc.png?t=123'), 'abc.png');
  assert.equal(storagePathFromUrl(BASE.replace('https', 'HTTPS') + 'abc.png'), 'abc.png');
  assert.equal(storagePathFromUrl(BASE + 'dir/a%20b.png'), 'dir/a b.png');
});

test('storagePathFromUrl returns null for foreign URLs and non-URLs', () => {
  assert.equal(storagePathFromUrl('https://example.com/cat.png'), null);
  assert.equal(storagePathFromUrl('https://abc.supabase.co/storage/v1/object/public/other/a.png'), null);
  assert.equal(storagePathFromUrl(BASE), null);
  assert.equal(storagePathFromUrl('🍺'), null);
  assert.equal(storagePathFromUrl(''), null);
  assert.equal(storagePathFromUrl(undefined), null);
  assert.equal(storagePathFromUrl('not a url /storage/v1/object/public/sprites/a.png'), null);
});
