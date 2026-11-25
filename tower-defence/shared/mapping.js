// snake_case DB rows <-> camelCase in-app shapes. The only place that converts.

export function weaponFromRow(r) {
  return {
    id: r.id, name: r.name, description: r.description, sprite: r.sprite,
    cost: r.cost, range: r.range, damage: r.damage, fireRate: r.fire_rate,
    effect: r.effect, effectStrength: r.effect_strength, effectDuration: r.effect_duration,
    upgrades: r.upgrades ?? [],
  };
}

export function weaponToRow(w) {
  return {
    id: w.id, name: w.name, description: w.description, sprite: w.sprite,
    cost: w.cost, range: w.range, damage: w.damage, fire_rate: w.fireRate,
    effect: w.effect, effect_strength: w.effectStrength, effect_duration: w.effectDuration,
    upgrades: w.upgrades,
  };
}

export function enemyFromRow(r) {
  return {
    id: r.id, name: r.name, description: r.description, sprite: r.sprite,
    hp: r.hp, speed: r.speed, reward: r.reward, wineDamage: r.wine_damage,
  };
}

export function enemyToRow(e) {
  return {
    id: e.id, name: e.name, description: e.description, sprite: e.sprite,
    hp: e.hp, speed: e.speed, reward: e.reward, wine_damage: e.wineDamage,
  };
}

export function levelFromRow(r) {
  return {
    id: r.id, name: r.name, sortOrder: r.sort_order, published: r.published,
    cols: r.cols, rows: r.rows, start: r.start, end: r.end,
    path: r.path ?? [], blocked: r.blocked ?? [], weaponIds: r.weapon_ids ?? [],
    startingCorks: r.starting_corks, startingWine: r.starting_wine,
    waves: r.waves ?? [],
  };
}

export function levelToRow(l) {
  return {
    id: l.id, name: l.name, sort_order: l.sortOrder, published: l.published,
    cols: l.cols, rows: l.rows, start: l.start, end: l.end,
    path: l.path, blocked: l.blocked, weapon_ids: l.weaponIds,
    starting_corks: l.startingCorks, starting_wine: l.startingWine,
    waves: l.waves,
  };
}
