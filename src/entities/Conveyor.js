import { Container, Sprite, MeshPlane } from "pixi.js";
import { LAYOUT } from "../config.js";
import { audio } from "../audio.js";

// Rows in the grid the belt texture is drawn on. Its COLUMNS are not a fixed
// count: there is one per point of LAYOUT.conveyor.shape, standing exactly
// where that point puts it. That is what makes the rounded ends editable —
// with columns spread evenly and only their height read from the table, a
// point could be dragged sideways all day and the artwork would not move.
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
      verticesX: c.shape.length,
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

  // Lay the grid over the outline: one column per point, standing at that
  // point's x and reaching its half-height above and below the centre line.
  // The texture is spread evenly across the columns, so with the default table
  // — evenly spaced, constant height — the grid is flat and the belt renders
  // exactly as the untouched sprite. Move a point and the artwork under it
  // moves too, rim included, which is the whole purpose.
  _shapeBelt(c) {
    const mesh = this.beltMesh;
    const pts = c.shape;
    const buffer = mesh.geometry.getBuffer("aPosition");
    const positions = buffer.data;
    for (let ix = 0; ix < pts.length; ix++) {
      const [x, half] = pts[ix];
      for (let iy = 0; iy < MESH_ROWS; iy++) {
        const v = iy / (MESH_ROWS - 1); // 0 at the top edge, 1 at the bottom
        const i = (iy * pts.length + ix) * 2;
        positions[i] = x;
        positions[i + 1] = this.cy + (v * 2 - 1) * half;
      }
    }
    buffer.update();
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
