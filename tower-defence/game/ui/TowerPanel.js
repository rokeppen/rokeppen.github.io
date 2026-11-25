// Side panel, bottom half: a white card showing the selected tower (stats, Upgrade, Sell),
// otherwise the weapon being placed or hovered, otherwise a short how-to-play.
// Keys: U upgrade, S sell. Upgrade/Sell are anchored to the bottom of the card, so they
// always stay on canvas.
import { PALETTE, SIDE_WIDTH } from '../theme.js';
import { weaponStats, upgradeCost } from '../logic/stats.js';
import { sellRefund } from '../logic/state.js';
import { Button, label, icon } from './widgets.js';
import { addCard } from './textures.js';

const DEPTH = 10;
// Vertical space the panel needs below the build menu: header, card with stats, effect line
// and the bottom-anchored buttons. BuildMenu never grows into it.
export const TOWER_PANEL_HEIGHT = 350;
const BUTTONS_HEIGHT = 70; // Upgrade + Sell row + key hint, measured up from `bottom`
const HELP = [
  'Guests crashed the drinks and',
  'are heading for the beer bar 🍻.',
  '',
  'Each turn: 3 actions (build,',
  'upgrade, sell), then End turn ▶.',
  'Unused actions pay 10 🧢 each.',
  'Guests walk tile by tile; your',
  'weapons fire as they pass.',
  '🔔 Bell: free, once per level.',
  '',
  'Keys: 1-9 build · Esc cancel',
  'Space end turn · Enter skip turn',
  'B bell · F ⏩ · M mute',
  'U upgrade · S sell',
].join('\n');

// Durations are whole guests' turns (the engine rounds data seconds up).
export function turnsText(duration) {
  const n = Math.ceil(duration || 0);
  return `${n} turn${n === 1 ? '' : 's'}`;
}

export function effectText(weapon, stats) {
  const dur = turnsText(weapon.effectDuration);
  switch (weapon.effect) {
    case 'slow': return `Slows guests ${Math.round(stats.effectStrength * 100)}% for ${dur}`;
    case 'distract': return `Distracts one guest for ${dur}`;
    case 'lure': return `Lures everyone in range for ${dur}`;
    case 'splash': return `Hits everyone within ${stats.effectStrength} tiles`;
    default: return 'Single target';
  }
}

export class TowerPanel {
  constructor(scene, top) {
    this.scene = scene;
    const cardX = scene.layout.sideX + 14;
    const cardW = SIDE_WIDTH - 28;
    const cardTop = top + 24;
    const cardBottom = scene.layout.height - 18;
    this.heading = label(scene, cardX, top + 2, '', { size: 12, bold: true, color: PALETTE.muted }).setDepth(DEPTH);
    addCard(scene, cardX + cardW / 2, (cardTop + cardBottom) / 2, cardW, cardBottom - cardTop, 'card')
      .setDepth(DEPTH - 0.5);
    this.x = cardX + 12;
    this.top = cardTop + 12;
    this.width = cardW - 24;
    this.bottom = cardBottom - 10;
    this.objects = [];
    this.buttons = [];
    this.shown = null;

    const kb = scene.input.keyboard;
    if (kb) {
      kb.on('keydown-U', () => this.upgrade());
      kb.on('keydown-S', () => this.sell());
    }
    this.update();
  }

  selectedTower() {
    const { state, selectedTowerId } = this.scene;
    return selectedTowerId === null ? null : state.towers.find((t) => t.id === selectedTowerId) ?? null;
  }

  upgrade() {
    const tower = this.selectedTower();
    if (!tower) return;
    const { scene } = this;
    if (scene.refuseAction()) return;
    const result = scene.state.upgradeTower(tower.id);
    if (!result.ok) scene.toastReason(result.reason);
    else scene.onTowerUpgraded(tower);
  }

  sell() {
    const tower = this.selectedTower();
    if (!tower) return;
    const { scene } = this;
    if (scene.refuseAction()) return;
    const result = scene.state.sellTower(tower.id);
    if (!result.ok) scene.toastReason(result.reason);
    else scene.onTowerSold(tower, result.refund);
  }

  update() {
    const { scene } = this;
    const tower = this.selectedTower();
    const weaponId = scene.selectedWeaponId ?? scene.hoverWeaponId ?? null;
    const corks = scene.state.corks;
    const sig = tower
      ? `t|${tower.id}|${tower.tier}|${corks >= (upgradeCost(scene.weapons.get(tower.weaponId), tower.tier) ?? Infinity)}|${this.canAct()}`
      : weaponId ? `w|${weaponId}|${scene.selectedWeaponId === weaponId}` : 'help';
    if (sig === this.shown) return;
    this.shown = sig;
    this.clear();
    if (tower) {
      this.heading.setText('SELECTED');
      this.showTower(tower);
    } else if (weaponId) {
      this.heading.setText(scene.selectedWeaponId === weaponId ? 'PLACING' : 'WEAPON');
      this.showWeapon(scene.weapons.get(weaponId), scene.selectedWeaponId === weaponId);
    } else {
      this.heading.setText('HOW TO PLAY');
      this.add(label(scene, this.x, this.top - 2, HELP, { size: 13, color: PALETTE.muted, lineSpacing: 2 }));
    }
  }

  // An action could be taken now (the buttons look pressable).
  canAct() {
    const { state, busy, ended } = this.scene;
    return !busy && !ended && !state.over && state.actionsLeft > 0;
  }

  clear() {
    for (const o of this.objects) o.destroy();
    for (const b of this.buttons) b.destroy();
    this.objects = [];
    this.buttons = [];
  }

  add(obj) {
    obj.setDepth(DEPTH);
    this.objects.push(obj);
    return obj;
  }

  header(weapon, subtitle, subColor = PALETTE.muted) {
    const { scene, x, top } = this;
    this.add(addCard(scene, x + 20, top + 20, 40, 40, 'icon'));
    this.add(icon(scene, x + 20, top + 20, weapon.sprite, weapon.fallbackSprite, 24));
    const name = this.add(label(scene, x + 52, top + 2, weapon.name, { size: 15, bold: true }));
    if (name.width > this.width - 52) name.setScale((this.width - 52) / name.width);
    this.add(label(scene, x + 52, top + 22, subtitle, { size: 13, bold: true, color: subColor }));
    return top + 54;
  }

  rows(y, rows) {
    // Two columns: name left (muted), value right (bold), like the mockup's stat rows.
    const { scene, x } = this;
    for (const [name, value] of rows) {
      this.add(label(scene, x, y, name, { size: 13, color: PALETTE.muted }));
      const v = this.add(label(scene, x + this.width, y, value, { size: 13, bold: true }).setOrigin(1, 0));
      if (v.width > this.width - 70) v.setScale((this.width - 70) / v.width);
      y += 21;
    }
    return y;
  }

  showWeapon(weapon, placing) {
    const { scene, x } = this;
    const stats = weaponStats(weapon, 0);
    let y = this.header(weapon, `🧢 ${weapon.cost}`, PALETTE.capsText);
    const desc = this.add(label(scene, x, y, weapon.description, {
      size: 12, color: PALETTE.muted, wordWrap: { width: this.width }, fontStyle: 'italic',
    }));
    y += desc.height + 6;
    y = this.rows(y, [
      ['Damage', `${stats.damage}`],
      ['Range', `${stats.range} tiles`],
      ['Rate', `${stats.fireRate}/turn`],
    ]);
    this.add(label(scene, x, y + 2, effectText(weapon, stats), { size: 13, wordWrap: { width: this.width } }));
    if (placing) {
      this.add(label(scene, x, this.bottom - 36, 'Click a free floor tile to build.\nRight-click or Esc to cancel.', {
        size: 12, color: PALETTE.goodText,
      }));
    }
  }

  showTower(tower) {
    const { scene, x } = this;
    const weapon = scene.weapons.get(tower.weaponId);
    const maxTier = (weapon.upgrades || []).length;
    const stats = weaponStats(weapon, tower.tier);
    const cost = upgradeCost(weapon, tower.tier);
    const next = cost === null ? null : weaponStats(weapon, tower.tier + 1);
    const pips = '●'.repeat(tower.tier + 1) + '○'.repeat(Math.max(maxTier - tower.tier, 0));
    let y = this.header(weapon, `Tier ${tower.tier + 1}/${maxTier + 1}  ${pips}`, PALETTE.goodText);

    const row = (name, now, then, unit = '') => {
      const changed = then !== undefined && then !== now;
      return [name, `${now}${unit}${changed ? ` → ${then}${unit}` : ''}`];
    };
    const lines = [
      row('Damage', stats.damage, next?.damage),
      row('Range', stats.range, next?.range),
      row('Rate', stats.fireRate, next?.fireRate, '/turn'),
    ];
    if (weapon.effect === 'slow') {
      const pct = (s) => Math.round(s.effectStrength * 100);
      lines.push(row('Slow', pct(stats), next ? pct(next) : undefined, '%'));
    } else if (weapon.effect === 'splash') {
      lines.push(row('Splash', stats.effectStrength, next?.effectStrength));
    }
    y = this.rows(y, lines) + 4;
    const buttonsTop = this.bottom - BUTTONS_HEIGHT;
    const effect = this.add(label(scene, x, y, effectText(weapon, stats), {
      size: 12, color: PALETTE.muted, wordWrap: { width: this.width },
    }));
    if (y + effect.height > buttonsTop - 4) effect.setVisible(false); // never under the buttons

    const b = this.bottom;
    const sellW = 76;
    const upW = this.width - sellW - 8;
    const upLabel = cost === null ? 'Maxed ★' : `⬆ Upgrade 🧢${cost}`;
    const up = new Button(scene, x + upW / 2, b - 50, upW, 38, upLabel, () => this.upgrade(),
      { size: 14, variant: 'primary' });
    up.setEnabled(cost !== null && scene.state.corks >= cost && this.canAct());
    const sell = new Button(scene, x + this.width - sellW / 2, b - 50, sellW, 38, `Sell +${sellRefund(tower)}`,
      () => this.sell(), { size: 14 });
    sell.setEnabled(this.canAct());
    this.buttons.push(up, sell);
    this.add(label(scene, x + this.width / 2, b - 22, '[U] upgrade · [S] sell · Esc close', {
      size: 11, color: PALETTE.muted,
    })).setOrigin(0.5, 0);
  }
}
