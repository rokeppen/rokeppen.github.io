// Renders one level from a GameState. All rules live in ../logic/state.js; this scene
// only draws the state, forwards input to it and plays back the events of the guests' turn.
//
// Play is turn-based: in the player's turn the scene waits for actions (place, upgrade,
// sell: 3 per turn) and the free Victory Bell; End turn (button or Space) calls
// state.endTurn(), which resolves the whole guests' turn at once. Its events are then
// played back round by round (see ../playback.js): guests tween tile to tile, towers fire
// after each round of steps. While that runs `busy` is true and every action is refused.
//
// The HUD, build menu and tower panel live in ../ui/ and talk to the scene through:
//   scene.state                      the GameState (read corks, wine, phase, towers, ...)
//   scene.view                       { corks, wine, wave, turn, actions } as shown: follows the
//                                    state, except during playback (then event by event)
//   scene.busy, scene.ended          guests' turn playing back / level finished
//   scene.fast                       ⏩: playback 3× faster
//   scene.level, scene.weapons       level definition, Map weaponId -> Weapon
//   scene.enemyDefs                  Map enemyId -> Enemy
//   scene.hud                        Hud (capsTarget(), bumpCaps() for flying caps)
//   scene.layout                     { boardX, boardY, boardWidth, boardHeight, sideX, width, height }
//                                    in canvas pixels (side panel spans sideX..width, HUD_HEIGHT..height)
//   scene.endTurn(), scene.ringBell()
//   scene.refuseAction()             true (with a toast while busy) when no action may be taken now
//   scene.selectWeapon(id|null)      choose a weapon to place (null cancels)
//   scene.selectTower(id|null)       choose a placed tower (range shown)
//   scene.selectedWeaponId / selectedTowerId / hoverWeaponId
//   scene.toast(text, color?), scene.toastReason(reason)
//   scene.onTowerUpgraded(tower), scene.onTowerSold(tower, refund), scene.backToMenu()
//   scene.sfx (see ../sound.js, may be null)
//   scene.bus                        Phaser EventEmitter, recreated per level run:
//     'state-event' (ev)             every engine event, once, when it is played back
//     'playback-done' (turn)         the guests' turn finished playing; input is back
//     'tile-click' ({x, y, type, towerId, result})   result = placeTower result when placing
//     'weapon-selected' (id|null), 'tower-selected' (id|null)
import { GameState } from '../logic/state.js';
import { weaponStats } from '../logic/stats.js';
import { planPlayback, scaleMs, STEP_MS, SETTLE_MS } from '../playback.js';
import {
  PALETTE, TILE, HUD_HEIGHT, SIDE_WIDTH, MIN_GAME_WIDTH, MIN_GAME_HEIGHT, BOARD_PAD, BOARD_EDGE,
  FONT, EMOJI_FONT, css, rgb,
} from '../theme.js';
import { Hud } from '../ui/Hud.js';
import { BuildMenu } from '../ui/BuildMenu.js';
import { TowerPanel } from '../ui/TowerPanel.js';
import { toast, reasonText, label, icon, barIcon } from '../ui/widgets.js';
import {
  addBackground, addBoardBase, addPiece, addCard, bakeBoardTextures, snap, PIECES, TEX, HP_W,
} from '../ui/textures.js';
import { recordBest } from '../progress.js';
import { CAFE_STATUS } from '../how-to.js';

const DEPTH = { board: 0, hover: 0.5, blocks: 1, table: 2, towers: 3, enemies: 4, effects: 6, bubbles: 7, hud: 10 };
const BLOCKED_SPRITES = ['🪴', '🗄️', '🖨️', '🛋️'];
const SHOT_TTL = 0.12; // seconds a shot line stays visible
const RING_TTL = 0.3;  // seconds a splash ring stays visible
const END_DELAY_MS = 1200; // let the last effects play before the end screen
const MARGIN = 12;         // space between the board frame and the canvas / side panel
const BUBBLE_MS = 2500;    // a quote bubble stays this long (or until its guest is gone)
const MAX_BUBBLES = 3;
const MAX_FLYING_CAPS = 6;
const SQUASH_MS = 60;      // half of the 120 ms squash when a tower fires
// Guests sharing a tile stand a little apart (pixels), by spawn order. From CROWD guests on
// one tile on, the rest stack in the middle and the tile gets a "×N" count pill.
const SHARE_OFFSETS = [[-9, -5], [9, 5], [9, -6], [-9, 6]];
const CROWD = SHARE_OFFSETS.length + 1;

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
    this.fast = false;
    this.stepMs = STEP_MS; // tile-to-tile tween of the current beat (shorter on long walks)
    this.busy = false;
    this.view = {};
    this.syncView();
    this.kills = 0;
    this.ended = false;
    this.toastObj = null;
    this.bubbles = new Map();      // enemy instance id -> { container, until }
    this.flyingCaps = 0;
    this.towerSprites = new Map(); // tower id -> { container, icon, pips, tier, punching }
    this.enemySprites = new Map(); // enemy instance id -> sprite record, see addEnemySprite
    this.stallSource = new Map();  // enemy instance id -> { effect, x, y } of the last distract/lure
    this.tileMarks = new Map();    // "x,y" -> { container, sig } the per-tile "→n" / "×N" pills
    this.shots = [];

    this.layout = this.computeLayout(this.level);
    this.scale.setGameSize(this.layout.width, this.layout.height);

    addBackground(this, this.layout.width, this.layout.height);
    bakeBoardTextures(this);
    this.drawBoard();
    this.drawEndpoints();
    this.hoverGfx = this.add.graphics().setDepth(DEPTH.hover);
    // Range circles stay on the board: clip them to the board frame.
    const { boardX, boardY, boardWidth, boardHeight } = this.layout;
    const clip = this.make.graphics({ x: 0, y: 0, add: false });
    clip.fillStyle(0xffffff, 1);
    clip.fillRect(boardX - BOARD_PAD, boardY - BOARD_PAD, boardWidth + 2 * BOARD_PAD, boardHeight + 2 * BOARD_PAD);
    const mask = clip.createGeometryMask();
    this.hoverGfx.setMask(mask);
    // The clip shape isn't on the display list, so the scene won't free it: do it on shutdown.
    this.events.once('shutdown', () => {
      mask.destroy();
      clip.destroy();
    });
    this.effectsGfx = this.add.graphics().setDepth(DEPTH.effects);
    this.installPointer();

    this.hud = new Hud(this);
    this.buildMenu = new BuildMenu(this);
    this.towerPanel = new TowerPanel(this, this.buildMenu.bottom);
  }

  // No simulation here: the state only changes on actions and End turn. Frames animate.
  update(_time, delta) {
    if (!this.state) return;
    if (!this.busy) this.syncView();
    this.syncTowers();
    this.animateEnemies();
    this.updateBubbles();
    this.drawHover();
    this.drawEffects(delta / 1000);
    this.hud.update();
    this.buildMenu.update();
    this.towerPanel.update();
  }

  syncView() {
    const s = this.state;
    const v = this.view;
    v.corks = s.corks;
    v.wine = s.wine;
    v.wave = s.waveIndex;
    v.turn = s.turn;
    v.actions = s.over ? 0 : s.actionsLeft;
  }

  // --- layout & coordinates ---

  // The canvas is at least MIN_GAME_WIDTH x MIN_GAME_HEIGHT; a smaller board is centred in
  // the area left of the side panel. Large boards simply grow the canvas (Scale.FIT shrinks it).
  // The board frame (BOARD_PAD around the tiles, BOARD_EDGE below) plus MARGIN must fit too.
  computeLayout(level) {
    const boardWidth = level.cols * TILE;
    const boardHeight = level.rows * TILE;
    const frame = BOARD_PAD + MARGIN;
    const width = Math.max(MIN_GAME_WIDTH, boardWidth + 2 * frame + SIDE_WIDTH);
    const height = Math.max(MIN_GAME_HEIGHT, HUD_HEIGHT + boardHeight + 2 * frame + BOARD_EDGE);
    const sideX = width - SIDE_WIDTH;
    return {
      boardX: Math.floor((sideX - boardWidth) / 2),
      boardY: HUD_HEIGHT + Math.floor((height - HUD_HEIGHT - boardHeight - BOARD_EDGE) / 2),
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

  // Centre of the path tile a guest stands on.
  pathCentre(index) {
    const path = this.level.path;
    const p = path[Math.max(0, Math.min(index, path.length - 1))];
    return this.tileCentre(p.x, p.y);
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

  // True when no action may be taken now. During the guests' turn it says why.
  refuseAction() {
    if (this.ended || this.state.over) return true;
    if (this.busy) {
      this.toastReason('guests-moving');
      return true;
    }
    return false;
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
      if (this.refuseAction()) return;
      const weaponId = this.selectedWeaponId;
      result = this.state.placeTower(x, y, weaponId);
      if (result.ok) {
        this.selectWeapon(null);
        this.onTowerPlaced(x, y, weaponId);
      } else {
        this.toastReason(result.reason);
      }
    } else {
      // Looking at a tower is not an action: allowed while the guests move.
      this.selectTower(tower ? tower.id : null);
    }
    this.bus.emit('tile-click', { x, y, type, towerId: tower ? tower.id : null, result });
  }

  // Ends the player's turn and plays back the guests' turn.
  endTurn() {
    if (this.ended || this.state.over) return;
    if (this.busy) {
      this.toastReason('guests-moving');
      return;
    }
    const result = this.state.endTurn();
    if (!result.ok) {
      this.toastReason(result.reason);
      return;
    }
    this.selectWeapon(null);
    this.runPlayback(result.events);
  }

  // The Nexios Victory Bell: free (not an action), once per level.
  ringBell() {
    if (this.refuseAction()) return;
    const { state } = this;
    if (!state.bellUsed && state.enemies.length === 0) {
      // Don't waste the once-per-level bell on an empty office.
      this.toast('No guests to ring out yet');
      return;
    }
    const result = state.ringBell();
    if (!result.ok) {
      this.toastReason(result.reason);
      return;
    }
    for (const ev of result.events) this.playEvent(ev);
  }

  toast(text, color = PALETTE.text) {
    const { sideX } = this.layout;
    toast(this, sideX / 2, HUD_HEIGHT + 30, text, color);
  }

  toastReason(reason) {
    this.toast(reasonText(reason), PALETTE.danger);
  }

  onTowerPlaced(x, y, weaponId) {
    const c = this.tileCentre(x, y);
    this.floatText(c.x, c.y - 30, `-${this.weapons.get(weaponId).cost} 🧢`, PALETTE.muted);
    this.play('cork');
  }

  onTowerUpgraded(tower) {
    const c = this.tileCentre(tower.x, tower.y);
    this.floatText(c.x, c.y - 30, '⬆ Upgraded!', PALETTE.goodText);
    const s = this.towerSprites.get(tower.id);
    if (s) {
      this.tweens.killTweensOf(s.container);
      s.container.setScale(1);
      s.punching = true;
      this.tweens.add({
        targets: s.container, scale: 1.2, duration: 110, yoyo: true,
        onComplete: () => { s.punching = false; },
      });
    }
    this.play('cork');
  }

  onTowerSold(tower, refund) {
    const c = this.tileCentre(tower.x, tower.y);
    this.floatText(c.x, c.y - 20, `+${refund} 🧢`, PALETTE.capsText);
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

  // --- guests' turn playback ---

  // Plays the beats one after another; each beat's wait is read when it starts, so ⏩
  // takes effect mid-turn. A short settle at the end lets the last shots and floats land.
  runPlayback(events) {
    this.busy = true;
    this.view.actions = 0;
    this.stepMs = STEP_MS;
    for (const s of this.enemySprites.values()) s.preview = null; // previews hidden while moving
    const beats = planPlayback(events);
    let i = 0;
    const next = () => {
      if (!this.state) return;
      if (i > beats.length) {
        this.finishPlayback();
        return;
      }
      if (i === beats.length) {
        i += 1;
        this.time.delayedCall(scaleMs(SETTLE_MS, this.fast), next);
        return;
      }
      const beat = beats[i++];
      if (beat.stepMs !== undefined) this.stepMs = beat.stepMs;
      for (const ev of beat.events) this.playEvent(ev);
      this.time.delayedCall(scaleMs(beat.ms, this.fast), next);
    };
    next();
  }

  // Back to the player: the sprites match the state exactly, previews are refreshed.
  finishPlayback() {
    this.busy = false;
    this.syncView();
    this.reconcileEnemies();
    this.bus.emit('playback-done', this.state.turn);
  }

  playEvent(ev) {
    this.renderEvent(ev);
    this.bus.emit('state-event', ev);
  }

  renderEvent(ev) {
    switch (ev.type) {
      case 'bonus': {
        this.view.corks += ev.caps;
        const at = this.hud.capsTarget();
        this.floatText(Math.max(at.x, 60), HUD_HEIGHT + 16, `+${ev.caps} 🧢`, PALETTE.capsText, DEPTH.hud + 2);
        this.hud.bumpCaps();
        this.play('cork');
        break;
      }
      case 'wave-start':
        this.view.wave = ev.wave;
        this.toast(`Wave ${ev.wave} incoming! 🚪`, PALETTE.text);
        break;
      case 'spawn':
        this.addEnemySprite(ev.id, ev.enemyId, ev.pathIndex ?? 0, true);
        break;
      case 'step':
        this.stepEnemy(ev);
        break;
      case 'shot':
        this.renderShot(ev);
        break;
      case 'effect': {
        const s = this.enemySprites.get(ev.id);
        if (s && ev.kind === 'stall') {
          s.stalled = true;
          s.walking = false;
        } else if (s && ev.kind === 'slow') {
          s.slowed = true;
        }
        break;
      }
      case 'kill': {
        this.kills += 1;
        this.view.corks += ev.reward;
        const at = this.toPixels(ev.x, ev.y);
        this.removeEnemySprite(ev.id, true);
        this.floatText(at.x, at.y - 24, `+${ev.reward} 🧢`, PALETTE.capsText);
        this.flyCap(at.x, at.y);
        this.play('cork');
        break;
      }
      case 'leak':
        this.renderLeak(ev);
        break;
      case 'bell':
        this.renderBell(ev);
        break;
      case 'wave-cleared':
        this.toast(`Wave ${ev.wave} cleared! 🍻`, PALETTE.goodText);
        break;
      case 'quote':
        this.showQuote(ev);
        break;
      case 'won':
      case 'lost':
        this.endLevel(ev.type === 'won');
        break;
      default:
        break;
    }
  }

  stepEnemy(ev) {
    const s = this.enemySprites.get(ev.id);
    if (!s) return;
    const from = this.pathCentre(ev.from);
    const to = this.pathCentre(ev.to);
    this.tweens.killTweensOf(s.pos);
    s.pos.x = from.x;
    s.pos.y = from.y;
    s.index = ev.to;
    s.walking = true;
    this.tweens.add({
      targets: s.pos, x: to.x, y: to.y, duration: Math.max(1, scaleMs(this.stepMs, this.fast)), ease: 'Sine.easeInOut',
      onComplete: () => { s.walking = false; },
    });
  }

  // The guest finishes its step onto the bar, then drains the kegs and leaves.
  renderLeak(ev) {
    this.time.delayedCall(scaleMs(this.stepMs, this.fast), () => {
      this.view.wine = Math.max(0, this.view.wine - ev.wineDamage);
      this.removeEnemySprite(ev.id, false);
      const at = this.tileCentre(this.level.end.x, this.level.end.y);
      this.floatText(at.x, at.y - 30, `-${ev.wineDamage} 🍺`, PALETTE.danger);
      this.cameras.main.shake(150, 0.004);
      this.play('leak');
    });
  }

  renderShot(ev) {
    const tower = this.state.towers.find((t) => t.id === ev.towerId);
    if (!tower) return;
    const weapon = this.weapons.get(tower.weaponId);
    const stats = weaponStats(weapon, tower.tier);
    const from = this.tileCentre(tower.x, tower.y);
    from.y -= PIECES.tower.lift;
    const to = this.toPixels(ev.x, ev.y);
    const effect = weapon ? weapon.effect : 'none';

    if (effect === 'lure') {
      // Pizza smell reaches everyone in range; remember where to lean.
      for (const id of ev.targetIds) {
        this.stallSource.set(id, { effect, x: tower.x + 0.5, y: tower.y + 0.5 });
        const s = this.enemySprites.get(id);
        if (!s) continue;
        this.shots.push({ kind: 'line', x1: from.x, y1: from.y, x2: s.pos.x, y2: s.pos.y, ttl: SHOT_TTL * 2, max: SHOT_TTL * 2, color: PALETTE.lure });
      }
      this.shots.push({ kind: 'ring', x: from.x, y: from.y, r: stats.range * TILE, ttl: RING_TTL, max: RING_TTL, color: PALETTE.lure });
    } else {
      if (effect === 'distract') {
        for (const id of ev.targetIds) this.stallSource.set(id, { effect, x: tower.x + 0.5, y: tower.y + 0.5 });
      }
      this.shots.push({ kind: 'line', x1: from.x, y1: from.y, x2: to.x, y2: to.y, ttl: SHOT_TTL, max: SHOT_TTL, color: PALETTE.shot });
      if (effect === 'splash') {
        const r = stats.effectStrength * TILE;
        this.shots.push({ kind: 'ring', x: to.x, y: to.y, r, ttl: RING_TTL, max: RING_TTL, color: PALETTE.splash });
      }
    }
    this.applyShotDamage(ev, effect, stats);

    // Squash: wider and flatter for 120 ms, anchored at the tower's foot.
    const s = this.towerSprites.get(tower.id);
    if (s && !s.punching) {
      s.punching = true;
      this.tweens.add({
        targets: s.container, scaleX: 1.12, scaleY: 0.86, duration: SQUASH_MS, yoyo: true,
        onComplete: () => { s.punching = false; s.container.setScale(1); },
      });
    }
    this.play('shot');
  }

  // HP bars during playback (events carry no damage). The engine's `hitIds` say who was hit
  // when present; otherwise the same rule as the engine: splash hits every guest within
  // effectStrength tiles of the target. The state is authoritative again once playback ends.
  applyShotDamage(ev, effect, stats) {
    if (!(stats.damage > 0)) return;
    let ids = Array.isArray(ev.hitIds) ? ev.hitIds : ev.targetIds;
    if (effect === 'splash' && !Array.isArray(ev.hitIds)) {
      ids = [];
      const path = this.level.path;
      for (const [id, s] of this.enemySprites) {
        const p = path[Math.min(s.index, path.length - 1)];
        if (Math.hypot(p.x + 0.5 - ev.x, p.y + 0.5 - ev.y) <= stats.effectStrength + 1e-9) ids.push(id);
      }
    }
    for (const id of ids) {
      const s = this.enemySprites.get(id);
      if (!s) continue;
      s.hp = Math.max(0, s.hp - stats.damage);
      this.drawHpBar(s, s.hp / s.maxHp);
    }
  }

  // The Nexios Victory Bell: everyone on the floor is walked out and pays up.
  renderBell(ev) {
    const cam = this.cameras.main;
    cam.shake(450, 0.012);
    cam.flash(500, ...rgb(PALETTE.gold));
    this.play('bell');
    this.kills += ev.count;
    this.view.corks += ev.reward;

    let i = 0;
    for (const [id, s] of [...this.enemySprites]) {
      const { x, y } = s.container;
      const delay = Math.min(i, 20) * 25;
      if (i < 12) {
        this.time.delayedCall(delay, () => {
          this.floatText(x, y - 24, `+${s.reward} 🧢`, PALETTE.capsText);
          this.flyCap(x, y);
        });
      }
      this.enemySprites.delete(id);
      this.stallSource.delete(id);
      this.tweens.killTweensOf(s.pos);
      this.tweens.add({
        targets: s.container, scale: 1.6, alpha: 0, angle: 25, delay, duration: 260,
        onComplete: () => s.container.destroy(),
      });
      i++;
    }

    const { boardX, boardY, boardWidth, boardHeight } = this.layout;
    const cx = boardX + boardWidth / 2;
    const cy = boardY + boardHeight / 2;
    this.shots.push({ kind: 'ring', x: cx, y: cy, r: Math.max(boardWidth, boardHeight), ttl: 0.6, max: 0.6, color: PALETTE.goldEdge, grow: true });
    const bell = this.add.text(cx, cy - 30, '🔔', { fontFamily: EMOJI_FONT, fontSize: '96px', padding: { x: 4, y: 12 } })
      .setOrigin(0.5, 0.2).setDepth(DEPTH.effects + 1).setScale(0.2);
    this.tweens.add({ targets: bell, scale: 1, duration: 250, ease: 'Back.easeOut' });
    this.tweens.add({ targets: bell, angle: { from: -22, to: 22 }, duration: 120, yoyo: true, repeat: 4 });
    this.tweens.add({ targets: bell, alpha: 0, delay: 1100, duration: 400, onComplete: () => bell.destroy() });

    const text = ev.count > 0 ? `DING DING! +${ev.reward} 🧢` : 'DING DING!';
    const t = this.add.text(cx, cy + 60, text, {
      fontFamily: `${FONT}, ${EMOJI_FONT}`, fontSize: '40px', fontStyle: 'bold',
      color: css(PALETTE.goldText), stroke: css(PALETTE.gold), strokeThickness: 8, padding: { x: 4, y: 8 },
    }).setOrigin(0.5).setDepth(DEPTH.effects + 1).setScale(0.3);
    this.tweens.add({ targets: t, scale: 1, duration: 320, ease: 'Back.easeOut' });
    this.tweens.add({ targets: t, alpha: 0, y: cy + 30, delay: 1300, duration: 500, onComplete: () => t.destroy() });
    if (ev.count > 0) {
      this.time.delayedCall(350, () => this.toast(`${ev.count} guest${ev.count === 1 ? '' : 's'} rung out of the office`, PALETTE.goldText));
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
      corks: s.corks, wave: s.waveIndex, totalWaves: s.totalWaves, kills: this.kills, turns: s.turn,
      reason: s.endReason,
    };
    recordBest(this.level.id, s.waveIndex, won);
    this.time.delayedCall(END_DELAY_MS, () => this.scene.launch('EndScene', result));
  }

  // --- static board ---

  // Baked images only: frame, one image per tile, raised furniture blocks with their emoji.
  drawBoard() {
    const { cols, rows } = this.level;
    const { boardX, boardY, boardWidth, boardHeight } = this.layout;
    addBoardBase(this, boardX, boardY, boardWidth, boardHeight, BOARD_PAD, BOARD_EDGE).setDepth(DEPTH.board - 1);
    const pathSet = new Set(this.level.path.map((p) => `${p.x},${p.y}`));
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const { x: px, y: py } = this.toPixels(x, y);
        this.add.image(px, py, pathSet.has(`${x},${y}`) ? TEX.path : TEX.floor).setOrigin(0).setDepth(DEPTH.board);
      }
    }
    for (const b of this.level.blocked || []) {
      const c = this.tileCentre(b.x, b.y);
      const depth = DEPTH.blocks + c.y / 100000;
      addPiece(this, 'block', c.x, c.y).setDepth(depth);
      this.emoji(c.x, c.y - PIECES.block.lift, BLOCKED_SPRITES[(b.x * 7 + b.y * 3) % BLOCKED_SPRITES.length], 28)
        .setDepth(depth);
    }
  }

  drawEndpoints() {
    const { start, end } = this.level;
    const s = this.tileCentre(start.x, start.y);
    addPiece(this, 'door', s.x, s.y).setDepth(DEPTH.table);
    this.emoji(s.x, s.y - PIECES.door.lift, '🚪', 28).setDepth(DEPTH.table);

    // The beer bar: a gold block with the level's bar sprite (image or emoji, 🍻 by default).
    const e = this.tileCentre(end.x, end.y);
    addPiece(this, 'bar', e.x, e.y).setDepth(DEPTH.table);
    barIcon(this, e.x, e.y - PIECES.bar.lift, this.level.barSprite, 32).setDepth(DEPTH.table);
  }

  // --- dynamic sprites ---

  syncTowers() {
    const alive = new Set();
    for (const t of this.state.towers) {
      alive.add(t.id);
      let s = this.towerSprites.get(t.id);
      if (!s) {
        // The container sits at the tower's foot so scaling (pop-in, squash) keeps it grounded.
        const c = this.tileCentre(t.x, t.y);
        const foot = PIECES.tower.h / 2;
        const base = addPiece(this, 'tower', 0, -foot);
        const faceY = -foot - PIECES.tower.lift;
        const weapon = this.weapons.get(t.weaponId);
        const ic = icon(this, 0, faceY - 3, weapon?.sprite, weapon?.fallbackSprite || '❔', 28);
        const container = this.add.container(c.x, c.y + foot, [base, ic])
          .setDepth(DEPTH.towers + c.y / 100000);
        container.setScale(0.3);
        s = { container, icon: ic, pips: [], faceY, tier: -1, punching: true };
        const sprite = s;
        this.tweens.add({
          targets: container, scale: 1, duration: 260, ease: 'Back.easeOut',
          onComplete: () => { sprite.punching = false; },
        });
        this.towerSprites.set(t.id, s);
      }
      if (s.tier !== t.tier) {
        // Green tier dots along the bottom of the face: one per tier above the first.
        s.tier = t.tier;
        for (const p of s.pips) p.destroy();
        s.pips = [];
        for (let i = 0; i < t.tier; i++) {
          const px = (i - (t.tier - 1) / 2) * 10;
          const pip = this.add.image(px, s.faceY + 18, TEX.pip);
          s.container.add(pip);
          s.pips.push(pip);
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

  // A guest piece with its icon, HP bar and status emoji (its "→n" preview is drawn per
  // tile by updateTileMarks, so guests sharing a tile show one pill). Its logical position `pos` (pixels, tweened tile to tile) is separate from the container,
  // which animateEnemies() places with the bob and the shared-tile offset.
  addEnemySprite(id, enemyId, index, popIn) {
    if (this.enemySprites.has(id)) return this.enemySprites.get(id);
    const def = this.enemyDefs.get(enemyId);
    const faceY = -PIECES.guest.lift;
    const base = addPiece(this, 'guest', 0, 0);
    const ic = icon(this, 0, faceY, def?.sprite, def?.fallbackSprite || '👤', 24);
    const hpY = faceY - PIECES.guest.h / 2 - 8;
    const hpBack = this.add.image(0, hpY, TEX.hpBack);
    const hpFill = this.add.image(-(HP_W + 2) / 2, hpY, TEX.hpHigh).setOrigin(0, 0.5);
    const status = this.emoji(17, faceY - 15, '', 16);
    const pos = this.pathCentre(index);
    const container = this.add.container(pos.x, pos.y, [base, ic, hpBack, hpFill, status]);
    const hp = def ? def.hp : 1;
    const s = {
      container, icon: ic, hpFill, hpTex: TEX.hpHigh, status, faceY, reward: def ? def.reward : 0,
      pos, index, ox: 0, oy: 0, hp, maxHp: hp, walking: false, stalled: false, slowed: false, preview: null,
      lastStatus: null, depth: null, phase: (id * 1.7) % (Math.PI * 2),
    };
    this.enemySprites.set(id, s);
    if (popIn) {
      container.setScale(0.3);
      this.tweens.add({ targets: container, scale: 1, duration: 160, ease: 'Back.easeOut' });
    }
    return s;
  }

  // After playback: sprites, HP, statuses and previews follow the state exactly.
  reconcileEnemies() {
    const alive = new Set();
    for (const e of this.state.enemies) {
      alive.add(e.id);
      const s = this.addEnemySprite(e.id, e.enemyId, e.pathIndex, false);
      this.tweens.killTweensOf(s.pos);
      const at = this.pathCentre(e.pathIndex);
      s.pos.x = at.x;
      s.pos.y = at.y;
      s.index = e.pathIndex;
      s.walking = false;
      s.hp = e.hp;
      s.maxHp = e.maxHp;
      this.drawHpBar(s, e.hp / e.maxHp);
      s.stalled = e.stalledTurns > 0;
      s.slowed = e.slowTurns > 0 && e.slowFactor < 1;
      if (!s.stalled) this.stallSource.delete(e.id);
      s.preview = this.state.over ? null : this.state.previewSteps(e);
    }
    for (const id of [...this.enemySprites.keys()]) {
      if (!alive.has(id)) this.removeEnemySprite(id, false);
    }
  }

  // Per frame: place each guest (tile position + shared-tile offset + bob while stepping),
  // depth by screen y, and the stalled wobble / pizza lean / slow snail.
  animateEnemies() {
    if (this.enemySprites.size === 0) {
      if (this.tileMarks.size > 0) this.updateTileMarks(new Map());
      return;
    }
    const now = this.time.now / 1000;
    const path = this.level.path;
    // Guests on the same tile, in spawn (id) order.
    const groups = new Map();
    for (const [id, s] of this.enemySprites) {
      const p = path[Math.min(s.index, path.length - 1)];
      const k = `${p.x},${p.y}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(id);
    }
    const slot = new Map();
    for (const ids of groups.values()) {
      ids.sort((a, b) => a - b);
      ids.forEach((id, i) => slot.set(id, ids.length > 1 && i < SHARE_OFFSETS.length ? SHARE_OFFSETS[i] : [0, 0]));
    }
    this.updateTileMarks(groups);
    for (const [id, s] of this.enemySprites) {
      const [tx, ty] = slot.get(id);
      s.ox += (tx - s.ox) * 0.3;
      s.oy += (ty - s.oy) * 0.3;
      // A little hop while stepping; still otherwise.
      const bob = s.walking ? -Math.abs(Math.sin(now * 26 + s.phase)) * 4 : 0;
      const px = s.pos.x + s.ox;
      const py = s.pos.y + s.oy;
      s.container.setPosition(px, py + bob);
      // Lower on screen draws in front; only touch depth when it changes.
      const depth = DEPTH.enemies + Math.round(py) / 10000;
      if (s.depth !== depth) {
        s.depth = depth;
        s.container.setDepth(depth);
      }

      const source = s.stalled ? this.stallSource.get(id) : null;
      let status = '';
      let rotation = 0;
      let ox = 0;
      let oy = 0;
      if (source && source.effect === 'lure') {
        // Leaning hungrily toward the pizza, without leaving the tile.
        const p = path[Math.min(s.index, path.length - 1)];
        const angle = Math.atan2(source.y - (p.y + 0.5), source.x - (p.x + 0.5));
        ox = Math.cos(angle) * 6;
        oy = Math.sin(angle) * 4;
        rotation = Math.cos(angle) * 0.35 + Math.sin(now * 14) * 0.05;
        status = '🍕';
      } else if (s.stalled) {
        rotation = Math.sin(now * 9 + id) * 0.2; // happy wobble at the Café
        status = CAFE_STATUS;
      } else if (s.slowed) {
        status = '🐌';
      }
      s.icon.setRotation(rotation).setPosition(ox, s.faceY + oy);
      if (s.lastStatus !== status) {
        s.lastStatus = status;
        s.status.setText(status);
      }
    }
  }

  // Per tile with guests: a "→n" pill (bottom right; "→1–3" when the guests there differ)
  // in the player's turn, and a "×N" count pill (bottom left) when CROWD or more share it.
  // Rebuilt only when a tile's text changes.
  updateTileMarks(groups) {
    const wanted = new Map();
    for (const [k, ids] of groups) {
      const previews = ids.map((id) => this.enemySprites.get(id).preview).filter((n) => n !== null);
      let step = '';
      if (previews.length > 0) {
        const lo = Math.min(...previews);
        const hi = Math.max(...previews);
        step = lo === hi ? `→${lo}` : `→${lo}–${hi}`;
      }
      const count = ids.length >= CROWD ? `×${ids.length}` : '';
      if (step || count) wanted.set(k, { step, count });
    }
    for (const [k, m] of this.tileMarks) {
      const w = wanted.get(k);
      if (!w || `${w.step}|${w.count}` !== m.sig) {
        m.container.destroy();
        this.tileMarks.delete(k);
      }
    }
    for (const [k, w] of wanted) {
      if (this.tileMarks.has(k)) continue;
      const [x, y] = k.split(',').map(Number);
      const c = this.tileCentre(x, y);
      const parts = [];
      const pill = (text, px, color) => {
        const t = label(this, 0, 0, text, { size: 13, bold: true, color }).setOrigin(0.5);
        const pw = snap(Math.max(30, t.width + 12));
        const bg = addCard(this, 0, 0, pw, 20, 'card');
        // Keep the pill inside the tile: anchor its outer edge.
        const cx = px > 0 ? TILE / 2 - 2 - pw / 2 : -TILE / 2 + 2 + pw / 2;
        bg.setPosition(cx, 20);
        t.setPosition(cx, 20);
        parts.push(bg, t);
      };
      if (w.step) pill(w.step, 1, PALETTE.text);
      if (w.count) pill(w.count, -1, PALETTE.danger);
      const container = this.add.container(c.x, c.y, parts).setDepth(DEPTH.enemies + 0.95);
      this.tileMarks.set(k, { container, sig: `${w.step}|${w.count}`, ...w });
    }
  }

  // Slim bar: scale the fill and swap its colour texture only when the band changes.
  drawHpBar(s, ratio) {
    const r = Math.max(0, Math.min(1, ratio));
    const tex = r > 0.6 ? TEX.hpHigh : r > 0.3 ? TEX.hpMid : TEX.hpLow;
    if (s.hpTex !== tex) {
      s.hpTex = tex;
      s.hpFill.setTexture(tex);
    }
    s.hpFill.setScale(r, 1);
  }

  // --- quote bubbles ---

  // A white rounded bubble with a tail above the guest. One per guest (a new line replaces
  // the old), at most MAX_BUBBLES on screen (extra quotes are skipped), BUBBLE_MS each.
  showQuote(ev) {
    if (!ev.text || !this.enemySprites.has(ev.id)) return;
    const existing = this.bubbles.get(ev.id);
    if (existing) {
      this.tweens.killTweensOf(existing.container);
      existing.container.destroy();
      this.bubbles.delete(ev.id);
    } else if (this.bubbles.size >= MAX_BUBBLES) {
      return;
    }
    const text = label(this, 0, 0, ev.text, {
      size: 13, wordWrap: { width: 170, useAdvancedWrap: true }, align: 'center',
    }).setOrigin(0.5);
    const w = snap(text.width + 20);
    const h = snap(text.height + 6, 4);
    const bg = addCard(this, 0, -h / 2, w, h, 'bubble');
    text.setY(-h / 2);
    const container = this.add.container(0, 0, [bg, text]).setDepth(DEPTH.bubbles).setAlpha(0);
    this.tweens.add({ targets: container, alpha: 1, duration: 150 });
    this.bubbles.set(ev.id, { container, width: w, height: h, until: this.time.now + BUBBLE_MS });
    this.updateBubbles();
  }

  updateBubbles() {
    if (this.bubbles.size === 0) return;
    const now = this.time.now;
    const { boardX, boardWidth } = this.layout;
    for (const [id, b] of this.bubbles) {
      const s = this.enemySprites.get(id);
      if (!s || now >= b.until) {
        this.tweens.killTweensOf(b.container);
        b.container.destroy();
        this.bubbles.delete(id);
        continue;
      }
      // Tail tip just above the HP bar; keep the bubble over the board horizontally and below
      // the HUD vertically (the container's y is the bubble's bottom edge).
      const half = b.width / 2;
      const x = Math.min(Math.max(s.container.x, boardX + half - 6), boardX + boardWidth - half + 6);
      const y = Math.max(s.container.y + s.faceY - PIECES.guest.h / 2 - 22, HUD_HEIGHT + 4 + b.height);
      b.container.setPosition(x, y);
    }
  }

  removeEnemySprite(id, pop) {
    this.stallSource.delete(id);
    const s = this.enemySprites.get(id);
    if (!s) return;
    this.enemySprites.delete(id);
    this.tweens.killTweensOf(s.pos);
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
      g.fillStyle(ok ? PALETTE.buildableHover : PALETTE.invalidHover, 1);
      g.fillRoundedRect(p.x + 2, p.y + 2, TILE - 4, TILE - 4, 7);
      g.lineStyle(2, ok ? PALETTE.good : PALETTE.invalidRange, 1);
      g.strokeRoundedRect(p.x + 3, p.y + 3, TILE - 6, TILE - 6, 6);
      this.drawRange(g, x, y, weaponStats(this.weapons.get(this.selectedWeaponId), 0).range, ok);
      return;
    }
    const tower = this.state.towers.find((t) => t.id === this.selectedTowerId)
      || (this.hoverTile && this.state.towers.find((t) => t.x === this.hoverTile.x && t.y === this.hoverTile.y));
    if (tower) {
      this.drawRange(g, tower.x, tower.y, weaponStats(this.weapons.get(tower.weaponId), tower.tier).range, true);
    }
  }

  // Pastel green range circle (red-ish when the tile can't take a tower).
  drawRange(g, x, y, rangeTiles, ok) {
    const c = this.tileCentre(x, y);
    const color = ok ? PALETTE.range : PALETTE.invalidRange;
    g.fillStyle(color, ok ? 0.12 : 0.08);
    g.fillCircle(c.x, c.y, rangeTiles * TILE);
    g.lineStyle(2, color, 0.6);
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

  floatText(x, y, text, color = PALETTE.capsText, depth = DEPTH.effects) {
    const t = this.add.text(x, y, text, {
      fontFamily: `${FONT}, ${EMOJI_FONT}`, fontSize: '18px', fontStyle: 'bold',
      color: css(color), stroke: css(PALETTE.white), strokeThickness: 4,
      padding: { x: 2, y: 4 },
    }).setOrigin(0.5).setDepth(depth);
    this.tweens.add({
      targets: t, y: y - 36, alpha: 0, duration: 900, ease: 'Cubic.easeOut',
      onComplete: () => t.destroy(),
    });
  }

  // A bottle cap flies from (x, y) to the HUD caps counter (at most MAX_FLYING_CAPS at once).
  flyCap(x, y) {
    if (this.flyingCaps >= MAX_FLYING_CAPS || !this.hud) return;
    this.flyingCaps += 1;
    const target = this.hud.capsTarget();
    const cap = this.emoji(x, y, '🧢', 20).setDepth(DEPTH.hud + 2);
    this.tweens.add({
      targets: cap, x: target.x, y: target.y, scale: 0.8, duration: 600, ease: 'Cubic.easeIn',
      onComplete: () => {
        cap.destroy();
        this.flyingCaps -= 1;
        if (this.hud) this.hud.bumpCaps();
      },
    });
  }

  emoji(x, y, char, size) {
    return this.add.text(x, y, char, {
      fontFamily: EMOJI_FONT, fontSize: `${size}px`, padding: { x: 2, y: 6 },
    }).setOrigin(0.5);
  }
}
