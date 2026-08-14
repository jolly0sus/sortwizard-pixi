import { Container, Sprite, NineSliceSprite } from "pixi.js";
import { LAYOUT } from "../config.js";
import { audio } from "../audio.js";

// Stadium-shaped ("racetrack") belt: two straight runs joined by semicircular
// ends. Only the TOP straight run captures falling balls (the original's
// "top line only" rule); the whole loop then carries them around.
export class Conveyor {
  constructor(root, textures, { onBallLost } = {}) {
    this.onBallLost = onBallLost;
    // monotonic belt odometer, used to time a ball out after one full lap
    this.travelled = 0;
    this.lapsBeforeLost = LAYOUT.conveyor.lapsBeforeLost;
    this.root = root;
    this.layer = new Container();
    root.addChild(this.layer);

    const c = LAYOUT.conveyor;
    this.cy = c.centerY;
    this.rx = c.pathRadius;
    this.ry = c.pathRadiusY;
    // arc length of the elliptical ends, approximated by the mean radius so
    // slots stay evenly pitched all the way round
    this.rm = (this.rx + this.ry) / 2;
    this.leftCapX = c.xLeft + c.pathInset + this.rx;
    this.rightCapX = c.xRight - c.pathInset - this.rx;
    this.straightLen = this.rightCapX - this.leftCapX;
    this.totalLen = 2 * this.straightLen + 2 * Math.PI * this.rm;
    this.speed = this.totalLen / c.loopSeconds;

    this.phase = 0;
    this.cellCount = c.cellCount;
    this.cells = [];

    // Belt art: a long capsule, stretched horizontally via 9-slice so its
    // rounded caps keep their shape.
    const beltW = c.xRight - c.xLeft;
    const beltH = c.beltH;

    // shadow under the belt so it reads as lifted off the board
    const shade = new Sprite(textures.boxShadow);
    shade.anchor.set(0.5);
    shade.width = beltW * c.shadowScale;
    shade.height = beltH * (c.shadowScale + 0.13);
    shade.x = c.xLeft + beltW / 2;
    shade.y = this.cy + c.shadowDrop;
    shade.alpha = c.shadowAlpha;
    this.layer.addChild(shade);

    // capWidth is how much of the source art each rounded end keeps at its own
    // scale; only the strip between the two caps is stretched to length. Raise
    // it for longer, blunter ends, lower it for tighter ones. Too high and the
    // caps overlap, so it is held to just under half the belt.
    const cap = Math.min(c.capWidth, textures.base.width / 2 - 1);
    const base = new NineSliceSprite({
      texture: textures.base,
      leftWidth: cap,
      rightWidth: cap,
      topHeight: 0,
      bottomHeight: 0,
    });
    base.width = beltW;
    base.height = beltH;
    base.x = c.xLeft;
    base.y = this.cy - beltH / 2;
    this.layer.addChild(base);
    this.beltHeight = beltH;

    this.cellLayer = new Container();
    this.layer.addChild(this.cellLayer);

    // Each slot is three copies of the same art rather than one: a dark one
    // spread a little wider and dropped a couple of pixels, the face itself,
    // and a pale one pulled in and lifted. Read together that is a lip
    // catching the light at the top and shade pooling at the bottom, which is
    // what makes the slot look pressed into the belt instead of printed on it.
    for (let i = 0; i < this.cellCount; i++) {
      // One tone for every slot. They used to alternate in threes, which read
      // as a light and a dark set rather than one belt.
      const tex = textures.cellLight;
      const holder = new Container();

      const shade = new Sprite(tex);
      shade.anchor.set(0.5);
      shade.width = c.cellW * 1.16;
      shade.height = c.cellH * 1.14;
      shade.tint = 0x160f2e;
      shade.alpha = 0.5;
      shade.y = c.cellH * 0.09;

      const face = new Sprite(tex);
      face.anchor.set(0.5);
      face.width = c.cellW;
      face.height = c.cellH;

      const gloss = new Sprite(tex);
      gloss.anchor.set(0.5);
      gloss.width = c.cellW * 0.74;
      gloss.height = c.cellH * 0.64;
      gloss.tint = 0xffffff;
      gloss.alpha = 0.22;
      gloss.y = -c.cellH * 0.14;

      holder.addChild(shade, face, gloss);
      this.cellLayer.addChild(holder);
      this.cells.push({
        sprite: holder,
        baseDist: (i * this.totalLen) / this.cellCount,
        ball: null,
      });
    }

    this.freeBalls = new Set();
  }

  pointAtDistance(d) {
    d = ((d % this.totalLen) + this.totalLen) % this.totalLen;
    const s = this.straightLen;
    const halfCirc = Math.PI * this.rm;
    if (d < s) {
      return { x: this.leftCapX + d, y: this.cy - this.ry, angle: 0 };
    }
    d -= s;
    if (d < halfCirc) {
      const a = -Math.PI / 2 + (d / halfCirc) * Math.PI;
      return {
        x: this.rightCapX + Math.cos(a) * this.rx,
        y: this.cy + Math.sin(a) * this.ry,
        angle: a + Math.PI / 2,
      };
    }
    d -= halfCirc;
    if (d < s) {
      return { x: this.rightCapX - d, y: this.cy + this.ry, angle: Math.PI };
    }
    d -= s;
    const a = Math.PI / 2 + (d / halfCirc) * Math.PI;
    return {
      x: this.leftCapX + Math.cos(a) * this.rx,
      y: this.cy + Math.sin(a) * this.ry,
      angle: a + Math.PI / 2,
    };
  }

  isTopSegment(d) {
    d = ((d % this.totalLen) + this.totalLen) % this.totalLen;
    return d < this.straightLen;
  }

  // The underside run, which passes directly over the receiver trays.
  isBottomSegment(d) {
    d = ((d % this.totalLen) + this.totalLen) % this.totalLen;
    const start = this.straightLen + Math.PI * this.rm;
    return d >= start && d < start + this.straightLen;
  }

  registerFreeBall(ball) {
    this.freeBalls.add(ball);
  }

  update(dt) {
    this.travelled += this.speed * dt;
    this.phase = (this.phase + this.speed * dt) % this.totalLen;
    this._dropStragglers();

    for (const cell of this.cells) {
      const d = cell.baseDist + this.phase;
      const p = this.pointAtDistance(d);
      cell.sprite.x = p.x;
      cell.sprite.y = p.y;
      cell.sprite.rotation = p.angle;
      cell.curDist = d;
      if (cell.ball) {
        cell.ball.x = p.x;
        cell.ball.y = p.y;
        cell.ball.distAlongPath = d;
      }
    }

    this._captureWaiting();
  }

  // Slot-major, not ball-major. Slots enter the top run at the left and travel
  // right; asking each waiting ball for its nearest slot meant whoever sat
  // closest to the entry always won, and balls resting at the far end starved
  // there forever. Now every free slot claims the nearest ball to *itself*, so
  // the run is served along its whole length.
  _captureWaiting() {
    if (!this.freeBalls.size) return;
    for (const ball of [...this.freeBalls]) {
      if (!ball.parent || ball.capturedByCell || ball.takenByBox)
        this.freeBalls.delete(ball);
    }
    if (!this.freeBalls.size) return;

    // half the slot pitch plus a margin, so no resting position is ever out
    // of reach of the slot passing over it
    const tolerance = this.totalLen / this.cellCount / 2 + 6;
    const topY = this.cy - this.ry;
    const bandTop = this.cy - this.beltHeight / 2 - 46;
    const bandBottom = topY + 30;

    for (const cell of this.cells) {
      if (cell.ball) continue;
      if (!this.isTopSegment(cell.curDist)) continue;

      let best = null;
      let bestDx = tolerance;
      for (const ball of this.freeBalls) {
        if (ball.y < bandTop || ball.y > bandBottom) continue;
        const dx = Math.abs(ball.x - cell.sprite.x);
        if (dx < bestDx) {
          bestDx = dx;
          best = ball;
        }
      }
      if (!best) continue;

      cell.ball = best;
      best.owningCell = cell;
      best.capturedByCell = true;
      best.freeFalling = false;
      best.ridingSince = this.travelled;
      this.freeBalls.delete(best);
      audio.playBallOnConveyor();
    }
  }

  // Dormant by design: LAYOUT.conveyor.lapsBeforeLost is 0, so nothing ever
  // leaves the belt. A ball nobody wants keeps riding, which is exactly what
  // makes a wrong tap fatal — 27 homeless balls fill all 27 slots for good.
  // Kept because the editor can switch the rule back on to experiment.
  _dropStragglers() {
    if (!this.onBallLost || !this.lapsBeforeLost) return;
    for (const cell of this.cells) {
      const ball = cell.ball;
      if (!ball || ball.takenByBox) continue;
      if (
        this.travelled - ball.ridingSince <
        this.totalLen * this.lapsBeforeLost
      )
        continue;
      cell.ball = null;
      ball.owningCell = null;
      ball.capturedByCell = false;
      this.onBallLost(ball);
    }
  }

  releaseBall(cell) {
    if (!cell.ball) return null;
    const b = cell.ball;
    cell.ball = null;
    b.owningCell = null;
    return b;
  }

  getOccupiedCells() {
    return this.cells.filter((c) => c.ball);
  }

  isFull() {
    return this.cells.every((c) => c.ball);
  }
}
