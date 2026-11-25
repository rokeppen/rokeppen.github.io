// Renders one level from a GameState. All rules live in ../logic/state.js; this scene
// only draws the state, forwards input to it and turns its events into effects.
//
// Hooks for UI modules (Task 6, game/ui/*):
//   scene.state                      the GameState (read corks, wine, phase, towers, ...)
//   scene.level, scene.weapons       level definition, Map weaponId -> Weapon
//   scene.layout                     { boardX, boardY, width, height } in canvas pixels
//   scene.selectWeapon(id|null)      choose a weapon to place (null cancels)
//   scene.selectTower(id|null)       choose a placed tower (range shown)
//   scene.selectedWeaponId / selectedTowerId
//   scene.bus                        Phaser EventEmitter, recreated per level run:
//     'state-event' (ev)             every event from state.drainEvents(), once
//     'tile-click' ({x, y, type, towerId, result})   result = placeTower result when placing
//     'weapon-selected' (id|null), 'tower-selected' (id|null)
import { GameState } from '../logic/state.js';
import { positionAt } from '../logic/path.js';
import { weaponStats } from '../logic/stats.js';
import { PALETTE, TILE, HUD_HEIGHT, FONT, EMOJI_FONT, css } from '../theme.js';

const DEPTH = { board: 0, hover: 1, table: 2, towers: 3, enemies: 4, effects: 5, hud: 10 };
const BLOCKED_SPRITES = ['🪴', '🗄️', '🖨️', '🛋️'];
const SHOT_TTL = 0.12; // seconds a shot line stays visible

export class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
  }

  init({ levelId }) {
    this.levelId = levelId;
  }

  create() {
    this.state = null;
    const data = this.registry.get('data');
    this.level = data.levels.find((l) => l.id === this.levelId);
    if (!this.level) {
      this.scene.start('MenuScene');
      return;
    }
    this.weapons = new Map(data.weapons.map((w) => [w.id, w]));
    this.enemyDefs = new Map(data.enemies.map((e) => [e.id, e]));
    this.state = new GameState(this.level, data);

    this.bus = new Phaser.Events.EventEmitter();
    this.events.once('shutdown', () => this.bus.destroy());

    this.selectedWeaponId = null;
    this.selectedTowerId = null;
    this.hoverTile = null;
    this.towerSprites = new Map(); // tower id -> { container, pips, tier }
    this.enemySprites = new Map(); // enemy instance id -> { container, hpBar, status, lastHp, lastStatus }
    this.shots = [];

    this.layout = this.computeLayout(this.level);
    this.scale.setGameSize(this.layout.width, this.layout.height);

    this.drawBoard();
    this.drawEndpoints();
    this.hoverGfx = this.add.graphics().setDepth(DEPTH.hover);
    this.effectsGfx = this.add.graphics().setDepth(DEPTH.effects);
    this.installPointer();
    this.installDevControls(); // TEMPORARY: replaced by game/ui in Task 6
  }

  update(_time, delta) {
    if (!this.state) return;
    this.state.tick(delta / 1000);
    this.consumeEvents();
    this.syncTowers();
    this.syncEnemies();
    this.drawHover();
    this.drawEffects(delta / 1000);
    this.updateDevHud(); // TEMPORARY
  }

  // --- layout & coordinates ---

  computeLayout(level) {
    const boardX = 0;
    const boardY = HUD_HEIGHT;
    return {
      boardX,
      boardY,
      width: level.cols * TILE,
      height: HUD_HEIGHT + level.rows * TILE,
    };
  }

  // Tile units (0.5 = centre of tile 0) -> canvas pixels.
  toPixels(tx, ty) {
    return { x: this.layout.boardX + tx * TILE, y: this.layout.boardY + ty * TILE };
  }

  tileCentre(x, y) {
    return this.toPixels(x + 0.5, y + 0.5);
  }

  tileAt(px, py) {
    const x = Math.floor((px - this.layout.boardX) / TILE);
    const y = Math.floor((py - this.layout.boardY) / TILE);
    if (x < 0 || y < 0 || x >= this.level.cols || y >= this.level.rows) return null;
    return { x, y };
  }

  // --- public hooks ---

  selectWeapon(weaponId) {
    this.selectedWeaponId = weaponId && this.level.weaponIds.includes(weaponId) ? weaponId : null;
    if (this.selectedWeaponId) this.selectedTowerId = null;
    this.bus.emit('weapon-selected', this.selectedWeaponId);
  }

  selectTower(towerId) {
    this.selectedTowerId = towerId ?? null;
    if (this.selectedTowerId !== null) this.selectedWeaponId = null;
    this.bus.emit('tower-selected', this.selectedTowerId);
  }

  onTileClick(x, y) {
    const type = this.state.tileType(x, y);
    const tower = this.state.towers.find((t) => t.x === x && t.y === y);
    let result = null;
    if (this.selectedWeaponId) {
      result = this.state.placeTower(x, y, this.selectedWeaponId);
      if (result.ok) this.selectWeapon(null);
    } else {
      this.selectTower(tower ? tower.id : null);
    }
    this.bus.emit('tile-click', { x, y, type, towerId: tower ? tower.id : null, result });
  }

  // --- input ---

  installPointer() {
    this.input.on('pointermove', (p) => { this.hoverTile = this.tileAt(p.worldX, p.worldY); });
    this.input.on('pointerdown', (p) => {
      const tile = this.tileAt(p.worldX, p.worldY);
      if (tile) this.onTileClick(tile.x, tile.y);
    });
    this.input.on('gameout', () => { this.hoverTile = null; });
  }

  // --- events (the single consumer of state.drainEvents) ---

  consumeEvents() {
    for (const ev of this.state.drainEvents()) {
      this.renderEvent(ev);
      this.bus.emit('state-event', ev);
    }
  }

  renderEvent(ev) {
    switch (ev.type) {
      case 'shot': {
        const tower = this.state.towers.find((t) => t.id === ev.towerId);
        if (!tower) break;
        const from = this.tileCentre(tower.x, tower.y);
        const to = this.toPixels(ev.x, ev.y);
        this.shots.push({ x1: from.x, y1: from.y, x2: to.x, y2: to.y, ttl: SHOT_TTL });
        break;
      }
      case 'kill': {
        const at = this.toPixels(ev.x, ev.y);
        this.removeEnemySprite(ev.id, true);
        this.floatText(at.x, at.y - 20, `+${ev.reward} 🍾`, PALETTE.accent);
        break;
      }
      case 'leak': {
        this.removeEnemySprite(ev.id, false);
        const at = this.tileCentre(this.level.end.x, this.level.end.y);
        this.floatText(at.x, at.y - 24, `-${ev.wineDamage} 🍷`, PALETTE.danger);
        this.cameras.main.shake(150, 0.004);
        break;
      }
      case 'bell':
        this.cameras.main.flash(300, 242, 193, 78);
        break;
      default:
        break;
    }
  }

  // --- static board ---

  drawBoard() {
    const { cols, rows } = this.level;
    const g = this.add.graphics().setDepth(DEPTH.board);
    const pathSet = new Set(this.level.path.map((p) => `${p.x},${p.y}`));
    const isPath = (x, y) => pathSet.has(`${x},${y}`);

    // Oak floor
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const { x: px, y: py } = this.toPixels(x, y);
        g.fillStyle((x + y) % 2 === 0 ? PALETTE.floor : PALETTE.floorAlt, 1);
        g.fillRect(px, py, TILE, TILE);
      }
    }
    g.lineStyle(1, PALETTE.gridLine, 0.6);
    for (let x = 0; x <= cols; x++) {
      const a = this.toPixels(x, 0);
      g.lineBetween(a.x, a.y, a.x, a.y + rows * TILE);
    }
    for (let y = 0; y <= rows; y++) {
      const a = this.toPixels(0, y);
      g.lineBetween(a.x, a.y, a.x + cols * TILE, a.y);
    }

    // Carpet runner along the path: dark edge, lighter inner strip joined to neighbours
    const inset = 6;
    for (const p of this.level.path) {
      const { x: px, y: py } = this.toPixels(p.x, p.y);
      g.fillStyle(PALETTE.pathEdge, 1);
      g.fillRect(px, py, TILE, TILE);
      g.fillStyle(PALETTE.path, 1);
      g.fillRect(px + inset, py + inset, TILE - 2 * inset, TILE - 2 * inset);
      if (isPath(p.x - 1, p.y)) g.fillRect(px, py + inset, inset, TILE - 2 * inset);
      if (isPath(p.x + 1, p.y)) g.fillRect(px + TILE - inset, py + inset, inset, TILE - 2 * inset);
      if (isPath(p.x, p.y - 1)) g.fillRect(px + inset, py, TILE - 2 * inset, inset);
      if (isPath(p.x, p.y + 1)) g.fillRect(px + inset, py + TILE - inset, TILE - 2 * inset, inset);
    }

    // Blocked tiles: office furniture
    for (const b of this.level.blocked || []) {
      const { x: px, y: py } = this.toPixels(b.x, b.y);
      g.fillStyle(PALETTE.blockedEdge, 1);
      g.fillRect(px + 2, py + 2, TILE - 4, TILE - 4);
      g.fillStyle(PALETTE.blocked, 1);
      g.fillRect(px + 5, py + 5, TILE - 10, TILE - 10);
      const c = this.tileCentre(b.x, b.y);
      this.emoji(c.x, c.y, BLOCKED_SPRITES[(b.x * 7 + b.y * 3) % BLOCKED_SPRITES.length], 36)
        .setDepth(DEPTH.board);
    }
  }

  drawEndpoints() {
    const { start, end } = this.level;
    const s = this.tileCentre(start.x, start.y);
    this.emoji(s.x, s.y, '🚪', 34).setDepth(DEPTH.table).setAlpha(0.9);

    const e = this.tileCentre(end.x, end.y);
    const g = this.add.graphics().setDepth(DEPTH.table);
    g.fillStyle(PALETTE.table, 1);
    g.fillRoundedRect(e.x - 28, e.y - 24, 56, 50, 8);
    g.fillStyle(PALETTE.tablecloth, 1);
    g.fillRoundedRect(e.x - 25, e.y - 21, 50, 40, 6);
    g.fillStyle(PALETTE.tableTop, 1);
    g.fillRect(e.x - 25, e.y + 12, 50, 7);
    this.emoji(e.x - 9, e.y - 2, '🍷', 26).setDepth(DEPTH.table);
    this.emoji(e.x + 11, e.y - 4, '🍾', 26).setDepth(DEPTH.table);
  }

  // --- dynamic sprites ---

  syncTowers() {
    const alive = new Set();
    for (const t of this.state.towers) {
      alive.add(t.id);
      let s = this.towerSprites.get(t.id);
      if (!s) {
        const c = this.tileCentre(t.x, t.y);
        const base = this.add.graphics();
        base.fillStyle(PALETTE.towerBase, 1);
        base.fillCircle(0, 0, 26);
        base.lineStyle(3, PALETTE.towerRing, 1);
        base.strokeCircle(0, 0, 26);
        const weapon = this.weapons.get(t.weaponId);
        const icon = this.emoji(0, -1, weapon ? weapon.sprite : '❔', 32);
        const pips = this.add.graphics();
        const container = this.add.container(c.x, c.y, [base, icon, pips]).setDepth(DEPTH.towers);
        s = { container, pips, tier: -1 };
        this.towerSprites.set(t.id, s);
      }
      if (s.tier !== t.tier) {
        s.tier = t.tier;
        s.pips.clear();
        for (let i = 0; i < t.tier; i++) {
          const px = (i - (t.tier - 1) / 2) * 10;
          s.pips.fillStyle(PALETTE.pathEdge, 1);
          s.pips.fillCircle(px, 24, 5);
          s.pips.fillStyle(PALETTE.tierPip, 1);
          s.pips.fillCircle(px, 24, 3.5);
        }
      }
    }
    for (const [id, s] of this.towerSprites) {
      if (!alive.has(id)) {
        s.container.destroy();
        this.towerSprites.delete(id);
      }
    }
    if (this.selectedTowerId !== null && !alive.has(this.selectedTowerId)) this.selectTower(null);
  }

  syncEnemies() {
    const alive = new Set();
    for (const e of this.state.enemies) {
      alive.add(e.id);
      let s = this.enemySprites.get(e.id);
      if (!s) {
        const def = this.enemyDefs.get(e.enemyId);
        const shadow = this.add.ellipse(0, 18, 34, 10, PALETTE.enemyShadow, 0.25);
        const icon = this.emoji(0, 0, def ? def.sprite : '👤', 40);
        const hpBar = this.add.graphics();
        const status = this.emoji(18, -18, '', 18);
        const container = this.add.container(0, 0, [shadow, icon, hpBar, status]);
        s = { container, hpBar, status, lastHp: null, lastStatus: null };
        this.enemySprites.set(e.id, s);
      }
      const pos = positionAt(this.level.path, e.distance);
      const px = this.toPixels(pos.x, pos.y);
      s.container.setPosition(px.x, px.y).setDepth(DEPTH.enemies + e.distance / 10000);
      if (s.lastHp !== e.hp) {
        s.lastHp = e.hp;
        this.drawHpBar(s.hpBar, e.hp / e.maxHp);
      }
      const status = this.state.time < e.stallUntil ? '💬'
        : this.state.time < e.slowUntil && e.slowFactor < 1 ? '🐌' : '';
      if (s.lastStatus !== status) {
        s.lastStatus = status;
        s.status.setText(status);
      }
    }
    for (const id of [...this.enemySprites.keys()]) {
      if (!alive.has(id)) this.removeEnemySprite(id, false);
    }
  }

  drawHpBar(g, ratio) {
    const r = Math.max(0, Math.min(1, ratio));
    const w = 40;
    const h = 6;
    g.clear();
    g.fillStyle(PALETTE.hpBack, 0.85);
    g.fillRect(-w / 2 - 1, -32, w + 2, h + 2);
    g.fillStyle(r > 0.6 ? PALETTE.hpHigh : r > 0.3 ? PALETTE.hpMid : PALETTE.hpLow, 1);
    g.fillRect(-w / 2, -31, w * r, h);
  }

  removeEnemySprite(id, pop) {
    const s = this.enemySprites.get(id);
    if (!s) return;
    this.enemySprites.delete(id);
    if (!pop) {
      s.container.destroy();
      return;
    }
    this.tweens.add({
      targets: s.container, scale: 1.4, alpha: 0, duration: 180,
      onComplete: () => s.container.destroy(),
    });
  }

  // --- overlays ---

  drawHover() {
    const g = this.hoverGfx;
    g.clear();
    if (this.selectedWeaponId && this.hoverTile) {
      const { x, y } = this.hoverTile;
      const ok = this.state.tileType(x, y) === 'buildable';
      const p = this.toPixels(x, y);
      g.fillStyle(ok ? PALETTE.buildableHover : PALETTE.invalidHover, 0.45);
      g.fillRect(p.x, p.y, TILE, TILE);
      if (ok) this.drawRange(g, x, y, weaponStats(this.weapons.get(this.selectedWeaponId), 0).range);
      return;
    }
    const tower = this.state.towers.find((t) => t.id === this.selectedTowerId)
      || (this.hoverTile && this.state.towers.find((t) => t.x === this.hoverTile.x && t.y === this.hoverTile.y));
    if (tower) {
      this.drawRange(g, tower.x, tower.y, weaponStats(this.weapons.get(tower.weaponId), tower.tier).range);
    }
  }

  drawRange(g, x, y, rangeTiles) {
    const c = this.tileCentre(x, y);
    g.fillStyle(PALETTE.range, 0.18);
    g.fillCircle(c.x, c.y, rangeTiles * TILE);
    g.lineStyle(2, PALETTE.range, 0.8);
    g.strokeCircle(c.x, c.y, rangeTiles * TILE);
  }

  drawEffects(dt) {
    const g = this.effectsGfx;
    g.clear();
    this.shots = this.shots.filter((s) => (s.ttl -= dt) > 0);
    for (const s of this.shots) {
      g.lineStyle(3, PALETTE.shot, s.ttl / SHOT_TTL);
      g.lineBetween(s.x1, s.y1, s.x2, s.y2);
    }
  }

  floatText(x, y, text, color) {
    const t = this.add.text(x, y, text, {
      fontFamily: `${FONT}, ${EMOJI_FONT}`, fontSize: '20px', fontStyle: 'bold',
      color: css(color), stroke: css(PALETTE.hpBack), strokeThickness: 4,
      padding: { x: 2, y: 4 },
    }).setOrigin(0.5).setDepth(DEPTH.effects);
    this.tweens.add({
      targets: t, y: y - 36, alpha: 0, duration: 900, ease: 'Cubic.easeOut',
      onComplete: () => t.destroy(),
    });
  }

  emoji(x, y, char, size) {
    return this.add.text(x, y, char, {
      fontFamily: EMOJI_FONT, fontSize: `${size}px`, padding: { x: 2, y: 6 },
    }).setOrigin(0.5);
  }

  // --- TEMPORARY dev controls and HUD (Task 6 replaces these with game/ui modules) ---
  // Keys: 1-9 pick weapon, Esc cancel, N next wave, B bell, U upgrade / S sell selected tower,
  // M back to menu.

  installDevControls() {
    const keys = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE'];
    this.level.weaponIds.forEach((id, i) => {
      if (i < keys.length) this.input.keyboard.on(`keydown-${keys[i]}`, () => this.selectWeapon(id));
    });
    const kb = this.input.keyboard;
    kb.on('keydown-ESC', () => { this.selectWeapon(null); this.selectTower(null); });
    kb.on('keydown-N', () => this.state.startNextWave());
    kb.on('keydown-B', () => this.state.ringBell());
    kb.on('keydown-U', () => { if (this.selectedTowerId !== null) this.state.upgradeTower(this.selectedTowerId); });
    kb.on('keydown-S', () => { if (this.selectedTowerId !== null) this.state.sellTower(this.selectedTowerId); });
    kb.on('keydown-M', () => this.scene.start('MenuScene'));

    const bar = this.add.graphics().setDepth(DEPTH.hud);
    bar.fillStyle(PALETTE.hudBar, 1);
    bar.fillRect(0, 0, this.layout.width, HUD_HEIGHT);
    this.devHud = this.add.text(16, HUD_HEIGHT / 2, '', {
      fontFamily: `${FONT}, ${EMOJI_FONT}`, fontSize: '20px', color: css(PALETTE.hudText),
      padding: { y: 4 },
    }).setOrigin(0, 0.5).setDepth(DEPTH.hud);
    const weaponKeys = this.level.weaponIds
      .map((id, i) => `${i + 1}${this.weapons.get(id)?.sprite ?? '?'}`).join(' ');
    this.add.text(this.layout.width - 16, HUD_HEIGHT / 2,
      `${weaponKeys}  N wave  B bell  U/S tower  M menu`, {
        fontFamily: `${FONT}, ${EMOJI_FONT}`, fontSize: '14px', color: css(PALETTE.hudMuted),
        padding: { y: 4 },
      }).setOrigin(1, 0.5).setDepth(DEPTH.hud);
  }

  updateDevHud() {
    if (!this.devHud) return;
    const s = this.state;
    const weapon = this.selectedWeaponId ? ` · placing ${this.weapons.get(this.selectedWeaponId).name}` : '';
    const text = `${this.level.name}   🍾 ${s.corks}   🍷 ${s.wine}   Wave ${s.waveIndex}/${s.totalWaves}   ${s.phase}${weapon}`;
    if (text !== this.devHudText) {
      this.devHudText = text;
      this.devHud.setText(text);
    }
  }
}
