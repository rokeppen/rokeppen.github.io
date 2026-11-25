// Level select. Starts GameScene with { levelId }.
import { PALETTE, FONT, EMOJI_FONT, MENU_WIDTH, MENU_HEIGHT, css } from '../theme.js';

export class MenuScene extends Phaser.Scene {
  constructor() {
    super('MenuScene');
  }

  create() {
    this.scale.setGameSize(MENU_WIDTH, MENU_HEIGHT);
    const data = this.registry.get('data');
    const cx = MENU_WIDTH / 2;

    this.add.text(cx, 90, '🍷', { fontFamily: EMOJI_FONT, fontSize: '72px' }).setOrigin(0.5);
    this.add.text(cx, 170, 'Friday Afternoon Drinks', {
      fontFamily: FONT, fontSize: '44px', fontStyle: 'bold', color: css(PALETTE.accent),
    }).setOrigin(0.5);
    this.add.text(cx, 220, 'Keep the uninvited guests away from the wine table.', {
      fontFamily: FONT, fontSize: '20px', color: css(PALETTE.hudMuted),
    }).setOrigin(0.5);

    if (data.levels.length === 0) {
      this.add.text(cx, 340, 'No levels on the menu tonight.', {
        fontFamily: FONT, fontSize: '24px', color: css(PALETTE.hudText),
      }).setOrigin(0.5);
    }

    data.levels.forEach((level, i) => {
      const y = 300 + i * 76;
      const label = `${i + 1}.  ${level.name}${level.published ? '' : '  (draft)'}`;
      this.makeButton(cx, y, label, () => this.startLevel(level.id));
      if (i < 9) this.input.keyboard.on(`keydown-${['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE'][i]}`,
        () => this.startLevel(level.id));
    });

    const back = this.add.text(24, MENU_HEIGHT - 24, '← Back', {
      fontFamily: FONT, fontSize: '20px', color: css(PALETTE.hudMuted),
    }).setOrigin(0, 1).setInteractive({ useHandCursor: true });
    back.on('pointerover', () => back.setColor(css(PALETTE.hudText)));
    back.on('pointerout', () => back.setColor(css(PALETTE.hudMuted)));
    back.on('pointerup', () => { window.location.href = './'; });
  }

  makeButton(x, y, label, onClick) {
    const w = 420;
    const h = 60;
    const bg = this.add.rectangle(x, y, w, h, PALETTE.hudBar)
      .setStrokeStyle(2, PALETTE.towerRing)
      .setInteractive({ useHandCursor: true });
    const text = this.add.text(x, y, label, {
      fontFamily: FONT, fontSize: '26px', color: css(PALETTE.hudText),
    }).setOrigin(0.5);
    bg.on('pointerover', () => { bg.setFillStyle(PALETTE.path); text.setColor(css(PALETTE.accent)); });
    bg.on('pointerout', () => { bg.setFillStyle(PALETTE.hudBar); text.setColor(css(PALETTE.hudText)); });
    bg.on('pointerup', onClick);
    return bg;
  }

  startLevel(levelId) {
    this.scene.start('GameScene', { levelId });
  }
}
