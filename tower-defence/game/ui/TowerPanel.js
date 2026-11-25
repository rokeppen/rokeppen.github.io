// Side panel, bottom half. Shows the selected tower (stats, Upgrade, Sell), otherwise the
// weapon being placed or hovered, otherwise a short how-to-play. Keys: U upgrade, S sell.
// Upgrade/Sell are anchored to the bottom of the side panel, so they always stay on canvas.
import { PALETTE, SIDE_WIDTH } from '../theme.js';
import { weaponStats, upgradeCost } from '../logic/stats.js';
import { sellRefund } from '../logic/state.js';
import { Button, label } from './widgets.js';

const DEPTH = 10;
// Vertical space the panel needs below the build menu: header, stats, effect line and the
// bottom-anchored buttons. BuildMenu never grows into it.
export const TOWER_PANEL_HEIGHT = 350;
const BUTTONS_HEIGHT = 116; // Upgrade + Sell + key hint, measured up from `bottom`
const HELP = [
  'Guests crashed the drinks!',
  '',
  '1. Pick a tower above',
  '2. Click the floor to build',
  '3. ▶ Start party to send guests',
  '',
  'Click a tower to upgrade or sell.',
  '🔔 Victory Bell: once per level,',
  'clears the room and pays out.',
  '',
  'Keys: 1-9 build · Esc cancel',
  'Space wave · B bell · F speed',
  'U upgrade · S sell · M mute',
].join('\n');

export function effectText(weapon, stats) {
  const dur = weapon.effectDuration;
  switch (weapon.effect) {
    case 'slow': return `Slows guests ${Math.round(stats.effectStrength * 100)}% for ${dur}s`;
    case 'distract': return `Distracts one guest for ${dur}s`;
    case 'lure': return `Lures everyone in range for ${dur}s`;
    case 'splash': return `Hits everyone within ${stats.effectStrength} tiles`;
    default: return 'Single target';
  }
}

export class TowerPanel {
  constructor(scene, top) {
    this.scene = scene;
    this.x = scene.layout.sideX + 16;
    this.top = top + 4;
    this.width = SIDE_WIDTH - 32;
    this.bottom = scene.layout.height - 12;
    scene.add.rectangle(this.x - 4, this.top - 8, this.width + 8, 2, PALETTE.panelEdge).setOrigin(0).setDepth(DEPTH);
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
    const result = scene.state.upgradeTower(tower.id);
    if (!result.ok) scene.toastReason(result.reason);
    else scene.onTowerUpgraded(tower);
  }

  sell() {
    const tower = this.selectedTower();
    if (!tower) return;
    const { scene } = this;
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
      ? `t|${tower.id}|${tower.tier}|${corks >= (upgradeCost(scene.weapons.get(tower.weaponId), tower.tier) ?? Infinity)}|${scene.state.over}`
      : weaponId ? `w|${weaponId}|${scene.selectedWeaponId === weaponId}` : 'help';
    if (sig === this.shown) return;
    this.shown = sig;
    this.clear();
    if (tower) this.showTower(tower);
    else if (weaponId) this.showWeapon(scene.weapons.get(weaponId), scene.selectedWeaponId === weaponId);
    else this.add(label(scene, this.x, this.top, HELP, { size: 13, color: PALETTE.hudMuted, lineSpacing: 2 }));
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

  header(weapon, subtitle) {
    const { scene, x, top } = this;
    this.add(label(scene, x, top, weapon.sprite, { size: 30 }));
    const name = this.add(label(scene, x + 44, top + 2, weapon.name, { size: 16, bold: true }));
    if (name.width > this.width - 44) name.setScale((this.width - 44) / name.width);
    this.add(label(scene, x + 44, top + 22, subtitle, { size: 13, color: PALETTE.accent }));
    return top + 50;
  }

  showWeapon(weapon, placing) {
    const { scene, x } = this;
    const stats = weaponStats(weapon, 0);
    let y = this.header(weapon, `🍾 ${weapon.cost}`);
    const desc = this.add(label(scene, x, y, weapon.description, {
      size: 13, color: PALETTE.hudMuted, wordWrap: { width: this.width }, fontStyle: 'italic',
    }));
    y += desc.height + 6;
    const lines = [
      `Damage   ${stats.damage}`,
      `Range    ${stats.range} tiles`,
      `Rate     ${stats.fireRate}/s`,
      effectText(weapon, stats),
    ];
    this.add(label(scene, x, y, lines.join('\n'), { size: 14, lineSpacing: 2 }));
    if (placing) {
      this.add(label(scene, x, this.bottom - 40, 'Click a free floor tile to build.\nRight-click or Esc to cancel.', {
        size: 12, color: PALETTE.good,
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
    const pips = '★'.repeat(tower.tier) + '☆'.repeat(Math.max(maxTier - tower.tier, 0));
    let y = this.header(weapon, `Tier ${tower.tier + 1}/${maxTier + 1}  ${pips}`);

    const row = (name, now, then, unit = '') => {
      const changed = then !== undefined && then !== now;
      return `${name.padEnd(8)} ${now}${unit}${changed ? `  →  ${then}${unit}` : ''}`;
    };
    const lines = [
      row('Damage', stats.damage, next?.damage),
      row('Range', stats.range, next?.range),
      row('Rate', stats.fireRate, next?.fireRate, '/s'),
    ];
    if (weapon.effect === 'slow') {
      const pct = (s) => Math.round(s.effectStrength * 100);
      lines.push(row('Slow', pct(stats), next ? pct(next) : undefined, '%'));
    } else if (weapon.effect === 'splash') {
      lines.push(row('Splash', stats.effectStrength, next?.effectStrength));
    }
    const statText = this.add(label(scene, x, y, lines.join('\n'), { size: 14, lineSpacing: 2 }));
    y += statText.height + 2;
    const buttonsTop = this.bottom - BUTTONS_HEIGHT;
    const effect = this.add(label(scene, x, y, effectText(weapon, stats), {
      size: 13, color: PALETTE.hudMuted, wordWrap: { width: this.width },
    }));
    if (y + effect.height > buttonsTop - 4) effect.setVisible(false); // never under the buttons

    const bw = this.width;
    const cx = x + bw / 2;
    const b = this.bottom;
    const upLabel = cost === null ? 'Fully upgraded ★' : `⬆ Upgrade (${cost} 🍾)`;
    const up = new Button(scene, cx, b - 96, bw, 40, upLabel, () => this.upgrade(), { size: 16 });
    up.setEnabled(cost !== null && scene.state.corks >= cost && !scene.state.over);
    const sell = new Button(scene, cx, b - 48, bw, 40, `Sell (+${sellRefund(tower)} 🍾)`, () => this.sell(), { size: 16 });
    sell.setEnabled(!scene.state.over);
    this.buttons.push(up, sell);
    this.add(label(scene, cx, b - 22, '[U] upgrade · [S] sell · Esc close', { size: 12, color: PALETTE.hudMuted }))
      .setOrigin(0.5, 0);
  }
}
