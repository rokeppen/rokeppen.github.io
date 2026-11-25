// Single source of colours and sizes for the game. No Phaser, no DOM: Node can import it.
// Colours are numbers (0xRRGGBB) for Phaser Graphics; use css()/rgba() for Text styles and canvas.
// Look: "style C, flat 2D" (pastel, soft chunky depth, white cards), see the approved mockup.
// Naming: internal state keeps `corks` (= bottle caps 🧢, the currency) and `wine` (= kegs 🍺,
// the lives); only player-facing text says caps, kegs and beer bar.

export const TILE = 64;

// Height of the strip above the board reserved for the HUD cards and buttons.
export const HUD_HEIGHT = 64;

// Width of the side panel right of the board (build menu + tower panel).
export const SIDE_WIDTH = 256;

// Room around the board for its cream frame (padding) and the chunky bottom edge below it.
export const BOARD_PAD = 10;
export const BOARD_EDGE = 10;

// Smallest in-level canvas: keeps the HUD readable and the side panel tall enough for
// the build menu plus the tower panel. Small boards are centred inside it.
export const MIN_GAME_WIDTH = 1280;
export const MIN_GAME_HEIGHT = 720;

// Canvas size outside a level (boot + menu). GameScene resizes to fit its level.
export const MENU_WIDTH = 1024;
export const MENU_HEIGHT = 704;

export const PALETTE = {
  // Page / canvas: light sky gradient behind everything
  background: 0xdcecf9,
  backgroundTop: 0xe6f3ff,
  backgroundBottom: 0xcfe6f7,
  // Board: cream frame with a darker chunky edge, soft floor tiles
  board: 0xf7f1e8,
  boardEdge: 0xddcfb8,
  floor: 0xfbf7f0,
  // Path: coral carpet with an inset bottom edge. A touch deeper than the mockup's #ec7b7b
  // so it reaches 3:1 against the floor tiles (readability check).
  path: 0xe06262,
  pathEdge: 0xb94a4a,
  // Furniture: raised slate-blue blocks (the mockup's edge tone as the face, for 3:1).
  blocked: 0x7590ac,
  blockedEdge: 0x58718c,
  // Thin outline around white pieces (towers, guests, bar, door) so they read on the floor.
  pieceOutline: 0x6b8299,
  // Towers: white -> pale blue rounded blocks, green tier dots
  towerTop: 0xffffff,
  towerBottom: 0xeef3f8,
  towerEdge: 0xb9c8d8,
  tierPip: 0x2bb673,
  tierPipEdge: 0x1a8a55,
  // Guests: white round pieces with a slim HP bar
  guest: 0xffffff,
  guestEdge: 0xc9d6e3,
  hpBack: 0xdbe4ee,
  hpHigh: 0x2bb673,
  hpMid: 0xf2b33d,
  hpLow: 0xe0524f,
  // Beer bar (end of the path) and door (start)
  bar: 0xffe3a3,
  barEdge: 0xe0b65c,
  door: 0xd6e6f5,
  doorEdge: 0x9fb6cc,
  // Placing
  buildableHover: 0xc9f2d9,
  invalidHover: 0xf6c3c3,
  range: 0x2bb673,
  invalidRange: 0xe0524f,
  // Effects
  shot: 0xf2a93b,            // amber beer streak
  lure: 0xff9f43,            // pizza orange
  splash: 0xd77fb5,          // HR pink
  shadow: 0x28466e,          // soft drop shadows (used with low alpha)
  // Text and UI
  text: 0x23384d,
  muted: 0x6b8299,
  good: 0x2bb673,
  goodText: 0x1a7f4f,        // green that stays readable as text on white
  danger: 0xc93c3c,
  capsText: 0xb8860b,        // "+N 🧢" floats
  card: 0xffffff,
  iconTile: 0xeef3f8,
  iconTileEdge: 0xc9d6e3,
  navy: 0x23384d,
  navyEdge: 0x0f1e2c,
  navyHover: 0x2f4a66,
  gold: 0xffd66b,
  goldEdge: 0xd9a520,
  goldHover: 0xffe08f,
  goldText: 0x5a3d00,
  ghost: 0xffffff,
  ghostEdge: 0xc9d6e3,
  ghostHover: 0xf3f7fb,
  white: 0xffffff,
  overlay: 0x23384d,
};

export const FONT = '"Segoe UI", system-ui, sans-serif';
export const EMOJI_FONT = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';

// 0xRRGGBB -> '#rrggbb' for Phaser Text styles and CSS.
export function css(color) {
  return `#${color.toString(16).padStart(6, '0')}`;
}

// 0xRRGGBB + alpha -> 'rgba(r,g,b,a)' for canvas drawing.
export function rgba(color, alpha = 1) {
  const [r, g, b] = rgb(color);
  return `rgba(${r},${g},${b},${alpha})`;
}

// 0xRRGGBB -> [r, g, b] (e.g. for camera.flash).
export function rgb(color) {
  return [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];
}

// WCAG contrast ratio between two 0xRRGGBB colours (used for the readability report/tests).
export function contrast(a, b) {
  const lum = (c) => {
    const [r, g, bl] = rgb(c).map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const x = lum(a);
  const y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
