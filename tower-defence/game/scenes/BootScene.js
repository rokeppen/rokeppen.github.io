// Loads GameData into the registry, then starts the menu (or a level directly).
// URL params: ?level=<id> skips the menu; ?preview=1 includes unpublished levels.
import { prepareGameData } from '../../shared/model.js';
import { PALETTE, FONT, MENU_WIDTH, MENU_HEIGHT, css } from '../theme.js';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  create() {
    const params = new URLSearchParams(window.location.search);
    const preview = params.get('preview') === '1';
    const levelId = params.get('level');

    const message = this.add.text(MENU_WIDTH / 2, MENU_HEIGHT / 2, 'Uncorking…', {
      fontFamily: FONT, fontSize: '32px', color: css(PALETTE.hudText),
    }).setOrigin(0.5);

    this.loadData({ preview })
      .then((data) => {
        this.registry.set('data', data);
        this.registry.set('preview', preview);
        if (levelId && data.levels.some((l) => l.id === levelId)) {
          this.scene.start('GameScene', { levelId });
        } else {
          if (levelId) console.warn(`Unknown level "${levelId}", showing the menu instead.`);
          this.scene.start('MenuScene');
        }
      })
      .catch((err) => {
        console.error(err);
        message.setText('The wine cellar is locked.\nCould not load the game data.')
          .setAlign('center').setColor(css(PALETTE.danger));
      });
  }

  // Task 7 swaps this for the Supabase data layer (with fallback).
  async loadData({ preview }) {
    const res = await fetch('fallback-data.json');
    if (!res.ok) throw new Error(`fallback-data.json: HTTP ${res.status}`);
    const raw = await res.json();
    return { ...prepareGameData(raw, { includeUnpublished: preview }), source: 'fallback' };
  }
}
