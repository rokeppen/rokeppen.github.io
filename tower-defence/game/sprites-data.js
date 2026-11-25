// Pure helpers for image sprites (no Phaser): URL detection, texture keys, URL collection.
export function isImageSprite(s) {
  return typeof s === 'string' && /^https?:\/\//i.test(s);
}

export function textureKey(url) {
  return `img:${url}`;
}

export function collectImageUrls(data) {
  const all = [
    ...(data?.weapons ?? []).map((w) => w.sprite),
    ...(data?.enemies ?? []).map((e) => e.sprite),
    ...(data?.levels ?? []).map((l) => l.barSprite),
  ];
  return [...new Set(all.filter(isImageSprite))];
}
