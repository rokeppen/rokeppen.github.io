// Top bar: white stat cards (🧢 caps, 🍺 kegs, "Wave n/total · Turn t", the action dots,
// "Next wave in N turns" with the coming guests) and the chunky game-wide buttons
// (Victory Bell = gold, End turn = navy, ⏩ / mute / levels = white).
// Keys: Space end turn, B bell, F ⏩ fast playback, M mute.
// The numbers come from scene.view, which follows the state except while the guests' turn
// plays back (then it changes event by event). (Internally caps are corks, kegs are wine.)
import { PALETTE, HUD_HEIGHT, css } from '../theme.js';
import { Button, label, icon } from './widgets.js';
import { addCard, snap } from './textures.js';

const DEPTH = 10;
const CARD_H = 42;
const GAP = 8;
const MAX_PREVIEW = 5; // guest kinds shown in the next-wave card
const ACTIONS_PER_TURN = 3; // the engine's per-turn action count (dots shown)

export function nextWaveText(n) {
  if (n === 0) return 'Next wave this turn';
  return `Next wave in ${n} turn${n === 1 ? '' : 's'}`;
}

export class Hud {
  constructor(scene) {
    this.scene = scene;
    const { width } = scene.layout;
    const mid = HUD_HEIGHT / 2;
    this.mid = mid;

    // Right-aligned buttons, laid out from the right edge.
    const h = 40;
    const by = mid - 2;
    let x = width - 14;
    const place = (w) => { x -= w; const cx = x + w / 2; x -= GAP; return cx; };
    this.levelsButton = new Button(scene, place(44), by, 44, h, '☰', () => scene.backToMenu(), { size: 18 });
    this.muteButton = new Button(scene, place(44), by, 44, h, '', () => this.toggleMute(), { size: 18 });
    this.fastButton = new Button(scene, place(56), by, 56, h, '', () => this.toggleFast(), { size: 15 });
    this.endTurnButton = new Button(scene, place(140), by, 140, h, 'End turn ▶', () => scene.endTurn(),
      { size: 16, variant: 'primary' });
    this.bellButton = new Button(scene, place(148), by, 148, h, '🔔 Victory Bell', () => scene.ringBell(),
      { size: 16, variant: 'gold' });
    this.buttonsLeft = x; // cards must end before this

    // Stat cards: [value, small label]. Built once; reflow() moves and resizes them.
    this.cards = {
      corks: this.makeCard('caps', PALETTE.text),
      wine: this.makeCard('kegs', PALETTE.text),
      wave: this.makeCard('', PALETTE.text),
      actions: this.makeCard('actions', PALETTE.goodText),
    };
    this.previewCard = { bg: null, w: 0, objects: [], width: 0 };

    const kb = scene.input.keyboard;
    if (kb) {
      // Space during the guests' turn is simply ignored (no toast for a held key).
      kb.on('keydown-SPACE', () => { if (!scene.busy) scene.endTurn(); });
      kb.on('keydown-B', () => scene.ringBell());
      kb.on('keydown-F', () => this.toggleFast());
      kb.on('keydown-M', () => this.toggleMute());
    }
    this.shown = {};
    this.update();
  }

  makeCard(small, color) {
    const value = label(this.scene, 0, this.mid - 2, '', { size: 18, bold: true, color })
      .setOrigin(0, 0.5).setDepth(DEPTH + 1);
    const sub = label(this.scene, 0, this.mid - 1, small, { size: 12, color: PALETTE.muted })
      .setOrigin(0, 0.5).setDepth(DEPTH + 1).setVisible(small !== '');
    return { value, sub, bg: null, w: 0, x: 0 };
  }

  // Where flying caps land (centre of the caps value).
  capsTarget() {
    const c = this.cards.corks;
    return { x: c.value.x + 14, y: this.mid };
  }

  bumpCaps() {
    this.bump(this.cards.corks.value);
  }

  toggleFast() {
    this.scene.fast = !this.scene.fast;
  }

  toggleMute() {
    const sfx = this.scene.sfx;
    if (sfx) sfx.setMuted(!sfx.muted);
  }

  // Called every frame; only touches game objects when a value changed.
  update() {
    const { state, sfx, view, busy } = this.scene;
    let dirty = false;
    this.set('corks', `🧢 ${view.corks}`, (v, prev) => {
      this.cards.corks.value.setText(v);
      dirty = true;
      if (prev !== undefined) this.bump(this.cards.corks.value);
    });
    this.set('wine', view.wine, (v, prev) => {
      const card = this.cards.wine;
      card.value.setText(`🍺 ${v}`);
      card.value.setColor(css(v <= Math.ceil(state.level.startingWine * 0.3) ? PALETTE.danger : PALETTE.text));
      dirty = true;
      if (prev !== undefined && v < prev) this.bump(card.value);
    });
    this.set('wave', `Wave ${view.wave}/${state.totalWaves} · Turn ${view.turn}`, (v) => {
      this.cards.wave.value.setText(v);
      dirty = true;
    });
    const left = Math.max(0, Math.min(ACTIONS_PER_TURN, view.actions));
    this.set('actions', left, (v) => {
      const c = this.cards.actions;
      c.value.setText('●'.repeat(v) + '○'.repeat(ACTIONS_PER_TURN - v));
      c.value.setColor(css(v > 0 ? PALETTE.goodText : PALETTE.muted));
      c.sub.setText(`${v}/${ACTIONS_PER_TURN} actions`);
      dirty = true;
    });
    // While the guests' turn plays back the state already holds the next turn: keep the old card.
    if (!busy) {
      const show = !state.over && state.nextWaveIn !== null && state.waveIndex < state.totalWaves;
      this.set('preview', show ? `${state.waveIndex}|${state.nextWaveIn}` : '', () => { dirty = true; });
    }
    if (dirty) this.reflow();

    const over = state.over || this.scene.ended;
    this.endTurnButton.setEnabled(!busy && !over).setText(busy ? "⏳ Guests' turn" : 'End turn ▶');
    this.bellButton.setEnabled(!state.bellUsed && !over && !busy)
      .setText(state.bellUsed ? '🔔 Bell rung' : '🔔 Victory Bell');
    this.fastButton.setText(this.scene.fast ? '⏩ 3×' : '⏩ 1×');
    this.muteButton.setText(sfx && sfx.muted ? '🔇' : '🔊');
  }

  // Lay the cards out left to right with minimum widths (so they don't jitter as numbers
  // change; widths snap to 8 px so only a few card textures are baked). The next-wave card
  // gets the room left before the buttons: it drops guest icons, then itself, if it doesn't
  // fit. If even the stats don't fit, they shrink.
  reflow() {
    for (const c of Object.values(this.cards)) {
      for (const o of [c.bg, c.value, c.sub]) if (o) { o.baseScale = 1; o.setScale(1); }
    }
    let x = 14;
    const order = [['corks', 96], ['wine', 84], ['wave', 120], ['actions', 112]];
    for (const [key, min] of order) {
      const c = this.cards[key];
      const w = snap(Math.max(min, this.inner(c) + 28));
      this.placeCard(c, x, w);
      x += w + GAP;
    }
    this.buildPreview(x, this.buttonsLeft - 6 - x);
    // Stats alone too wide: squeeze them. Not reachable at the 1280 px minimum width (the
    // stats need ~560 px, the buttons leave ~750), kept as a guard; bump() respects it.
    const statsRight = x - GAP;
    if (statsRight > this.buttonsLeft - 6) {
      const k = (this.buttonsLeft - 6) / statsRight;
      for (const c of Object.values(this.cards)) {
        for (const o of [c.bg, c.value, c.sub]) { o.x *= k; o.baseScale = k; o.setScale(k); }
      }
    }
  }

  inner(c) {
    return c.value.width + (c.sub.visible ? 6 + c.sub.width : 0);
  }

  placeCard(c, x, w) {
    if (!c.bg || c.w !== w) {
      if (c.bg) c.bg.destroy();
      c.bg = addCard(this.scene, 0, this.mid - 2, w, CARD_H, 'card').setDepth(DEPTH);
      c.w = w;
    }
    c.bg.x = x + w / 2;
    c.value.x = x + (w - this.inner(c)) / 2;
    c.sub.x = c.value.x + c.value.width + 6;
  }

  // "Next wave in N turns" and an icon per guest kind of that wave with its count, as many
  // kinds as fit in `room` (none if even the text doesn't fit).
  buildPreview(x, room) {
    const p = this.previewCard;
    for (const o of p.objects) o.destroy();
    if (p.bg) p.bg.destroy();
    p.objects = [];
    p.bg = null;
    p.width = 0;
    if (!this.shown.preview) return;
    const { state, enemyDefs } = this.scene;
    const wave = state.level.waves[state.waveIndex];
    if (!wave) return;
    const counts = new Map();
    for (const g of wave) counts.set(g.enemyId, (counts.get(g.enemyId) ?? 0) + g.count);
    const add = (o, bx) => { o.x = x + bx; o.setDepth(DEPTH + 1); p.objects.push(o); return o; };
    let bx = 12;
    const head = add(label(this.scene, 0, this.mid - 2, nextWaveText(state.nextWaveIn), {
      size: 12, bold: true, color: PALETTE.text,
    }).setOrigin(0, 0.5), bx);
    bx += head.width + 8;
    if (snap(bx + 4) > room) {
      for (const o of p.objects) o.destroy();
      p.objects = [];
      return;
    }
    for (const [id, n] of [...counts].slice(0, MAX_PREVIEW)) {
      const def = enemyDefs.get(id);
      const ic = add(icon(this.scene, 0, this.mid - 2, def?.sprite, def?.fallbackSprite || '👤', 20), bx + 11);
      const t = add(label(this.scene, 0, this.mid - 2, `×${n}`, { size: 14, bold: true }).setOrigin(0, 0.5), bx + 23);
      const next = bx + 23 + t.width + 8;
      if (snap(next + 4) > room) {
        ic.destroy();
        t.destroy();
        p.objects.length -= 2;
        break;
      }
      bx = next;
    }
    p.width = snap(bx + 4);
    p.bg = addCard(this.scene, x + p.width / 2, this.mid - 2, p.width, CARD_H, 'card').setDepth(DEPTH);
  }

  set(key, value, apply) {
    if (this.shown[key] === value) return;
    const prev = this.shown[key];
    this.shown[key] = value;
    apply(value, prev);
  }

  bump(text) {
    this.scene.tweens.killTweensOf(text);
    const base = text.baseScale ?? 1;
    text.setScale(base);
    this.scene.tweens.add({
      targets: text, scale: base * 1.15, duration: 90, yoyo: true,
      onComplete: () => text.setScale(base),
    });
  }
}
