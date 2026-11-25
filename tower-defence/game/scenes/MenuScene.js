// Level select. Starts GameScene with { levelId }.
// Up to 5 levels: one column. More: two columns of 5 per page, with page arrows.
// Each card shows the best wave reached (or "cleared") from localStorage.
// A "how to play" overlay opens on the first launch and from the "?" button.
import { PALETTE, FONT, EMOJI_FONT, MENU_WIDTH, MENU_HEIGHT, css } from '../theme.js';
import { loadStars, loadBest, howToSeen, markHowToSeen } from '../progress.js';
import { isRightButton, label, Button } from '../ui/widgets.js';

const KEYS = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE'];
const ROWS = 5;
const TOP = 290;
const STEP = 68;
const BUTTON_H = 58;
const OVERLAY_DEPTH = 100;

const HOW_TO_PLAY = [
  ['🗺️', 'Place office weapons on the floor beside the carpet, never on it.'],
  ['🚶', 'Uninvited guests walk the carpet to the wine table and drink your wine.'],
  ['🍾', 'Every guest escorted out pays wine corks. Spend them on more weapons.'],
  ['⬆️', 'Click a placed weapon to upgrade it, or sell it for half its cost.'],
  ['🍷', 'Wine Tasting: one guest gets a glass and a lecture on tannins (distracted).'],
  ['🍕', 'Pizza Hut Delivery: free pizza stalls the whole crowd on the path.'],
  ['🔔', 'Nexios Victory Bell: ring it once per level to clear the room. Pays out too!'],
  ['📧', 'Out-of-Office, ☕ Coffee Machine (slows) and 🗣️ HR Talk (splash) do the rest.'],
];

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
    this.overlay = null;
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

    const kb = this.input.keyboard;
    if (kb) {
      this.levels.forEach((level, i) => {
        if (i < KEYS.length) kb.on(`keydown-${KEYS[i]}`, () => { if (!this.overlay) this.startLevel(level.id); });
      });
      kb.on('keydown-ESC', () => this.closeHowTo());
      kb.on('keydown-ENTER', () => this.closeHowTo());
    }
    this.showPage(0);

    const back = this.add.text(24, MENU_HEIGHT - 24, '← Back', {
      fontFamily: FONT, fontSize: '20px', color: css(PALETTE.hudMuted),
    }).setOrigin(0, 1).setInteractive({ useHandCursor: true });
    back.on('pointerover', () => back.setColor(css(PALETTE.hudText)));
    back.on('pointerout', () => back.setColor(css(PALETTE.hudMuted)));
    back.on('pointerup', (p) => { if (!isRightButton(p)) window.location.href = './'; });

    const help = new Button(this, MENU_WIDTH - 44, 44, 48, 48, '?', () => this.openHowTo(), { size: 26, depth: 1 });
    help.text.setFontStyle('bold');

    if (!howToSeen()) this.openHowTo();
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
    const w = twoColumns ? 400 : 480;
    const cx = MENU_WIDTH / 2;
    const first = this.page * this.perPage;
    this.levels.slice(first, first + this.perPage).forEach((level, j) => {
      const i = first + j;
      const col = twoColumns ? Math.floor(j / ROWS) : 0;
      const x = twoColumns ? cx + (col === 0 ? -1 : 1) * (w / 2 + 12) : cx;
      const y = TOP + (j % ROWS) * STEP;
      const stars = this.stars[level.id] ? `  ${'★'.repeat(this.stars[level.id])}` : '';
      const title = `${i + 1}.  ${level.name}${level.published ? '' : '  (draft)'}${stars}`;
      this.makeCard(x, y, w, title, this.bestText(level), () => this.startLevel(level.id));
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

  bestText(level) {
    const total = Array.isArray(level.waves) ? level.waves.length : 0;
    const best = loadBest(level.id);
    if (best && best.cleared) return `🏆 cleared · all ${total} waves`;
    if (best && best.wave > 0) return `Best: wave ${best.wave} of ${total}`;
    return `Not played yet · ${total} wave${total === 1 ? '' : 's'}`;
  }

  makeArrow(x, y, text, onClick) {
    const t = this.add.text(x, y, text, {
      fontFamily: FONT, fontSize: '20px', color: css(PALETTE.accent),
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    t.on('pointerup', (p) => { if (!isRightButton(p) && !this.overlay) onClick(); });
    this.pageObjects.push(t);
  }

  makeCard(x, y, w, title, subtitle, onClick) {
    const bg = this.add.rectangle(x, y, w, BUTTON_H, PALETTE.hudBar)
      .setStrokeStyle(2, PALETTE.towerRing)
      .setInteractive({ useHandCursor: true });
    const text = this.add.text(x, y - 10, title, {
      fontFamily: `${FONT}, ${EMOJI_FONT}`, fontSize: '22px', color: css(PALETTE.hudText),
    }).setOrigin(0.5);
    if (text.width > w - 24) text.setScale((w - 24) / text.width);
    const sub = this.add.text(x, y + 15, subtitle, {
      fontFamily: `${FONT}, ${EMOJI_FONT}`, fontSize: '14px', color: css(PALETTE.hudMuted),
    }).setOrigin(0.5);
    if (sub.width > w - 24) sub.setScale((w - 24) / sub.width);
    bg.on('pointerover', () => { bg.setFillStyle(PALETTE.path); text.setColor(css(PALETTE.accent)); });
    bg.on('pointerout', () => { bg.setFillStyle(PALETTE.hudBar); text.setColor(css(PALETTE.hudText)); });
    bg.on('pointerup', (p) => { if (!isRightButton(p) && !this.overlay) onClick(); });
    this.pageObjects.push(bg, text, sub);
    return bg;
  }

  openHowTo() {
    if (this.overlay) return;
    const objects = [];
    const cx = MENU_WIDTH / 2;
    const cy = MENU_HEIGHT / 2;
    const pw = 820;
    const ph = 560;
    // Full-screen interactive dim: swallows clicks meant for the cards underneath.
    const dim = this.add.rectangle(0, 0, MENU_WIDTH, MENU_HEIGHT, PALETTE.overlay, 0.8)
      .setOrigin(0).setDepth(OVERLAY_DEPTH).setInteractive();
    dim.on('pointerup', (p) => { if (!isRightButton(p)) this.closeHowTo(); });
    const panel = this.add.rectangle(cx, cy, pw, ph, PALETTE.hudBar)
      .setStrokeStyle(4, PALETTE.accent).setDepth(OVERLAY_DEPTH).setInteractive();
    objects.push(dim, panel);
    objects.push(label(this, cx, cy - ph / 2 + 40, 'How to play', {
      size: 32, bold: true, color: PALETTE.accent,
    }).setOrigin(0.5).setDepth(OVERLAY_DEPTH));
    objects.push(label(this, cx, cy - ph / 2 + 78, 'The Nexios Friday drinks are on. Not everyone was invited.', {
      size: 16, color: PALETTE.hudMuted,
    }).setOrigin(0.5).setDepth(OVERLAY_DEPTH));
    const left = cx - pw / 2 + 40;
    HOW_TO_PLAY.forEach(([icon, text], i) => {
      const y = cy - ph / 2 + 120 + i * 42;
      objects.push(label(this, left, y, icon, { size: 22 }).setOrigin(0, 0).setDepth(OVERLAY_DEPTH));
      const t = label(this, left + 44, y + 2, text, { size: 17 }).setOrigin(0, 0).setDepth(OVERLAY_DEPTH);
      if (t.width > pw - 100) t.setScale((pw - 100) / t.width);
      objects.push(t);
    });
    const ok = new Button(this, cx, cy + ph / 2 - 44, 240, 50, "Let's party 🥂", () => this.closeHowTo(), {
      size: 20, depth: OVERLAY_DEPTH,
    });
    objects.push(ok);
    this.overlay = objects;
  }

  closeHowTo() {
    if (!this.overlay || this.overlay.length === 0) return;
    markHowToSeen();
    for (const o of this.overlay) o.destroy();
    // Stay "open" (empty) until the next tick so the same click or key cannot also start a level.
    this.overlay = [];
    this.time.delayedCall(0, () => { this.overlay = null; });
  }

  startLevel(levelId) {
    this.scene.start('GameScene', { levelId });
  }
}
