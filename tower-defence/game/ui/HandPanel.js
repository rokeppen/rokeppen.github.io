// Side panel, top part: the player's hand of action cards, one white row per card
// (icon, title, what it does, hotkey). Cards are free; one card per turn.
// Unplayable cards (no target, a card already played, guests moving) are faded; the
// pending card gets a green outline; a freshly drawn card lifts briefly.
// Keys: 1-7 pick a card, Esc cancels.
// The hand never takes the space the tower panel needs (TOWER_PANEL_HEIGHT).
import { PALETTE, HUD_HEIGHT, SIDE_WIDTH } from '../theme.js';
import { label, icon, isRightButton } from './widgets.js';
import { addCard, CARD_PAD } from './textures.js';
import { TOWER_PANEL_HEIGHT } from './TowerPanel.js';
import { HAND_MAX, cardTitle, cardSubtitle, cardIcon } from '../logic/cards.js';

const KEYS = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN'];
const DEPTH = 10;
const HEADER = 40;
const GAP = 8;
const MAX_ROW_H = 50;
const DRAWN_MS = 700;

export class HandPanel {
  constructor(scene) {
    this.scene = scene;
    const { sideX: x0, height } = scene.layout;
    this.x = x0 + 14;
    this.w = SIDE_WIDTH - 28;
    this.top = HUD_HEIGHT + HEADER;
    const maxH = height - HUD_HEIGHT - HEADER - TOWER_PANEL_HEIGHT;
    this.rowH = Math.max(30, Math.min(MAX_ROW_H, Math.floor((maxH + GAP) / HAND_MAX) - GAP));
    this.bottom = this.top + HAND_MAX * (this.rowH + GAP);
    this.heading = label(scene, x0 + 14, HUD_HEIGHT + 12, '', { size: 12, bold: true, color: PALETTE.muted })
      .setDepth(DEPTH);
    label(scene, x0 + SIDE_WIDTH - 14, HUD_HEIGHT + 12, 'one card per turn', { size: 12, color: PALETTE.muted })
      .setOrigin(1, 0).setDepth(DEPTH);
    this.rows = [];
    this.handSig = null;
    this.drawnId = null;

    scene.bus.on('state-event', (ev) => {
      if (ev.type === 'draw') {
        this.drawnId = ev.card.id;
        this.handSig = null; // rebuild so the new card shows during the playback
        this.rebuild(true);
        scene.time.delayedCall(DRAWN_MS, () => { if (this.drawnId === ev.card.id) this.drawnId = null; });
      }
    });
    const kb = scene.input.keyboard;
    if (kb) {
      KEYS.forEach((k, i) => kb.on(`keydown-${k}`, () => {
        const card = scene.state.hand[i];
        if (card) this.pick(card.id);
      }));
      kb.on('keydown-ESC', () => { scene.selectCard(null); scene.selectTower(null); });
    }
    this.update();
  }

  // Cards shown: during the guests' turn only those already drawn (by played-back events).
  visibleHand() {
    const { state, busy } = this.scene;
    if (!busy) return state.hand;
    return state.hand.filter((c) => !this.pendingDraws().has(c.id));
  }

  // Draw events of the running playback not played back yet.
  pendingDraws() {
    const run = this.scene.playback;
    const ids = new Set();
    if (!run) return ids;
    for (const beat of run.beats.slice(run.i)) {
      for (const ev of beat.events) if (ev.type === 'draw') ids.add(ev.card.id);
    }
    return ids;
  }

  rebuild(force = false) {
    const hand = this.visibleHand();
    const sig = hand.map((c) => c.id).join(',');
    if (!force && sig === this.handSig) return;
    this.handSig = sig;
    for (const r of this.rows) for (const o of r.objects) o.destroy();
    this.rows = hand.map((card, i) => this.makeRow(card, i));
    this.heading.setText(`HAND ${hand.length}/${HAND_MAX}`);
  }

  makeRow(card, index) {
    const { scene, x, w, rowH: h } = this;
    const y = this.top + index * (h + GAP);
    const cx = x + w / 2;
    const cy = y + h / 2;
    const bg = addCard(scene, cx, cy, w, h, 'card').setInteractive({
      hitArea: new Phaser.Geom.Rectangle(CARD_PAD, CARD_PAD, w, h),
      hitAreaCallback: Phaser.Geom.Rectangle.Contains,
      useHandCursor: true,
    });
    const outline = addCard(scene, cx, cy, w, h, 'select').setVisible(false);
    const ts = Math.max(22, Math.min(34, h - 12));
    const tx = x + 8 + ts / 2;
    const tile = addCard(scene, tx, cy - 1, ts, ts, 'icon');
    const { sprite, fallback } = cardIcon(card, scene.weapons);
    const ic = icon(scene, tx, cy - 1, sprite, fallback, Math.round(ts * 0.6));
    const textX = x + ts + 16;
    const textW = w - ts - 34;
    const title = label(scene, textX, cy - 8, cardTitle(card, scene.weapons), { size: 14, bold: true })
      .setOrigin(0, 0.5);
    if (title.width > textW) title.setScale(textW / title.width);
    const sub = label(scene, textX, cy + 10, cardSubtitle(card, scene.weapons), { size: 11, color: PALETTE.muted })
      .setOrigin(0, 0.5);
    if (sub.width > textW + 12) sub.setScale((textW + 12) / sub.width);
    const key = label(scene, x + w - 6, y + 2, index < KEYS.length ? `${index + 1}` : '', {
      size: 10, color: PALETTE.muted,
    }).setOrigin(1, 0);
    const objects = [bg, outline, tile, ic, title, sub, key];
    for (const o of objects) {
      o.setDepth(DEPTH);
      o.baseY = o.y;
    }
    outline.setDepth(DEPTH + 0.5);
    const row = { card, objects, outline, hover: false, shown: null };
    bg.on('pointerover', () => { row.hover = true; scene.hoverCardId = card.id; });
    bg.on('pointerout', () => {
      row.hover = false;
      if (scene.hoverCardId === card.id) scene.hoverCardId = null;
    });
    bg.on('pointerup', (pointer) => {
      if (!isRightButton(pointer)) this.pick(card.id);
    });
    return row;
  }

  pick(cardId) {
    const { scene } = this;
    if (scene.pendingCard && scene.pendingCard.id === cardId) {
      scene.selectCard(null);
      return;
    }
    scene.selectCard(cardId);
  }

  update() {
    this.rebuild();
    const { state, pendingCard, busy } = this.scene;
    for (const r of this.rows) {
      const playable = !busy && state.cardPlayable(r.card);
      const selected = !!pendingCard && pendingCard.id === r.card.id;
      const drawn = this.drawnId === r.card.id;
      const sig = `${playable}|${selected}|${r.hover}|${drawn}`;
      if (r.shown === sig) continue;
      r.shown = sig;
      r.outline.setVisible(selected || drawn);
      const lift = drawn ? -4 : (r.hover && playable) || selected ? -2 : 0;
      for (const o of r.objects) {
        o.y = o.baseY + lift;
        o.setAlpha(playable || selected || drawn ? 1 : 0.45);
      }
    }
  }
}
