// Level select. Starts GameScene with { levelId }.
// Up to 5 levels: one column. More: two columns of 5 per page, with page arrows.
import { PALETTE, FONT, EMOJI_FONT, MENU_WIDTH, MENU_HEIGHT, css } from '../theme.js';
import { loadStars } from '../progress.js';
import { isRightButton } from '../ui/widgets.js';

const KEYS = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE'];
const ROWS = 5;
const TOP = 290;
const STEP = 68;
const BUTTON_H = 56;

export class MenuScene extends Phaser.Scene {
  constructor() {
    super('MenuScene');
  }

  create() {
    this.scale.setGameSize(MENU_WIDTH, MENU_HEIGHT);
    const data = this.registry.get('data');
    this.levels = data.levels;
    this.stars = loadStars();
    this.page = 0;
    this.pageObjects = [];
    const cx = MENU_WIDTH / 2;

    this.add.text(cx, 90, '🍷', { fontFamily: EMOJI_FONT, fontSize: '72px' }).setOrigin(0.5);
    this.add.text(cx, 170, 'Friday Afternoon Drinks', {
      fontFamily: FONT, fontSize: '44px', fontStyle: 'bold', color: css(PALETTE.accent),
    }).setOrigin(0.5);
    this.add.text(cx, 220, 'Keep the uninvited guests away from the wine table.', {
      fontFamily: FONT, fontSize: '20px', color: css(PALETTE.hudMuted),
    }).setOrigin(0.5);

    if (this.levels.length === 0) {
      this.add.text(cx, 340, 'No levels on the menu tonight.', {
        fontFamily: FONT, fontSize: '24px', color: css(PALETTE.hudText),
      }).setOrigin(0.5);
    }

    this.levels.forEach((level, i) => {
      if (i < KEYS.length) this.input.keyboard.on(`keydown-${KEYS[i]}`, () => this.startLevel(level.id));
    });
    this.showPage(0);

    const back = this.add.text(24, MENU_HEIGHT - 24, '← Back', {
      fontFamily: FONT, fontSize: '20px', color: css(PALETTE.hudMuted),
    }).setOrigin(0, 1).setInteractive({ useHandCursor: true });
    back.on('pointerover', () => back.setColor(css(PALETTE.hudText)));
    back.on('pointerout', () => back.setColor(css(PALETTE.hudMuted)));
    back.on('pointerup', (p) => { if (!isRightButton(p)) window.location.href = './'; });
  }

  get perPage() {
    return this.levels.length <= ROWS ? ROWS : ROWS * 2;
  }

  showPage(page) {
    for (const o of this.pageObjects) o.destroy();
    this.pageObjects = [];
    const pages = Math.max(1, Math.ceil(this.levels.length / this.perPage));
    this.page = Math.min(Math.max(page, 0), pages - 1);
    const twoColumns = this.levels.length > ROWS;
    const w = twoColumns ? 400 : 440;
    const cx = MENU_WIDTH / 2;
    const first = this.page * this.perPage;
    this.levels.slice(first, first + this.perPage).forEach((level, j) => {
      const i = first + j;
      const col = twoColumns ? Math.floor(j / ROWS) : 0;
      const x = twoColumns ? cx + (col === 0 ? -1 : 1) * (w / 2 + 12) : cx;
      const y = TOP + (j % ROWS) * STEP;
      const stars = this.stars[level.id] ? `  ${'★'.repeat(this.stars[level.id])}` : '';
      const label = `${i + 1}.  ${level.name}${level.published ? '' : '  (draft)'}${stars}`;
      this.makeButton(x, y, w, label, () => this.startLevel(level.id));
    });
    if (pages > 1) {
      const y = TOP + ROWS * STEP + 10;
      this.pageObjects.push(this.add.text(cx, y, `${this.page + 1} / ${pages}`, {
        fontFamily: FONT, fontSize: '18px', color: css(PALETTE.hudMuted),
      }).setOrigin(0.5));
      if (this.page > 0) this.makeArrow(cx - 90, y, '‹ Prev', () => this.showPage(this.page - 1));
      if (this.page < pages - 1) this.makeArrow(cx + 90, y, 'Next ›', () => this.showPage(this.page + 1));
    }
  }

  makeArrow(x, y, label, onClick) {
    const t = this.add.text(x, y, label, {
      fontFamily: FONT, fontSize: '20px', color: css(PALETTE.accent),
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    t.on('pointerup', (p) => { if (!isRightButton(p)) onClick(); });
    this.pageObjects.push(t);
  }

  makeButton(x, y, w, label, onClick) {
    const bg = this.add.rectangle(x, y, w, BUTTON_H, PALETTE.hudBar)
      .setStrokeStyle(2, PALETTE.towerRing)
      .setInteractive({ useHandCursor: true });
    const text = this.add.text(x, y, label, {
      fontFamily: `${FONT}, ${EMOJI_FONT}`, fontSize: '24px', color: css(PALETTE.hudText),
    }).setOrigin(0.5);
    if (text.width > w - 24) text.setScale((w - 24) / text.width);
    bg.on('pointerover', () => { bg.setFillStyle(PALETTE.path); text.setColor(css(PALETTE.accent)); });
    bg.on('pointerout', () => { bg.setFillStyle(PALETTE.hudBar); text.setColor(css(PALETTE.hudText)); });
    bg.on('pointerup', (p) => { if (!isRightButton(p)) onClick(); });
    this.pageObjects.push(bg, text);
    return bg;
  }

  startLevel(levelId) {
    this.scene.start('GameScene', { levelId });
  }
}
