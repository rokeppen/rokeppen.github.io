// Pure level-editing operations for the admin level editor.
// No DOM, no CDN imports: tested in Node. Every function returns a new level and
// never mutates its input; when an edit is refused the same level object is returned.
import { isPathValid, validateLevel } from '../shared/model.js';

export const DEFAULT_COLS = 16;
export const DEFAULT_ROWS = 10;
export const MIN_SIZE = 5;
export const MAX_SIZE = 30;

const same = (a, b) => !!a && !!b && a.x === b.x && a.y === b.y;
const tile = (t) => ({ x: t.x, y: t.y });
const inBounds = (t, cols, rows) => t.x >= 0 && t.y >= 0 && t.x < cols && t.y < rows;
const without = (tiles, t) => tiles.filter((p) => !same(p, t));

export function newLevel() {
  return {
    id: crypto.randomUUID(),
    name: 'New level',
    sortOrder: 0,
    published: false,
    cols: DEFAULT_COLS,
    rows: DEFAULT_ROWS,
    start: null,
    end: null,
    path: [],
    blocked: [],
    weaponIds: [],
    startingCorks: 100,
    startingWine: 20,
    waves: [],
  };
}

// Deep copy (levels are plain JSON data).
export function cloneLevel(level) {
  return structuredClone(level);
}

export function duplicateLevel(level) {
  return { ...cloneLevel(level), id: crypto.randomUUID(), name: `${level.name} (copy)`, published: false };
}

function setEndpoint(level, key, t) {
  if (!inBounds(t, level.cols, level.rows)) return level;
  if (same(level[key], t)) return level;
  const other = key === 'start' ? 'end' : 'start';
  return {
    ...level,
    [key]: tile(t),
    [other]: same(level[other], t) ? null : level[other],
    path: [],
    blocked: without(level.blocked, t),
  };
}

export const setStart = (level, t) => setEndpoint(level, 'start', t);
export const setEnd = (level, t) => setEndpoint(level, 'end', t);

export function extendPath(level, t) {
  const { path } = level;
  if (path.length === 0) {
    return same(t, level.start) ? { ...level, path: [tile(t)] } : level;
  }
  const last = path[path.length - 1];
  if (same(t, last)) return { ...level, path: path.slice(0, -1) };
  const adjacent = Math.abs(t.x - last.x) + Math.abs(t.y - last.y) === 1;
  if (!adjacent || !inBounds(t, level.cols, level.rows) || path.some((p) => same(p, t))) return level;
  return { ...level, path: [...path, tile(t)], blocked: without(level.blocked, t) };
}

export function toggleBlocked(level, t) {
  if (!inBounds(t, level.cols, level.rows)) return level;
  if (same(t, level.start) || same(t, level.end) || level.path.some((p) => same(p, t))) return level;
  const blocked = level.blocked.some((p) => same(p, t))
    ? without(level.blocked, t)
    : [...level.blocked, tile(t)];
  return { ...level, blocked };
}

// Erase whatever is on a tile: start/end (and with them the path), the path from
// this tile onwards, or a blocked tile.
export function eraseTile(level, t) {
  if (same(t, level.start)) return { ...level, start: null, path: [] };
  if (same(t, level.end)) return { ...level, end: null, path: [] };
  const i = level.path.findIndex((p) => same(p, t));
  if (i >= 0) return { ...level, path: level.path.slice(0, i) };
  if (level.blocked.some((p) => same(p, t))) return { ...level, blocked: without(level.blocked, t) };
  return level;
}

export const TOOLS = ['start', 'end', 'path', 'blocked', 'erase'];

export function applyTool(level, tool, t) {
  switch (tool) {
    case 'start': return setStart(level, t);
    case 'end': return setEnd(level, t);
    case 'path': return extendPath(level, t);
    case 'blocked': return toggleBlocked(level, t);
    case 'erase': return eraseTile(level, t);
    default: return level;
  }
}

export function resizeLevel(level, cols, rows) {
  const warnings = [];
  const fits = (t) => inBounds(t, cols, rows);
  let { start, end, path } = level;

  const lostEnds = [start && !fits(start) && 'start', end && !fits(end) && 'end'].filter(Boolean);
  if (lostEnds.length) {
    if (start && !fits(start)) start = null;
    if (end && !fits(end)) end = null;
    warnings.push(`The ${lostEnds.join(' and ')} tile fell outside the map and was removed, so the path was cleared.`);
    path = [];
  } else {
    const cut = path.findIndex((p) => !fits(p));
    if (cut >= 0) {
      warnings.push(`The path left the map and was cut short after ${cut} tile${cut === 1 ? '' : 's'}.`);
      path = path.slice(0, cut);
    }
  }

  const blocked = level.blocked.filter(fits);
  const dropped = level.blocked.length - blocked.length;
  if (dropped > 0) warnings.push(`${dropped} blocked tile${dropped === 1 ? ' was' : 's were'} outside the map and removed.`);

  return { level: { ...level, cols, rows, start, end, path, blocked }, warnings };
}

function pathProblem(level) {
  const { path, start, end } = level;
  if (!start) return 'Place a start tile (S).';
  if (!end) return 'Place an end tile (E).';
  if (path.length === 0) return 'Draw the path: start on S and click adjacent tiles up to E.';
  if (!same(path[path.length - 1], end)) return 'The path does not reach the end tile (E) yet.';
  return 'The path is invalid: it must be an unbroken chain of adjacent tiles from S to E.';
}

// ok = named + valid path + validateLevel keeps the level. `errors` lists every reason
// (validateLevel's non-fatal notes, e.g. a dropped unknown weapon, are listed even when ok).
export function canSave(level, catalog) {
  const errors = [];
  const named = String(level.name ?? '').trim() !== '';
  if (!named) errors.push('Give the level a name.');
  if (!isPathValid(level.path, level.start, level.end, level.cols, level.rows)) {
    errors.push(pathProblem(level));
    return { ok: false, errors };
  }
  const result = validateLevel(level, catalog);
  errors.push(...result.errors);
  return { ok: named && result.level !== null, errors };
}
