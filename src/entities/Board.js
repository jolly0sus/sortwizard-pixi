// The original draws the whole board with three pieces of art and no
// procedural geometry at all: a flat purple backdrop, the TanBackingRender
// sheet (wood, pressed grid and inner shading baked in), and the huge
// FramePurpleRender on top of the gameplay — purple surround, hourglass
// cutout and yellow frame in one image. The frame is wider than the screen
// and simply bleeds off both sides.
import { Graphics, Sprite } from "pixi.js";
import { DESIGN_W, DESIGN_H, LAYOUT, PALETTE } from "../config.js";

// Purple ground + wood. Sits under everything.
export function buildBackground(layer, textures) {
  const bg = new Graphics();
  // overscanned so fixed-height fitting never shows the page behind it
  bg.rect(-DESIGN_W * 2, -DESIGN_H, DESIGN_W * 5, DESIGN_H * 3).fill(
    PALETTE.bg,
  );
  layer.addChild(bg);

  const wood = new Sprite(textures.tanBacking);
  wood.anchor.set(0.5);
  wood.position.set(LAYOUT.wood.x, LAYOUT.wood.y);
  wood.width = LAYOUT.wood.w;
  wood.height = LAYOUT.wood.h;
  layer.addChild(wood);
}

// The frame renders ABOVE the balls, trays and belt — that is what clips them
// against the board's edge in the original.
export function buildFrame(layer, textures) {
  const frame = new Sprite(textures.framePurple);
  frame.anchor.set(0.5);
  frame.position.set(LAYOUT.frame.x, LAYOUT.frame.y);
  frame.width = LAYOUT.frame.w;
  frame.height = LAYOUT.frame.h;
  layer.addChild(frame);
}
