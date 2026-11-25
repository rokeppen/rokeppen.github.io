// Pure data-shape validation. No DOM, no CDN imports.
// Internal names predate the beer theme: corks/startingCorks = bottle caps, wine/startingWine/wineDamage = kegs.

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

const inBounds = (p, cols, rows) =>
  Number.isInteger(p?.x) && Number.isInteger(p?.y) &&
  p.x >= 0 && p.y >= 0 && p.x < cols && p.y < rows;

export function isPathValid(path, start, end, cols, rows) {
  if (!Array.isArray(path) || path.length < 2) return false;
  const seen = new Set();
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    if (!inBounds(p, cols, rows)) return false;
    const key = `${p.x},${p.y}`;
    if (seen.has(key)) return false;
    seen.add(key);
    if (i > 0) {
      const d = Math.abs(p.x - path[i - 1].x) + Math.abs(p.y - path[i - 1].y);
      if (d !== 1) return false;
    }
  }
  const first = path[0];
  const last = path[path.length - 1];
  return first.x === start?.x && first.y === start?.y &&
    last.x === end?.x && last.y === end?.y;
}

// The level's guest list: `enemyIds` when it is an array, else (legacy level) the unique
// enemy ids used in its waves, in order of first use.
export function levelEnemyIds(level) {
  if (Array.isArray(level?.enemyIds)) return level.enemyIds;
  const ids = [];
  for (const wave of Array.isArray(level?.waves) ? level.waves : []) {
    for (const g of Array.isArray(wave) ? wave : []) {
      if (g?.enemyId !== undefined && !ids.includes(g.enemyId)) ids.push(g.enemyId);
    }
  }
  return ids;
}

export function validateLevel(level, catalog) {
  const errors = [];
  const name = level?.name ?? level?.id ?? 'level';
  const weaponIds = new Set((catalog?.weapons ?? []).map(w => w.id));
  const enemyIds = new Set((catalog?.enemies ?? []).map(e => e.id));

  if (!isPathValid(level?.path, level?.start, level?.end, level?.cols, level?.rows)) {
    return { level: null, errors: [`${name}: path is invalid`] };
  }

  const explicitList = Array.isArray(level.enemyIds);
  const guestList = [];
  for (const id of levelEnemyIds(level)) {
    // Legacy lists derived from waves keep unknown ids; the wave loop reports those.
    if (explicitList && !enemyIds.has(id)) errors.push(`${name}: unknown guest "${id}" dropped`);
    else guestList.push(id);
  }
  if (guestList.length === 0 && explicitList) {
    errors.push(`${name}: no guests on the guest list`);
    return { level: null, errors };
  }
  const guests = new Set(guestList);

  const keptWeapons = [];
  for (const id of level.weaponIds ?? []) {
    if (weaponIds.has(id)) keptWeapons.push(id);
    else errors.push(`${name}: unknown weapon "${id}" dropped`);
  }

  const waves = [];
  (level.waves ?? []).forEach((wave, wi) => {
    const groups = [];
    for (const g of wave ?? []) {
      if (!enemyIds.has(g?.enemyId)) {
        errors.push(`${name}: wave ${wi + 1} has unknown enemy "${g?.enemyId}", group dropped`);
      } else if (!guests.has(g.enemyId)) {
        errors.push(`${name}: wave ${wi + 1} guest "${g.enemyId}" is not on the level's guest list, group dropped`);
      } else if (!Number.isInteger(g.count) || g.count < 1) {
        errors.push(`${name}: wave ${wi + 1} group "${g.enemyId}" count must be a whole number >= 1, group dropped`);
      } else if (!isNum(g.intervalS) || g.intervalS <= 0) {
        errors.push(`${name}: wave ${wi + 1} group "${g.enemyId}" interval must be > 0, group dropped`);
      } else if (!isNum(g.delayS) || g.delayS < 0) {
        errors.push(`${name}: wave ${wi + 1} group "${g.enemyId}" delay must be >= 0, group dropped`);
      } else {
        groups.push({ ...g });
      }
    }
    if (groups.length > 0) waves.push(groups);
    else errors.push(`${name}: wave ${wi + 1} is empty, dropped`);
  });

  const onPath = new Set(level.path.map(p => `${p.x},${p.y}`));
  const blocked = [];
  for (const b of level.blocked ?? []) {
    if (!inBounds(b, level.cols, level.rows)) {
      errors.push(`${name}: blocked tile (${b?.x},${b?.y}) is out of bounds, dropped`);
    } else if (onPath.has(`${b.x},${b.y}`)) {
      errors.push(`${name}: blocked tile (${b.x},${b.y}) is on the path, dropped`);
    } else {
      blocked.push({ x: b.x, y: b.y });
    }
  }

  if (!isNum(level.startingWine) || level.startingWine < 1) {
    errors.push(`${name}: starting kegs must be a number >= 1`);
    return { level: null, errors };
  }
  if (!isNum(level.startingCorks) || level.startingCorks < 0) {
    errors.push(`${name}: starting caps must be a number >= 0`);
    return { level: null, errors };
  }
  if (keptWeapons.length === 0) {
    errors.push(`${name}: no valid weapons left`);
    return { level: null, errors };
  }
  if (waves.length === 0) {
    errors.push(`${name}: no valid waves left`);
    return { level: null, errors };
  }

  return {
    level: {
      ...level,
      path: level.path.map(p => ({ ...p })),
      weaponIds: keptWeapons,
      enemyIds: guestList,
      waves,
      blocked,
    },
    errors,
  };
}

export function prepareGameData(raw, { includeUnpublished = false } = {}) {
  const weapons = raw.weapons ?? [];
  const enemies = raw.enemies ?? [];
  const levels = (raw.levels ?? [])
    .filter(l => includeUnpublished || l.published)
    .map(l => validateLevel(l, { weapons, enemies }).level)
    .filter(Boolean)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  return { weapons, enemies, levels };
}
