// Seeded level generator. Pure: no DOM, no CDN imports, no Math.random.
// Internal names: corks/startingCorks = bottle caps, wine/startingWine/wineDamage = kegs.
//
// Path: a self-avoiding walk on a coarse grid whose cells sit on odd (x, y) tiles. Each coarse
// step becomes two tiles, so separate parts of the path never touch and there is always a
// buildable tile between them. The walk starts as a random staircase between the two edge
// tiles and is then lengthened by "bumps" (replace a step u->v by u->u'->v'->v, with u', v'
// beside it) until it reaches a length set by twistiness.

export const SIZES = { small: [12, 8], medium: [16, 10], large: [20, 12] };
export const DIFFICULTIES = ['chill', 'party', 'chaos'];

const TUNING = {
  chill: { guests: 1, interval: 1.2, corks: 3, wine: 20 },
  party: { guests: 1.4, interval: 0.9, corks: 2.5, wine: 12 },
  chaos: { guests: 1.9, interval: 0.6, corks: 2, wine: 8 },
};

// ---------- random ----------

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pickInt = (rng, n) => Math.floor(rng() * n);
const pick = (rng, list) => list[pickInt(rng, list.length)];

function shuffle(rng, list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = pickInt(rng, i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function randomSeed() {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0];
}

// ---------- catalog helpers ----------

const unique = (ids) => [...new Set(Array.isArray(ids) ? ids : [])];

function listedGuests(opts, catalog) {
  const byId = new Map((catalog?.enemies ?? []).map((e) => [e.id, e]));
  return unique(opts?.enemyIds).filter((id) => byId.has(id)).map((id) => byId.get(id));
}

function listedWeapons(opts, catalog) {
  const byId = new Map((catalog?.weapons ?? []).map((w) => [w.id, w]));
  return unique(opts?.weaponIds).filter((id) => byId.has(id)).map((id) => byId.get(id));
}

const num = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

export function canGenerate(opts, catalog) {
  if (!Object.hasOwn(SIZES, opts?.size)) return { ok: false, reason: 'Pick a board size.' };
  if (!DIFFICULTIES.includes(opts?.difficulty)) return { ok: false, reason: 'Pick a difficulty.' };
  const waves = opts?.waves;
  if (!Number.isInteger(waves) || waves < 1 || waves > 20) {
    return { ok: false, reason: 'The number of waves must be a whole number from 1 to 20.' };
  }
  if (listedGuests(opts, catalog).length === 0) {
    return { ok: false, reason: 'Put at least one guest on the guest list.' };
  }
  if (!listedWeapons(opts, catalog).some((w) => num(w.damage, 0) > 0)) {
    return { ok: false, reason: 'Pick at least one weapon that does damage.' };
  }
  return { ok: true };
}

// ---------- path ----------

const EDGES = ['left', 'right', 'top', 'bottom'];
const key = (p) => `${p.x},${p.y}`;

// Coarse cell (cx, cy) is tile (2cx+1, 2cy+1).
function coarseDims(cols, rows) {
  return { w: Math.floor((cols - 1) / 2), h: Math.floor((rows - 1) / 2) };
}

// The coarse cell that edge position `i` attaches to, and the tiles from the edge tile inward
// up to (not including) that cell's tile: one tile, or two when the far edge is an even
// distance away.
function edgeAnchor(edge, i, cols, rows) {
  const { w, h } = coarseDims(cols, rows);
  const t = 2 * i + 1;
  const tiles = [];
  if (edge === 'left') tiles.push({ x: 0, y: t });
  if (edge === 'top') tiles.push({ x: t, y: 0 });
  if (edge === 'right') for (let x = cols - 1; x > 2 * (w - 1) + 1; x--) tiles.push({ x, y: t });
  if (edge === 'bottom') for (let y = rows - 1; y > 2 * (h - 1) + 1; y--) tiles.push({ x: t, y });
  return { tiles, cell: cellOf(edge, i, w, h) };
}

function cellOf(edge, i, w, h) {
  if (edge === 'left') return { x: 0, y: i };
  if (edge === 'top') return { x: i, y: 0 };
  if (edge === 'right') return { x: w - 1, y: i };
  return { x: i, y: h - 1 };
}

function chooseEnds(rng, w, h) {
  const along = (edge) => (edge === 'left' || edge === 'right' ? h : w);
  const manhattan = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  const minDist = Math.max(2, Math.floor((w + h) / 2));
  for (let tries = 0; tries < 50; tries++) {
    const se = pick(rng, EDGES);
    const ee = pick(rng, EDGES.filter((e) => e !== se));
    const si = pickInt(rng, along(se));
    const ei = pickInt(rng, along(ee));
    if (manhattan(cellOf(se, si, w, h), cellOf(ee, ei, w, h)) >= minDist) return { se, si, ee, ei };
  }
  return { se: 'left', si: Math.floor(h / 2), ee: 'right', ei: Math.floor(h / 2) };
}

// Random monotone staircase from a to b on the coarse grid.
function staircase(rng, a, b) {
  const path = [{ ...a }];
  const cur = { ...a };
  while (cur.x !== b.x || cur.y !== b.y) {
    const dx = Math.sign(b.x - cur.x);
    const dy = Math.sign(b.y - cur.y);
    const remX = Math.abs(b.x - cur.x);
    const remY = Math.abs(b.y - cur.y);
    if (dy === 0 || (dx !== 0 && rng() < remX / (remX + remY))) cur.x += dx;
    else cur.y += dy;
    path.push({ ...cur });
  }
  return path;
}

// Lengthen the coarse walk with detours until it has `target` cells or no detour fits.
function bump(rng, path, w, h, target) {
  const used = new Set(path.map(key));
  const inside = (p) => p.x >= 0 && p.y >= 0 && p.x < w && p.y < h;
  while (path.length < target) {
    const options = [];
    for (let i = 0; i + 1 < path.length; i++) {
      const u = path[i];
      const v = path[i + 1];
      const perp = u.x === v.x ? [{ x: 1, y: 0 }, { x: -1, y: 0 }] : [{ x: 0, y: 1 }, { x: 0, y: -1 }];
      for (const n of perp) {
        const u2 = { x: u.x + n.x, y: u.y + n.y };
        const v2 = { x: v.x + n.x, y: v.y + n.y };
        if (inside(u2) && inside(v2) && !used.has(key(u2)) && !used.has(key(v2))) options.push([i, u2, v2]);
      }
    }
    if (options.length === 0) break;
    const [i, u2, v2] = pick(rng, options);
    path.splice(i + 1, 0, u2, v2);
    used.add(key(u2));
    used.add(key(v2));
  }
  return path;
}

function makePath(rng, cols, rows, twistiness) {
  const { w, h } = coarseDims(cols, rows);
  const { se, si, ee, ei } = chooseEnds(rng, w, h);
  const start = edgeAnchor(se, si, cols, rows);
  const end = edgeAnchor(ee, ei, cols, rows);
  const coarse = staircase(rng, start.cell, end.cell);
  const shortest = coarse.length;
  const longest = Math.max(shortest, Math.floor(w * h * 0.8));
  bump(rng, coarse, w, h, Math.round(shortest + twistiness * (longest - shortest)));

  const path = [...start.tiles];
  coarse.forEach((c, i) => {
    const tile = { x: 2 * c.x + 1, y: 2 * c.y + 1 };
    if (i > 0) {
      const prev = coarse[i - 1];
      path.push({ x: prev.x + c.x + 1, y: prev.y + c.y + 1 }); // tile between two cells
    }
    path.push(tile);
  });
  path.push(...[...end.tiles].reverse());
  return { path, start: { ...path[0] }, end: { ...path[path.length - 1] } };
}

// ---------- blocked tiles ----------

function makeBlocked(rng, cols, rows, path) {
  const onPath = new Set(path.map(key));
  const nearPath = new Set();
  for (const p of path) {
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) nearPath.add(`${p.x + dx},${p.y + dy}`);
  }
  const far = [];
  const near = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const k = `${x},${y}`;
      if (onPath.has(k)) continue;
      (nearPath.has(k) ? near : far).push({ x, y });
    }
  }
  const free = far.length + near.length;
  const wanted = Math.round((0.06 + rng() * 0.06) * free);
  const count = Math.min(Math.floor(free * 0.12), Math.max(Math.ceil(free * 0.06), wanted));
  // Prefer tiles away from the path so the path keeps buildable neighbours.
  return [...shuffle(rng, far), ...shuffle(rng, near)].slice(0, count);
}

// ---------- waves ----------

const toughness = (e) => num(e.hp, 1) * num(e.speed, 1) * num(e.wineDamage, 1);
const round = (v, step) => Math.round(v / step) * step;

// Wave index from which each guest may appear: the easier half from wave 0, the tougher
// ones spread over the later half, toughest last.
function unlockWaves(guests, n) {
  const sorted = guests.map((g, i) => ({ g, i })).sort((a, b) => toughness(a.g) - toughness(b.g) || a.i - b.i);
  const easy = Math.ceil(sorted.length / 2);
  const tough = sorted.length - easy;
  const half = Math.floor(n / 2);
  return sorted.map(({ g }, rank) => ({
    guest: g,
    from: rank < easy ? 0 : half + Math.floor(((rank - easy) * (n - half)) / tough),
  }));
}

function makeWaves(rng, guests, n, tune) {
  const unlocks = unlockWaves(guests, n);
  const waves = [];
  let prevHp = 0;
  for (let i = 0; i < n; i++) {
    const pool = unlocks.filter((u) => u.from <= i).map((u) => u.guest);
    const fresh = unlocks.filter((u) => u.from === i && i > 0).map((u) => u.guest);
    const groupCount = 1 + pickInt(rng, Math.min(3, pool.length));
    const chosen = [...fresh, ...shuffle(rng, pool.filter((g) => !fresh.includes(g)))].slice(0, Math.max(groupCount, Math.min(fresh.length, 3)));
    const weights = chosen.map(() => 0.5 + rng());
    const weightSum = weights.reduce((s, x) => s + x, 0);
    const total = tune.guests * (4 + 1.2 * i);
    const slowdown = 1 - (0.3 * i) / Math.max(1, n - 1);
    const wave = chosen.map((g, k) => ({
      enemyId: g.id,
      count: Math.max(1, Math.round((total * weights[k]) / weightSum)),
      intervalS: Math.max(0.2, round(tune.interval * (0.85 + 0.3 * rng()) * slowdown, 0.05)),
      delayS: 0,
    }));
    // Total HP must grow every wave: add the toughest group's guests until it does.
    const hpOf = (gr) => num(guests.find((g) => g.id === gr.enemyId).hp, 1);
    const hpTotal = () => wave.reduce((s, gr) => s + gr.count * hpOf(gr), 0);
    const heaviest = wave.reduce((a, b) => (hpOf(b) > hpOf(a) ? b : a));
    while (hpTotal() <= prevHp) heaviest.count += 1;
    prevHp = hpTotal();
    // Groups overlap a little: each starts when the previous one is ~60% through.
    for (let k = 1; k < wave.length; k++) {
      const p = wave[k - 1];
      wave[k].delayS = round(p.delayS + p.count * p.intervalS * 0.6, 0.1);
    }
    for (const gr of wave) {
      gr.intervalS = Number(gr.intervalS.toFixed(2));
      gr.delayS = Number(gr.delayS.toFixed(1));
    }
    waves.push(wave);
  }
  return waves;
}

// ---------- level ----------

export function generateLevel(opts, catalog) {
  const check = canGenerate(opts, catalog);
  if (!check.ok) throw new Error(check.reason);
  const seed = num(opts.seed, 0) >>> 0;
  const twistiness = Math.min(1, Math.max(0, num(opts.twistiness, 0.5)));
  const tune = TUNING[opts.difficulty];
  const [cols, rows] = SIZES[opts.size];
  const rng = mulberry32(seed);

  const guests = listedGuests(opts, catalog);
  const weapons = listedWeapons(opts, catalog);
  const { path, start, end } = makePath(rng, cols, rows, twistiness);
  const blocked = makeBlocked(rng, cols, rows, path);
  const waves = makeWaves(rng, guests, opts.waves, tune);

  const cost = (w) => Math.max(0, num(w.cost, 0));
  const cheapest = Math.min(...weapons.map(cost));
  const cheapestDamage = Math.min(...weapons.filter((w) => num(w.damage, 0) > 0).map(cost));
  const startingCorks = Math.max(1, Math.ceil(Math.max(2 * cheapest, tune.corks * cheapestDamage) / 5) * 5);

  return {
    name: `Generated party #${seed}`,
    cols, rows, start, end, path, blocked,
    enemyIds: guests.map((g) => g.id),
    weaponIds: weapons.map((w) => w.id),
    waves,
    startingCorks,
    startingWine: tune.wine,
    barSprite: '🍻',
  };
}
