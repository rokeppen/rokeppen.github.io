// Scripted players for balance tests. Pure: no Phaser, no DOM.
//
// The sensible bot spends its actions greedily each player turn:
//   1. build the level weapon with the best damage × fireRate / cost on the free
//      buildable tile that has the most path tiles within its range (ties: smallest y, then x);
//   2. otherwise upgrade the tower that covers the most path tiles;
//   3. otherwise do nothing.
// The mixed bot builds damage towers like the sensible bot (but values splash for crowds)
// and, after every 2 damage towers, 1 support tower (slow, distract or lure) next to the
// best-covered damage tower that has the least support so far.
// No bot sells or rings the Victory Bell, so a win proves the towers alone hold.
import { GameState } from './state.js';
import { weaponStats, upgradeCost } from './stats.js';

// Damage-0 weapons (pure stall or slow) count 0.5 damage per effect second.
const EFFECT_DAMAGE_PER_SECOND = 0.5;
// The mixed bot assumes a splash shot hits this many guests on average.
const SPLASH_CROWD = 3;
// ... and that a lure stalls this many guests per shot.
const LURE_CROWD = 3;
const SUPPORT_EFFECTS = new Set(['slow', 'distract', 'lure']);
const DAMAGE_PER_SUPPORT = 2;
const SUPPORT_NEAR = 2.5; // a support within this distance counts as backing a damage tower

export const isSupport = (w) => SUPPORT_EFFECTS.has(w.effect);

export function weaponScore(weapon) {
  const damage = weapon.damage > 0 ? weapon.damage : EFFECT_DAMAGE_PER_SECOND * (weapon.effectDuration || 0);
  return (damage * weapon.fireRate) / weapon.cost;
}

// Mixed bot: damage per cap, with splash counted against a crowd.
export function damageScore(weapon) {
  const crowd = weapon.effect === 'splash' ? SPLASH_CROWD : 1;
  return (weapon.damage * weapon.fireRate * crowd) / weapon.cost;
}

// Mixed bot: stall/slow turns handed out per turn, per cap. A slow counts by its strength.
export function supportScore(weapon) {
  const turns = Math.ceil(weapon.effectDuration || 0);
  const weight = weapon.effect === 'slow' ? weapon.effectStrength : 1;
  const crowd = weapon.effect === 'lure' ? LURE_CROWD : 1;
  return (weapon.fireRate * turns * weight * crowd) / weapon.cost;
}

// Path tiles whose centre lies within `range` of the tile (x, y)'s centre.
export function pathCoverage(state, x, y, range) {
  let n = 0;
  for (const p of state.path) {
    if (Math.hypot(p.x - x, p.y - y) <= range + 1e-9) n += 1;
  }
  return n;
}

function levelWeapons(state, only) {
  return state.level.weaponIds
    .filter((id) => !only || only.includes(id))
    .map((id) => state.weaponDefs.get(id))
    .filter(Boolean);
}

function best(list, score) {
  let top = null;
  for (const w of list) if (!top || score(w) > score(top)) top = w;
  return top;
}

function bestTile(state, range) {
  let top = null;
  for (let y = 0; y < state.level.rows; y++) {
    for (let x = 0; x < state.level.cols; x++) {
      if (state.tileType(x, y) !== 'buildable') continue;
      const cover = pathCoverage(state, x, y, range);
      if (cover > 0 && (!top || cover > top.cover)) top = { x, y, cover };
    }
  }
  return top;
}

function build(state, weapon, tile) {
  if (!weapon || !tile || state.corks < weapon.cost) return false;
  return state.placeTower(tile.x, tile.y, weapon.id).ok;
}

function tryUpgrade(state) {
  let top = null;
  for (const t of state.towers) {
    const weapon = state.weaponDefs.get(t.weaponId);
    if (upgradeCost(weapon, t.tier) === null) continue;
    const cover = pathCoverage(state, t.x, t.y, weaponStats(weapon, t.tier).range);
    if (!top || cover > top.cover) top = { tower: t, cover, cost: upgradeCost(weapon, t.tier) };
  }
  if (!top || state.corks < top.cost) return false;
  return state.upgradeTower(top.tower.id).ok;
}

// `only`: restrict the bot to these weapon ids (e.g. ['hr-talk']).
export function playSensibly(state, { only } = {}) {
  while (state.actionsLeft > 0 && !state.over) {
    const weapon = best(levelWeapons(state, only), weaponScore);
    if (weapon && state.corks >= weapon.cost && build(state, weapon, bestTile(state, weapon.range))) continue;
    if (tryUpgrade(state)) continue;
    return;
  }
}

// Path indices within `range` of the tile (x, y).
function reachIndices(state, x, y, range) {
  const out = [];
  state.path.forEach((p, i) => { if (Math.hypot(p.x - x, p.y - y) <= range + 1e-9) out.push(i); });
  return out;
}

// Buildable tile for a support tower backing `tower`. A support aims at the guest furthest
// along in its range, so it must not reach past the middle of the damage tower's stretch of
// path: then it holds guests on their way into the damage zone, not on their way out. Among
// those tiles it covers as many of the damage tower's path tiles as possible.
// Ties: fewest path tiles outside the damage zone, then smallest (y, x).
export function supportTileFor(state, tower, support) {
  const reach = new Set(reachIndices(state, tower.x, tower.y,
    weaponStats(state.weaponDefs.get(tower.weaponId), tower.tier).range));
  if (reach.size === 0) return null;
  const sorted = [...reach].sort((a, b) => a - b);
  const last = sorted[Math.floor(sorted.length / 2)];
  let top = null;
  for (let y = 0; y < state.level.rows; y++) {
    for (let x = 0; x < state.level.cols; x++) {
      if (state.tileType(x, y) !== 'buildable') continue;
      const mine = reachIndices(state, x, y, support.range);
      if (mine.length === 0 || Math.max(...mine) > last) continue;
      const overlap = mine.filter((i) => reach.has(i)).length;
      const outside = mine.length - overlap;
      if (overlap > 0 && (!top || overlap > top.cover || (overlap === top.cover && outside < top.outside))) {
        top = { x, y, cover: overlap, outside };
      }
    }
  }
  return top;
}

// Support tile next to the best-covered damage tower with the least support so far.
function supportTile(state, support) {
  const towerStats = (t) => weaponStats(state.weaponDefs.get(t.weaponId), t.tier);
  const damageTowers = state.towers
    .filter((t) => !isSupport(state.weaponDefs.get(t.weaponId)))
    .map((t) => ({
      t,
      backed: state.towers.filter((s) => isSupport(state.weaponDefs.get(s.weaponId))
        && Math.hypot(s.x - t.x, s.y - t.y) <= SUPPORT_NEAR).length,
      cover: pathCoverage(state, t.x, t.y, towerStats(t).range),
    }))
    .sort((a, b) => a.backed - b.backed || b.cover - a.cover || a.t.id - b.t.id);
  for (const { t } of damageTowers) {
    const tile = supportTileFor(state, t, support);
    if (tile) return tile;
  }
  return null;
}

export function playMixed(state, { only } = {}) {
  while (state.actionsLeft > 0 && !state.over) {
    const weapons = levelWeapons(state, only);
    const damage = best(weapons.filter((w) => !isSupport(w) && w.damage > 0), damageScore);
    const support = best(weapons.filter(isSupport), supportScore);
    const count = (pred) => state.towers.filter((t) => pred(state.weaponDefs.get(t.weaponId))).length;
    const supports = count(isSupport);
    const damages = state.towers.length - supports;
    const wantSupport = support && damages >= DAMAGE_PER_SUPPORT * (supports + 1);
    if (wantSupport) {
      const tile = supportTile(state, support);
      if (tile) {
        if (build(state, support, tile)) continue;
        if (tryUpgrade(state)) continue;
        return; // save up for the support tower
      }
    }
    if (damage && build(state, damage, bestTile(state, damage.range))) continue;
    if (tryUpgrade(state)) continue;
    return;
  }
}

// Runs a whole level. bot: 'sensible', 'mixed' or 'idle' (only ends turns).
// `only` restricts the weapons the bot may build.
export function runGame(level, catalog, { bot = 'sensible', rng, only } = {}) {
  const state = new GameState(level, catalog, rng ? { rng } : {});
  const kegsLostByWave = new Array(state.totalWaves).fill(0); // index 0 = wave 1
  let kills = 0;
  while (!state.over) {
    if (bot === 'sensible') playSensibly(state, { only });
    else if (bot === 'mixed') playMixed(state, { only });
    for (const e of state.endTurn().events) {
      if (e.type === 'leak') kegsLostByWave[state.waveIndex - 1] += e.wineDamage;
      if (e.type === 'kill') kills += 1;
    }
  }
  const towers = {};
  for (const t of state.towers) towers[t.weaponId] = (towers[t.weaponId] || 0) + 1;
  return { phase: state.phase, turn: state.turn, endReason: state.endReason, wine: state.wine, kegsLostByWave, kills, towers };
}
