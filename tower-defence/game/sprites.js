// Phaser helpers for image sprites with emoji fallback.
import { EMOJI_FONT } from './theme.js';
import { isImageSprite, textureKey, collectImageUrls } from './sprites-data.js';

const PRELOAD_TIMEOUT_MS = 6000;
const failedKeys = new Set();

// Queues every image URL in the data and resolves when loading completes, fails or times out.
// Never rejects; failed keys are remembered so makeSprite falls back to emoji.
export function preloadImages(scene, data) {
  const urls = collectImageUrls(data).filter((u) => !scene.textures.exists(textureKey(u)));
  if (urls.length === 0) return Promise.resolve();
  return new Promise((resolve) => {
    let timer;
    let done = false;
    const loader = scene.load;
    const onError = (file) => { if (file?.key) failedKeys.add(file.key); };
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      loader.off('loaderror', onError);
      loader.off('complete', finish);
      resolve();
    };
    try {
      loader.setCORS?.('anonymous');
      loader.crossOrigin = 'anonymous';
      loader.on('loaderror', onError);
      loader.once('complete', finish);
      for (const u of urls) loader.image(textureKey(u), u);
      timer = setTimeout(() => {
        for (const u of urls) if (!scene.textures.exists(textureKey(u))) failedKeys.add(textureKey(u));
        finish();
      }, PRELOAD_TIMEOUT_MS);
      loader.start();
    } catch (e) {
      console.warn('Image preload failed:', e);
      finish();
    }
  });
}

export function makeSprite(scene, x, y, sprite, fallback, size) {
  if (isImageSprite(sprite)) {
    const key = textureKey(sprite);
    if (scene.textures.exists(key) && !failedKeys.has(key)) {
      const img = scene.add.image(x, y, key).setOrigin(0.5);
      return img.setScale(size / Math.max(img.width, img.height, 1));
    }
  }
  const glyph = (isImageSprite(fallback) ? '' : fallback) || (isImageSprite(sprite) ? '' : sprite) || '❔';
  return scene.add.text(x, y, glyph, { fontFamily: EMOJI_FONT, fontSize: `${size}px` }).setOrigin(0.5);
}
