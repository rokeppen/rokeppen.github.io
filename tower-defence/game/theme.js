// Single source of colours and sizes for the game. No Phaser, no DOM: Node can import it.
// Colours are numbers (0xRRGGBB) for Phaser Graphics; use css() for Text styles.

export const TILE = 64;

// Height of the strip above the board reserved for the HUD (Task 6).
export const HUD_HEIGHT = 64;

// Canvas size outside a level (boot + menu). GameScene resizes to fit its level.
export const MENU_WIDTH = 1024;
export const MENU_HEIGHT = 704;

export const PALETTE = {
  // Page / canvas
  background: 0x2b1d16,      // dark walnut, around the board
  // Office floor: light oak planks, two shades for a checker
  floor: 0xd9b48a,
  floorAlt: 0xcfa87c,
  gridLine: 0xb88f64,
  // Path: burgundy carpet runner, strongly contrasting with the oak floor
  path: 0x8e2b3a,
  pathEdge: 0x5e1724,
  // Blocked tiles: desks, cabinets, plants
  blocked: 0x5a4636,
  blockedEdge: 0x3b2c21,
  // Placement hover
  buildableHover: 0x7bd389,
  invalidHover: 0xe05a47,
  range: 0xfff3c4,
  // Wine table at the end of the path, door at the start
  table: 0x6b3f22,
  tableTop: 0x9a6236,
  tablecloth: 0xf4ead5,
  door: 0x3f6e8c,
  // Towers
  towerBase: 0xfff6e5,
  towerRing: 0xc9932e,
  tierPip: 0xf2c14e,
  // Enemies
  enemyShadow: 0x000000,
  hpBack: 0x2b1d16,
  hpHigh: 0x5cc46b,
  hpMid: 0xf2c14e,
  hpLow: 0xe05a47,
  // Effects
  shot: 0xfff3c4,
  // HUD
  hudBar: 0x3b2a20,
  hudText: 0xfdf6e3,
  hudMuted: 0xcbb89d,
  accent: 0xf2c14e,          // champagne gold
  danger: 0xe05a47,
};

export const FONT = '"Segoe UI", system-ui, sans-serif';
export const EMOJI_FONT = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';

// 0xRRGGBB -> '#rrggbb' for Phaser Text styles and CSS.
export function css(color) {
  return `#${color.toString(16).padStart(6, '0')}`;
}
