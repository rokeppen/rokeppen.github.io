// Loads GameData into the registry, then starts the menu (or a level directly).
// Data comes from Supabase, falling back to the bundled fallback-data.json.
// URL params: ?level=<id> skips the menu; ?preview=1 includes unpublished levels.
import { createDataSource } from '../../shared/data.js';
import { preloadImages } from '../sprites.js';
import { PALETTE, FONT, MENU_WIDTH, MENU_HEIGHT, css } from '../theme.js';

export const LOAD_ERROR = "The party is cancelled: couldn't load levels. Try reloading.";

// supabase.js imports the client from a CDN. It is imported dynamically so a blocked or broken
// CDN only costs the database, not the whole game: the data layer then uses the fallback.
// A CDN that hangs instead of failing is cut off after IMPORT_TIMEOUT_MS.
const IMPORT_TIMEOUT_MS = 5000;

async function loadSupabaseClient() {
  let timer;
  try {
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`import timed out after ${IMPORT_TIMEOUT_MS} ms`)), IMPORT_TIMEOUT_MS);
    });
    return (await Promise.race([import('../../supabase.js'), timeout])).supabase;
  } catch (e) {
    console.warn('Supabase client unavailable, using fallback data:', e);
    const fail = () => Promise.reject(new Error('Supabase client unavailable'));
    return { from: () => ({ select: fail, upsert: fail, delete: fail }) };
  } finally {
    clearTimeout(timer);
  }
}

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

    const fetchFallback = () => fetch('fallback-data.json').then((r) => {
      if (!r.ok) throw new Error(`fallback-data.json: HTTP ${r.status}`);
      return r.json();
    });

    loadSupabaseClient()
      .then((client) => createDataSource({ client, fetchFallback })
        .loadGameData({ includeUnpublished: preview }))
      .then(async (data) => {
        console.info(`Game data loaded from ${data.source}.`);
        await preloadImages(this, data);
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
