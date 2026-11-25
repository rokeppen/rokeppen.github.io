// Side panel, top part: one card per weapon in the level with its cost.
// Unaffordable weapons are greyed out. Keys: 1-9 pick a weapon, Esc cancels.
// The menu never takes the space the tower panel needs (TOWER_PANEL_HEIGHT): with many
// weapons the cards switch to 2-4 compact columns (icon + cost; hover shows the details).
import { PALETTE, HUD_HEIGHT, SIDE_WIDTH, css } from '../theme.js';
import { label, isRightButton } from './widgets.js';
import { TOWER_PANEL_HEIGHT } from './TowerPanel.js';

const KEYS = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE'];
const DEPTH = 10;
const HEADER = 44;
const GAP = 6;
const MAX_CARD_H = 60;
const MIN_CARD_H = [44, 40, 40, 36]; // per column count 1..4

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
    scene.add.rectangle(x0, HUD_HEIGHT, SIDE_WIDTH, panelH, PALETTE.panel).setOrigin(0).setDepth(DEPTH - 1);
    scene.add.rectangle(x0, HUD_HEIGHT, 2, panelH, PALETTE.panelEdge).setOrigin(0).setDepth(DEPTH - 1);
    label(scene, x0 + 16, HUD_HEIGHT + 10, 'Build', { size: 18, bold: true, color: PALETTE.accent })
      .setDepth(DEPTH);
    label(scene, x0 + SIDE_WIDTH - 14, HUD_HEIGHT + 13, 'cost in corks', { size: 13, color: PALETTE.hudMuted })
      .setOrigin(1, 0).setDepth(DEPTH);

    const weapons = scene.level.weaponIds.map((id) => scene.weapons.get(id)).filter(Boolean);
    const top = HUD_HEIGHT + HEADER;
    const maxH = panelH - HEADER - TOWER_PANEL_HEIGHT;
    const grid = cardGrid(weapons.length, maxH, SIDE_WIDTH - 24);
    this.grid = grid;
    this.cards = weapons.map((w, i) => {
      const col = i % grid.cols;
      const row = Math.floor(i / grid.cols);
      return this.makeCard(w, i, x0 + 12 + col * (grid.w + GAP), top + row * (grid.h + GAP), grid.w, grid.h);
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
    const bg = scene.add.rectangle(x, y, w, h, PALETTE.button).setOrigin(0)
      .setStrokeStyle(2, PALETTE.panelEdge).setDepth(DEPTH)
      .setInteractive({ useHandCursor: true });
    let icon;
    let name = null;
    let cost;
    const hotkey = index < 9 ? `${index + 1}` : '';
    if (!compact) {
      icon = label(scene, x + 28, y + h / 2, weapon.sprite, { size: Math.min(30, h - 18) }).setOrigin(0.5);
      name = label(scene, x + 54, y + h / 2 - 9, weapon.name, { size: 15, bold: true }).setOrigin(0, 0.5);
      if (name.width > w - 64) name.setScale((w - 64) / name.width);
      cost = label(scene, x + 54, y + h / 2 + 11, `🍾 ${weapon.cost}`, { size: 14, color: PALETTE.accent })
        .setOrigin(0, 0.5);
    } else if (this.grid.cols === 2) {
      icon = label(scene, x + 22, y + h / 2, weapon.sprite, { size: Math.min(26, h - 16) }).setOrigin(0.5);
      cost = label(scene, x + 42, y + h / 2, `🍾 ${weapon.cost}`, { size: 14, color: PALETTE.accent })
        .setOrigin(0, 0.5);
    } else {
      icon = label(scene, x + w / 2, y + h * 0.38, weapon.sprite, { size: Math.max(14, Math.min(24, h - 22)) })
        .setOrigin(0.5);
      cost = label(scene, x + w / 2, y + h - 9, `${weapon.cost}`, { size: 12, color: PALETTE.accent })
        .setOrigin(0.5);
    }
    const key = label(scene, x + w - 5, y + 3, hotkey, { size: 11, color: PALETTE.hudMuted }).setOrigin(1, 0);
    for (const o of [icon, name, cost, key]) if (o) o.setDepth(DEPTH);
    if (cost.width > w - 8) cost.setScale((w - 8) / cost.width);

    const card = { weapon, bg, icon, name, cost, key, hover: false, shown: null };
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
    if (scene.state.over) return;
    if (scene.selectedWeaponId === weaponId) {
      scene.selectWeapon(null);
      return;
    }
    const weapon = scene.weapons.get(weaponId);
    if (scene.state.corks < weapon.cost) {
      scene.toastReason('no-corks');
      return;
    }
    scene.selectWeapon(weaponId);
  }

  update() {
    const { state, selectedWeaponId } = this.scene;
    for (const c of this.cards) {
      const affordable = state.corks >= c.weapon.cost;
      const selected = selectedWeaponId === c.weapon.id;
      const sig = `${affordable}|${selected}|${c.hover}`;
      if (c.shown === sig) continue;
      c.shown = sig;
      c.bg.setFillStyle(selected ? PALETTE.buttonHover : c.hover && affordable ? PALETTE.panelEdge : PALETTE.button);
      c.bg.setStrokeStyle(2, selected ? PALETTE.accent : PALETTE.panelEdge);
      const alpha = affordable || selected ? 1 : 0.4;
      for (const o of [c.icon, c.name, c.key]) if (o) o.setAlpha(alpha);
      c.cost.setAlpha(affordable ? 1 : 0.8).setColor(css(affordable ? PALETTE.accent : PALETTE.danger));
    }
  }
}
