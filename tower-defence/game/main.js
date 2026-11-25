// Entry point. Phaser is loaded as a classic <script> before this module (global `Phaser`).
import { BootScene } from './scenes/BootScene.js';
import { MenuScene } from './scenes/MenuScene.js';
import { GameScene } from './scenes/GameScene.js';
import { PALETTE, MENU_WIDTH, MENU_HEIGHT, css } from './theme.js';

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: css(PALETTE.background),
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: MENU_WIDTH,
    height: MENU_HEIGHT,
  },
  scene: [BootScene, MenuScene, GameScene],
});
