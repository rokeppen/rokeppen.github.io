// Framework-free turn engine. Phaser scenes only render this state and play back
// the events that endTurn() returns.
//
// One round = the player's turn (up to 3 actions) + the guests' turn, which runs
// inside endTurn(): wave progress, spawns, step and shot budgets, then resolution
// rounds (round 0 fires only; each later round moves every guest with steps left one
// tile, then every tower with shots left fires once). See the "Turn engine rules"
// in docs/superpowers/specs/2026-11-25-turn-based-design.md.
import { buildSpawnTurns } from './waves.js';
import { weaponStats, upgradeCost } from './stats.js';

const EPS = 1e-9;
const ACTIONS_PER_TURN = 3;
const ACTION_BONUS = 10; // caps per unused action
const WAVE_GAP = 2; // guests' turns between clearing a wave and the next wave
const MAX_TURNS = 500;
const MIN_SPEED = 0.1;
const QUOTES_PER_GUEST = 2;
const QUOTE_SPAWN_CHANCE = 0.35;
const QUOTE_WALK_CHANCE = 0.25;

export class GameState {
  constructor(level, { weapons, enemies }, { rng = Math.random } = {}) {
    this.rng = rng;
    this.level = level;
    this.weaponDefs = new Map(weapons.map((w) => [w.id, w]));
    this.enemyDefs = new Map(enemies.map((e) => [e.id, e]));
    this.path = level.path;
    this.lastIndex = level.path.length - 1;
    this.pathTiles = new Set(level.path.map(key));
    this.blockedTiles = new Set((level.blocked || []).map(key));

    this.corks = level.startingCorks;
    this.wine = level.startingWine;
    this.turn = 1;
    this.phase = 'player';
    this.endReason = null;
    this.actionsLeft = ACTIONS_PER_TURN;
    this.waveIndex = 0;
    this.totalWaves = level.waves.length;
    this.nextWaveIn = this.totalWaves > 0 ? 0 : null;
    this.towers = [];
    this.enemies = [];
    this.bellUsed = false;

    this.waveRunning = false;
    this.waveTurn = 0; // guests' turns since the running wave started (0-based)
    this.spawnQueue = [];
    this.nextTowerId = 1;
    this.nextEnemyId = 1;
  }

  get over() {
    return this.phase === 'won' || this.phase === 'lost';
  }

  tileType(x, y) {
    if (x < 0 || y < 0 || x >= this.level.cols || y >= this.level.rows) return 'outside';
    const k = key({ x, y });
    if (this.pathTiles.has(k)) return 'path';
    if (this.blockedTiles.has(k)) return 'blocked';
    if (this.towers.some((t) => t.x === x && t.y === y)) return 'tower';
    return 'buildable';
  }

  // --- player actions ---

  placeTower(x, y, weaponId) {
    const refused = this.actionRefusal();
    if (refused) return refused;
    const weapon = this.weaponDefs.get(weaponId);
    if (!weapon || !this.level.weaponIds.includes(weaponId)) return { ok: false, reason: 'not-in-level' };
    if (this.tileType(x, y) !== 'buildable') return { ok: false, reason: 'not-buildable' };
    if (this.corks < weapon.cost) return { ok: false, reason: 'no-corks' };
    this.corks -= weapon.cost;
    this.towers.push({ id: this.nextTowerId++, x, y, weaponId, tier: 0, spent: weapon.cost, shotCredit: 0 });
    this.actionsLeft -= 1;
    return { ok: true };
  }

  upgradeTower(towerId) {
    const refused = this.actionRefusal();
    if (refused) return refused;
    const tower = this.towers.find((t) => t.id === towerId);
    if (!tower) return { ok: false, reason: 'unknown' };
    const cost = upgradeCost(this.weaponDefs.get(tower.weaponId), tower.tier);
    if (cost === null) return { ok: false, reason: 'max-tier' };
    if (this.corks < cost) return { ok: false, reason: 'no-corks' };
    this.corks -= cost;
    tower.spent += cost;
    tower.tier += 1;
    this.actionsLeft -= 1;
    return { ok: true };
  }

  sellTower(towerId) {
    const refused = this.actionRefusal();
    if (refused) return refused;
    const i = this.towers.findIndex((t) => t.id === towerId);
    if (i < 0) return { ok: false, reason: 'unknown' };
    const refund = sellRefund(this.towers[i]);
    this.towers.splice(i, 1);
    this.corks += refund;
    this.actionsLeft -= 1;
    return { ok: true, refund };
  }

  // Free (not an action), once per level: every guest present pays out and leaves.
  ringBell() {
    if (this.over) return { ok: false, reason: 'game-over', events: [] };
    if (this.bellUsed) return { ok: false, reason: 'used', events: [] };
    let reward = 0;
    for (const e of this.enemies) reward += this.enemyDefs.get(e.enemyId).reward;
    const event = { type: 'bell', round: 0, count: this.enemies.length, reward, ids: this.enemies.map((e) => e.id) };
    this.corks += reward;
    this.enemies = [];
    this.bellUsed = true;
    return { ok: true, events: [event] };
  }

  // Steps the guest would take next guests' turn if nothing changes.
  previewSteps(e) {
    if (e.stalledTurns > 0) return 0;
    return Math.floor(e.credit + this.speedOf(e) * e.slowFactor + EPS);
  }

  // Pays the action bonus, resolves the guests' turn and starts the next player turn.
  endTurn() {
    if (this.over) return { ok: false, reason: 'game-over', events: [] };
    const events = [];
    this.events = events;
    this.round = 0;

    const caps = ACTION_BONUS * this.actionsLeft;
    if (caps > 0) {
      this.corks += caps;
      events.push({ type: 'bonus', round: -1, caps });
    }
    this.actionsLeft = 0;

    this.turnState = { stalledNow: new Set(), immuneNow: new Set(), steps: new Map(), shots: new Map(), quoted: false };
    this.progressWave();
    this.spawnDue();
    this.budgetSteps();
    this.walkingQuotes();
    this.budgetShots();
    this.resolve();
    this.finishTurn();

    this.events = null;
    this.turnState = null;
    return { ok: true, events };
  }

  // --- guests' turn, in order ---

  progressWave() {
    if (this.waveRunning) {
      this.waveTurn += 1;
      return;
    }
    if (this.nextWaveIn !== 0 || this.waveIndex >= this.totalWaves) return;
    this.spawnQueue = buildSpawnTurns(this.level.waves[this.waveIndex]);
    this.waveIndex += 1;
    this.waveTurn = 0;
    this.waveRunning = true;
    this.nextWaveIn = null;
    this.emit({ type: 'wave-start', wave: this.waveIndex });
  }

  spawnDue() {
    if (!this.waveRunning) return;
    while (this.spawnQueue.length > 0 && this.spawnQueue[0].turn <= this.waveTurn) {
      const { enemyId } = this.spawnQueue.shift();
      const def = this.enemyDefs.get(enemyId);
      if (!def) continue;
      const id = this.nextEnemyId++;
      const e = { id, enemyId, hp: def.hp, maxHp: def.hp, pathIndex: 0, credit: 0,
        stalledTurns: 0, stallImmuneTurns: 0, slowFactor: 1, slowTurns: 0,
        quotesLeft: QUOTES_PER_GUEST, spawnOrder: id };
      this.enemies.push(e);
      this.emit({ type: 'spawn', id, enemyId, pathIndex: 0 });
      this.maybeQuote(e, QUOTE_SPAWN_CHANCE);
    }
  }

  budgetSteps() {
    const ts = this.turnState;
    for (const e of this.enemies) {
      let steps = 0;
      if (e.stalledTurns > 0) {
        e.stalledTurns -= 1;
        ts.stalledNow.add(e);
      } else {
        if (e.stallImmuneTurns > 0) {
          e.stallImmuneTurns -= 1;
          ts.immuneNow.add(e);
        }
        e.credit += this.speedOf(e) * e.slowFactor;
        steps = Math.floor(e.credit + EPS);
        e.credit = Math.max(0, e.credit - steps);
      }
      if (e.slowTurns > 0) {
        e.slowTurns -= 1;
        if (e.slowTurns === 0) e.slowFactor = 1;
      }
      ts.steps.set(e, steps);
    }
  }

  walkingQuotes() {
    for (const e of this.enemies) {
      if (this.turnState.steps.get(e) > 0) this.maybeQuote(e, QUOTE_WALK_CHANCE);
    }
  }

  budgetShots() {
    for (const t of this.towers) {
      t.shotCredit += this.statsOf(t).fireRate;
      const shots = Math.floor(t.shotCredit + EPS);
      t.shotCredit = Math.max(0, t.shotCredit - shots);
      this.turnState.shots.set(t, shots);
    }
  }

  resolve() {
    this.round = 0;
    this.fireRound();
    for (;;) {
      this.round += 1;
      const moved = this.moveRound();
      const fired = this.fireRound();
      if (!moved && !fired) break;
    }
  }

  finishTurn() {
    // End-of-turn events take the round after the last one that had events.
    if (this.wine <= 0) return this.finish('lost', 'kegs');
    const allSpawned = this.spawnQueue.length === 0;
    if (this.waveIndex >= this.totalWaves && allSpawned && this.enemies.length === 0) {
      return this.finish('won', null);
    }
    const waveDone = this.waveRunning && allSpawned && this.enemies.length === 0;
    if (waveDone) {
      this.waveRunning = false;
      this.nextWaveIn = WAVE_GAP;
      this.emit({ type: 'wave-cleared', wave: this.waveIndex, nextWaveIn: WAVE_GAP });
    }
    if (this.turn >= MAX_TURNS) return this.finish('lost', 'too-long');
    this.turn += 1;
    this.actionsLeft = ACTIONS_PER_TURN;
    // nextWaveIn counts the guests' turns before the wave's: 0 = the coming one.
    if (this.nextWaveIn !== null && this.nextWaveIn > 0) this.nextWaveIn -= 1;
  }

  // --- resolution helpers ---

  // Every guest with steps left moves one tile, furthest along first, ties in spawn order.
  moveRound() {
    const steps = this.turnState.steps;
    const movers = this.enemies.filter((e) => steps.get(e) > 0).sort(byProgress);
    for (const e of movers) {
      steps.set(e, steps.get(e) - 1);
      const from = e.pathIndex;
      e.pathIndex = Math.min(from + 1, this.lastIndex);
      this.emit({ type: 'step', id: e.id, from, to: e.pathIndex });
      if (e.pathIndex >= this.lastIndex) this.leak(e);
    }
    return movers.length > 0;
  }

  leak(e) {
    const { wineDamage } = this.enemyDefs.get(e.enemyId);
    this.wine = Math.max(this.wine - wineDamage, 0);
    this.enemies = this.enemies.filter((x) => x !== e);
    this.emit({ type: 'leak', id: e.id, enemyId: e.enemyId, wineDamage });
  }

  // Each tower with shots left fires once at the in-range guest furthest along.
  fireRound() {
    let fired = false;
    for (const tower of this.towers) {
      if (!(this.turnState.shots.get(tower) > 0)) continue;
      if (this.fire(tower)) {
        this.turnState.shots.set(tower, this.turnState.shots.get(tower) - 1);
        fired = true;
      }
    }
    return fired;
  }

  fire(tower) {
    const weapon = this.weaponDefs.get(tower.weaponId);
    const stats = this.statsOf(tower);
    const cx = tower.x + 0.5;
    const cy = tower.y + 0.5;
    const inRange = this.enemies.filter((e) => dist(cx, cy, this.posOf(e)) <= stats.range + EPS);
    if (inRange.length === 0) return false;
    const target = [...inRange].sort(byProgress)[0];
    const targetPos = this.posOf(target);

    let targets = [target];
    let hit = [target];
    if (weapon.effect === 'lure') {
      targets = inRange;
      hit = inRange;
    } else if (weapon.effect === 'splash') {
      hit = this.enemies.filter((e) => dist(targetPos.x, targetPos.y, this.posOf(e)) <= stats.effectStrength + EPS);
    }
    this.emit({ type: 'shot', towerId: tower.id, targetIds: targets.map((e) => e.id), x: targetPos.x, y: targetPos.y });

    const duration = weapon.effectDuration || 0;
    for (const e of targets) {
      if (this.isImmune(e, weapon.effect)) continue;
      if (weapon.effect === 'slow') this.applySlow(e, 1 - stats.effectStrength, Math.ceil(duration));
      else if (weapon.effect === 'distract' || weapon.effect === 'lure') this.applyStall(e, duration);
    }
    for (const e of hit) e.hp -= stats.damage;
    this.payKills();
    return true;
  }

  applySlow(e, factor, turns) {
    if (turns <= 0) return;
    e.slowFactor = factor;
    e.slowTurns = turns;
    this.emit({ type: 'effect', id: e.id, kind: 'slow', turns });
  }

  // Stall for `turns` guests' turns after this one; the rest of this turn's steps are
  // cancelled. Then ceil(0.5 d) turns of stall immunity. Never refreshed while stalled
  // or immune, so repeated hits cannot pin a guest.
  applyStall(e, duration) {
    const ts = this.turnState;
    const turns = Math.ceil(duration);
    if (turns <= 0 || e.stalledTurns > 0 || e.stallImmuneTurns > 0
      || ts.stalledNow.has(e) || ts.immuneNow.has(e)) return;
    e.stalledTurns = turns;
    e.stallImmuneTurns = Math.ceil(0.5 * duration);
    ts.steps.set(e, 0);
    this.emit({ type: 'effect', id: e.id, kind: 'stall', turns });
  }

  payKills() {
    this.enemies = this.enemies.filter((e) => {
      if (e.hp > 0) return true;
      const { reward } = this.enemyDefs.get(e.enemyId);
      const { x, y } = this.posOf(e);
      this.corks += reward;
      this.emit({ type: 'kill', id: e.id, enemyId: e.enemyId, reward, x, y });
      return false;
    });
  }

  // --- quotes ---

  // At most one new quote per guests' turn and QUOTES_PER_GUEST per guest.
  maybeQuote(e, chance) {
    if (this.turnState.quoted || e.quotesLeft <= 0) return;
    const def = this.enemyDefs.get(e.enemyId);
    if (!Array.isArray(def.quotes) || def.quotes.length === 0) return;
    if (this.rng() >= chance) return;
    const text = def.quotes[Math.floor(this.rng() * def.quotes.length)];
    e.quotesLeft -= 1;
    this.turnState.quoted = true;
    this.emit({ type: 'quote', id: e.id, enemyId: e.enemyId, text });
  }

  // --- misc ---

  actionRefusal() {
    if (this.over) return { ok: false, reason: 'game-over' };
    if (this.actionsLeft <= 0) return { ok: false, reason: 'no-actions' };
    return null;
  }

  finish(phase, reason) {
    this.phase = phase;
    this.endReason = reason;
    this.nextWaveIn = null;
    this.emit(phase === 'lost' ? { type: 'lost', reason } : { type: 'won' });
  }

  emit(event) {
    this.events.push({ type: event.type, round: this.round, ...event });
  }

  speedOf(e) {
    return Math.max(this.enemyDefs.get(e.enemyId).speed || 0, MIN_SPEED);
  }

  statsOf(tower) {
    return weaponStats(this.weaponDefs.get(tower.weaponId), tower.tier);
  }

  isImmune(e, effect) {
    return (this.enemyDefs.get(e.enemyId).immuneTo || []).includes(effect);
  }

  posOf(e) {
    const p = this.path[e.pathIndex];
    return { x: p.x + 0.5, y: p.y + 0.5 };
  }
}

// Caps returned when selling a tower: half of everything spent on it, rounded down.
export function sellRefund(tower) {
  return Math.floor(tower.spent / 2);
}

// Furthest along first; ties in spawn order.
function byProgress(a, b) {
  return b.pathIndex - a.pathIndex || a.spawnOrder - b.spawnOrder;
}

function key(p) {
  return `${p.x},${p.y}`;
}

function dist(x, y, p) {
  return Math.hypot(p.x - x, p.y - y);
}
