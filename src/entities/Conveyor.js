import { Container, Sprite, MeshPlane } from "pixi.js";
import { LAYOUT } from "../config.js";
import { audio } from "../audio.js";

// How tall the belt is at a given x, from LAYOUT.conveyor.shape — half its
// height, measured from the centre line, linearly interpolated between the
// table's points.
function beltHalfHeightAt(c, x) {
  const pts = c.shape;
  if (x <= pts[0][0]) return pts[0][1];
  const last = pts[pts.length - 1];
  if (x >= last[0]) return last[1];
  let lo = 0;
  let hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid][0] <= x) lo = mid;
    else hi = mid;
  }
  const [x0, h0] = pts[lo];
  const [x1, h1] = pts[hi];
  return h0 + ((h1 - h0) * (x - x0)) / (x1 - x0);
}

// Grid the belt texture is drawn on. Enough columns to follow a curve without
// faceting; two rows would stretch the interior linearly, so a few more keep
// the centre track where it belongs.
const MESH_COLUMNS = 60;
const MESH_ROWS = 6;

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

    // The belt is the original artwork, laid over a grid whose vertices take
    // their height from LAYOUT.conveyor.shape. Nothing new is drawn on top:
    // the purple rim you see is the one in the texture, and bending the grid
    // bends that rim with it, which is what makes the existing outline
    // editable rather than replaced.
    //
    // With the default shape — a constant half-height — the grid is flat and
    // the belt renders exactly as the plain sprite did.
    const base = new MeshPlane({
      texture: textures.base,
      verticesX: MESH_COLUMNS,
      verticesY: MESH_ROWS,
    });
    this.beltMesh = base;
    this.layer.addChild(base);
    this._shapeBelt(c);

    this.beltHeight = beltH;

    this.cellLayer = new Container();
    this.layer.addChild(this.cellLayer);

    for (let i = 0; i < this.cellCount; i++) {
      const spr = new Sprite(
        i % 6 < 3 ? textures.cellDark : textures.cellLight,
      );
      spr.anchor.set(0.5);
      spr.width = c.cellW;
      spr.height = c.cellH;
      this.cellLayer.addChild(spr);
      this.cells.push({
        sprite: spr,
        baseDist: (i * this.totalLen) / this.cellCount,
        ball: null,
      });
    }

    this.freeBalls = new Set();
  }

  // Push the grid's vertices out to the outline. Column i spans the belt from
  // xLeft to xRight; each row is placed as a fraction of that column's height,
  // so the texture is squeezed or stretched vertically to fit and its rim
  // lands exactly on the shape.
  _shapeBelt(c) {
    const mesh = this.beltMesh;
    const positions = mesh.geometry.getBuffer("aPosition").data;
    for (let ix = 0; ix < MESH_COLUMNS; ix++) {
      const t = ix / (MESH_COLUMNS - 1);
      const x = c.xLeft + (c.xRight - c.xLeft) * t;
      const half = beltHalfHeightAt(c, x);
      for (let iy = 0; iy < MESH_ROWS; iy++) {
        const v = iy / (MESH_ROWS - 1); // 0 at the top edge, 1 at the bottom
        const i = (iy * MESH_COLUMNS + ix) * 2;
        positions[i] = x;
        positions[i + 1] = this.cy + (v * 2 - 1) * half;
      }
    }
    mesh.geometry.getBuffer("aPosition").update();
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
