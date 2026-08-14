import { Container, Graphics, Sprite } from "pixi.js";
import { DESIGN_W, DESIGN_H, LAYOUT, PALETTE } from "../config.js";

// Derived live from LAYOUT rather than captured at module load, so the editor
// can move things and have the maths follow on the next rebuild.
export const boardCx = () => LAYOUT.board.x + LAYOUT.board.w / 2;

// x range over which the belt's straight run carries slots, i.e. the only
// band where a falling ball can actually be picked up.
export const captureLeftX = () =>
  LAYOUT.conveyor.xLeft +
  LAYOUT.conveyor.pathInset +
  LAYOUT.conveyor.pathRadius;
export const captureRightX = () =>
  LAYOUT.conveyor.xRight -
  LAYOUT.conveyor.pathInset -
  LAYOUT.conveyor.pathRadius;
const captureHalfWidth = () => (captureRightX() - captureLeftX()) / 2;

// Half-width of the wooden board at a given y — the silhouette that gets
// drawn, and the wall balls slide along on their way down.
export function boardHalfWidthAt(y) {
  const b = LAYOUT.board;
  const topHalf = b.w / 2;
  const waistHalf = b.waistWidth / 2;
  const lowerHalf = b.lowerW / 2;
  if (y <= b.bottomTop) return topHalf;
  if (y <= b.waistBottom) {
    const t = (y - b.bottomTop) / (b.waistBottom - b.bottomTop);
    return topHalf + (waistHalf - topHalf) * Math.pow(t, b.waistExponent);
  }
  // Parallel throat. Measured off the original: the neck holds a constant
  // 111px from y=940 down to where the lower section takes over, rather than
  // flaring open the moment the taper ends. Without this stretch the walls
  // read as one continuous funnel instead of two shapes meeting at a gap.
  if (y <= b.lowerTop) return waistHalf;
  return lowerHalf;
}

// The silhouette is walked as short line segments, so every place the profile
// changes slope — the shoulder, the throat, where the neck meets the lower
// section — came out as a hard crease. The original's walls are rounded there:
// each wing ends in a fat curve, not a notch.
//
// Two passes of a moving average fix all of them at once: one pass turns a
// corner into a straight chamfer, the second rounds that chamfer into an arc.
// Flat stretches average to themselves, so the board's straight sides are
// untouched. The radius is a balance — the throat is only ~56px long, and a
// window wider than half of it eats into the parallel section and lets the
// neck bulge open. waistWidth is set against this: it is measured at 72 here
// and draws at ~99, because the smoothing opens it up by roughly the radius.
const CORNER_ROUND = 16;

function roundedHalfWidthAt(y) {
  const span = CORNER_ROUND / 2;
  const pass = (yy) => {
    let sum = 0;
    for (let k = -2; k <= 2; k++) sum += boardHalfWidthAt(yy + (k * span) / 2);
    return sum / 5;
  };
  let sum = 0;
  for (let k = -2; k <= 2; k++) sum += pass(y + (k * span) / 2);
  return sum / 5;
}

// Where a *ball* may travel. Same as the board above the throat, but below it
// the walls close in to the belt's capture span so a ball can never settle
// past the last slot and sit there forever.
export function ballHalfWidthAt(y) {
  // The rounded profile, not the raw one, so a ball rides the wall that is
  // actually drawn — otherwise it clips the corner at the throat.
  const h = roundedHalfWidthAt(y);
  if (y < LAYOUT.board.waistBottom) return h;
  return Math.min(h, captureHalfWidth());
}

// `inset` shrinks the outline toward the middle of the board, which is how
// the frame gets its concentric bevel rings and the wood its inner shadow.
function traceBoardPath(g, inset = 0) {
  const b = LAYOUT.board;
  const cx = boardCx();
  const r = Math.max(8, b.radius - inset);
  const step = 6;
  const top = b.y + inset;
  const bottom = b.bottom - inset;
  const half = (y) => Math.max(10, roundedHalfWidthAt(y) - inset);
  const topHalf = half(top);
  const botHalf = half(bottom);

  g.moveTo(cx - topHalf + r, top);
  g.lineTo(cx + topHalf - r, top);
  g.arcTo(cx + topHalf, top, cx + topHalf, top + r, r);
  // right flank, following the funnel profile
  for (let y = top + r; y <= bottom - r; y += step) {
    g.lineTo(cx + half(y), y);
  }
  g.lineTo(cx + botHalf, bottom - r);
  g.arcTo(cx + botHalf, bottom, cx + botHalf - r, bottom, r);
  g.lineTo(cx - botHalf + r, bottom);
  g.arcTo(cx - botHalf, bottom, cx - botHalf, bottom - r, r);
  // left flank, back up
  for (let y = bottom - r; y >= top + r; y -= step) {
    g.lineTo(cx - half(y), y);
  }
  g.lineTo(cx - topHalf, top + r);
  g.arcTo(cx - topHalf, top, cx - topHalf + r, top, r);
  g.closePath();
}

// Hourglass board: wide top section (pipes + grid), a throat, and a wide
// bottom section (conveyor + trays). Drawn rather than sprited because the
// source renders carry no 9-slice data, but filled with the original's wood.
export function buildBoard(root, textures) {
  const layer = new Container();
  root.addChildAt(layer, 0);

  layer.addChild(
    new Graphics().rect(0, 0, DESIGN_W, DESIGN_H).fill({ color: PALETTE.bg }),
  );

  const b = LAYOUT.board;

  const shape = new Graphics();
  traceBoardPath(shape);
  shape.fill({ color: PALETTE.wood });
  layer.addChild(shape);

  // real wood grain, clipped to the board silhouette
  if (textures?.wood) {
    const clip = new Graphics();
    traceBoardPath(clip);
    clip.fill({ color: 0xffffff });
    layer.addChild(clip);

    const wood = new Sprite(textures.wood);
    wood.x = b.x;
    wood.y = b.y;
    wood.width = b.w;
    wood.height = b.bottom - b.y;
    wood.mask = clip;
    layer.addChild(wood);
  }

  // the wood sits down inside the frame, so darken it as it nears the rim
  const innerShade = new Graphics();
  for (let i = 0; i < 5; i++) {
    traceBoardPath(innerShade, 12 + i * 7);
    innerShade.stroke({ color: 0x7a4020, width: 16, alpha: 0.05 });
  }
  layer.addChild(innerShade);

  // Grid squares pressed into the board: a dark lip along the top edge reads
  // as the groove, the lighter face below it as the floor catching the light.
  const grid = new Graphics();
  const g = LAYOUT.grid;
  const stepX = g.cellSize + g.gap;
  const totalW = g.cols * g.cellSize + (g.cols - 1) * g.gap;
  const startX = b.x + (b.w - totalW) / 2;
  for (let row = 0; row < g.rows; row++) {
    for (let col = 0; col < g.cols; col++) {
      const x = startX + col * stepX;
      const y = g.topY + row * stepX;
      grid
        .roundRect(x, y, g.cellSize, g.cellSize, 15)
        .fill({ color: PALETTE.woodLine, alpha: 0.28 });
      grid
        .roundRect(x, y + 4, g.cellSize, g.cellSize, 15)
        .fill({ color: 0xffdcb2, alpha: 0.5 });
    }
  }
  layer.addChild(grid);

  // Frame, built as concentric rings rather than one flat stroke: a dark
  // outline to bite against the purple, a thick gold body, then a light ring
  // hugging the inside so the whole thing reads as a raised tube.
  // Each ring is drawn narrower than the last and nudged inward, so they
  // overlap instead of butting together — no seams, and the tone ramps from a
  // dark outer edge to a bright inner one, which is what gives it volume.
  const rim = new Graphics();
  const rings = [
    { inset: 0, width: 26, color: 0x4a2000, alpha: 0.95 },
    { inset: 1, width: 22, color: 0xb8730a, alpha: 1 },
    { inset: 2, width: 16, color: 0xf0a81a, alpha: 1 },
    { inset: 3, width: 10, color: PALETTE.frameYellow, alpha: 1 },
    { inset: 5, width: 5, color: 0xfff2a8, alpha: 0.9 },
  ];
  for (const ring of rings) {
    traceBoardPath(rim, ring.inset);
    rim.stroke({
      color: ring.color,
      width: ring.width,
      alignment: 0.5,
      alpha: ring.alpha,
    });
  }
  layer.addChild(rim);

  return layer;
}
