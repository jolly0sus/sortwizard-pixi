// A small circles-vs-static-shapes solver standing in for the original's
// Box2D world. It keeps the properties that shape how the original *feels*:
// the same gravity, the ball's bouncy restitution (0.45) with Box2D's
// velocity threshold (impacts slower than ~1 m/s land dead, which is what
// lets a heap settle), zero friction, the original's odd negative linear
// damping, and sleeping — a heap at rest stops simulating instead of buzzing.
//
// Bodies are the Ball entities themselves: the solver reads/writes their
// x/y/vx/vy directly. Static shapes are the original's InvisibleWalls,
// converted in config.js.
import { PHYSICS, WALLS } from "./config.js";

const SLOP = 0.6; // tolerated penetration, ~0.5 world px
const BAUMGARTE = 0.35; // fraction of remaining overlap corrected per pass
const VELOCITY_PASSES = 4;
const POSITION_PASSES = 2;
const TIME_TO_SLEEP = 0.5;

export class PhysicsWorld {
  constructor() {
    this.walls = WALLS;
    this.balls = new Set();
    this._acc = 0;
  }

  add(ball) {
    ball.sleepTimer = 0;
    ball.asleep = false;
    this.balls.add(ball);
  }

  remove(ball) {
    this.balls.delete(ball);
  }

  // Fixed 1/60 steps, at most one per rendered frame (the original's
  // maxSubSteps is 1); the remainder carries over so a 120 Hz display still
  // averages out to real time.
  step(frameDt) {
    this._acc = Math.min(this._acc + frameDt, PHYSICS.fixedStep * 2);
    if (this._acc < PHYSICS.fixedStep) return;
    this._acc -= PHYSICS.fixedStep;
    this._step(PHYSICS.fixedStep);
  }

  _step(dt) {
    const r = PHYSICS.ballRadius;
    const active = [];
    for (const b of this.balls) {
      if (!b.physicsActive) continue;
      active.push(b);
      if (b.asleep) continue;
      b.vy += PHYSICS.gravity * dt;
      // Box2D damping: v *= 1 / (1 + dt * d); d is -0.5 in the original.
      const damp = 1 / (1 + dt * PHYSICS.linearDamping);
      b.vx *= damp;
      b.vy *= damp;
    }
    if (!active.length) return;

    // integrate
    for (const b of active) {
      if (b.asleep) continue;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
    }

    // contacts: velocity passes
    for (let pass = 0; pass < VELOCITY_PASSES; pass++) {
      for (let i = 0; i < active.length; i++) {
        const a = active[i];
        for (let j = i + 1; j < active.length; j++) {
          this._ballBall(a, active[j], r, pass === 0);
        }
        for (const w of this.walls) this._ballWall(a, w, r, pass === 0);
      }
    }
    // extra position-only passes to squeeze remaining overlap out of heaps
    for (let pass = 0; pass < POSITION_PASSES; pass++) {
      for (let i = 0; i < active.length; i++) {
        const a = active[i];
        for (let j = i + 1; j < active.length; j++) {
          this._ballBall(a, active[j], r, false, true);
        }
        for (const w of this.walls) this._ballWall(a, w, r, false, true);
      }
    }

    // Sleeping. A ball may only rest while something still holds it up from
    // below — a wall or another ball. Box2D wakes an island when a touching
    // body vanishes (e.g. gets captured by the belt); this support check is
    // our equivalent, or heaps would hang in mid-air over a drained throat.
    const touch = r * 2 + SLOP * 4;
    for (const b of active) {
      const speed2 = b.vx * b.vx + b.vy * b.vy;
      if (speed2 >= PHYSICS.sleepSpeed * PHYSICS.sleepSpeed) {
        b.sleepTimer = 0;
        b.asleep = false;
        continue;
      }
      let supported = false;
      for (const o of active) {
        if (o === b) continue;
        const dx = o.x - b.x;
        const dy = o.y - b.y;
        if (dy > 0.2 * r && dx * dx + dy * dy < touch * touch) {
          supported = true;
          break;
        }
      }
      if (!supported) supported = this._touchesWallBelow(b, r + SLOP * 4);
      if (!supported) {
        b.sleepTimer = 0;
        b.asleep = false;
        continue;
      }
      b.sleepTimer += dt;
      if (b.sleepTimer >= TIME_TO_SLEEP) {
        b.asleep = true;
        b.vx = 0;
        b.vy = 0;
      }
    }
  }

  // Is any static shape within `reach` of the ball's centre, below it?
  _touchesWallBelow(b, reach) {
    for (const w of this.walls) {
      if (w.type === "circle") {
        const dx = b.x - w.x;
        const dy = b.y - w.y;
        const min = reach + w.r;
        if (dx * dx + dy * dy < min * min && w.y > b.y) return true;
        continue;
      }
      const cos = Math.cos(w.angle);
      const sin = Math.sin(w.angle);
      const dx = b.x - w.x;
      const dy = b.y - w.y;
      const localX = dx * cos + dy * sin;
      const localY = -dx * sin + dy * cos;
      const cx = Math.max(-w.hw, Math.min(w.hw, localX));
      const cy = Math.max(-w.hh, Math.min(w.hh, localY));
      const ddx = localX - cx;
      const ddy = localY - cy;
      if (ddx * ddx + ddy * ddy < reach * reach) {
        // contact point below the centre?
        const wx = w.x + cx * cos - cy * sin;
        const wy = w.y + cx * sin + cy * cos;
        if (wy > b.y + 0.2 * reach) return true;
        void wx;
      }
    }
    return false;
  }

  _wake(b) {
    b.sleepTimer = 0;
    b.asleep = false;
  }

  _ballBall(a, b, r, applyRestitution, positionOnly = false) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const min = r * 2;
    const d2 = dx * dx + dy * dy;
    if (d2 >= min * min) return;
    const d = Math.sqrt(d2) || 0.0001;
    const nx = dx / d;
    const ny = dy / d;
    const pen = min - d;

    if (pen > SLOP) {
      const push = (pen - SLOP) * BAUMGARTE * 0.5;
      a.x -= nx * push;
      a.y -= ny * push;
      b.x += nx * push;
      b.y += ny * push;
      if (pen > SLOP * 2) {
        this._wake(a);
        this._wake(b);
      }
    }
    if (positionOnly) return;

    const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    if (rel >= 0) return;
    const e =
      applyRestitution && -rel > PHYSICS.restitutionThreshold
        ? PHYSICS.restitution
        : 0;
    const jn = (-(1 + e) * rel) / 2; // equal masses
    a.vx -= nx * jn;
    a.vy -= ny * jn;
    b.vx += nx * jn;
    b.vy += ny * jn;
    if (jn > 1) {
      this._wake(a);
      this._wake(b);
    }
  }

  _ballWall(b, w, r, applyRestitution, positionOnly = false) {
    let nx, ny, pen;
    if (w.type === "circle") {
      const dx = b.x - w.x;
      const dy = b.y - w.y;
      const min = r + w.r;
      const d2 = dx * dx + dy * dy;
      if (d2 >= min * min) return;
      const d = Math.sqrt(d2) || 0.0001;
      nx = dx / d;
      ny = dy / d;
      pen = min - d;
    } else {
      // circle vs oriented box: bring the centre into box space
      const cos = Math.cos(w.angle);
      const sin = Math.sin(w.angle);
      const dx = b.x - w.x;
      const dy = b.y - w.y;
      const localX = dx * cos + dy * sin;
      const localY = -dx * sin + dy * cos;
      const cx = Math.max(-w.hw, Math.min(w.hw, localX));
      const cy = Math.max(-w.hh, Math.min(w.hh, localY));
      let ddx = localX - cx;
      let ddy = localY - cy;
      const d2 = ddx * ddx + ddy * ddy;
      if (d2 > r * r) return;
      let d = Math.sqrt(d2);
      if (d < 0.0001) {
        // centre inside the box: push out along the shallowest axis
        const px = w.hw - Math.abs(localX);
        const py = w.hh - Math.abs(localY);
        if (px < py) {
          ddx = localX >= 0 ? 1 : -1;
          ddy = 0;
          d = 0;
          pen = r + px;
        } else {
          ddx = 0;
          ddy = localY >= 0 ? 1 : -1;
          d = 0;
          pen = r + py;
        }
      } else {
        ddx /= d;
        ddy /= d;
        pen = r - d;
      }
      nx = ddx * cos - ddy * sin;
      ny = ddx * sin + ddy * cos;
    }

    if (pen > SLOP) {
      const push = (pen - SLOP) * BAUMGARTE;
      b.x += nx * push;
      b.y += ny * push;
    }
    if (positionOnly) return;

    const rel = b.vx * nx + b.vy * ny;
    if (rel >= 0) return;
    const e =
      applyRestitution && -rel > PHYSICS.restitutionThreshold
        ? PHYSICS.restitution
        : 0;
    b.vx -= (1 + e) * rel * nx;
    b.vy -= (1 + e) * rel * ny;
    if ((1 + e) * -rel > 1) this._wake(b);
  }
}
