// Side panel, top half: one card per weapon in the level with its cost.
// Unaffordable weapons are greyed out. Keys: 1-9 pick a weapon, Esc cancels.
import { PALETTE, HUD_HEIGHT, SIDE_WIDTH, TILE, css } from '../theme.js';
import { label } from './widgets.js';

const KEYS = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE'];
const DEPTH = 10;

export class BuildMenu {
  constructor(scene) {
    this.scene = scene;
    const x0 = scene.level.cols * TILE;
    const panelH = scene.level.rows * TILE;
    scene.add.rectangle(x0, HUD_HEIGHT, SIDE_WIDTH, panelH, PALETTE.panel).setOrigin(0).setDepth(DEPTH - 1);
    scene.add.rectangle(x0, HUD_HEIGHT, 2, panelH, PALETTE.panelEdge).setOrigin(0).setDepth(DEPTH - 1);
    label(scene, x0 + 16, HUD_HEIGHT + 10, 'Build', { size: 18, bold: true, color: PALETTE.accent })
      .setDepth(DEPTH);
    label(scene, x0 + SIDE_WIDTH - 14, HUD_HEIGHT + 13, 'cost in corks', { size: 13, color: PALETTE.hudMuted })
      .setOrigin(1, 0).setDepth(DEPTH);

    const weapons = scene.level.weaponIds.map((id) => scene.weapons.get(id)).filter(Boolean);
    const top = HUD_HEIGHT + 44;
    const maxH = panelH * 0.58 - 44; // the rest belongs to the tower panel
    const gap = 8;
    const cardH = Math.max(40, Math.min(60, Math.floor(maxH / Math.max(weapons.length, 1)) - gap));
    const cardW = SIDE_WIDTH - 24;
    this.cards = weapons.map((w, i) => this.makeCard(w, i, x0 + 12, top + i * (cardH + gap), cardW, cardH));
    this.bottom = top + weapons.length * (cardH + gap);

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
    const bg = scene.add.rectangle(x, y, w, h, PALETTE.button).setOrigin(0)
      .setStrokeStyle(2, PALETTE.panelEdge).setDepth(DEPTH)
      .setInteractive({ useHandCursor: true });
    const icon = label(scene, x + 28, y + h / 2, weapon.sprite, { size: Math.min(30, h - 18) })
      .setOrigin(0.5).setDepth(DEPTH);
    const name = label(scene, x + 54, y + h / 2 - 9, weapon.name, { size: 15, bold: true })
      .setOrigin(0, 0.5).setDepth(DEPTH);
    if (name.width > w - 64) name.setScale((w - 64) / name.width);
    const cost = label(scene, x + 54, y + h / 2 + 11, `🍾 ${weapon.cost}`, { size: 14, color: PALETTE.accent })
      .setOrigin(0, 0.5).setDepth(DEPTH);
    const key = label(scene, x + w - 8, y + h / 2 + 11, index < 9 ? `[${index + 1}]` : '', { size: 12, color: PALETTE.hudMuted })
      .setOrigin(1, 0.5).setDepth(DEPTH);
    const card = { weapon, bg, icon, name, cost, key, hover: false, shown: null };
    bg.on('pointerover', () => { card.hover = true; scene.hoverWeaponId = weapon.id; });
    bg.on('pointerout', () => {
      card.hover = false;
      if (scene.hoverWeaponId === weapon.id) scene.hoverWeaponId = null;
    });
    bg.on('pointerup', () => this.pick(weapon.id));
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
      for (const o of [c.icon, c.name, c.key]) o.setAlpha(alpha);
      c.cost.setAlpha(affordable ? 1 : 0.8).setColor(css(affordable ? PALETTE.accent : PALETTE.danger));
    }
  }
}
