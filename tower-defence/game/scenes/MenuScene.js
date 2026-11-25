// Level select. Starts GameScene with { levelId }.
// Up to 5 levels: one column. More: two columns of 5 per page, with page arrows.
// Each card shows the level's beer bar icon and the best wave reached (or "cleared") from
// localStorage. A "how to play" overlay opens on the first launch and from the "?" button.
import { PALETTE, FONT, EMOJI_FONT, MENU_WIDTH, MENU_HEIGHT, css } from '../theme.js';
import { loadStars, loadBest, howToSeen, markHowToSeen } from '../progress.js';
import { isRightButton, label, icon, Button } from '../ui/widgets.js';
import { addBackground, addCard, CARD_PAD } from '../ui/textures.js';

const KEYS = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE'];
const ROWS = 5;
const TOP = 272;
const STEP = 70;
const BUTTON_H = 56;
const OVERLAY_DEPTH = 100;

// [icon, text]; an icon may be { weapon | enemy: id, fallback } to use that item's sprite.
const HOW_TO_PLAY = [
  ['🗺️', 'Place office weapons on the floor beside the carpet, never on it.'],
  ['🚶', 'Uninvited guests walk the carpet to the beer bar 🍻 and drain your kegs 🍺.'],
  ['🧢', 'Every guest escorted out pays bottle caps. Spend them on more weapons.'],
  ['⬆️', 'Click a placed weapon to upgrade it, or sell it for half its cost.'],
  [{ weapon: 'cafe', fallback: '🍻' }, 'Café: a cosy pub corner no guest can resist. Distracts one guest at a time.'],
  [{ enemy: 'wine-snob', fallback: '🍷' }, "Wine Snob: too posh for the Café, it's immune to it. Stop them another way."],
  [{ weapon: 'pizza-hut', fallback: '🍕' }, 'Pizza Hut Delivery: free pizza lures the whole crowd and stalls them.'],
  ['🔔', 'Nexios Victory Bell: ring it once per level to clear the room. Pays caps too!'],
  [{ weapon: 'out-of-office', fallback: '📧' }, 'Out-of-Office, Coffee Machine (slows) and HR Talk (splash) do the rest.'],
];

export class MenuScene extends Phaser.Scene {
  constructor() {
    super('MenuScene');
  }

  create() {
    this.scale.setGameSize(MENU_WIDTH, MENU_HEIGHT);
    const data = this.registry.get('data');
    this.data_ = data;
    this.levels = data.levels;
    this.stars = loadStars();
    this.page = 0;
    this.pageObjects = [];
    this.overlay = null;
    const cx = MENU_WIDTH / 2;

    addBackground(this, MENU_WIDTH, MENU_HEIGHT);
    this.add.text(cx, 84, '🍻', { fontFamily: EMOJI_FONT, fontSize: '68px', padding: { x: 4, y: 10 } }).setOrigin(0.5);
    this.add.text(cx, 160, 'Friday Afternoon Drinks', {
      fontFamily: FONT, fontSize: '44px', fontStyle: 'bold', color: css(PALETTE.text),
    }).setOrigin(0.5);
    this.add.text(cx, 206, 'Keep the uninvited guests away from the beer bar.', {
      fontFamily: FONT, fontSize: '19px', color: css(PALETTE.muted),
    }).setOrigin(0.5);

    if (this.levels.length === 0) {
      this.add.text(cx, 340, 'No levels on the menu tonight.', {
        fontFamily: FONT, fontSize: '24px', color: css(PALETTE.text),
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
      fontFamily: FONT, fontSize: '19px', fontStyle: 'bold', color: css(PALETTE.muted),
    }).setOrigin(0, 1).setInteractive({ useHandCursor: true });
    back.on('pointerover', () => back.setColor(css(PALETTE.text)));
    back.on('pointerout', () => back.setColor(css(PALETTE.muted)));
    back.on('pointerup', (p) => { if (!isRightButton(p)) window.location.href = './'; });

    const help = new Button(this, MENU_WIDTH - 44, 42, 46, 44, '?', () => this.openHowTo(), { size: 24, depth: 1 });
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
    const w = twoColumns ? 420 : 500;
    const cx = MENU_WIDTH / 2;
    const first = this.page * this.perPage;
    this.levels.slice(first, first + this.perPage).forEach((level, j) => {
      const i = first + j;
      const col = twoColumns ? Math.floor(j / ROWS) : 0;
      const x = twoColumns ? cx + (col === 0 ? -1 : 1) * (w / 2 + 12) : cx;
      const y = TOP + (j % ROWS) * STEP;
      const stars = this.stars[level.id] ? `  ${'★'.repeat(this.stars[level.id])}` : '';
      const title = `${i + 1}.  ${level.name}${level.published ? '' : '  (draft)'}${stars}`;
      this.makeCard(x, y, w, level, title, this.bestText(level), () => this.startLevel(level.id));
    });
    if (pages > 1) {
      const y = TOP + ROWS * STEP + 4;
      this.pageObjects.push(this.add.text(cx, y, `${this.page + 1} / ${pages}`, {
        fontFamily: FONT, fontSize: '18px', color: css(PALETTE.muted),
      }).setOrigin(0.5));
      if (this.page > 0) this.makeArrow(cx - 100, y, '‹ Prev', () => this.showPage(this.page - 1));
      if (this.page < pages - 1) this.makeArrow(cx + 100, y, 'Next ›', () => this.showPage(this.page + 1));
    }
  }

  bestText(level) {
    const total = Array.isArray(level.waves) ? level.waves.length : 0;
    const best = loadBest(level.id);
    if (best && best.cleared) return `🏆 Bar defended · all ${total} waves`;
    if (best && best.wave > 0) return `Best: held the bar to wave ${best.wave} of ${total}`;
    return `Not played yet · ${total} wave${total === 1 ? '' : 's'}`;
  }

  makeArrow(x, y, text, onClick) {
    const b = new Button(this, x, y, 104, 36, text, () => { if (!this.overlay) onClick(); }, { size: 16, depth: 1 });
    this.pageObjects.push(b);
  }

  makeCard(x, y, w, level, title, subtitle, onClick) {
    const bg = addCard(this, x, y, w, BUTTON_H, 'card').setInteractive({
      hitArea: new Phaser.Geom.Rectangle(CARD_PAD, CARD_PAD, w, BUTTON_H),
      hitAreaCallback: Phaser.Geom.Rectangle.Contains,
      useHandCursor: true,
    });
    const outline = addCard(this, x, y, w, BUTTON_H, 'select').setVisible(false);
    const left = x - w / 2;
    const tile = addCard(this, left + 32, y, 38, 38, 'icon');
    const bar = icon(this, left + 32, y, level.barSprite, '🍻', 24);
    const text = this.add.text(left + 62, y - 10, title, {
      fontFamily: `${FONT}, ${EMOJI_FONT}`, fontSize: '19px', fontStyle: 'bold', color: css(PALETTE.text),
      padding: { x: 1, y: 3 },
    }).setOrigin(0, 0.5);
    if (text.width > w - 80) text.setScale((w - 80) / text.width);
    const sub = this.add.text(left + 62, y + 13, subtitle, {
      fontFamily: `${FONT}, ${EMOJI_FONT}`, fontSize: '13px', color: css(PALETTE.muted),
      padding: { x: 1, y: 3 },
    }).setOrigin(0, 0.5);
    if (sub.width > w - 80) sub.setScale((w - 80) / sub.width);
    const parts = [bg, outline, tile, bar, text, sub];
    for (const o of parts) o.baseY = o.y;
    const lift = (dy) => { for (const o of parts) o.y = o.baseY + dy; };
    bg.on('pointerover', () => { outline.setVisible(true); lift(-2); });
    bg.on('pointerout', () => { outline.setVisible(false); lift(0); });
    bg.on('pointerup', (p) => { if (!isRightButton(p) && !this.overlay) onClick(); });
    this.pageObjects.push(...parts);
    return bg;
  }

  // Resolves a how-to icon: a plain emoji, or an item from the loaded data (image or emoji).
  howToIcon(spec, x, y) {
    if (typeof spec === 'string') return label(this, x, y, spec, { size: 22 }).setOrigin(0.5);
    const data = this.data_ ?? {};
    const item = spec.weapon
      ? (data.weapons ?? []).find((w) => w.id === spec.weapon)
      : (data.enemies ?? []).find((e) => e.id === spec.enemy);
    return icon(this, x, y, item?.sprite ?? spec.fallback, item?.fallbackSprite || spec.fallback, 22);
  }

  openHowTo() {
    if (this.overlay) return;
    const objects = [];
    const cx = MENU_WIDTH / 2;
    const cy = MENU_HEIGHT / 2;
    const pw = 840;
    const ph = 590;
    // Full-screen interactive dim: swallows clicks meant for the cards underneath.
    const dim = this.add.rectangle(0, 0, MENU_WIDTH, MENU_HEIGHT, PALETTE.overlay, 0.45)
      .setOrigin(0).setDepth(OVERLAY_DEPTH).setInteractive();
    dim.on('pointerup', (p) => { if (!isRightButton(p)) this.closeHowTo(); });
    const panel = addCard(this, cx, cy, pw, ph, 'card').setDepth(OVERLAY_DEPTH).setInteractive({
      hitArea: new Phaser.Geom.Rectangle(CARD_PAD, CARD_PAD, pw, ph),
      hitAreaCallback: Phaser.Geom.Rectangle.Contains,
    });
    objects.push(dim, panel);
    objects.push(label(this, cx, cy - ph / 2 + 38, 'How to play', {
      size: 30, bold: true,
    }).setOrigin(0.5).setDepth(OVERLAY_DEPTH));
    objects.push(label(this, cx, cy - ph / 2 + 74, 'The Nexios Friday beers are on. Not everyone was invited.', {
      size: 16, color: PALETTE.muted,
    }).setOrigin(0.5).setDepth(OVERLAY_DEPTH));
    const left = cx - pw / 2 + 36;
    HOW_TO_PLAY.forEach(([spec, text], i) => {
      const y = cy - ph / 2 + 128 + i * 44;
      objects.push(addCard(this, left + 18, y, 36, 36, 'icon').setDepth(OVERLAY_DEPTH));
      objects.push(this.howToIcon(spec, left + 18, y).setDepth(OVERLAY_DEPTH));
      const t = label(this, left + 50, y, text, { size: 16 }).setOrigin(0, 0.5).setDepth(OVERLAY_DEPTH);
      if (t.width > pw - 110) t.setScale((pw - 110) / t.width);
      objects.push(t);
    });
    const ok = new Button(this, cx, cy + ph / 2 - 40, 240, 46, "Let's party 🍻", () => this.closeHowTo(), {
      size: 19, depth: OVERLAY_DEPTH, variant: 'primary',
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
