// Win/lose overlay, launched on top of a finished GameScene.
// Data: { levelId, won, wine, startingWine, corks, wave, totalWaves, kills }
// Keys: R / Enter retry (Enter = next round after a win), Esc levels.
import { PALETTE } from '../theme.js';
import { Button, label } from '../ui/widgets.js';
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
    this.tweens.add({ targets: dim, fillAlpha: 0.72, duration: 300 });

    const panel = this.add.container(cx, cy);
    const pw = 520;
    const ph = 380;
    const bg = this.add.rectangle(0, 0, pw, ph, PALETTE.hudBar).setStrokeStyle(4, r.won ? PALETTE.accent : PALETTE.danger);
    const icon = label(this, 0, -ph / 2 + 62, r.won ? '🥂' : '🍷', { size: 64 }).setOrigin(0.5);
    const title = label(this, 0, -ph / 2 + 132, r.won ? 'The wine is safe!' : 'The wine ran out…', {
      size: 34, bold: true, color: r.won ? PALETTE.accent : PALETTE.danger,
    }).setOrigin(0.5);
    const sub = label(this, 0, -ph / 2 + 172, r.won
      ? `${level?.name ?? 'Level'} cleared · ${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}`
      : `${level?.name ?? 'Level'} · the guests got through on wave ${r.wave}/${r.totalWaves}`, {
      size: 18, color: PALETTE.hudText,
    }).setOrigin(0.5);
    const stats = label(this, 0, -ph / 2 + 214,
      `🍷 ${r.wine}/${r.startingWine} left    🍾 ${r.corks} corks    🚪 ${r.kills} guests escorted out`, {
        size: 16, color: PALETTE.hudMuted,
      }).setOrigin(0.5);
    panel.add([bg, icon, title, sub, stats]);
    panel.setScale(0.7).setAlpha(0);
    this.tweens.add({ targets: panel, scale: 1, alpha: 1, duration: 380, ease: 'Back.easeOut' });

    const by = cy + ph / 2 - 70;
    const buttons = next
      ? [['↻ Retry', () => this.retry()], ['☰ Levels', () => this.levels()], ['Next round ▶', () => this.play(next.id)]]
      : [['↻ Retry', () => this.retry()], ['☰ Levels', () => this.levels()]];
    const bw = next ? 150 : 180;
    buttons.forEach(([text, onClick], i) => {
      const x = cx + (i - (buttons.length - 1) / 2) * (bw + 16);
      const b = new Button(this, x, by, bw, 50, text, onClick, { size: 20, depth: 1 });
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
    label(this, cx, by + 34, `R retry · Esc levels${next ? ' · Enter next round' : ''}`, {
      size: 12, color: PALETTE.hudMuted,
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
