// snake_case DB rows <-> camelCase in-app shapes. The only place that converts.

// A sprite is an image URL when it starts with http(s):// (any case), otherwise it is an emoji.
// The one definition: the game (sprites-data.js) and the admin reuse it.
export const isUrl = (s) => typeof s === 'string' && /^https?:\/\//i.test(s);

export const DEFAULT_GUEST_SPRITE = '👤';
export const DEFAULT_WEAPON_SPRITE = '❔';
export const DEFAULT_BAR_SPRITE = '🍻';

// The emoji shown when `sprite` is a URL that fails to load. For emoji sprites it is the sprite.
const fallbackFor = (explicit, sprite, dflt) =>
  explicit ?? (isUrl(sprite) || !sprite ? dflt : sprite);

export function weaponFromRow(r) {
  return {
    id: r.id, name: r.name, description: r.description, sprite: r.sprite,
    cost: r.cost, range: r.range, damage: r.damage, fireRate: r.fire_rate,
    effect: r.effect, effectStrength: r.effect_strength, effectDuration: r.effect_duration,
    upgrades: r.upgrades ?? [],
    fallbackSprite: fallbackFor(r.fallback_sprite, r.sprite, DEFAULT_WEAPON_SPRITE),
  };
}

export function weaponToRow(w) {
  return {
    id: w.id, name: w.name, description: w.description, sprite: w.sprite,
    cost: w.cost, range: w.range, damage: w.damage, fire_rate: w.fireRate,
    effect: w.effect, effect_strength: w.effectStrength, effect_duration: w.effectDuration,
    upgrades: w.upgrades,
    fallback_sprite: fallbackFor(w.fallbackSprite, w.sprite, DEFAULT_WEAPON_SPRITE),
  };
}

export function enemyFromRow(r) {
  return {
    id: r.id, name: r.name, description: r.description, sprite: r.sprite,
    hp: r.hp, speed: r.speed, reward: r.reward, wineDamage: r.wine_damage,
    quotes: r.quotes ?? [], immuneTo: r.immune_to ?? [],
    fallbackSprite: fallbackFor(r.fallback_sprite, r.sprite, DEFAULT_GUEST_SPRITE),
  };
}

export function enemyToRow(e) {
  return {
    id: e.id, name: e.name, description: e.description, sprite: e.sprite,
    hp: e.hp, speed: e.speed, reward: e.reward, wine_damage: e.wineDamage,
    quotes: e.quotes ?? [], immune_to: e.immuneTo ?? [],
    fallback_sprite: fallbackFor(e.fallbackSprite, e.sprite, DEFAULT_GUEST_SPRITE),
  };
}

export function levelFromRow(r) {
  return {
    id: r.id, name: r.name, sortOrder: r.sort_order, published: r.published,
    cols: r.cols, rows: r.rows, start: r.start, end: r.end,
    path: r.path ?? [], blocked: r.blocked ?? [], weaponIds: r.weapon_ids ?? [],
    startingCorks: r.starting_corks, startingWine: r.starting_wine,
    waves: r.waves ?? [],
    // null = legacy row without a guest list; derived from the waves (see levelEnemyIds).
    enemyIds: r.enemy_ids ?? null,
    barSprite: r.bar_sprite ?? DEFAULT_BAR_SPRITE,
  };
}

export function levelToRow(l) {
  return {
    id: l.id, name: l.name, sort_order: l.sortOrder, published: l.published,
    cols: l.cols, rows: l.rows, start: l.start, end: l.end,
    path: l.path, blocked: l.blocked, weapon_ids: l.weaponIds,
    starting_corks: l.startingCorks, starting_wine: l.startingWine,
    waves: l.waves,
    enemy_ids: l.enemyIds ?? null,
    bar_sprite: l.barSprite ?? DEFAULT_BAR_SPRITE,
  };
}
