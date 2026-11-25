// Renders one level from a GameState. All rules live in ../logic/state.js; this scene
// only draws the state, forwards input to it and turns its events into effects and sounds.
// The HUD, build menu and tower panel live in ../ui/ and talk to the scene through:
//   scene.state                      the GameState (read corks, wine, phase, towers, ...)
//   scene.level, scene.weapons       level definition, Map weaponId -> Weapon
//   scene.enemyDefs                  Map enemyId -> Enemy
//   scene.layout                     { boardX, boardY, boardWidth, boardHeight, sideX, width, height }
//                                    in canvas pixels (side panel spans sideX..width, HUD_HEIGHT..height)
//   scene.selectWeapon(id|null)      choose a weapon to place (null cancels)
//   scene.selectTower(id|null)       choose a placed tower (range shown)
//   scene.selectedWeaponId / selectedTowerId / hoverWeaponId
//   scene.toast(text, color?), scene.toastReason(reason)
//   scene.onTowerUpgraded(tower), scene.onTowerSold(tower, refund), scene.backToMenu()
//   scene.speed (1|2), scene.sfx (see ../sound.js, may be null)
//   scene.bus                        Phaser EventEmitter, recreated per level run:
//     'state-event' (ev)             every event from state.drainEvents(), once
//     'tile-click' ({x, y, type, towerId, result})   result = placeTower result when placing
//     'weapon-selected' (id|null), 'tower-selected' (id|null)
import { GameState } from '../logic/state.js';
import { positionAt } from '../logic/path.js';
import { weaponStats } from '../logic/stats.js';
import { PALETTE, TILE, HUD_HEIGHT, SIDE_WIDTH, MIN_GAME_WIDTH, MIN_GAME_HEIGHT, FONT, EMOJI_FONT, css, rgb } from '../theme.js';
import { Hud } from '../ui/Hud.js';
import { BuildMenu } from '../ui/BuildMenu.js';
import { TowerPanel } from '../ui/TowerPanel.js';
import { toast, reasonText } from '../ui/widgets.js';

const DEPTH = { board: 0, hover: 1, table: 2, towers: 3, enemies: 4, effects: 6, hud: 10 };
const BLOCKED_SPRITES = ['🪴', '🗄️', '🖨️', '🛋️'];
const SHOT_TTL = 0.12; // seconds a shot line stays visible
const RING_TTL = 0.3;  // seconds a splash ring stays visible
const END_DELAY_MS = 1200; // let the last effects play before the end screen

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
    this.sfx = this.registry.get('sfx') ?? null;

    this.bus = new Phaser.Events.EventEmitter();
    this.events.once('shutdown', () => this.bus.destroy());
    // Input is switched off when a level ends; a restart must switch it back on.
    this.input.enabled = true;
    if (this.input.keyboard) this.input.keyboard.enabled = true;

    this.selectedWeaponId = null;
    this.selectedTowerId = null;
    this.hoverWeaponId = null;
    this.hoverTile = null;
    this.speed = 1;
    this.kills = 0;
    this.ended = false;
    this.toastText = null;
    this.towerSprites = new Map(); // tower id -> { container, pips, tier }
    this.enemySprites = new Map(); // enemy instance id -> { container, icon, hpBar, status, ... }
    this.stallSource = new Map();  // enemy instance id -> { effect, x, y } of the last distract/lure
    this.shots = [];

    this.layout = this.computeLayout(this.level);
    this.scale.setGameSize(this.layout.width, this.layout.height);

    this.drawBoard();
    this.drawEndpoints();
    this.hoverGfx = this.add.graphics().setDepth(DEPTH.hover);
    this.effectsGfx = this.add.graphics().setDepth(DEPTH.effects);
    this.installPointer();

    this.hud = new Hud(this);
    this.buildMenu = new BuildMenu(this);
    this.towerPanel = new TowerPanel(this, this.buildMenu.bottom);
  }

  update(_time, delta) {
    if (!this.state) return;
    // GameState caps each tick, so a long frame (tab switched away) can't skip towers.
    this.state.tick((delta / 1000) * this.speed);
    this.consumeEvents();
    this.syncTowers();
    this.syncEnemies();
    this.drawHover();
    this.drawEffects(delta / 1000);
    this.hud.update();
    this.buildMenu.update();
    this.towerPanel.update();
  }

  // --- layout & coordinates ---

  // The canvas is at least MIN_GAME_WIDTH x MIN_GAME_HEIGHT; a smaller board is centred in
  // the area left of the side panel. Large boards simply grow the canvas (Scale.FIT shrinks it).
  computeLayout(level) {
    const boardWidth = level.cols * TILE;
    const boardHeight = level.rows * TILE;
    const width = Math.max(MIN_GAME_WIDTH, boardWidth + SIDE_WIDTH);
    const height = Math.max(MIN_GAME_HEIGHT, HUD_HEIGHT + boardHeight);
    const sideX = width - SIDE_WIDTH;
    return {
      boardX: Math.floor((sideX - boardWidth) / 2),
      boardY: HUD_HEIGHT + Math.floor((height - HUD_HEIGHT - boardHeight) / 2),
      boardWidth,
      boardHeight,
      sideX,
      width,
      height,
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
    if (this.state.over) return;
    const type = this.state.tileType(x, y);
    const tower = this.state.towers.find((t) => t.x === x && t.y === y);
    let result = null;
    if (this.selectedWeaponId && tower) {
      // Clicking an existing tower while placing opens that tower instead of complaining.
      this.selectTower(tower.id);
    } else if (this.selectedWeaponId) {
      const weaponId = this.selectedWeaponId;
      result = this.state.placeTower(x, y, weaponId);
      if (result.ok) {
        this.selectWeapon(null);
        this.onTowerPlaced(x, y, weaponId);
      } else {
        this.toastReason(result.reason);
      }
    } else {
      this.selectTower(tower ? tower.id : null);
    }
    this.bus.emit('tile-click', { x, y, type, towerId: tower ? tower.id : null, result });
  }

  toast(text, color = PALETTE.hudText) {
    const { boardX, boardWidth } = this.layout;
    toast(this, boardX + boardWidth / 2, HUD_HEIGHT + 24, text, color);
  }

  toastReason(reason) {
    this.toast(reasonText(reason), PALETTE.danger);
  }

  onTowerPlaced(x, y, weaponId) {
    const c = this.tileCentre(x, y);
    this.floatText(c.x, c.y - 30, `-${this.weapons.get(weaponId).cost} 🍾`, PALETTE.hudMuted);
    this.play('cork');
  }

  onTowerUpgraded(tower) {
    const c = this.tileCentre(tower.x, tower.y);
    this.floatText(c.x, c.y - 30, '⬆ Upgraded!', PALETTE.accent);
    const s = this.towerSprites.get(tower.id);
    if (s) this.tweens.add({ targets: s.container, scale: 1.25, duration: 110, yoyo: true });
    this.play('cork');
  }

  onTowerSold(tower, refund) {
    const c = this.tileCentre(tower.x, tower.y);
    this.floatText(c.x, c.y - 20, `+${refund} 🍾`, PALETTE.accent);
    this.play('cork');
  }

  backToMenu() {
    this.scene.stop('EndScene');
    this.scene.start('MenuScene');
  }

  play(name) {
    if (this.sfx) this.sfx.play(name);
  }

  // --- input ---

  installPointer() {
    if (this.input.mouse) this.input.mouse.disableContextMenu();
    this.input.on('pointermove', (p) => { this.hoverTile = this.tileAt(p.worldX, p.worldY); });
    this.input.on('pointerdown', (p) => {
      if (p.rightButtonDown && p.rightButtonDown()) {
        this.selectWeapon(null);
        this.selectTower(null);
        return;
      }
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
      case 'shot':
        this.renderShot(ev);
        break;
      case 'kill': {
        this.kills += 1;
        const at = this.toPixels(ev.x, ev.y);
        this.removeEnemySprite(ev.id, true);
        this.floatText(at.x, at.y - 20, `+${ev.reward} 🍾`, PALETTE.accent);
        this.play('cork');
        break;
      }
      case 'leak': {
        this.removeEnemySprite(ev.id, false);
        const at = this.tileCentre(this.level.end.x, this.level.end.y);
        this.floatText(at.x, at.y - 24, `-${ev.wineDamage} 🍷`, PALETTE.danger);
        this.cameras.main.shake(150, 0.004);
        this.play('leak');
        break;
      }
      case 'bell':
        this.renderBell(ev);
        break;
      case 'wave-cleared':
        this.toast(`Wave ${this.state.waveIndex} cleared! 🥂`, PALETTE.good);
        break;
      case 'won':
      case 'lost':
        this.endLevel(ev.type === 'won');
        break;
      default:
        break;
    }
  }

  renderShot(ev) {
    const tower = this.state.towers.find((t) => t.id === ev.towerId);
    if (!tower) return;
    const weapon = this.weapons.get(tower.weaponId);
    const from = this.tileCentre(tower.x, tower.y);
    const to = this.toPixels(ev.x, ev.y);
    const effect = weapon ? weapon.effect : 'none';

    if (effect === 'lure') {
      // Pizza smell reaches everyone in range; remember where to lean.
      for (const id of ev.targetIds) {
        this.stallSource.set(id, { effect, x: tower.x + 0.5, y: tower.y + 0.5 });
        const e = this.state.enemies.find((en) => en.id === id);
        if (!e) continue;
        const p = positionAt(this.level.path, e.distance);
        const px = this.toPixels(p.x, p.y);
        this.shots.push({ kind: 'line', x1: from.x, y1: from.y, x2: px.x, y2: px.y, ttl: SHOT_TTL * 2, max: SHOT_TTL * 2, color: PALETTE.lure });
      }
      this.shots.push({ kind: 'ring', x: from.x, y: from.y, r: weaponStats(weapon, tower.tier).range * TILE, ttl: RING_TTL, max: RING_TTL, color: PALETTE.lure });
    } else {
      if (effect === 'distract') {
        for (const id of ev.targetIds) this.stallSource.set(id, { effect, x: tower.x + 0.5, y: tower.y + 0.5 });
      }
      this.shots.push({ kind: 'line', x1: from.x, y1: from.y, x2: to.x, y2: to.y, ttl: SHOT_TTL, max: SHOT_TTL, color: PALETTE.shot });
      if (effect === 'splash') {
        const r = weaponStats(weapon, tower.tier).effectStrength * TILE;
        this.shots.push({ kind: 'ring', x: to.x, y: to.y, r, ttl: RING_TTL, max: RING_TTL, color: PALETTE.splash });
      }
    }

    const s = this.towerSprites.get(tower.id);
    if (s && !s.punching) {
      s.punching = true;
      this.tweens.add({
        targets: s.icon, scale: 1.2, duration: 60, yoyo: true,
        onComplete: () => { s.punching = false; },
      });
    }
    this.play('shot');
  }

  // The Nexios Victory Bell: everyone on the floor is walked out and pays up.
  renderBell(ev) {
    const cam = this.cameras.main;
    cam.shake(450, 0.012);
    cam.flash(500, ...rgb(PALETTE.accent));
    this.play('bell');
    this.kills += ev.count;

    let i = 0;
    for (const [id, s] of [...this.enemySprites]) {
      const { x, y } = s.container;
      const delay = Math.min(i, 20) * 25;
      if (i < 12) {
        this.time.delayedCall(delay, () => this.floatText(x, y - 20, `+${s.reward} 🍾`, PALETTE.accent));
      }
      this.enemySprites.delete(id);
      this.stallSource.delete(id);
      this.tweens.add({
        targets: s.container, scale: 1.6, alpha: 0, angle: 25, delay, duration: 260,
        onComplete: () => s.container.destroy(),
      });
      i++;
    }

    const { boardX, boardY, boardWidth, boardHeight } = this.layout;
    const cx = boardX + boardWidth / 2;
    const cy = boardY + boardHeight / 2;
    this.shots.push({ kind: 'ring', x: cx, y: cy, r: Math.max(boardWidth, boardHeight), ttl: 0.6, max: 0.6, color: PALETTE.accent, grow: true });
    const bell = this.add.text(cx, cy - 30, '🔔', { fontFamily: EMOJI_FONT, fontSize: '96px', padding: { x: 4, y: 12 } })
      .setOrigin(0.5, 0.2).setDepth(DEPTH.effects + 1).setScale(0.2);
    this.tweens.add({ targets: bell, scale: 1, duration: 250, ease: 'Back.easeOut' });
    this.tweens.add({ targets: bell, angle: { from: -22, to: 22 }, duration: 120, yoyo: true, repeat: 4 });
    this.tweens.add({ targets: bell, alpha: 0, delay: 1100, duration: 400, onComplete: () => bell.destroy() });

    const text = ev.count > 0 ? `DING DING! +${ev.reward} 🍾` : 'DING DING!';
    const t = this.add.text(cx, cy + 60, text, {
      fontFamily: `${FONT}, ${EMOJI_FONT}`, fontSize: '40px', fontStyle: 'bold',
      color: css(PALETTE.accent), stroke: css(PALETTE.hpBack), strokeThickness: 7, padding: { x: 4, y: 8 },
    }).setOrigin(0.5).setDepth(DEPTH.effects + 1).setScale(0.3);
    this.tweens.add({ targets: t, scale: 1, duration: 320, ease: 'Back.easeOut' });
    this.tweens.add({ targets: t, alpha: 0, y: cy + 30, delay: 1300, duration: 500, onComplete: () => t.destroy() });
    if (ev.count > 0) {
      this.time.delayedCall(350, () => this.toast(`${ev.count} guest${ev.count === 1 ? '' : 's'} rung out of the office`, PALETTE.accent));
    }
  }

  endLevel(won) {
    if (this.ended) return;
    this.ended = true;
    this.selectWeapon(null);
    this.selectTower(null);
    this.input.enabled = false;
    if (this.input.keyboard) this.input.keyboard.enabled = false;
    this.play(won ? 'won' : 'lost');
    if (!won) this.cameras.main.shake(400, 0.01);
    const s = this.state;
    const result = {
      levelId: this.level.id, won, wine: s.wine, startingWine: this.level.startingWine,
      corks: s.corks, wave: s.waveIndex, totalWaves: s.totalWaves, kills: this.kills,
    };
    this.time.delayedCall(END_DELAY_MS, () => this.scene.launch('EndScene', result));
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
    const door = this.add.graphics().setDepth(DEPTH.table);
    door.fillStyle(PALETTE.door, 0.9);
    door.fillRoundedRect(s.x - 24, s.y - 28, 48, 56, 6);
    this.emoji(s.x, s.y, '🚪', 34).setDepth(DEPTH.table);

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
        container.setScale(0.3);
        this.tweens.add({ targets: container, scale: 1, duration: 260, ease: 'Back.easeOut' });
        s = { container, icon, pips, tier: -1, punching: false };
        this.towerSprites.set(t.id, s);
      }
      if (s.tier !== t.tier) {
        s.tier = t.tier;
        s.pips.clear();
        for (let i = 0; i < t.tier; i++) {
          const px = (i - (t.tier - 1) / 2) * 10;
          s.pips.fillStyle(PALETTE.tierPipEdge, 1);
          s.pips.fillCircle(px, 24, 5);
          s.pips.fillStyle(PALETTE.tierPip, 1);
          s.pips.fillCircle(px, 24, 3.5);
        }
      }
    }
    for (const [id, s] of this.towerSprites) {
      if (!alive.has(id)) {
        this.tweens.killTweensOf([s.container, s.icon]);
        s.container.destroy();
        this.towerSprites.delete(id);
      }
    }
    if (this.selectedTowerId !== null && !alive.has(this.selectedTowerId)) this.selectTower(null);
  }

  syncEnemies() {
    const alive = new Set();
    const now = this.state.time;
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
        s = { container, icon, hpBar, status, reward: def ? def.reward : 0,
          lastHp: null, lastStatus: null, depth: null };
        this.enemySprites.set(e.id, s);
      }
      const pos = positionAt(this.level.path, e.distance);
      const px = this.toPixels(pos.x, pos.y);
      s.container.setPosition(px.x, px.y);
      // Lower on screen draws in front; only touch depth when it changes.
      const depth = DEPTH.enemies + Math.round(px.y) / 10000;
      if (s.depth !== depth) {
        s.depth = depth;
        s.container.setDepth(depth);
      }
      if (s.lastHp !== e.hp) {
        s.lastHp = e.hp;
        this.drawHpBar(s.hpBar, e.hp / e.maxHp);
      }

      const stalled = now < e.stallUntil;
      const source = stalled ? this.stallSource.get(e.id) : null;
      let status = '';
      let rotation = 0;
      let ox = 0;
      let oy = 0;
      if (source && source.effect === 'lure') {
        // Leaning hungrily toward the pizza, without leaving the path.
        const angle = Math.atan2(source.y - pos.y, source.x - pos.x);
        ox = Math.cos(angle) * 7;
        oy = Math.sin(angle) * 5;
        rotation = Math.cos(angle) * 0.35 + Math.sin(now * 14) * 0.05;
        status = '🍕';
      } else if (stalled) {
        rotation = Math.sin(now * 9 + e.id) * 0.2; // tipsy wobble at the wine tasting
        status = '💬';
      } else if (now < e.slowUntil && e.slowFactor < 1) {
        status = '🐌';
      }
      s.icon.setRotation(rotation).setPosition(ox, oy);
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
    this.stallSource.delete(id);
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
      this.drawRange(g, x, y, weaponStats(this.weapons.get(this.selectedWeaponId), 0).range, ok);
      return;
    }
    const tower = this.state.towers.find((t) => t.id === this.selectedTowerId)
      || (this.hoverTile && this.state.towers.find((t) => t.x === this.hoverTile.x && t.y === this.hoverTile.y));
    if (tower) {
      this.drawRange(g, tower.x, tower.y, weaponStats(this.weapons.get(tower.weaponId), tower.tier).range, true);
    }
  }

  drawRange(g, x, y, rangeTiles, ok) {
    const c = this.tileCentre(x, y);
    const color = ok ? PALETTE.range : PALETTE.invalidHover;
    g.fillStyle(color, ok ? 0.18 : 0.1);
    g.fillCircle(c.x, c.y, rangeTiles * TILE);
    g.lineStyle(2, color, 0.8);
    g.strokeCircle(c.x, c.y, rangeTiles * TILE);
  }

  drawEffects(dt) {
    const g = this.effectsGfx;
    g.clear();
    this.shots = this.shots.filter((s) => (s.ttl -= dt) > 0);
    for (const s of this.shots) {
      const life = s.ttl / s.max;
      if (s.kind === 'ring') {
        const r = s.grow ? s.r * (1 - life) : s.r * (1.1 - life * 0.3);
        g.lineStyle(s.grow ? 10 : 3, s.color, life);
        g.strokeCircle(s.x, s.y, r);
      } else {
        g.lineStyle(3, s.color, life);
        g.lineBetween(s.x1, s.y1, s.x2, s.y2);
      }
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
}
