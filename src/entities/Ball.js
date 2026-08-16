// Port of the original Ball.ts + its prefab: a 56-unit node with a "Visual"
// sprite and a glow overlay, pooled, carrying the ownership flags the rest of
// the game keys off. The physics body is the entity itself — the solver in
// physics.js reads x/y/vx/vy straight off it.
import { Container, Sprite } from "pixi.js";
import { BALL, LAUNCH } from "../config.js";
import { tweenTo, ease } from "../tween.js";

export class Ball extends Container {
  static pool = [];
  static all = new Set();

  constructor(textures) {
    super();
    this.textures = textures;

    this.visual = new Sprite();
    this.visual.anchor.set(0.5);
    this.visual.width = BALL.visual;
    this.visual.height = BALL.visual;
    this.addChild(this.visual);

    this.glowSprite = new Sprite();
    this.glowSprite.anchor.set(0.5);
    this.glowSprite.width = BALL.glowW;
    this.glowSprite.height = BALL.glowH;
    this.glowSprite.position.set(BALL.glowDX, BALL.glowDY);
    this.glowSprite.visible = false;
    this.addChild(this.glowSprite);

    this.reset();
  }

  reset() {
    this.color = null;
    this.capturedByCell = false;
    this.takenByBox = false;
    this.owningCell = null;
    this.spawnedByMultiplier = false;
    this.alreadyMultiplied = false;
    // physics state
    this.physicsActive = false; // true only while the body is Dynamic
    this.vx = 0;
    this.vy = 0;
    this.sleepTimer = 0;
    this.asleep = false;
    // belt bookkeeping (Ball.recordConveyorPrevPos in the original)
    this.prevConveyorX = 0;
    this.prevConveyorY = 0;
    this.hasPrevConveyorPos = false;

    this.scale.set(1);
    this.alpha = 1;
    this.rotation = 0;
    this.visual.scale.set(BALL.visual / this.visual.texture?.width || 1);
    this.visual.visible = true;
    this.glowSprite.visible = false;
    this.glowSprite.alpha = 1;
  }

  setColor(color) {
    this.color = color;
    this.visual.texture = this.textures.ball[color];
    this.visual.width = BALL.visual;
    this.visual.height = BALL.visual;
  }

  // Static lit state — the persistent highlight used while a ball sits in a
  // tray well.
  setGlowSprite(on) {
    if (on) {
      this.glowSprite.texture = this.textures.ballLit[this.color];
      this.glowSprite.width = BALL.glowW;
      this.glowSprite.height = BALL.glowH;
      this.glowSprite.alpha = 1;
      this.glowSprite.visible = true;
    } else {
      this.glowSprite.visible = false;
    }
  }

  // Glow pulse: node pops 0.5 -> 1 (backOut 0.45s) while the glow overlay
  // fades out (sineIn 0.45s). Used on multiplication.
  playGlowEffect() {
    this.scale.set(0.5);
    tweenTo(this.scale, { x: 1, y: 1 }, 0.45, ease.outBack);
    this.glowSprite.texture = this.textures.ballLit[this.color];
    this.glowSprite.width = BALL.glowW;
    this.glowSprite.height = BALL.glowH;
    this.glowSprite.alpha = 1;
    this.glowSprite.visible = true;
    tweenTo(this.glowSprite, { alpha: 0 }, 0.45, ease.sineIn, () => {
      this.glowSprite.visible = false;
      this.glowSprite.alpha = 1;
    });
  }

  // Spawn-time reset (initPhysics in the original): inert until launched.
  initPhysics() {
    Ball.all.add(this);
    this.capturedByCell = false;
    this.takenByBox = false;
    this.owningCell = null;
    this.spawnedByMultiplier = false;
    this.alreadyMultiplied = false;
    this.hasPrevConveyorPos = false;
    this.physicsActive = false;
    this.vx = 0;
    this.vy = 0;
    this.sleepTimer = 0;
    this.asleep = false;
    this.scale.set(1);
    this.rotation = 0;
    this.glowSprite.visible = false;
  }

  // The throw out of the box: not physics at first — the ball is tweened
  // straight down, then released to the solver with the tween's exit speed
  // and a random sideways kick.
  playLaunchAnimation(x, y) {
    this.position.set(x, y);
    this.scale.set(1);
    tweenTo(this, { y: y + LAUNCH.drop }, LAUNCH.duration, ease.inQuad, () =>
      this._releasePhysics(),
    );
    // squash/stretch on the sprite, in parallel: 0.35/0.65 of the descent
    const v = this.visual.scale.x;
    tweenTo(
      this.visual.scale,
      { x: v * 1.15, y: v * 1.15 },
      LAUNCH.duration * 0.35,
      ease.sineOut,
      () =>
        tweenTo(
          this.visual.scale,
          { x: v, y: v },
          LAUNCH.duration * 0.65,
          ease.sineIn,
        ),
    );
  }

  _releasePhysics() {
    if (this.destroyed || this.capturedByCell || this.takenByBox) return;
    this.physicsActive = true;
    this.asleep = false;
    this.sleepTimer = 0;
    this.vx = (Math.random() - 0.5) * 2 * LAUNCH.releaseVXRange;
    this.vy = LAUNCH.releaseVY;
  }

  recordConveyorPrevPos(x, y) {
    this.prevConveyorX = x;
    this.prevConveyorY = y;
    this.hasPrevConveyorPos = true;
  }

  // Belt capture: the body goes kinematic (solver ignores it) and stops.
  captureIntoCell() {
    this.hasPrevConveyorPos = false;
    this.physicsActive = false;
    this.vx = 0;
    this.vy = 0;
    this.capturedByCell = true;
    return true;
  }

  // Leaving a cell for a tray: flagged and inert; the tray animates it.
  prepareForBox() {
    this.takenByBox = true;
    this.capturedByCell = true;
    this.hasPrevConveyorPos = false;
    this.physicsActive = false;
    this.vx = 0;
    this.vy = 0;
  }

  static getFreeBalls() {
    const out = [];
    for (const b of Ball.all) {
      if (!b.destroyed && !b.capturedByCell && !b.takenByBox) out.push(b);
    }
    return out;
  }

  static getFreeBallCount() {
    let n = 0;
    for (const b of Ball.all) {
      if (!b.destroyed && !b.capturedByCell && !b.takenByBox) n++;
    }
    return n;
  }

  static getConveyorBalls() {
    const out = [];
    for (const b of Ball.all) {
      if (!b.destroyed && !b.takenByBox && b.owningCell) out.push(b);
    }
    return out;
  }

  static getTotalBallCount() {
    return Ball.all.size;
  }

  static spawn(textures, parent) {
    const ball = Ball.pool.pop() ?? new Ball(textures);
    ball.reset();
    parent.addChild(ball);
    return ball;
  }

  static despawn(ball) {
    Ball.all.delete(ball);
    ball.owningCell = null;
    ball.parent?.removeChild(ball);
    Ball.pool.push(ball);
  }

  static clearPool() {
    for (const ball of Ball.pool) ball.destroy({ children: true });
    Ball.pool.length = 0;
    Ball.all.clear();
  }
}
