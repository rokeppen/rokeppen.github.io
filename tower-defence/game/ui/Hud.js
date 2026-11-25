// Top bar: corks, wine, wave counter and the game-wide buttons
// (Next wave, Victory Bell, speed, mute, levels).
// Keys: Space/N next wave, B bell, F speed, M mute.
import { PALETTE, HUD_HEIGHT, css } from '../theme.js';
import { Button, label } from './widgets.js';

export class Hud {
  constructor(scene) {
    this.scene = scene;
    const { width } = scene.layout;
    const mid = HUD_HEIGHT / 2;
    const depth = 10;

    scene.add.rectangle(0, 0, width, HUD_HEIGHT, PALETTE.hudBar).setOrigin(0).setDepth(depth);
    scene.add.rectangle(0, HUD_HEIGHT - 2, width, 2, PALETTE.towerRing, 0.6).setOrigin(0).setDepth(depth);

    const name = scene.level.name.length > 22 ? `${scene.level.name.slice(0, 21)}…` : scene.level.name;
    this.name = label(scene, 16, mid, name, { size: 16, color: PALETTE.hudMuted })
      .setOrigin(0, 0.5).setDepth(depth);
    // Stats flow left to right (see reflow), so a big cork count pushes the rest along.
    this.statsX = 16 + Math.max(this.name.width, 90) + 24;
    this.corks = label(scene, 0, mid, '', { size: 24, bold: true, color: PALETTE.accent })
      .setOrigin(0, 0.5).setDepth(depth);
    this.wine = label(scene, 0, mid, '', { size: 24, bold: true })
      .setOrigin(0, 0.5).setDepth(depth);
    this.wave = label(scene, 0, mid, '', { size: 20 }).setOrigin(0, 0.5).setDepth(depth);
    this.preview = label(scene, 0, mid, '', { size: 16, color: PALETTE.hudMuted })
      .setOrigin(0, 0.5).setDepth(depth);

    // Right-aligned buttons, laid out from the right edge.
    const h = 42;
    let x = width - 12;
    const place = (w) => { x -= w; const cx = x + w / 2; x -= 8; return cx; };
    this.levelsButton = new Button(scene, place(48), mid, 48, h, '☰', () => scene.backToMenu(), { size: 20 });
    this.muteButton = new Button(scene, place(48), mid, 48, h, '', () => this.toggleMute(), { size: 20 });
    this.speedButton = new Button(scene, place(64), mid, 64, h, '', () => this.toggleSpeed(), { size: 17 });
    this.bellButton = new Button(scene, place(176), mid, 176, h, '🔔 Victory Bell', () => this.ringBell(),
      { fill: PALETTE.path });
    this.waveButton = new Button(scene, place(156), mid, 156, h, '', () => this.nextWave(), { size: 18 });
    this.buttonsLeft = x; // stats must end before this

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

  nextWave() {
    const result = this.scene.state.startNextWave();
    if (!result.ok) this.scene.toastReason(result.reason);
    else this.scene.toast(`Wave ${this.scene.state.waveIndex} incoming! 🚪`, PALETTE.accent);
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
    this.set('corks', `🍾 ${state.corks}`, (v, prev) => {
      this.corks.setText(v);
      dirty = true;
      if (prev !== undefined) this.bump(this.corks);
    });
    this.set('wine', state.wine, (v, prev) => {
      this.wine.setText(`🍷 ${v}`);
      this.wine.setColor(v <= Math.ceil(state.level.startingWine * 0.3) ? css(PALETTE.danger) : css(PALETTE.hudText));
      dirty = true;
      if (prev !== undefined && v < prev) this.bump(this.wine);
    });
    this.set('wave', `Wave ${state.waveIndex}/${state.totalWaves}`, (v) => { this.wave.setText(v); dirty = true; });
    this.set('preview', state.phase === 'build' ? this.nextWavePreview() : '', (v) => {
      this.preview.setText(v);
      dirty = true;
    });
    if (dirty) this.reflow();

    const building = state.phase === 'build';
    this.waveButton.setEnabled(building)
      .setText(building ? (state.waveIndex === 0 ? '▶ Start party' : '▶ Next wave') : '⏳ Arriving…');
    this.bellButton.setEnabled(!state.bellUsed && !state.over)
      .setText(state.bellUsed ? '🔔 Bell rung' : '🔔 Victory Bell');
    this.speedButton.setText(this.scene.speed === 2 ? '⏩ 2×' : '▶ 1×');
    this.muteButton.setText(sfx && sfx.muted ? '🔇' : '🔊');
  }

  // Lay the stats out left to right with minimum slots (so they don't jitter as numbers
  // change), then shrink the preview, and if needed the whole row, to end before the buttons.
  reflow() {
    const gap = 22;
    const slots = [[this.corks, 110], [this.wine, 72], [this.wave, 96]];
    let x = this.statsX;
    for (const [text, min] of slots) {
      text.x = x;
      x += Math.max(text.width, min) + gap;
    }
    this.preview.x = x;
    const room = this.buttonsLeft - 12 - x;
    this.preview.setScale(this.preview.width > room ? Math.max(room, 0) / this.preview.width : 1);
    this.preview.setVisible(room >= 40);
  }

  set(key, value, apply) {
    if (this.shown[key] === value) return;
    const prev = this.shown[key];
    this.shown[key] = value;
    apply(value, prev);
  }

  bump(text) {
    this.scene.tweens.killTweensOf(text);
    text.setScale(1);
    this.scene.tweens.add({ targets: text, scale: 1.18, duration: 90, yoyo: true });
  }

  // "next: 6🧑‍💼 3❓" for the upcoming wave.
  nextWavePreview() {
    const { state } = this.scene;
    const wave = state.level.waves[state.waveIndex];
    if (!wave) return '';
    const counts = new Map();
    for (const g of wave) counts.set(g.enemyId, (counts.get(g.enemyId) ?? 0) + g.count);
    const parts = [...counts].map(([id, n]) => `${n}${this.scene.enemyDefs.get(id)?.sprite ?? '👤'}`);
    return `next: ${parts.join(' ')}`;
  }
}
