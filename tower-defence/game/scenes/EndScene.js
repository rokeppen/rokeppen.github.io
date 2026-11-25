// Win/lose overlay, launched on top of a finished GameScene.
// Data: { levelId, won, wine, startingWine, corks, wave, totalWaves, kills, turns, reason }
// (wine = kegs left, corks = bottle caps; internal names.)
// Keys: R / Enter retry (Enter = next round after a win), Esc levels.
import { PALETTE } from '../theme.js';
import { Button, label } from '../ui/widgets.js';
import { addCard } from '../ui/textures.js';
import { starsFor, recordStars } from '../progress.js';

export class EndScene extends Phaser.Scene {
  constructor() {
    super('EndScene');
  }

  init(data) {
    this.result = data;
  }

  create() {
    const r = this.result;
    const { width, height } = this.scale;
    const cx = width / 2;
    const cy = height / 2;
    const levels = this.registry.get('data').levels;
    const index = levels.findIndex((l) => l.id === r.levelId);
    const level = levels[index];
    const next = r.won ? levels[index + 1] : null;
    const stars = r.won ? starsFor(r.wine, r.startingWine) : 0;
    if (r.won) recordStars(r.levelId, stars);

    const dim = this.add.rectangle(0, 0, width, height, PALETTE.overlay, 0).setOrigin(0).setInteractive();
    this.tweens.add({ targets: dim, fillAlpha: 0.45, duration: 300 });

    const panel = this.add.container(cx, cy);
    const pw = 540;
    const ph = 380;
    const bg = addCard(this, 0, 0, pw, ph, 'card');
    const icon = label(this, 0, -ph / 2 + 64, r.won ? '🍻' : '🍺', { size: 64 }).setOrigin(0.5);
    const title = label(this, 0, -ph / 2 + 134, r.won ? 'The kegs are safe!'
      : r.reason === 'too-long' ? 'Last orders! The party ran too long' : 'The kegs ran dry…', {
      size: 34, bold: true, color: r.won ? PALETTE.goodText : PALETTE.danger,
    }).setOrigin(0.5);
    const turns = Number.isFinite(r.turns) ? ` in ${r.turns} turn${r.turns === 1 ? '' : 's'}` : '';
    const lostWhy = r.reason === 'too-long'
      ? `the party ran too long (wave ${r.wave}/${r.totalWaves})`
      : `the guests drained the bar on wave ${r.wave}/${r.totalWaves}`;
    const sub = label(this, 0, -ph / 2 + 174, r.won
      ? `${level?.name ?? 'Level'} cleared${turns}`
      : `${level?.name ?? 'Level'} · ${lostWhy}`, {
      size: 17, color: PALETTE.text,
    }).setOrigin(0.5);
    if (sub.width > pw - 40) sub.setScale((pw - 40) / sub.width);
    const starText = label(this, 0, -ph / 2 + 206, r.won ? `${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}` : '', {
      size: 26, bold: true, color: PALETTE.capsText,
    }).setOrigin(0.5);
    const stats = label(this, 0, -ph / 2 + 244,
      `🍺 ${r.wine}/${r.startingWine} kegs left    🧢 ${r.corks} caps    🚪 ${r.kills} escorted out    🔄 ${r.turns ?? '?'} turns`, {
        size: 15, color: PALETTE.muted,
      }).setOrigin(0.5);
    if (stats.width > pw - 40) stats.setScale((pw - 40) / stats.width);
    panel.add([bg, icon, title, sub, starText, stats]);
    panel.setScale(0.7).setAlpha(0);
    this.tweens.add({ targets: panel, scale: 1, alpha: 1, duration: 380, ease: 'Back.easeOut' });

    const by = cy + ph / 2 - 74;
    const buttons = next
      ? [['↻ Retry', () => this.retry(), 'ghost'], ['☰ Levels', () => this.levels(), 'ghost'],
        ['Next round ▶', () => this.play(next.id), 'primary']]
      : [['↻ Retry', () => this.retry(), r.won ? 'ghost' : 'primary'], ['☰ Levels', () => this.levels(), r.won ? 'primary' : 'ghost']];
    const bw = next ? 150 : 180;
    buttons.forEach(([text, onClick, variant], i) => {
      const x = cx + (i - (buttons.length - 1) / 2) * (bw + 16);
      const b = new Button(this, x, by, bw, 46, text, onClick, { size: 18, depth: 1, variant });
      b.bg.setAlpha(0);
      b.text.setAlpha(0);
      this.tweens.add({ targets: [b.bg, b.text], alpha: 1, delay: 250 + i * 80, duration: 200 });
    });

    const kb = this.input.keyboard;
    if (kb) {
      kb.on('keydown-R', () => this.retry());
      kb.on('keydown-ENTER', () => (next ? this.play(next.id) : this.retry()));
      kb.on('keydown-ESC', () => this.levels());
    }
    label(this, cx, by + 36, `R retry · Esc levels${next ? ' · Enter next round' : ''}`, {
      size: 12, color: PALETTE.muted,
    }).setOrigin(0.5, 0);
  }

  retry() {
    this.play(this.result.levelId);
  }

  play(levelId) {
    // Queued in order: stop the finished level, stop this overlay, start the level fresh.
    this.scene.stop('GameScene');
    this.scene.start('GameScene', { levelId });
  }

  levels() {
    this.scene.stop('GameScene');
    this.scene.start('MenuScene');
  }
}
