// Scripted players for balance tests. Pure: no Phaser, no DOM.
//
// Each bot plays at most one card from its hand per player turn (cards are free):
// The sensible bot:
//   1. plays the Build card whose weapon has the best damage × fireRate, on the free
//      buildable tile that has the most path tiles within its range (ties: smallest y, then x);
//   2. otherwise plays the Upgrade card whose matching tower covers the most path tiles;
//   3. otherwise plays nothing.
// The mixed bot builds damage towers like the sensible bot (but values splash for crowds)
// and, after every 2 damage towers, 1 support tower (slow, distract or lure) next to the
// best-covered damage tower that has the least support so far, when it holds such a card.
// No bot plays Sell or Bell cards, so a win proves the towers alone hold.
import { GameState } from './state.js';
import { weaponStats, upgradeCost } from './stats.js';

// Damage-0 weapons (pure stall or slow) count 0.5 damage per effect turn.
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
  return damage * weapon.fireRate;
}

// Mixed bot: damage per turn, with splash counted against a crowd.
export function damageScore(weapon) {
  const crowd = weapon.effect === 'splash' ? SPLASH_CROWD : 1;
  return weapon.damage * weapon.fireRate * crowd;
}

// Mixed bot: stall/slow turns handed out per turn. A slow counts by its strength.
export function supportScore(weapon) {
  const turns = Math.ceil(weapon.effectDuration || 0);
  const weight = weapon.effect === 'slow' ? weapon.effectStrength : 1;
  const crowd = weapon.effect === 'lure' ? LURE_CROWD : 1;
  return weapon.fireRate * turns * weight * crowd;
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

// Playable Build cards in the hand, with their weapon (limited to `only`).
function buildCards(state, only) {
  return state.hand
    .filter((c) => c.kind === 'build' && (!only || only.includes(c.weaponId)) && state.cardPlayable(c))
    .map((card) => ({ card, weapon: state.weaponDefs.get(card.weaponId) }))
    .filter((x) => x.weapon);
}

function bestBuildCard(cards, score) {
  let top = null;
  for (const c of cards) if (!top || score(c.weapon) > score(top.weapon)) top = c;
  return top;
}

function build(state, choice, tile) {
  if (!choice || !tile) return false;
  return state.playCard(choice.card.id, { x: tile.x, y: tile.y }).ok;
}

// Plays the Upgrade card whose matching tower covers the most path.
function tryUpgrade(state) {
  let top = null;
  for (const card of state.hand) {
    if (card.kind !== 'upgrade' || !state.cardPlayable(card)) continue;
    for (const t of state.towers) {
      if (t.weaponId !== card.weaponId) continue;
      const weapon = state.weaponDefs.get(t.weaponId);
      if (upgradeCost(weapon, t.tier) === null) continue;
      const cover = pathCoverage(state, t.x, t.y, weaponStats(weapon, t.tier).range);
      if (!top || cover > top.cover) top = { card, tower: t, cover };
    }
  }
  return !!top && state.playCard(top.card.id, { towerId: top.tower.id }).ok;
}

// `only`: restrict the bot to Build cards of these weapon ids (e.g. ['hr-talk']).
export function playSensibly(state, { only } = {}) {
  if (state.over || state.cardPlayedThisTurn) return;
  const choice = bestBuildCard(buildCards(state, only), weaponScore);
  // A support card waits while an upgrade is on offer.
  if (choice && isSupport(choice.weapon) && tryUpgrade(state)) return;
  if (choice && build(state, choice, bestTile(state, choice.weapon.range))) return;
  tryUpgrade(state);
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

// Which support effect backs which damage tower (from the balance probes): a slow pulls the
// leader out of a pack and costs splash its crowd, so splash wants a single-guest stall
// (Café); a single-target tower is fire-rate-bound and gains most from a crowd stall (Pizza Hut).
const SUPPORT_FOR = { splash: 'distract', none: 'lure' };

export function pickSupport(weapons, damage) {
  const supports = weapons.filter(isSupport);
  const wanted = damage && SUPPORT_FOR[damage.effect];
  const preferred = supports.filter((w) => w.effect === wanted);
  return best(preferred.length > 0 ? preferred : supports, supportScore);
}

export function playMixed(state, { only } = {}) {
  if (state.over || state.cardPlayedThisTurn) return;
  const cards = buildCards(state, only);
  const damageCard = bestBuildCard(cards.filter((c) => !isSupport(c.weapon) && c.weapon.damage > 0), damageScore);
  // The support the level's best damage weapon wants, among the support cards held.
  const bestDamage = best(levelWeapons(state, only).filter((w) => !isSupport(w) && w.damage > 0), damageScore);
  const held = cards.filter((c) => isSupport(c.weapon));
  const supportWeapon = pickSupport(held.map((c) => c.weapon), bestDamage);
  const supportCard = supportWeapon && held.find((c) => c.weapon === supportWeapon);
  const count = (pred) => state.towers.filter((t) => pred(state.weaponDefs.get(t.weaponId))).length;
  const supports = count(isSupport);
  const damages = state.towers.length - supports;
  const wantSupport = damages >= DAMAGE_PER_SUPPORT * (supports + 1);
  if (wantSupport && supportCard && build(state, supportCard, supportTile(state, supportCard.weapon))) return;
  if (damageCard && build(state, damageCard, bestTile(state, damageCard.weapon.range))) return;
  if (tryUpgrade(state)) return;
  // Nothing better to do: a support card is still worth placing.
  if (supportCard) build(state, supportCard, supportTile(state, supportCard.weapon));
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
