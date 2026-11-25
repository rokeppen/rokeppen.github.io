// Scripted players for balance tests. Pure: no Phaser, no DOM.
//
// The sensible bot spends its actions greedily each player turn:
//   1. build the level weapon with the best damage × fireRate / cost on the free
//      buildable tile that has the most path tiles within its range (ties: smallest y, then x);
//   2. otherwise upgrade the tower that covers the most path tiles;
//   3. otherwise do nothing.
// It never sells and never rings the Victory Bell, so a win proves the towers alone hold.
import { GameState } from './state.js';
import { weaponStats, upgradeCost } from './stats.js';

// Damage-0 weapons (pure stall or slow) count 0.5 damage per effect second.
const EFFECT_DAMAGE_PER_SECOND = 0.5;

export function weaponScore(weapon) {
  const damage = weapon.damage > 0 ? weapon.damage : EFFECT_DAMAGE_PER_SECOND * (weapon.effectDuration || 0);
  return (damage * weapon.fireRate) / weapon.cost;
}

// Path tiles whose centre lies within `range` of the tile (x, y)'s centre.
export function pathCoverage(state, x, y, range) {
  let n = 0;
  for (const p of state.path) {
    if (Math.hypot(p.x - x, p.y - y) <= range + 1e-9) n += 1;
  }
  return n;
}

function bestWeapon(state) {
  let best = null;
  for (const id of state.level.weaponIds) {
    const w = state.weaponDefs.get(id);
    if (!w) continue;
    if (!best || weaponScore(w) > weaponScore(best)) best = w;
  }
  return best;
}

function bestTile(state, range) {
  let best = null;
  for (let y = 0; y < state.level.rows; y++) {
    for (let x = 0; x < state.level.cols; x++) {
      if (state.tileType(x, y) !== 'buildable') continue;
      const cover = pathCoverage(state, x, y, range);
      if (cover > 0 && (!best || cover > best.cover)) best = { x, y, cover };
    }
  }
  return best;
}

function tryBuild(state) {
  const weapon = bestWeapon(state);
  if (!weapon || state.corks < weapon.cost) return false;
  const tile = bestTile(state, weapon.range);
  if (!tile) return false;
  return state.placeTower(tile.x, tile.y, weapon.id).ok;
}

function tryUpgrade(state) {
  let best = null;
  for (const t of state.towers) {
    const weapon = state.weaponDefs.get(t.weaponId);
    if (upgradeCost(weapon, t.tier) === null) continue;
    const cover = pathCoverage(state, t.x, t.y, weaponStats(weapon, t.tier).range);
    if (!best || cover > best.cover) best = { tower: t, cover, cost: upgradeCost(weapon, t.tier) };
  }
  if (!best || state.corks < best.cost) return false;
  return state.upgradeTower(best.tower.id).ok;
}

export function playSensibly(state) {
  while (state.actionsLeft > 0 && !state.over) {
    if (tryBuild(state)) continue;
    if (tryUpgrade(state)) continue;
    return;
  }
}

// Runs a whole level with the given bot ('sensible' or 'idle', which only ends turns).
export function runGame(level, catalog, { bot = 'sensible', rng } = {}) {
  const state = new GameState(level, catalog, rng ? { rng } : {});
  const kegsLostByWave = new Array(state.totalWaves).fill(0); // index 0 = wave 1
  while (!state.over) {
    if (bot === 'sensible') playSensibly(state);
    for (const e of state.endTurn().events) {
      if (e.type === 'leak') kegsLostByWave[state.waveIndex - 1] += e.wineDamage;
    }
  }
  return { phase: state.phase, turn: state.turn, endReason: state.endReason, wine: state.wine, kegsLostByWave };
}
