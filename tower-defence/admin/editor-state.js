// Pure level-editing operations for the admin level editor.
// No DOM, no CDN imports: tested in Node. Every function returns a new level and
// never mutates its input; when an edit is refused the same level object is returned.
import { isPathValid, validateLevel, levelEnemyIds } from '../shared/model.js';

export const DEFAULT_COLS = 16;
export const DEFAULT_ROWS = 10;
export const MIN_SIZE = 5;
export const MAX_SIZE = 30;
export const DEFAULT_BAR_SPRITE = '🍻';

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
    enemyIds: [],
    startingCorks: 100,
    startingWine: 20,
    waves: [],
    barSprite: DEFAULT_BAR_SPRITE,
  };
}

// Deep copy (levels are plain JSON data).
export function cloneLevel(level) {
  return structuredClone(level);
}

export function duplicateLevel(level) {
  const name = String(level.name ?? '').trim() ? level.name : 'Untitled';
  return { ...cloneLevel(level), id: crypto.randomUUID(), name: `${name} (copy)`, published: false };
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
  if (same(last, level.end)) return level; // the path is complete: never run past E
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

const isInt = (n, min) => typeof n === 'number' && Number.isInteger(n) && n >= min;
const isNum = (n) => typeof n === 'number' && Number.isFinite(n);

// Weapons, starting resources and waves, in the editor's words.
function setupProblems(level, catalog) {
  const errors = [];
  const weaponIds = new Set((catalog?.weapons ?? []).map((w) => w.id));
  const enemyIds = new Set((catalog?.enemies ?? []).map((e) => e.id));
  const chosen = Array.isArray(level.weaponIds) ? level.weaponIds : [];
  if (chosen.length === 0) errors.push('Pick at least one weapon.');
  for (const id of chosen) {
    if (!weaponIds.has(id)) errors.push(`Weapon '${id}' no longer exists — untick it.`);
  }
  const explicitGuests = Array.isArray(level.enemyIds);
  const guests = new Set(levelEnemyIds(level));
  if (explicitGuests) {
    if (guests.size === 0) errors.push('Put at least one guest on the guest list.');
    for (const id of guests) {
      if (!enemyIds.has(id)) errors.push(`Guest '${id}' no longer exists — take it off the guest list.`);
    }
  }
  if (level.barSprite != null && String(level.barSprite).trim() === '') {
    errors.push('Pick a bar emoji or upload a bar image.');
  }
  if (!isInt(level.startingCorks, 1)) errors.push('Starting corks must be a whole number of at least 1.');
  if (!isInt(level.startingWine, 1)) errors.push('Starting wine must be a whole number of at least 1.');
  const waves = Array.isArray(level.waves) ? level.waves : [];
  if (waves.length === 0) errors.push('Add at least one wave.');
  waves.forEach((wave, wi) => {
    const w = `Wave ${wi + 1}`;
    if (!Array.isArray(wave) || wave.length === 0) { errors.push(`${w} has no guests.`); return; }
    wave.forEach((g, gi) => {
      const at = `${w}, group ${gi + 1}`;
      if (!g || typeof g !== 'object') { errors.push(`${at} is malformed — remove it.`); return; }
      if (!enemyIds.has(g.enemyId)) errors.push(`${w}: guest '${g.enemyId}' no longer exists — remove that group.`);
      else if (!guests.has(g.enemyId)) errors.push(`${w}: guest '${g.enemyId}' is not on the guest list — list the guest or remove that group.`);
      if (!isInt(g.count, 1)) errors.push(`${at}: count must be a whole number of at least 1.`);
      if (!isNum(g.intervalS) || g.intervalS <= 0) errors.push(`${at}: interval must be more than 0 seconds.`);
      if (!isNum(g.delayS) || g.delayS < 0) errors.push(`${at}: delay can't be negative.`);
    });
  });
  return errors;
}

// ok only when nothing is wrong, so what is saved is exactly what the game plays.
// `errors` lists every reason; validateLevel's errors are surfaced and block saving too.
export function canSave(level, catalog) {
  const errors = [];
  if (String(level.name ?? '').trim() === '') errors.push('Give the level a name.');
  const pathOk = isPathValid(level.path, level.start, level.end, level.cols, level.rows);
  if (!pathOk) errors.push(pathProblem(level));
  errors.push(...setupProblems(level, catalog));
  if (errors.length) return { ok: false, errors };
  const result = validateLevel(level, catalog);
  errors.push(...result.errors);
  return { ok: result.level !== null && errors.length === 0, errors };
}

// ---------- weapons and waves ----------

const DEFAULT_GROUP = { count: 5, intervalS: 1, delayS: 0 };
const wavesOf = (level) => (Array.isArray(level.waves) ? level.waves : []);

export function setWeapons(level, ids) {
  return { ...level, weaponIds: [...new Set(ids)] };
}

// Copies the last wave, or starts with one default group of `firstEnemyId`.
export function addWave(level, firstEnemyId) {
  const waves = wavesOf(level);
  if (waves.length) return { ...level, waves: [...waves, structuredClone(waves[waves.length - 1])] };
  if (firstEnemyId == null) return level;
  return { ...level, waves: [[{ enemyId: firstEnemyId, ...DEFAULT_GROUP }]] };
}

export function removeWave(level, i) {
  const waves = wavesOf(level);
  if (!(i >= 0 && i < waves.length)) return level;
  return { ...level, waves: waves.filter((_, k) => k !== i) };
}

export function moveWave(level, i, dir) {
  const waves = [...wavesOf(level)];
  const j = i + dir;
  if (!(i >= 0 && i < waves.length && j >= 0 && j < waves.length)) return level;
  [waves[i], waves[j]] = [waves[j], waves[i]];
  return { ...level, waves };
}

function editWave(level, waveIdx, fn) {
  const waves = wavesOf(level);
  const wave = waves[waveIdx];
  if (!Array.isArray(wave)) return level;
  const next = fn(wave);
  if (next === wave) return level;
  return { ...level, waves: waves.map((w, k) => (k === waveIdx ? next : w)) };
}

export function addGroup(level, waveIdx, enemyId) {
  if (enemyId == null) return level;
  return editWave(level, waveIdx, (wave) => [...wave, { enemyId, ...DEFAULT_GROUP }]);
}

export function updateGroup(level, waveIdx, groupIdx, patch) {
  return editWave(level, waveIdx, (wave) => (groupIdx >= 0 && groupIdx < wave.length
    ? wave.map((g, k) => (k === groupIdx ? { ...g, ...patch } : g))
    : wave));
}

export function removeGroup(level, waveIdx, groupIdx) {
  return editWave(level, waveIdx, (wave) => (groupIdx >= 0 && groupIdx < wave.length
    ? wave.filter((_, k) => k !== groupIdx)
    : wave));
}

// ---------- guest list ----------

// The guest list (deduped). Groups of guests taken off the list are removed from the waves,
// and so are waves left without guests; adding guests leaves the waves untouched.
export function setGuests(level, ids) {
  const enemyIds = [...new Set(ids)];
  const listed = new Set(enemyIds);
  const waves = wavesOf(level);
  const dropped = (g) => g && typeof g === 'object' && !listed.has(g.enemyId);
  if (!waves.some((w) => Array.isArray(w) && w.some(dropped))) return { ...level, enemyIds };
  const kept = waves
    .map((w) => (Array.isArray(w) && w.some(dropped) ? w.filter((g) => !dropped(g)) : w))
    .filter((w, i) => !(Array.isArray(w) && w.length === 0 && waves[i].length > 0));
  return { ...level, enemyIds, waves: kept };
}

// Guests the waves use, in order of first use.
export function guestsInUse(level) {
  const ids = [];
  for (const wave of wavesOf(level)) {
    for (const g of Array.isArray(wave) ? wave : []) {
      if (g && typeof g === 'object' && !ids.includes(g.enemyId)) ids.push(g.enemyId);
    }
  }
  return ids;
}

// 1-based numbers of the waves that use a guest.
export function guestWaves(level, enemyId) {
  const out = [];
  wavesOf(level).forEach((wave, i) => {
    if (Array.isArray(wave) && wave.some((g) => g && typeof g === 'object' && g.enemyId === enemyId)) out.push(i + 1);
  });
  return out;
}

// ---------- generator ----------

export const GENERATED_NAME_PREFIX = 'Generated party #';
const DEFAULT_NAME = newLevel().name;

// Merges a generateLevel() result into the draft. id, published and sortOrder always stay.
// The name is replaced only when it is empty, the new-level default or an earlier generated
// name; the bar sprite only when it is empty.
export function applyGenerated(draft, generated) {
  const { id, published, sortOrder, ...fields } = generated ?? {};
  const name = String(draft.name ?? '').trim();
  const rename = name === '' || name === DEFAULT_NAME || name.startsWith(GENERATED_NAME_PREFIX);
  const bar = typeof draft.barSprite === 'string' ? draft.barSprite.trim() : '';
  return {
    ...draft,
    ...structuredClone(fields),
    id: draft.id,
    published: draft.published,
    sortOrder: draft.sortOrder,
    name: rename ? fields.name ?? draft.name : draft.name,
    barSprite: bar ? draft.barSprite : fields.barSprite ?? DEFAULT_BAR_SPRITE,
  };
}

// "6 🧑‍💼 + 2 ❓": guests per enemy type, in order of first appearance.
export function waveSummary(wave, enemies = []) {
  const totals = new Map();
  for (const g of Array.isArray(wave) ? wave : []) {
    if (!g || typeof g !== 'object') continue;
    totals.set(g.enemyId, (totals.get(g.enemyId) ?? 0) + (isNum(g.count) ? g.count : 0));
  }
  if (totals.size === 0) return 'no guests';
  return [...totals].map(([id, n]) => `${n} ${enemies.find((e) => e.id === id)?.sprite || '?'}`).join(' + ');
}

// ---------- loading raw (possibly invalid) DB levels ----------

const isTile = (t) => !!t && typeof t === 'object' && Number.isInteger(t.x) && Number.isInteger(t.y);
const toNumber = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);

// Turns a raw level (possibly invalid, straight from the DB) into one the editor can work on:
// malformed tiles/waves/numbers are sanitised, and weapons/guests that no longer exist in the
// catalog are dropped. Every repair is reported in `warnings`; a valid level comes back
// unchanged (same JSON) with no warnings.
export function prepareForEditor(raw, catalog = {}) {
  const warnings = [];
  const src = raw && typeof raw === 'object' ? raw : {};
  const weaponIds = new Set((catalog.weapons ?? []).map((w) => w.id));
  const enemyIds = new Set((catalog.enemies ?? []).map((e) => e.id));
  const plural = (n, one, many) => (n === 1 ? one : many);

  const size = (v, fallback, what) => {
    if (Number.isInteger(v) && v >= MIN_SIZE && v <= MAX_SIZE) return v;
    const n = toNumber(v);
    const fixed = Number.isFinite(n) ? Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(n))) : fallback;
    warnings.push(`The number of ${what} was invalid and was set to ${fixed}.`);
    return fixed;
  };
  const cols = size(src.cols, DEFAULT_COLS, 'columns');
  const rows = size(src.rows, DEFAULT_ROWS, 'rows');

  const point = (v, what) => {
    if (v == null) return null;
    if (isTile(v)) return tile(v);
    warnings.push(`The ${what} tile was malformed and was removed.`);
    return null;
  };
  const start = point(src.start, 'start');
  const end = point(src.end, 'end');

  const tiles = (v, what) => {
    if (v == null) return [];
    if (!Array.isArray(v)) { warnings.push(`The ${what} tiles were malformed and were cleared.`); return []; }
    const kept = v.filter(isTile).map(tile);
    const bad = v.length - kept.length;
    if (bad) warnings.push(`${bad} malformed ${what} ${plural(bad, 'tile was', 'tiles were')} removed.`);
    return kept;
  };
  const path = tiles(src.path, 'path');
  const blockedAll = tiles(src.blocked, 'blocked');
  const taken = (t) => same(t, start) || same(t, end) || path.some((p) => same(p, t));
  const blocked = blockedAll.filter((t) => inBounds(t, cols, rows) && !taken(t));
  const dropped = blockedAll.length - blocked.length;
  if (dropped) warnings.push(`${dropped} blocked ${plural(dropped, 'tile was', 'tiles were')} off the map or on the path and ${plural(dropped, 'was', 'were')} removed.`);

  const weapons = [];
  if (Array.isArray(src.weaponIds)) {
    for (const id of new Set(src.weaponIds)) {
      if (weaponIds.has(id)) weapons.push(id);
      else warnings.push(`Weapon '${id}' no longer exists — removed from this level.`);
    }
  } else if (src.weaponIds != null) {
    warnings.push('The weapon list was malformed and was cleared.');
  }

  const number = (v, fallback, what) => {
    const n = toNumber(v);
    if (Number.isFinite(n)) return n;
    warnings.push(`${what} was missing or invalid and was set to ${fallback}.`);
    return fallback;
  };
  const startingCorks = number(src.startingCorks, 100, 'Starting corks');
  const startingWine = number(src.startingWine, 20, 'Starting wine');

  const waves = [];
  if (Array.isArray(src.waves)) {
    src.waves.forEach((wave, wi) => {
      const w = `Wave ${wi + 1}`;
      if (!Array.isArray(wave)) { warnings.push(`${w} was malformed and was removed.`); return; }
      const groups = [];
      for (const g of wave) {
        if (!g || typeof g !== 'object') { warnings.push(`${w}: a malformed guest group was dropped.`); continue; }
        if (!enemyIds.has(g.enemyId)) {
          warnings.push(`${w}: guest '${g.enemyId}' no longer exists — group dropped.`);
          continue;
        }
        const field = (k) => number(g[k], DEFAULT_GROUP[k], `${w}: the ${k} of a '${g.enemyId}' group`);
        groups.push({ ...g, count: field('count'), intervalS: field('intervalS'), delayS: field('delayS') });
      }
      if (groups.length) waves.push(groups);
      else if (wave.length) warnings.push(`${w} had no guests left and was removed.`);
      else waves.push(groups); // an empty wave is kept so the admin sees it (canSave reports it)
    });
  } else if (src.waves != null) {
    warnings.push('The wave list was malformed and was cleared.');
  }

  // Guest list: unknown guests are dropped. A legacy level (no list) gets the guests its
  // (repaired) waves use, so saving writes an explicit list.
  let guests;
  if (Array.isArray(src.enemyIds)) {
    guests = [];
    for (const id of new Set(src.enemyIds)) {
      if (enemyIds.has(id)) guests.push(id);
      else warnings.push(`Guest '${id}' no longer exists — removed from the guest list.`);
    }
  } else {
    if (src.enemyIds != null) warnings.push('The guest list was malformed.');
    guests = levelEnemyIds({ waves });
    warnings.push(`This level had no guest list yet; it was set to the guests its waves use${guests.length ? '' : ' (none)'}.`);
  }
  const barSprite = typeof src.barSprite === 'string' && src.barSprite.trim() ? src.barSprite : DEFAULT_BAR_SPRITE;
  if (src.barSprite != null && barSprite !== src.barSprite) warnings.push('The bar image was invalid and was reset to 🍻.');

  const level = {
    ...src,
    id: src.id ?? crypto.randomUUID(),
    name: src.name == null ? '' : String(src.name),
    sortOrder: Number.isFinite(src.sortOrder) ? src.sortOrder : 0,
    published: src.published === true,
    cols, rows, start, end, path, blocked,
    weaponIds: weapons,
    enemyIds: guests,
    startingCorks, startingWine,
    waves,
    barSprite,
  };
  return { level, warnings };
}
