// Bakes the rounded, shadowed shapes of the pastel look into canvas textures, once.
// Tiles, pieces, cards and buttons are then plain Images: nothing is re-tessellated per frame.
// Textures live in the game-wide texture manager, so a key that exists is reused as is
// (every shape is fully determined by its key).
import { PALETTE, TILE, rgba, css } from '../theme.js';

// Space around a baked shape for its soft shadow.
const PAD = 14;

// Raised pieces standing on the floor. `ox, oy` is the face centre inside the texture,
// `lift` how far the face sits above the tile centre.
export const PIECES = {
  tower: { key: 'td-tower', w: 50, h: 50, r: 13, depth: 6, lift: 4 },
  guest: { key: 'td-guest', w: 38, h: 38, r: 19, depth: 5, lift: 2, round: true },
  bar: { key: 'td-bar', w: 54, h: 54, r: 13, depth: 6, lift: 4 },
  door: { key: 'td-door', w: 46, h: 52, r: 10, depth: 5, lift: 3 },
  block: { key: 'td-block', w: 56, h: 56, r: 9, depth: 5, lift: 4 },
};
export const TEX = {
  floor: 'td-floor',
  path: 'td-path',
  pip: 'td-pip',
  hpBack: 'td-hp-back',
  hpHigh: 'td-hp-high',
  hpMid: 'td-hp-mid',
  hpLow: 'td-hp-low',
};
export const HP_W = 36;
export const HP_H = 5;

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// A circle of radius r whose bottom half is pushed down by `depth`: the face plus its edge.
function capsule(ctx, cx, cy, r, depth) {
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI, 0);
  ctx.lineTo(cx + r, cy + depth);
  ctx.arc(cx, cy + depth, r, 0, Math.PI);
  ctx.closePath();
}

// Creates a canvas texture `key` of w x h and lets `draw(ctx)` paint it. No-op if it exists.
export function bake(scene, key, w, h, draw) {
  if (scene.textures.exists(key)) return key;
  const tex = scene.textures.createCanvas(key, Math.ceil(w), Math.ceil(h));
  if (!tex) return key;
  const ctx = tex.getContext();
  draw(ctx);
  tex.refresh();
  return key;
}

function withShadow(ctx, alpha, blur, offsetY, fn) {
  ctx.save();
  ctx.shadowColor = rgba(PALETTE.shadow, alpha);
  ctx.shadowBlur = blur;
  ctx.shadowOffsetY = offsetY;
  fn();
  ctx.restore();
}

// --- pieces ---

const PIECE_STYLE = {
  tower: { face: PALETTE.towerTop, faceBottom: PALETTE.towerBottom, edge: PALETTE.towerEdge },
  guest: { face: PALETTE.guest, faceBottom: PALETTE.guest, edge: PALETTE.guestEdge },
  bar: { face: PALETTE.bar, faceBottom: PALETTE.bar, edge: PALETTE.barEdge },
  door: { face: PALETTE.door, faceBottom: PALETTE.door, edge: PALETTE.doorEdge },
  block: { face: PALETTE.blocked, faceBottom: PALETTE.blocked, edge: PALETTE.blockedEdge, noOutline: true },
};

function pieceSize(p) {
  return { tw: p.w + PAD * 2, th: p.h + p.depth + PAD * 2 + 4 };
}

function bakePiece(scene, name) {
  const p = PIECES[name];
  const s = PIECE_STYLE[name];
  const { tw, th } = pieceSize(p);
  bake(scene, p.key, tw, th, (ctx) => {
    const x = PAD;
    const y = PAD;
    const outline = () => {
      if (p.round) capsule(ctx, x + p.r, y + p.r, p.r, p.depth);
      else roundRect(ctx, x, y, p.w, p.h + p.depth, p.r);
    };
    // Edge (face pushed down) with the soft drop shadow under it.
    withShadow(ctx, 0.28, 10, 5, () => {
      ctx.fillStyle = css(s.edge);
      outline();
      ctx.fill();
    });
    // Face: top-to-bottom gradient.
    const grad = ctx.createLinearGradient(0, y, 0, y + p.h);
    grad.addColorStop(0, css(s.face));
    grad.addColorStop(1, css(s.faceBottom));
    ctx.fillStyle = grad;
    if (p.round) {
      ctx.beginPath();
      ctx.arc(x + p.r, y + p.r, p.r, 0, Math.PI * 2);
    } else {
      roundRect(ctx, x, y, p.w, p.h, p.r);
    }
    ctx.fill();
    if (!s.noOutline) {
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = css(PALETTE.pieceOutline);
      outline();
      ctx.stroke();
    }
  });
}

// Adds a raised piece image whose face is centred at (x, y - lift).
export function addPiece(scene, name, x, y) {
  const p = PIECES[name];
  const { tw, th } = pieceSize(p);
  bakePiece(scene, name);
  return scene.add.image(x, y - p.lift, p.key).setOrigin((PAD + p.w / 2) / tw, (PAD + p.h / 2) / th);
}

// --- board ---

export function bakeBoardTextures(scene) {
  for (const name of Object.keys(PIECES)) bakePiece(scene, name);
  bake(scene, TEX.floor, TILE, TILE, (ctx) => {
    ctx.fillStyle = css(PALETTE.floor);
    roundRect(ctx, 2, 2, TILE - 4, TILE - 4, 7);
    ctx.fill();
  });
  bake(scene, TEX.path, TILE, TILE, (ctx) => {
    // Coral carpet tile with an inset darker bottom edge (clipped to the rounded tile).
    roundRect(ctx, 2, 2, TILE - 4, TILE - 4, 7);
    ctx.save();
    ctx.clip();
    ctx.fillStyle = css(PALETTE.pathEdge);
    ctx.fillRect(0, 0, TILE, TILE);
    ctx.fillStyle = css(PALETTE.path);
    ctx.fillRect(0, 0, TILE, TILE - 7);
    ctx.restore();
  });
  bake(scene, TEX.pip, 10, 11, (ctx) => {
    ctx.fillStyle = css(PALETTE.tierPipEdge);
    ctx.beginPath();
    ctx.arc(5, 6, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = css(PALETTE.tierPip);
    ctx.beginPath();
    ctx.arc(5, 5, 4, 0, Math.PI * 2);
    ctx.fill();
  });
  const bar = (key, color) => bake(scene, key, HP_W + 2, HP_H + 2, (ctx) => {
    ctx.fillStyle = css(color);
    roundRect(ctx, 1, 1, HP_W, HP_H, HP_H / 2);
    ctx.fill();
  });
  bar(TEX.hpBack, PALETTE.hpBack);
  bar(TEX.hpHigh, PALETTE.hpHigh);
  bar(TEX.hpMid, PALETTE.hpMid);
  bar(TEX.hpLow, PALETTE.hpLow);
}

// The cream board frame: w x h is the tile area; adds an image whose tile area starts at (x, y).
export function addBoardBase(scene, x, y, w, h, pad, edge) {
  const key = `td-board-${w}x${h}`;
  const fw = w + pad * 2;
  const fh = h + pad * 2;
  bake(scene, key, fw + PAD * 2 + 8, fh + edge + PAD * 2 + 12, (ctx) => {
    withShadow(ctx, 0.22, 24, 12, () => {
      ctx.fillStyle = css(PALETTE.boardEdge);
      roundRect(ctx, PAD + 4, PAD, fw, fh + edge, 16);
      ctx.fill();
    });
    ctx.fillStyle = css(PALETTE.board);
    roundRect(ctx, PAD + 4, PAD, fw, fh, 16);
    ctx.fill();
  });
  return scene.add.image(x - pad - PAD - 4, y - pad - PAD, key).setOrigin(0);
}

// Full-canvas sky gradient.
export function addBackground(scene, w, h) {
  const key = `td-bg-${w}x${h}`;
  bake(scene, key, w, h, (ctx) => {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, css(PALETTE.backgroundTop));
    grad.addColorStop(1, css(PALETTE.backgroundBottom));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  });
  return scene.add.image(0, 0, key).setOrigin(0).setDepth(-100);
}

// --- cards and buttons ---

// style: card (white, soft shadow), icon (small pale tile), select (green outline only),
// bubble (speech bubble with a tail), primary / gold / ghost (chunky buttons).
const CARD_STYLE = {
  card: { face: PALETTE.card, radius: 14, shadow: [0.16, 16, 6] },
  icon: { face: PALETTE.iconTile, edge: PALETTE.iconTileEdge, depth: 3, radius: 10 },
  select: { stroke: PALETTE.good, lineWidth: 3, radius: 15 },
  primary: { face: PALETTE.navy, edge: PALETTE.navyEdge, depth: 4, radius: 12, shadow: [0.18, 8, 4] },
  primaryHover: { face: PALETTE.navyHover, edge: PALETTE.navyEdge, depth: 4, radius: 12, shadow: [0.18, 8, 4] },
  gold: { face: PALETTE.gold, edge: PALETTE.goldEdge, depth: 4, radius: 12, shadow: [0.18, 8, 4] },
  goldHover: { face: PALETTE.goldHover, edge: PALETTE.goldEdge, depth: 4, radius: 12, shadow: [0.18, 8, 4] },
  ghost: { face: PALETTE.ghost, edge: PALETTE.ghostEdge, depth: 4, radius: 12, shadow: [0.14, 8, 4] },
  ghostHover: { face: PALETTE.ghostHover, edge: PALETTE.ghostEdge, depth: 4, radius: 12, shadow: [0.14, 8, 4] },
  bubble: { face: PALETTE.card, radius: 12, shadow: [0.2, 8, 3], stroke: PALETTE.guestEdge, lineWidth: 1.5, tail: 8 },
};

export const CARD_PAD = PAD;

function cardKey(style, w, h) {
  return `td-${style}-${w}x${h}`;
}

export function bakeCard(scene, style, w, h) {
  const s = CARD_STYLE[style] ?? CARD_STYLE.card;
  const depth = s.depth ?? 0;
  const tail = s.tail ?? 0;
  const key = cardKey(style, w, h);
  return bake(scene, key, w + PAD * 2, h + depth + tail + PAD * 2, (ctx) => {
    const x = PAD;
    const y = PAD;
    if (tail) {
      // Speech bubble: outline colour first (body + tail, with shadow), then the face inset.
      const cx = x + w / 2;
      const lw = s.lineWidth;
      withShadow(ctx, ...s.shadow, () => {
        ctx.fillStyle = css(s.stroke);
        roundRect(ctx, x, y, w, h, s.radius);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(cx - tail, y + h - 2);
        ctx.lineTo(cx, y + h + tail);
        ctx.lineTo(cx + tail, y + h - 2);
        ctx.closePath();
        ctx.fill();
      });
      ctx.fillStyle = css(s.face);
      roundRect(ctx, x + lw, y + lw, w - lw * 2, h - lw * 2, s.radius - lw);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx - tail + lw * 1.5, y + h - lw - 2);
      ctx.lineTo(cx, y + h + tail - lw * 2);
      ctx.lineTo(cx + tail - lw * 1.5, y + h - lw - 2);
      ctx.closePath();
      ctx.fill();
      return;
    }
    if (s.edge !== undefined) {
      const fill = () => { ctx.fillStyle = css(s.edge); roundRect(ctx, x, y, w, h + depth, s.radius); ctx.fill(); };
      if (s.shadow) withShadow(ctx, ...s.shadow, fill);
      else fill();
    }
    if (s.face !== undefined) {
      const fill = () => { ctx.fillStyle = css(s.face); roundRect(ctx, x, y, w, h, s.radius); ctx.fill(); };
      if (s.shadow && s.edge === undefined) withShadow(ctx, ...s.shadow, fill);
      else fill();
    }
    if (s.stroke !== undefined) {
      ctx.lineWidth = s.lineWidth;
      ctx.strokeStyle = css(s.stroke);
      roundRect(ctx, x + s.lineWidth / 2, y + s.lineWidth / 2, w - s.lineWidth, h - s.lineWidth, s.radius);
      ctx.stroke();
    }
  });
}

// Sizes are rounded up so a changing label (e.g. a growing number) reuses a few textures.
export function snap(n, step = 8) {
  return Math.max(step, Math.ceil(n / step) * step);
}

// Adds a card image with its face (w x h, without the chunky edge) centred at (x, y).
export function addCard(scene, x, y, w, h, style = 'card') {
  const s = CARD_STYLE[style] ?? CARD_STYLE.card;
  const depth = s.depth ?? 0;
  const tail = s.tail ?? 0;
  const key = bakeCard(scene, style, w, h);
  const tw = w + PAD * 2;
  const th = h + depth + tail + PAD * 2;
  return scene.add.image(x, y, key).setOrigin((PAD + w / 2) / tw, (PAD + h / 2) / th);
}

// Swaps an existing card image to another style of the same size (e.g. hover).
export function setCardStyle(image, style, w, h) {
  const key = bakeCard(image.scene, style, w, h);
  if (image.texture?.key !== key) image.setTexture(key);
  return image;
}
