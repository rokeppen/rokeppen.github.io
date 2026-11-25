// Framework-free game simulation. Phaser scenes only render this state.
import { pathLength, positionAt } from './path.js';
import { buildSpawnSchedule } from './waves.js';
import { weaponStats, upgradeCost } from './stats.js';

const MAX_TICK = 0.25; // seconds simulated per tick() call at most
const SUBSTEP = 0.05;
const EPS = 1e-9;

export class GameState {
  constructor(level, { weapons, enemies }) {
    this.level = level;
    this.weaponDefs = new Map(weapons.map((w) => [w.id, w]));
    this.enemyDefs = new Map(enemies.map((e) => [e.id, e]));
    this.pathLen = pathLength(level.path);
    this.pathTiles = new Set(level.path.map(key));
    this.blockedTiles = new Set((level.blocked || []).map(key));

    this.corks = level.startingCorks;
    this.wine = level.startingWine;
    this.phase = 'build';
    this.waveIndex = 0;
    this.totalWaves = level.waves.length;
    this.towers = [];
    this.enemies = [];
    this.bellUsed = false;
    this.time = 0;

    this.schedule = [];
    this.scheduleIndex = 0;
    this.waveTime = 0;
    this.nextTowerId = 1;
    this.nextEnemyId = 1;
    this.events = [];
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

  placeTower(x, y, weaponId) {
    if (this.over) return { ok: false, reason: 'game-over' };
    const weapon = this.weaponDefs.get(weaponId);
    if (!weapon || !this.level.weaponIds.includes(weaponId)) return { ok: false, reason: 'not-in-level' };
    if (this.tileType(x, y) !== 'buildable') return { ok: false, reason: 'not-buildable' };
    if (this.corks < weapon.cost) return { ok: false, reason: 'no-corks' };
    this.corks -= weapon.cost;
    this.towers.push({ id: this.nextTowerId++, x, y, weaponId, tier: 0, spent: weapon.cost, cooldown: 0 });
    return { ok: true };
  }

  upgradeTower(towerId) {
    if (this.over) return { ok: false, reason: 'game-over' };
    const tower = this.towers.find((t) => t.id === towerId);
    if (!tower) return { ok: false, reason: 'unknown' };
    const cost = upgradeCost(this.weaponDefs.get(tower.weaponId), tower.tier);
    if (cost === null) return { ok: false, reason: 'max-tier' };
    if (this.corks < cost) return { ok: false, reason: 'no-corks' };
    this.corks -= cost;
    tower.spent += cost;
    tower.tier += 1;
    return { ok: true };
  }

  sellTower(towerId) {
    if (this.over) return { ok: false, reason: 'game-over' };
    const i = this.towers.findIndex((t) => t.id === towerId);
    if (i < 0) return { ok: false, reason: 'unknown' };
    const refund = sellRefund(this.towers[i]);
    this.towers.splice(i, 1);
    this.corks += refund;
    return { ok: true, refund };
  }

  startNextWave() {
    if (this.over) return { ok: false, reason: 'game-over' };
    if (this.phase === 'wave') return { ok: false, reason: 'wave-running' };
    if (this.waveIndex >= this.totalWaves) return { ok: false, reason: 'no-waves' };
    this.schedule = buildSpawnSchedule(this.level.waves[this.waveIndex]);
    this.scheduleIndex = 0;
    this.waveTime = 0;
    this.waveIndex += 1;
    this.phase = 'wave';
    return { ok: true };
  }

  ringBell() {
    if (this.over) return { ok: false, reason: 'game-over' };
    if (this.bellUsed) return { ok: false, reason: 'used' };
    let reward = 0;
    for (const e of this.enemies) reward += this.enemyDefs.get(e.enemyId).reward;
    this.corks += reward;
    this.events.push({ type: 'bell', count: this.enemies.length, reward });
    this.enemies = [];
    this.bellUsed = true;
    return { ok: true };
  }

  tick(dt) {
    let remaining = Math.min(Math.max(dt, 0), MAX_TICK);
    while (remaining > EPS && !this.over) {
      const step = Math.min(SUBSTEP, remaining);
      this.step(step);
      remaining -= step;
    }
  }

  drainEvents() {
    const out = this.events;
    this.events = [];
    return out;
  }

  // --- private ---

  step(dt) {
    this.time += dt;
    if (this.phase === 'wave') this.spawn(dt);
    this.move(dt);
    this.fire(dt);
    this.leak();
    this.updatePhase();
  }

  spawn(dt) {
    this.waveTime += dt;
    while (this.scheduleIndex < this.schedule.length
      && this.schedule[this.scheduleIndex].time <= this.waveTime + EPS) {
      const { enemyId } = this.schedule[this.scheduleIndex++];
      const def = this.enemyDefs.get(enemyId);
      if (!def) continue;
      const id = this.nextEnemyId++;
      this.enemies.push({ id, enemyId, hp: def.hp, maxHp: def.hp, distance: 0,
        stallUntil: 0, stallImmuneUntil: 0, slowUntil: 0, slowFactor: 1 });
      this.events.push({ type: 'spawn', id, enemyId });
    }
  }

  move(dt) {
    for (const e of this.enemies) {
      if (this.time >= e.slowUntil) e.slowFactor = 1;
      if (this.time < e.stallUntil) continue;
      e.distance += this.enemyDefs.get(e.enemyId).speed * e.slowFactor * dt;
    }
  }

  fire(dt) {
    for (const tower of this.towers) {
      tower.cooldown = Math.max(tower.cooldown - dt, 0);
      if (tower.cooldown > 0) continue;
      const weapon = this.weaponDefs.get(tower.weaponId);
      const stats = weaponStats(weapon, tower.tier);
      const cx = tower.x + 0.5;
      const cy = tower.y + 0.5;
      const inRange = this.enemies.filter((e) => dist(cx, cy, this.posOf(e)) <= stats.range + EPS);
      if (inRange.length === 0) continue;
      const target = inRange.reduce((a, b) => (b.distance > a.distance ? b : a));
      const targetPos = this.posOf(target);
      tower.cooldown = 1 / stats.fireRate;

      let targets = [target];
      let hit = [target];
      if (weapon.effect === 'lure') {
        targets = inRange;
        hit = inRange;
      } else if (weapon.effect === 'splash') {
        hit = this.enemies.filter((e) => dist(targetPos.x, targetPos.y, this.posOf(e)) <= stats.effectStrength + EPS);
      }
      const until = this.time + (weapon.effectDuration || 0);
      for (const e of targets) {
        if (weapon.effect === 'slow') {
          e.slowFactor = 1 - stats.effectStrength;
          e.slowUntil = until;
        } else if (weapon.effect === 'distract' || weapon.effect === 'lure') {
          this.applyStall(e, weapon.effectDuration || 0);
        }
      }
      for (const e of hit) e.hp -= stats.damage;
      this.events.push({ type: 'shot', towerId: tower.id, targetIds: targets.map((e) => e.id),
        x: targetPos.x, y: targetPos.y });
      this.payKills();
    }
  }

  // Distract/lure: a stall is never refreshed while it runs, and after it ends the
  // guest is immune for half the duration, so fast stallers can't pin it forever.
  applyStall(e, duration) {
    if (duration <= 0 || this.time < e.stallUntil || this.time < e.stallImmuneUntil) return;
    e.stallUntil = this.time + duration;
    e.stallImmuneUntil = e.stallUntil + 0.5 * duration;
  }

  payKills() {
    this.enemies = this.enemies.filter((e) => {
      if (e.hp > 0) return true;
      const reward = this.enemyDefs.get(e.enemyId).reward;
      const { x, y } = this.posOf(e);
      this.corks += reward;
      this.events.push({ type: 'kill', id: e.id, enemyId: e.enemyId, reward, x, y });
      return false;
    });
  }

  leak() {
    this.enemies = this.enemies.filter((e) => {
      if (e.distance < this.pathLen) return true;
      const wineDamage = this.enemyDefs.get(e.enemyId).wineDamage;
      this.wine = Math.max(this.wine - wineDamage, 0);
      this.events.push({ type: 'leak', id: e.id, enemyId: e.enemyId, wineDamage });
      return false;
    });
  }

  updatePhase() {
    if (this.wine <= 0) {
      this.phase = 'lost';
      this.events.push({ type: 'lost' });
      return;
    }
    if (this.phase !== 'wave') return;
    if (this.scheduleIndex < this.schedule.length || this.enemies.length > 0) return;
    if (this.waveIndex >= this.totalWaves) {
      this.phase = 'won';
      this.events.push({ type: 'won' });
    } else {
      this.phase = 'build';
      this.events.push({ type: 'wave-cleared' });
    }
  }

  posOf(e) {
    return positionAt(this.level.path, e.distance);
  }
}

// Corks returned when selling a tower: half of everything spent on it, rounded down.
export function sellRefund(tower) {
  return Math.floor(tower.spent / 2);
}

function key(p) {
  return `${p.x},${p.y}`;
}

function dist(x, y, p) {
  return Math.hypot(p.x - x, p.y - y);
}
