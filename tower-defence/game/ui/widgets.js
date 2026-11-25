// Small UI building blocks shared by the HUD, build menu, tower panel, menu and end scene.
import { PALETTE, FONT, EMOJI_FONT, css } from '../theme.js';
import { makeSprite } from '../sprites.js';
import { isImageSprite } from '../sprites-data.js';
import { addCard, setCardStyle, snap, CARD_PAD } from './textures.js';

export const UI_FONT = `${FONT}, ${EMOJI_FONT}`;

export function label(scene, x, y, text, { size = 18, color = PALETTE.text, bold = false, ...style } = {}) {
  return scene.add.text(x, y, text, {
    fontFamily: UI_FONT, fontSize: `${size}px`, color: css(color),
    fontStyle: bold ? 'bold' : 'normal', padding: { x: 1, y: 4 }, ...style,
  });
}

// A weapon / guest / bar icon: image sprite or emoji fallback (see ../sprites.js), centred.
// Emoji get a little padding so tall glyphs aren't clipped.
export function icon(scene, x, y, sprite, fallback, size) {
  const o = makeSprite(scene, x, y, sprite, fallback, size);
  if (typeof o.setPadding === 'function') o.setPadding(2, 6);
  return o;
}

// The beer bar icon. Levels only store `barSprite`: an emoji is its own fallback, an image
// URL falls back to 🍻 (makeSprite prefers an emoji fallback, so passing 🍻 for an emoji
// barSprite would hide it).
export function barIcon(scene, x, y, barSprite, size) {
  const fallback = isImageSprite(barSprite) ? '🍻' : (barSprite || '🍻');
  return icon(scene, x, y, barSprite || '🍻', fallback, size);
}

// True when a pointer event came from the right mouse button (Phaser sets `button` to the
// button pressed or released). Right-click means "cancel" in this game, never "press".
export function isRightButton(pointer) {
  return !!pointer && pointer.button === 2;
}

const BUTTON_TEXT = {
  primary: PALETTE.white,
  gold: PALETTE.goldText,
  ghost: PALETTE.text,
};

// A chunky rounded button (variant: primary = navy, gold, ghost = white). `enabled` is
// visual only: clicks still reach onClick, so the caller can explain with a toast why
// nothing happened.
export class Button {
  constructor(scene, x, y, w, h, text, onClick, { size = 18, depth = 10, variant = 'ghost' } = {}) {
    this.scene = scene;
    this.variant = BUTTON_TEXT[variant] !== undefined ? variant : 'ghost';
    this.w = Math.round(w);
    this.h = Math.round(h);
    this.y = y;
    this.enabled = true;
    this.hover = false;
    this.bg = addCard(scene, x, y, this.w, this.h, this.variant).setDepth(depth);
    // Only the face and its edge are clickable, not the shadow padding around them.
    this.bg.setInteractive({
      hitArea: new Phaser.Geom.Rectangle(CARD_PAD, CARD_PAD, this.w, this.h + 4),
      hitAreaCallback: Phaser.Geom.Rectangle.Contains,
      useHandCursor: true,
    });
    this.text = label(scene, x, y, text, { size, bold: true, color: BUTTON_TEXT[this.variant] })
      .setOrigin(0.5).setDepth(depth);
    this.fitText();
    this.bg.on('pointerover', () => { this.hover = true; this.refresh(); });
    this.bg.on('pointerout', () => { this.hover = false; this.refresh(); });
    this.bg.on('pointerup', (pointer) => {
      if (!isRightButton(pointer)) onClick();
    });
  }

  fitText() {
    const room = this.w - 12;
    this.text.setScale(1);
    if (this.text.width > room) this.text.setScale(room / this.text.width);
  }

  setText(text) {
    if (this.text.text !== text) {
      this.text.setText(text);
      this.fitText();
    }
    return this;
  }

  setEnabled(enabled) {
    if (this.enabled !== enabled) {
      this.enabled = enabled;
      this.refresh();
    }
    return this;
  }

  refresh() {
    const lit = this.hover && this.enabled;
    setCardStyle(this.bg, lit ? `${this.variant}Hover` : this.variant, this.w, this.h);
    const lift = lit ? -1 : 0;
    this.bg.y = this.y + lift;
    this.text.y = this.y + lift;
    this.bg.setAlpha(this.enabled ? 1 : 0.45);
    this.text.setAlpha(this.enabled ? 1 : 0.55);
  }

  destroy() {
    this.bg.destroy();
    this.text.destroy();
  }
}

// One toast at a time: a small white card with the text, centred near the top of the given
// area. Newer toasts replace older ones.
export function toast(scene, x, y, text, color = PALETTE.text) {
  if (scene.toastObj) {
    scene.tweens.killTweensOf(scene.toastObj);
    scene.toastObj.destroy();
  }
  const t = label(scene, 0, 0, text, { size: 18, bold: true, color }).setOrigin(0.5);
  const bg = addCard(scene, 0, 0, snap(t.width + 32), 40, 'card');
  const c = scene.add.container(x, y, [bg, t]).setDepth(20).setAlpha(0);
  scene.toastObj = c;
  scene.tweens.add({ targets: c, alpha: 1, y: y + 8, duration: 140, ease: 'Back.easeOut' });
  scene.tweens.add({
    targets: c, alpha: 0, delay: 1400, duration: 400,
    onComplete: () => {
      if (scene.toastObj === c) scene.toastObj = null;
      c.destroy();
    },
  });
  return c;
}

// Friendly text for the `reason` codes GameState returns on failed actions
// ('guests-moving' is the scene's own: input during the guests' turn playback).
const REASONS = {
  'not-buildable': "Can't build there",
  'max-tier': 'Fully upgraded',
  'card-played': 'You already played a card this turn',
  'no-target': 'Pick a valid target for this card',
  'wrong-weapon': 'That card is for another weapon',
  'unknown-card': 'That card is gone',
  'no-tile': 'No free floor left to build on',
  'no-tower': 'You have none of that weapon to upgrade',
  'no-towers': 'No weapons on the floor to sell',
  'no-guests': 'No guests to ring out yet',
  'guests-moving': 'Guests are moving…',
  'game-over': "The party's over",
  'not-in-level': 'Not on the menu tonight',
  'unknown': 'Nothing to do there',
};

export function reasonText(reason) {
  return REASONS[reason] ?? 'Not now';
}
