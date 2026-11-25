// Loads GameData into the registry, then starts the menu (or a level directly).
// Data comes from Supabase, falling back to the bundled fallback-data.json.
// URL params: ?level=<id> skips the menu; ?preview=1 includes unpublished levels.
import { supabase } from '../../supabase.js';
import { createDataSource } from '../../shared/data.js';
import { PALETTE, FONT, MENU_WIDTH, MENU_HEIGHT, css } from '../theme.js';

export const LOAD_ERROR = "The party is cancelled: couldn't load levels. Try reloading.";

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

    const source = createDataSource({
      client: supabase,
      fetchFallback: () => fetch('fallback-data.json').then((r) => {
        if (!r.ok) throw new Error(`fallback-data.json: HTTP ${r.status}`);
        return r.json();
      }),
    });

    source.loadGameData({ includeUnpublished: preview })
      .then((data) => {
        console.info(`Game data loaded from ${data.source}.`);
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
        message.setText(LOAD_ERROR).setFontSize(24)
          .setWordWrapWidth(MENU_WIDTH - 80).setAlign('center').setColor(css(PALETTE.danger));
      });
  }
}
