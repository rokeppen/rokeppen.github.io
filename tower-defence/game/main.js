// Entry point. Phaser is loaded as a classic <script> before this module (global `Phaser`).
import { BootScene } from './scenes/BootScene.js';
import { MenuScene } from './scenes/MenuScene.js';
import { GameScene } from './scenes/GameScene.js';
import { EndScene } from './scenes/EndScene.js';
import { createSound } from './sound.js';
import { PALETTE, MENU_WIDTH, MENU_HEIGHT, css } from './theme.js';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: css(PALETTE.background),
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: MENU_WIDTH,
    height: MENU_HEIGHT,
  },
  // All sound is synthesised by ./sound.js; Phaser's own audio would open a second AudioContext.
  audio: { noAudio: true },
  scene: [BootScene, MenuScene, GameScene, EndScene],
});

// Shared by every scene; outlives level restarts.
game.registry.set('sfx', createSound());
