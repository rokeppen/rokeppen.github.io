// Side panel, bottom half: a white card showing the selected tower's stats, otherwise the
// weapon of the Build card being placed or hovered, otherwise a short how-to-play.
// Upgrading and selling are done with cards from the hand, not here.
import { PALETTE, SIDE_WIDTH } from '../theme.js';
import { weaponStats, upgradeCost } from '../logic/stats.js';
import { label, icon } from './widgets.js';
import { addCard } from './textures.js';
import { cardTitle, cardHint } from '../logic/cards.js';

const DEPTH = 10;
// Vertical space the panel needs below the hand: header, card with stats, effect line and
// the hint at the bottom. HandPanel never grows into it.
export const TOWER_PANEL_HEIGHT = 250;
const HELP = [
  'Guests crashed the drinks and',
  'are heading for the beer bar 🍻.',
  '',
  'Play one card per turn, then',
  'End turn ▶. You draw a card',
  'each turn and keep the rest.',
  'Guests walk tile by tile; your',
  'weapons fire as they pass.',
  'Keys: 1-7 card · Esc cancel',
  'Space end turn · Enter skip',
  'F ⏩ · M mute',
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
    this.shown = null;
    this.update();
  }

  selectedTower() {
    const { state, selectedTowerId } = this.scene;
    return selectedTowerId === null ? null : state.towers.find((t) => t.id === selectedTowerId) ?? null;
  }

  // The weapon of the Build card being placed, else of the Build card hovered in the hand.
  cardWeapon() {
    const { pendingCard, hoverCardId, state } = this.scene;
    if (pendingCard && pendingCard.kind === 'build') return { weaponId: pendingCard.weaponId, placing: true };
    const hovered = hoverCardId !== null ? state.hand.find((c) => c.id === hoverCardId) : null;
    if (hovered && hovered.kind === 'build') return { weaponId: hovered.weaponId, placing: false };
    return null;
  }

  update() {
    const { scene } = this;
    const tower = this.selectedTower();
    const pick = this.cardWeapon();
    const pending = scene.pendingCard;
    const targeting = pending && pending.kind !== 'build' ? pending : null;
    const sig = targeting ? `c|${targeting.id}` : tower ? `t|${tower.id}|${tower.tier}`
      : pick ? `w|${pick.weaponId}|${pick.placing}` : 'help';
    if (sig === this.shown) return;
    this.shown = sig;
    this.clear();
    if (targeting) {
      // Upgrade or Sell waiting for a tower: say what to click (a sale can't be undone).
      this.heading.setText('PLAYING');
      this.add(label(scene, this.x, this.top, cardTitle(targeting, scene.weapons), { size: 15, bold: true }));
      this.add(label(scene, this.x, this.top + 28, `${cardHint(targeting, scene.weapons)}\n\nRight-click or Esc to cancel.`, {
        size: 13, color: PALETTE.goodText, wordWrap: { width: this.width },
      }));
    } else if (tower) {
      this.heading.setText('SELECTED');
      this.showTower(tower);
    } else if (pick) {
      this.heading.setText(pick.placing ? 'PLACING' : 'CARD');
      this.showWeapon(scene.weapons.get(pick.weaponId), pick.placing);
    } else {
      this.heading.setText('HOW TO PLAY');
      this.add(label(scene, this.x, this.top - 2, HELP, { size: 13, color: PALETTE.muted, lineSpacing: 2 }));
    }
  }

  clear() {
    for (const o of this.objects) o.destroy();
    this.objects = [];
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
    let y = this.header(weapon, 'Free with a Build card', PALETTE.goodText);
    const desc = this.add(label(scene, x, y, weapon.description, {
      size: 12, color: PALETTE.muted, wordWrap: { width: this.width }, fontStyle: 'italic',
    }));
    y += desc.height + 6;
    y = this.rows(y, [
      ['Damage', `${stats.damage}`],
      ['Range', `${stats.range} tiles`],
      ['Rate', `${stats.fireRate}/turn`],
    ]);
    const effect = this.add(label(scene, x, y + 2, effectText(weapon, stats), { size: 13, wordWrap: { width: this.width } }));
    if (placing) {
      effect.setVisible(y + 2 + effect.height < this.bottom - 38);
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
    const effect = this.add(label(scene, x, y, effectText(weapon, stats), {
      size: 12, color: PALETTE.muted, wordWrap: { width: this.width },
    }));
    if (y + effect.height > this.bottom - 22) effect.setVisible(false); // never under the hint
    const hint = cost === null ? 'Fully upgraded ★' : 'An Upgrade card adds a tier';
    this.add(label(scene, x + this.width / 2, this.bottom - 18, hint, { size: 11, color: PALETTE.muted }))
      .setOrigin(0.5, 0);
  }
}
