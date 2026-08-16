// Port of the original Conveyor.ts + ConveyorCell.ts.
//
// The belt is a closed polyline over seven waypoints. 27 cells ride it at
// constant speed; "Curve" waypoints don't bend the path, they only make the
// cells rotate to face the loop's centroid through the turns. Balls are
// captured from a sensor zone above the top run, snap onto their cell over
// 0.15 s, then travel as a packed train behind the frontmost ball — the
// grouping chain — one cell step apart, each converging on an exact slot.
import { Container, Sprite } from "pixi.js";
import { LAYOUT, BALL_DIAMETER } from "../config.js";
import { Ball } from "./Ball.js";
import { audio } from "../audio.js";

const SNAP_EPS = 0.06; // 0.05 world px
const COINCIDENT_EPS = 0.6; // 0.5 world px

class ConveyorCell {
  constructor(conveyor, index, textures) {
    this.conveyor = conveyor;
    this.index = index;
    this.container = new Container();
    this.sprite = new Sprite(
      Math.floor(index / 3) % 2 === 0 ? textures.cellDark : textures.cellLight,
    );
    this.sprite.anchor.set(0.5);
    this.sprite.width = LAYOUT.conveyor.cell.w;
    this.sprite.height = LAYOUT.conveyor.cell.h;
    this.container.addChild(this.sprite);

    this.ball = null;
    this._snapping = false;
    this._pending = false;
    this._snapT = 0;
    this._snapX = 0;
    this._snapY = 0;
  }

  get isOccupied() {
    return this.ball !== null && !this.ball.destroyed;
  }

  get isSnapping() {
    return this._snapping || this._pending;
  }

  getBallColor() {
    return this.isOccupied ? this.ball.color : null;
  }

  tryCaptureBall(ball) {
    if (this.isOccupied) return false;
    if (!ball || ball.destroyed || ball.capturedByCell || ball.takenByBox)
      return false;
    this.ball = ball;
    this._snapping = false;
    this._pending = true;
    ball.capturedByCell = true;
    this.conveyor._nextTick.push(() => this._finishCapture(ball));
    return true;
  }

  _finishCapture(ball) {
    if (!ball || ball.destroyed) {
      if (this.ball === ball) {
        this.ball = null;
        this._snapping = false;
        this._pending = false;
      }
      return;
    }
    if (this.ball !== ball) {
      // reassigned meanwhile — roll the flag back so it can be captured again
      if (ball.capturedByCell && !ball.takenByBox) ball.capturedByCell = false;
      return;
    }
    this._pending = false;
    ball.captureIntoCell();
    ball.owningCell = this;
    audio.playBallOnConveyor();
    this._snapX = ball.x;
    this._snapY = ball.y;
    this._snapT = 0;
    this._snapping = true;
  }

  updateSnap(dt) {
    if (!this._snapping) return;
    if (!this.ball || this.ball.destroyed) {
      this._snapping = false;
      return;
    }
    this._snapT += dt / LAYOUT.conveyor.snapDuration;
    const l = Math.min(this._snapT, 1);
    const e = 1 - Math.pow(1 - l, 3); // cubic ease-out
    // live target — tracks the moving cell
    const tx = this.container.x;
    const ty = this.container.y;
    this.ball.x = this._snapX + (tx - this._snapX) * e;
    this.ball.y = this._snapY + (ty - this._snapY) * e;
    if (l >= 1) this._snapping = false;
  }

  syncBallTo(x, y) {
    if (!this.isOccupied) return;
    if (this.ball.takenByBox) {
      // orphan cleanup
      this.ball = null;
      this._snapping = false;
      this._pending = false;
      return;
    }
    if (this._snapping || this._pending) return;
    this.ball.x = x;
    this.ball.y = y;
  }

  // A tray takes the ball off the belt.
  takeBall() {
    const ball = this.isOccupied ? this.ball : null;
    this.ball = null;
    this._snapping = false;
    this._pending = false;
    if (ball) {
      ball.owningCell = null;
      ball.prepareForBox();
    }
    return ball;
  }

  forceTakeBall() {
    const ball = this.isOccupied ? this.ball : null;
    this.ball = null;
    this._snapping = false;
    this._pending = false;
    if (ball) ball.owningCell = null;
    return ball;
  }

  detachBallForReassign() {
    if (!this.isOccupied || this.isSnapping) return null;
    const ball = this.ball;
    this.ball = null;
    return ball;
  }

  adoptBall(ball) {
    if (this.isOccupied || !ball || ball.destroyed) return false;
    this.ball = ball;
    this._snapping = false;
    this._pending = false;
    ball.owningCell = this;
    return true;
  }
}

export class Conveyor {
  constructor(layer, textures) {
    this.layer = layer;
    const C = LAYOUT.conveyor;

    // belt base art
    this.base = new Sprite(textures.base);
    this.base.anchor.set(0.5);
    this.base.position.set(C.belt.x, C.belt.y);
    this.base.width = C.belt.w;
    this.base.height = C.belt.h;
    layer.addChild(this.base);

    // path
    this.points = C.waypoints.map(([x, y]) => ({ x, y }));
    this.types = C.waypointTypes;
    this.segments = [];
    let run = 0;
    for (let i = 0; i < this.points.length; i++) {
      const a = this.points[i];
      const b = this.points[(i + 1) % this.points.length];
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      this.segments.push({
        a,
        b,
        length,
        startDist: run,
        typeA: this.types[i] ?? 0,
        typeB: this.types[(i + 1) % this.points.length] ?? 0,
      });
      run += length;
    }
    this.totalLength = run;
    this.centroid = {
      x: this.points.reduce((s, p) => s + p.x, 0) / this.points.length,
      y: this.points.reduce((s, p) => s + p.y, 0) / this.points.length,
    };

    this.speed = C.speed;
    this.snapSpeed = C.snapSpeed;
    this.phase = 0;
    this._nextTick = [];
    this._ballsInZone = new Set();
    this._leaderIdx = -1;

    // cells
    this.cells = [];
    this.cellBaseDist = [];
    this.ballDist = [];
    this.prevOccupied = [];
    const step = this.totalLength / C.cellCount;
    for (let i = 0; i < C.cellCount; i++) {
      const cell = new ConveyorCell(this, i, textures);
      const d = i * step;
      this.cells.push(cell);
      this.cellBaseDist.push(d);
      this.ballDist.push(d);
      this.prevOccupied.push(false);
      this._placeCell(cell, d);
      layer.addChild(cell.container);
    }
  }

  wrap(t) {
    const e = this.totalLength;
    if (e <= 0) return 0;
    let i = t % e;
    if (i < 0) i += e;
    return i;
  }

  pointAtDistance(t) {
    const e = this.wrap(t);
    for (const seg of this.segments) {
      if (e >= seg.startDist && e <= seg.startDist + seg.length) {
        const n = seg.length > 0 ? (e - seg.startDist) / seg.length : 0;
        return {
          x: seg.a.x + (seg.b.x - seg.a.x) * n,
          y: seg.a.y + (seg.b.y - seg.a.y) * n,
        };
      }
    }
    const last = this.segments[this.segments.length - 1];
    return { x: last.b.x, y: last.b.y };
  }

  segmentAtDistance(t) {
    const e = this.wrap(t);
    for (const seg of this.segments) {
      if (e >= seg.startDist && e <= seg.startDist + seg.length) return seg;
    }
    return this.segments[this.segments.length - 1] ?? null;
  }

  distanceAtPoint(px, py) {
    let best = 0;
    let bestD2 = Infinity;
    for (const seg of this.segments) {
      const abx = seg.b.x - seg.a.x;
      const aby = seg.b.y - seg.a.y;
      const len2 = abx * abx + aby * aby;
      let n = 0;
      if (len2 > 1e-6) {
        n = Math.max(
          0,
          Math.min(1, ((px - seg.a.x) * abx + (py - seg.a.y) * aby) / len2),
        );
      }
      const cx = seg.a.x + abx * n;
      const cy = seg.a.y + aby * n;
      const d2 = (px - cx) * (px - cx) + (py - cy) * (py - cy);
      if (d2 < bestD2) {
        bestD2 = d2;
        best = seg.startDist + seg.length * n;
      }
    }
    return this.wrap(best);
  }

  _lerpAngle(t, e, i) {
    return t + (((((e - t) % 360) + 540) % 360) - 180) * i;
  }

  _placeCell(cell, dist) {
    const pos = this.pointAtDistance(dist);
    cell.container.position.set(pos.x, pos.y);
    const seg = this.segmentAtDistance(dist);
    if (!seg) return;
    // radial angle facing the centroid, computed in the original's y-up terms
    const s = this.centroid.x - pos.x;
    const r = -(this.centroid.y - pos.y);
    const a = s === 0 && r === 0 ? 0 : (Math.atan2(r, s) * 180) / Math.PI - 90;
    const o = seg.typeA === 1;
    const h = seg.typeB === 1;
    let deg = 0;
    if (o && h) deg = a;
    else if (o || h) {
      const n =
        seg.length > 0 ? (this.wrap(dist) - seg.startDist) / seg.length : 0;
      deg = this._lerpAngle(o ? a : 0, h ? a : 0, n);
    }
    cell.container.rotation = (-deg * Math.PI) / 180;
  }

  isSlotOnTopLine(dist) {
    const seg = this.segmentAtDistance(dist);
    if (!seg) return false;
    const p = this.pointAtDistance(dist);
    // y-down: "above the centroid" means smaller y
    return (seg.typeA !== 1 || seg.typeB !== 1) && p.y < this.centroid.y;
  }

  registerBallInZone(ball) {
    this._ballsInZone.add(ball);
  }

  isFull() {
    return this.cells.every((c) => c.isOccupied);
  }

  getOccupiedCells() {
    return this.cells.filter((c) => c.isOccupied);
  }

  update(dt) {
    // deferred capture completions (the original's scheduleOnce(0))
    if (this._nextTick.length) {
      const jobs = this._nextTick;
      this._nextTick = [];
      for (const job of jobs) job();
    }

    this.phase = this.wrap(this.phase + this.speed * dt);

    // cells ride the belt rigidly
    for (let i = 0; i < this.cells.length; i++) {
      this._placeCell(this.cells[i], this.cellBaseDist[i] + this.phase);
    }

    for (const cell of this.cells) cell.updateSnap(dt);

    this._pollZone();

    // ball-distance bookkeeping
    const step = this.totalLength / this.cells.length;
    for (let i = 0; i < this.cells.length; i++) {
      const cell = this.cells[i];
      if (cell.isOccupied) {
        if (!this.prevOccupied[i]) {
          this.ballDist[i] = this.distanceAtPoint(cell.ball.x, cell.ball.y);
          this.prevOccupied[i] = true;
        }
        if (cell.isSnapping) {
          this.ballDist[i] = this.distanceAtPoint(cell.ball.x, cell.ball.y);
        }
      } else {
        this.ballDist[i] = this.wrap(this.cellBaseDist[i] + this.phase);
        this.prevOccupied[i] = false;
      }
    }

    this._advanceChain(dt, step);
    this._reconcileCellAssignments();
    this._updateBallSiblingOrder();
  }

  // -- capture ------------------------------------------------------------

  _pollZone() {
    const Z = LAYOUT.conveyor.capture;
    const r = BALL_DIAMETER / 2;
    // recovery sweep: any free ball touching the zone joins the set (the
    // original's sensor is a box the ball's circle overlaps)
    for (const ball of Ball.getFreeBalls()) {
      if (this._ballsInZone.has(ball)) continue;
      if (
        Math.abs(ball.x - Z.x) <= Z.halfW + r &&
        Math.abs(ball.y - Z.y) <= Z.halfH + r
      ) {
        this._ballsInZone.add(ball);
      }
    }
    if (!this._ballsInZone.size) return;
    for (const ball of Array.from(this._ballsInZone)) {
      if (!ball || ball.destroyed || ball.capturedByCell || ball.takenByBox) {
        this._ballsInZone.delete(ball);
        continue;
      }
      // prune balls that left the zone
      if (
        Math.abs(ball.x - Z.x) > Z.halfW + r ||
        Math.abs(ball.y - Z.y) > Z.halfH + r
      ) {
        this._ballsInZone.delete(ball);
        continue;
      }
      this._tryAttachBall(ball);
    }
  }

  _tryAttachBall(ball) {
    const cell = this._findNearestFreeCell(ball);
    if (cell && cell.tryCaptureBall(ball)) {
      this._ballsInZone.delete(ball);
      return true;
    }
    return false;
  }

  // A falling ball only gets captured by a free cell currently on the top
  // line whose centre is horizontally within half a cell step of it.
  _findNearestFreeCell(ball) {
    const step = this.totalLength / Math.max(1, this.cells.length);
    const tol = 0.5 * step;
    let best = null;
    let bestDx = Infinity;
    for (let i = 0; i < this.cells.length; i++) {
      const cell = this.cells[i];
      if (cell.isOccupied || cell.isSnapping) continue;
      const slotDist = this.wrap(this.cellBaseDist[i] + this.phase);
      if (!this.isSlotOnTopLine(slotDist)) continue;
      const dx = Math.abs(cell.container.x - ball.x);
      if (dx > tol) continue;
      if (dx < bestDx) {
        bestDx = dx;
        best = cell;
      }
    }
    return best;
  }

  // -- movement -----------------------------------------------------------

  _nearestSlotDist(t) {
    let best = t;
    let bestAbs = Infinity;
    for (let i = 0; i < this.cells.length; i++) {
      const slot = this.wrap(this.cellBaseDist[i] + this.phase);
      let s = this.wrap(slot - t);
      if (s > this.totalLength / 2) s -= this.totalLength;
      if (Math.abs(s) < bestAbs) {
        bestAbs = Math.abs(s);
        best = slot;
      }
    }
    return best;
  }

  _advanceToTarget(cur, target, dt) {
    let n = this.wrap(target - cur);
    if (n > this.totalLength / 2) n -= this.totalLength;
    const s = this.speed * dt;
    let r = n;
    if (Math.abs(n) >= SNAP_EPS) {
      const a = this.snapSpeed * dt;
      if (r > a) r = a;
      if (r < -a) r = -a;
    }
    let o = s + r;
    const h = 0.25 * (this.totalLength / this.cells.length);
    if (o > h) o = h;
    if (o < -h) o = -h;
    return this.wrap(cur + o);
  }

  _frontmostBallDist(entries) {
    if (entries.length === 0) return 0;
    if (entries.length === 1) return entries[0].dist;
    let best = entries[0].dist;
    let bestGap = -Infinity;
    for (const n of entries) {
      let minGap = Infinity;
      for (const r of entries) {
        if (r === n) continue;
        const gap = this.wrap(r.dist - n.dist);
        if (gap < COINCIDENT_EPS) continue;
        if (gap < minGap) minGap = gap;
      }
      if (minGap > bestGap) {
        bestGap = minGap;
        best = n.dist;
      }
    }
    return best;
  }

  _writeBallPos(i, cell) {
    const p = this.pointAtDistance(this.ballDist[i]);
    if (cell.ball && !cell.ball.destroyed) {
      cell.ball.recordConveyorPrevPos(cell.ball.x, cell.ball.y);
    }
    cell.syncBallTo(p.x, p.y);
  }

  _advanceChain(dt, step) {
    const entries = [];
    for (let i = 0; i < this.cells.length; i++) {
      const cell = this.cells[i];
      if (cell.isOccupied && !cell.isSnapping) {
        entries.push({ idx: i, dist: this.ballDist[i] });
      }
    }
    if (!entries.length) return;

    if (entries.length === 1) {
      const e = entries[0];
      const target = this._nearestSlotDist(e.dist);
      this.ballDist[e.idx] = this._advanceToTarget(e.dist, target, dt);
      this._writeBallPos(e.idx, this.cells[e.idx]);
      this._leaderIdx = e.idx;
      return;
    }

    const front = this._frontmostBallDist(entries);
    const key = (t) => this.wrap(front - t);
    entries.sort((a, b) => key(a.dist) - key(b.dist));
    this._leaderIdx = entries[0].idx;
    const leaderTarget = this._nearestSlotDist(entries[0].dist);

    // pack target slots one step apart behind the leader
    const used = new Set();
    const targets = [];
    for (let g = 0; g < entries.length; g++) {
      const ideal = this.wrap(leaderTarget - g * step);
      let bestSlot = ideal;
      let bestAbs = Infinity;
      for (let c = 0; c < this.cells.length; c++) {
        const y = this.wrap(this.cellBaseDist[c] + this.phase);
        if (used.has(y)) continue;
        let w = this.wrap(y - ideal);
        if (w > this.totalLength / 2) w -= this.totalLength;
        if (Math.abs(w) < bestAbs) {
          bestAbs = Math.abs(w);
          bestSlot = y;
        }
      }
      used.add(bestSlot);
      targets.push(bestSlot);
    }

    for (let g = 0; g < entries.length; g++) {
      const e = entries[g];
      this.ballDist[e.idx] = this._advanceToTarget(e.dist, targets[g], dt);
      this._writeBallPos(e.idx, this.cells[e.idx]);
    }
  }

  // Rebind balls to cells so occupancy matches the packed train.
  _reconcileCellAssignments() {
    const locked = new Array(this.cells.length).fill(false);
    const movable = [];
    for (let i = 0; i < this.cells.length; i++) {
      const cell = this.cells[i];
      if (!cell.isOccupied) continue;
      if (cell.isSnapping) locked[i] = true;
      else
        movable.push({ ball: cell.ball, dist: this.ballDist[i], fromIdx: i });
    }
    if (!movable.length) return;

    const slots = [];
    for (let i = 0; i < this.cells.length; i++) {
      if (locked[i]) continue;
      slots.push({
        idx: i,
        dist: this.wrap(this.cellBaseDist[i] + this.phase),
      });
    }
    const front = this._frontmostBallDist(
      movable.map((m) => ({ dist: m.dist })),
    );
    const key = (d) => this.wrap(front - d);
    movable.sort((a, b) => key(a.dist) - key(b.dist));
    slots.sort((a, b) => key(a.dist) - key(b.dist));

    const moves = [];
    for (let p = 0; p < movable.length; p++) {
      const toIdx = p < slots.length ? slots[p].idx : movable[p].fromIdx;
      if (toIdx !== movable[p].fromIdx) moves.push({ ...movable[p], toIdx });
    }
    if (!moves.length) return;

    const leaderBall =
      this._leaderIdx >= 0 && this.cells[this._leaderIdx]?.isOccupied
        ? this.cells[this._leaderIdx].ball
        : null;

    for (const m of moves) {
      const ball = this.cells[m.fromIdx].detachBallForReassign();
      if (!ball) {
        m.skip = true;
        continue;
      }
      m.detached = ball;
    }
    let newLeaderIdx = this._leaderIdx;
    for (const m of moves) {
      if (m.skip) continue;
      let target = this.cells[m.toIdx];
      if (!target.adoptBall(m.detached)) {
        target = this.cells.find((c) => c.adoptBall(m.detached));
      }
      if (target) {
        const idx = this.cells.indexOf(target);
        this.ballDist[idx] = m.dist;
        this.prevOccupied[idx] = true;
        if (m.detached === leaderBall) newLeaderIdx = idx;
      }
      if (!this.cells[m.fromIdx].isOccupied)
        this.prevOccupied[m.fromIdx] = false;
    }
    this._leaderIdx =
      newLeaderIdx >= 0 && this.cells[newLeaderIdx]?.isOccupied
        ? newLeaderIdx
        : -1;
  }

  // Frontmost riding ball renders on top, reusing existing sibling indices.
  _updateBallSiblingOrder() {
    const entries = [];
    for (let i = 0; i < this.cells.length; i++) {
      const cell = this.cells[i];
      if (!cell.isOccupied || cell.isSnapping) continue;
      if (!cell.ball.parent) continue;
      entries.push({ ball: cell.ball, dist: this.ballDist[i] });
    }
    if (entries.length < 2) return;
    entries.sort((t, e) =>
      this.wrap(e.dist - t.dist) < 0.5 * this.totalLength ? -1 : 1,
    );
    // group by parent, reassign sorted indices within each group
    const byParent = new Map();
    for (const e of entries) {
      const list = byParent.get(e.ball.parent) ?? [];
      list.push(e.ball);
      byParent.set(e.ball.parent, list);
    }
    for (const [parent, balls] of byParent) {
      if (balls.length < 2) continue;
      const indices = balls
        .map((b) => parent.getChildIndex(b))
        .sort((a, b) => a - b);
      for (let k = 0; k < balls.length; k++) {
        if (parent.getChildIndex(balls[k]) !== indices[k]) {
          parent.setChildIndex(balls[k], indices[k]);
        }
      }
    }
  }
}
