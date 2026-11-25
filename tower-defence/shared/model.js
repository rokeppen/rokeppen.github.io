// Pure data-shape validation. No DOM, no CDN imports.

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

export function validateLevel(level, catalog) {
  const errors = [];
  const name = level?.name ?? level?.id ?? 'level';
  const weaponIds = new Set((catalog?.weapons ?? []).map(w => w.id));
  const enemyIds = new Set((catalog?.enemies ?? []).map(e => e.id));

  if (!isPathValid(level?.path, level?.start, level?.end, level?.cols, level?.rows)) {
    return { level: null, errors: [`${name}: path is invalid`] };
  }

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
      } else if (!(g.count >= 1)) {
        errors.push(`${name}: wave ${wi + 1} group "${g.enemyId}" has count < 1, group dropped`);
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
