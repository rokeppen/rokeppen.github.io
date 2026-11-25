// Small UI building blocks shared by the HUD, build menu, tower panel and end scene.
import { PALETTE, FONT, EMOJI_FONT, css } from '../theme.js';

export const UI_FONT = `${FONT}, ${EMOJI_FONT}`;

export function label(scene, x, y, text, { size = 18, color = PALETTE.hudText, bold = false, ...style } = {}) {
  return scene.add.text(x, y, text, {
    fontFamily: UI_FONT, fontSize: `${size}px`, color: css(color),
    fontStyle: bold ? 'bold' : 'normal', padding: { x: 1, y: 4 }, ...style,
  });
}

// True when a pointer event came from the right mouse button (Phaser sets `button` to the
// button pressed or released). Right-click means "cancel" in this game, never "press".
export function isRightButton(pointer) {
  return !!pointer && pointer.button === 2;
}

// A rectangle button. `enabled` is visual only: clicks still reach onClick, so the caller can
// explain with a toast why nothing happened.
export class Button {
  constructor(scene, x, y, w, h, text, onClick, { size = 18, depth = 10, fill = PALETTE.button } = {}) {
    this.scene = scene;
    this.fill = fill;
    this.enabled = true;
    this.hover = false;
    this.bg = scene.add.rectangle(x, y, w, h, fill)
      .setStrokeStyle(2, PALETTE.towerRing)
      .setDepth(depth)
      .setInteractive({ useHandCursor: true });
    this.text = label(scene, x, y, text, { size }).setOrigin(0.5).setDepth(depth);
    this.bg.on('pointerover', () => { this.hover = true; this.refresh(); });
    this.bg.on('pointerout', () => { this.hover = false; this.refresh(); });
    this.bg.on('pointerup', (pointer) => {
      if (!isRightButton(pointer)) onClick();
    });
  }

  setText(text) {
    if (this.text.text !== text) this.text.setText(text);
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
    this.bg.setFillStyle(lit ? PALETTE.buttonHover : this.fill);
    this.bg.setAlpha(this.enabled ? 1 : 0.45);
    this.text.setAlpha(this.enabled ? 1 : 0.5);
    this.text.setColor(css(lit ? PALETTE.accent : PALETTE.hudText));
  }

  destroy() {
    this.bg.destroy();
    this.text.destroy();
  }
}

// One toast at a time, centred near the top of the given area. Newer toasts replace older ones.
export function toast(scene, x, y, text, color = PALETTE.hudText) {
  if (scene.toastText) {
    scene.tweens.killTweensOf(scene.toastText);
    scene.toastText.destroy();
  }
  const t = label(scene, x, y, text, {
    size: 22, bold: true, color, stroke: css(PALETTE.hpBack), strokeThickness: 5,
  }).setOrigin(0.5).setDepth(20).setAlpha(0);
  scene.toastText = t;
  scene.tweens.add({ targets: t, alpha: 1, y: y + 8, duration: 140, ease: 'Back.easeOut' });
  scene.tweens.add({
    targets: t, alpha: 0, delay: 1400, duration: 400,
    onComplete: () => {
      if (scene.toastText === t) scene.toastText = null;
      t.destroy();
    },
  });
  return t;
}

// Friendly text for the `reason` codes GameState returns on failed actions.
const REASONS = {
  'no-corks': 'Not enough corks 🍾',
  'not-buildable': "Can't build there",
  'max-tier': 'Fully upgraded',
  'wave-running': 'Guests are still arriving!',
  'no-waves': 'That was the last wave',
  'used': 'The bell has already rung 🔔',
  'game-over': "The party's over",
  'not-in-level': 'Not on the menu tonight',
  'unknown': 'Nothing to do there',
};

export function reasonText(reason) {
  return REASONS[reason] ?? 'Not now';
}
