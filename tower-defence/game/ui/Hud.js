// Top bar: white stat cards (🧢 caps, 🍺 kegs, wave, next-wave preview) and the chunky
// game-wide buttons (Next wave = navy, Victory Bell = gold, speed / mute / levels = white).
// Keys: Space/N next wave, B bell, F speed, M mute.
// (Internally caps are state.corks and kegs are state.wine.)
import { PALETTE, HUD_HEIGHT, css } from '../theme.js';
import { Button, label, icon } from './widgets.js';
import { addCard, snap } from './textures.js';

const DEPTH = 10;
const CARD_H = 42;
const GAP = 8;
const MAX_PREVIEW = 5; // guest kinds shown in the next-wave card

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
    this.speedButton = new Button(scene, place(60), by, 60, h, '', () => this.toggleSpeed(), { size: 15 });
    this.bellButton = new Button(scene, place(170), by, 170, h, '🔔 Victory Bell', () => this.ringBell(),
      { size: 16, variant: 'gold' });
    this.waveButton = new Button(scene, place(150), by, 150, h, '', () => this.nextWave(),
      { size: 16, variant: 'primary' });
    this.buttonsLeft = x; // cards must end before this

    // Stat cards: [value, small label]. Built once; reflow() moves and resizes them.
    this.cards = {
      corks: this.makeCard('caps', PALETTE.text),
      wine: this.makeCard('kegs', PALETTE.text),
      wave: this.makeCard(this.shortName(scene.level.name), PALETTE.text),
    };
    this.previewCard = { bg: null, w: 0, objects: [], width: 0 };

    const kb = scene.input.keyboard;
    if (kb) {
      kb.on('keydown-SPACE', () => this.nextWave());
      kb.on('keydown-N', () => this.nextWave());
      kb.on('keydown-B', () => this.ringBell());
      kb.on('keydown-F', () => this.toggleSpeed());
      kb.on('keydown-M', () => this.toggleMute());
    }
    this.shown = {};
    this.update();
  }

  shortName(name) {
    return name.length > 18 ? `${name.slice(0, 17)}…` : name;
  }

  makeCard(small, color) {
    const value = label(this.scene, 0, this.mid - 2, '', { size: 18, bold: true, color })
      .setOrigin(0, 0.5).setDepth(DEPTH + 1);
    const sub = label(this.scene, 0, this.mid - 1, small, { size: 12, color: PALETTE.muted })
      .setOrigin(0, 0.5).setDepth(DEPTH + 1);
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

  nextWave() {
    const result = this.scene.state.startNextWave();
    if (!result.ok) this.scene.toastReason(result.reason);
    else this.scene.toast(`Wave ${this.scene.state.waveIndex} incoming! 🚪`, PALETTE.text);
  }

  ringBell() {
    const { state } = this.scene;
    if (!state.bellUsed && !state.over && state.enemies.length === 0) {
      // Don't waste the once-per-level bell on an empty office.
      this.scene.toast('No guests to ring out yet');
      return;
    }
    const result = state.ringBell();
    if (!result.ok) this.scene.toastReason(result.reason);
  }

  toggleSpeed() {
    this.scene.speed = this.scene.speed === 1 ? 2 : 1;
  }

  toggleMute() {
    const sfx = this.scene.sfx;
    if (sfx) sfx.setMuted(!sfx.muted);
  }

  // Called every frame; only touches game objects when a value changed.
  update() {
    const { state, sfx } = this.scene;
    let dirty = false;
    this.set('corks', `🧢 ${state.corks}`, (v, prev) => {
      this.cards.corks.value.setText(v);
      dirty = true;
      if (prev !== undefined) this.bump(this.cards.corks.value);
    });
    this.set('wine', state.wine, (v, prev) => {
      const card = this.cards.wine;
      card.value.setText(`🍺 ${v}`);
      card.value.setColor(css(v <= Math.ceil(state.level.startingWine * 0.3) ? PALETTE.danger : PALETTE.text));
      dirty = true;
      if (prev !== undefined && v < prev) this.bump(card.value);
    });
    this.set('wave', `Wave ${state.waveIndex} / ${state.totalWaves}`, (v) => {
      this.cards.wave.value.setText(v);
      dirty = true;
    });
    const previewKey = state.phase === 'build' ? `${state.waveIndex}` : '';
    this.set('preview', previewKey, () => { this.buildPreview(); dirty = true; });
    if (dirty) this.reflow();

    const building = state.phase === 'build';
    this.waveButton.setEnabled(building)
      .setText(building ? (state.waveIndex === 0 ? '▶ Start party' : '▶ Next wave') : '⏳ Arriving…');
    this.bellButton.setEnabled(!state.bellUsed && !state.over)
      .setText(state.bellUsed ? '🔔 Bell rung' : '🔔 Victory Bell');
    this.speedButton.setText(this.scene.speed === 2 ? '⏩ 2×' : '▶ 1×');
    this.muteButton.setText(sfx && sfx.muted ? '🔇' : '🔊');
  }

  // Lay the cards out left to right with minimum widths (so they don't jitter as numbers
  // change; widths snap to 8 px so only a few card textures are baked). The preview card is
  // dropped if it doesn't fit before the buttons; if even the stats don't fit, they shrink.
  reflow() {
    for (const c of Object.values(this.cards)) {
      for (const o of [c.bg, c.value, c.sub]) if (o) { o.baseScale = 1; o.setScale(1); }
    }
    let x = 14;
    const order = [['corks', 96], ['wine', 84], ['wave', 120]];
    for (const [key, min] of order) {
      const c = this.cards[key];
      const inner = c.value.width + 6 + c.sub.width;
      const w = snap(Math.max(min, inner + 28));
      this.placeCard(c, x, w);
      x += w + GAP;
    }
    const p = this.previewCard;
    const room = this.buttonsLeft - 6 - x;
    const fits = p.width > 0 && p.width <= room;
    if (p.bg) p.bg.setVisible(fits);
    for (const o of p.objects) {
      o.setVisible(fits);
      o.x = o.baseX + x;
    }
    if (p.bg) p.bg.x = x + p.width / 2;
    // Stats alone too wide: squeeze them. Not reachable at the 1280 px minimum width (the
    // stats need ~450 px, the buttons leave ~750), kept as a guard; bump() respects it.
    const statsRight = x - GAP;
    if (statsRight > this.buttonsLeft - 6) {
      const k = (this.buttonsLeft - 6) / statsRight;
      for (const c of Object.values(this.cards)) {
        for (const o of [c.bg, c.value, c.sub]) { o.x *= k; o.baseScale = k; o.setScale(k); }
      }
    }
  }

  placeCard(c, x, w) {
    if (!c.bg || c.w !== w) {
      if (c.bg) c.bg.destroy();
      c.bg = addCard(this.scene, 0, this.mid - 2, w, CARD_H, 'card').setDepth(DEPTH);
      c.w = w;
    }
    c.bg.x = x + w / 2;
    const inner = c.value.width + 6 + c.sub.width;
    c.value.x = x + (w - inner) / 2;
    c.sub.x = c.value.x + c.value.width + 6;
  }

  // "Next" card: an icon per guest kind of the upcoming wave with its count.
  buildPreview() {
    const p = this.previewCard;
    for (const o of p.objects) o.destroy();
    if (p.bg) p.bg.destroy();
    p.objects = [];
    p.bg = null;
    p.width = 0;
    const { state, enemyDefs } = this.scene;
    if (state.phase !== 'build') return;
    const wave = state.level.waves[state.waveIndex];
    if (!wave) return;
    const counts = new Map();
    for (const g of wave) counts.set(g.enemyId, (counts.get(g.enemyId) ?? 0) + g.count);
    const add = (o, bx) => { o.baseX = bx; o.setDepth(DEPTH + 1); p.objects.push(o); return o; };
    let bx = 12;
    const head = add(label(this.scene, 0, this.mid - 2, 'Next', { size: 12, color: PALETTE.muted }).setOrigin(0, 0.5), bx);
    bx += head.width + 8;
    for (const [id, n] of [...counts].slice(0, MAX_PREVIEW)) {
      const def = enemyDefs.get(id);
      add(icon(this.scene, 0, this.mid - 2, def?.sprite, def?.fallbackSprite || '👤', 20), bx + 11);
      const t = add(label(this.scene, 0, this.mid - 2, `×${n}`, { size: 14, bold: true }).setOrigin(0, 0.5), bx + 23);
      bx += 23 + t.width + 8;
    }
    p.width = snap(bx + 4);
    p.bg = addCard(this.scene, 0, this.mid - 2, p.width, CARD_H, 'card').setDepth(DEPTH);
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
