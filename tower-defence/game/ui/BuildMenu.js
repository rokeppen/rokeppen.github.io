// Side panel, top part: one white card per weapon in the level with its cost in caps.
// Unaffordable weapons are faded (all of them while no action is left or the guests are
// moving); the selected one gets a green outline.
// Keys: 1-9 pick a weapon, Esc cancels.
// The menu never takes the space the tower panel needs (TOWER_PANEL_HEIGHT): with many
// weapons the cards switch to 2-4 compact columns (icon + cost; hover shows the details).
import { PALETTE, HUD_HEIGHT, SIDE_WIDTH, css } from '../theme.js';
import { label, icon, isRightButton } from './widgets.js';
import { addCard, CARD_PAD } from './textures.js';
import { TOWER_PANEL_HEIGHT } from './TowerPanel.js';

const KEYS = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE'];
const DEPTH = 10;
const HEADER = 40;
const GAP = 8;
const MAX_CARD_H = 56;
const MIN_CARD_H = [44, 40, 40, 36]; // per column count 1..4

const EFFECT_WORD = { slow: 'slows', distract: 'distracts', lure: 'lures', splash: 'splash' };

// Pick the fewest columns whose cards stay tall enough within maxH.
export function cardGrid(count, maxH, width) {
  let best = null;
  for (let cols = 1; cols <= 4; cols++) {
    const rows = Math.max(1, Math.ceil(count / cols));
    const h = Math.min(MAX_CARD_H, Math.floor((maxH + GAP) / rows) - GAP);
    best = { cols, rows, h: Math.max(h, 20), w: Math.floor((width - (cols - 1) * GAP) / cols) };
    if (h >= MIN_CARD_H[cols - 1]) break;
  }
  return best;
}

export class BuildMenu {
  constructor(scene) {
    this.scene = scene;
    const { sideX: x0, height } = scene.layout;
    const panelH = height - HUD_HEIGHT;
    label(scene, x0 + 14, HUD_HEIGHT + 12, 'BUILD', { size: 12, bold: true, color: PALETTE.muted })
      .setDepth(DEPTH);
    label(scene, x0 + SIDE_WIDTH - 14, HUD_HEIGHT + 12, 'cost in caps 🧢', { size: 12, color: PALETTE.muted })
      .setOrigin(1, 0).setDepth(DEPTH);

    const weapons = scene.level.weaponIds.map((id) => scene.weapons.get(id)).filter(Boolean);
    const top = HUD_HEIGHT + HEADER;
    const maxH = panelH - HEADER - TOWER_PANEL_HEIGHT;
    const grid = cardGrid(weapons.length, maxH, SIDE_WIDTH - 28);
    this.grid = grid;
    this.cards = weapons.map((w, i) => {
      const col = i % grid.cols;
      const row = Math.floor(i / grid.cols);
      return this.makeCard(w, i, x0 + 14 + col * (grid.w + GAP), top + row * (grid.h + GAP), grid.w, grid.h);
    });
    this.bottom = top + grid.rows * (grid.h + GAP);

    const kb = scene.input.keyboard;
    if (kb) {
      weapons.forEach((w, i) => {
        if (i < KEYS.length) kb.on(`keydown-${KEYS[i]}`, () => this.pick(w.id));
      });
      kb.on('keydown-ESC', () => { scene.selectWeapon(null); scene.selectTower(null); });
    }
    this.update();
  }

  makeCard(weapon, index, x, y, w, h) {
    const { scene } = this;
    const compact = this.grid.cols > 1;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const bg = addCard(scene, cx, cy, w, h, 'card')
      .setInteractive({
        hitArea: new Phaser.Geom.Rectangle(CARD_PAD, CARD_PAD, w, h),
        hitAreaCallback: Phaser.Geom.Rectangle.Contains,
        useHandCursor: true,
      });
    const outline = addCard(scene, cx, cy, w, h, 'select').setVisible(false);
    const tileSize = Math.max(22, Math.min(36, h - 14));
    let tile;
    let ic;
    let name = null;
    let cost;
    const hotkey = index < 9 ? `${index + 1}` : '';
    const sub = `🧢 ${weapon.cost}${EFFECT_WORD[weapon.effect] ? ` · ${EFFECT_WORD[weapon.effect]}` : ''}`;
    if (!compact) {
      const tx = x + 10 + tileSize / 2;
      tile = addCard(scene, tx, cy - 1, tileSize, tileSize, 'icon');
      ic = icon(scene, tx, cy - 1, weapon.sprite, weapon.fallbackSprite, Math.round(tileSize * 0.58));
      name = label(scene, x + tileSize + 20, cy - 9, weapon.name, { size: 14, bold: true }).setOrigin(0, 0.5);
      if (name.width > w - tileSize - 34) name.setScale((w - tileSize - 34) / name.width);
      cost = label(scene, x + tileSize + 20, cy + 10, sub, { size: 12, color: PALETTE.muted }).setOrigin(0, 0.5);
      if (cost.width > w - tileSize - 26) cost.setScale((w - tileSize - 26) / cost.width);
    } else if (this.grid.cols === 2) {
      const ts = Math.min(tileSize, 30);
      const tx = x + 8 + ts / 2;
      tile = addCard(scene, tx, cy - 1, ts, ts, 'icon');
      ic = icon(scene, tx, cy - 1, weapon.sprite, weapon.fallbackSprite, Math.round(ts * 0.6));
      cost = label(scene, x + ts + 14, cy, `🧢 ${weapon.cost}`, { size: 13, bold: true }).setOrigin(0, 0.5);
    } else {
      const ts = Math.max(16, Math.min(24, h - 20));
      tile = null;
      ic = icon(scene, cx, y + 4 + ts / 2, weapon.sprite, weapon.fallbackSprite, ts);
      cost = label(scene, cx, y + h - 8, `${weapon.cost}`, { size: 11, bold: true, color: PALETTE.muted })
        .setOrigin(0.5);
    }
    if (compact && cost.width > w - (cost.originX === 0 ? cost.x - x : 0) - 6) {
      cost.setScale(Math.max(0.5, (w - (cost.originX === 0 ? cost.x - x : 0) - 6) / cost.width));
    }
    const key = label(scene, x + w - 6, y + 2, hotkey, { size: 10, color: PALETTE.muted }).setOrigin(1, 0);
    const objects = [bg, outline, tile, ic, name, cost, key].filter(Boolean);
    for (const o of objects) {
      o.setDepth(DEPTH);
      o.baseY = o.y;
    }
    outline.setDepth(DEPTH + 0.5);

    const costColor = compact && this.grid.cols === 2 ? PALETTE.text : PALETTE.muted;
    const card = { weapon, bg, outline, objects, cost, costColor, hover: false, shown: null };
    bg.on('pointerover', () => { card.hover = true; scene.hoverWeaponId = weapon.id; });
    bg.on('pointerout', () => {
      card.hover = false;
      if (scene.hoverWeaponId === weapon.id) scene.hoverWeaponId = null;
    });
    bg.on('pointerup', (pointer) => {
      if (!isRightButton(pointer)) this.pick(weapon.id);
    });
    return card;
  }

  pick(weaponId) {
    const { scene } = this;
    if (scene.selectedWeaponId === weaponId) {
      scene.selectWeapon(null);
      return;
    }
    if (scene.refuseAction()) return;
    const weapon = scene.weapons.get(weaponId);
    if (scene.state.actionsLeft <= 0) {
      scene.toastReason('no-actions');
      return;
    }
    if (scene.state.corks < weapon.cost) {
      scene.toastReason('no-corks');
      return;
    }
    scene.selectWeapon(weaponId);
  }

  update() {
    const { state, selectedWeaponId, busy } = this.scene;
    const canAct = !busy && !state.over && state.actionsLeft > 0;
    for (const c of this.cards) {
      const affordable = state.corks >= c.weapon.cost;
      const selected = selectedWeaponId === c.weapon.id;
      const sig = `${affordable}|${selected}|${c.hover}|${canAct}`;
      if (c.shown === sig) continue;
      c.shown = sig;
      c.outline.setVisible(selected);
      const lift = (c.hover && affordable && canAct) || selected ? -2 : 0;
      for (const o of c.objects) {
        o.y = o.baseY + lift;
        o.setAlpha((affordable && canAct) || selected ? 1 : 0.45);
      }
      c.cost.setColor(css(affordable ? c.costColor : PALETTE.danger));
    }
  }
}
