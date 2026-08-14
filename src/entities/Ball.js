import { Container, Sprite, Texture } from "pixi.js";
import { BALL_DIAMETER } from "../config.js";

const pool = [];

export class Ball extends Container {
  constructor() {
    super();
    this.sprite = new Sprite(Texture.EMPTY);
    this.sprite.anchor.set(0.5);
    this.sprite.width = BALL_DIAMETER;
    this.sprite.height = BALL_DIAMETER;
    this.addChild(this.sprite);

    this.color = null;
    this.capturedByCell = false;
    this.takenByBox = false;
    this.owningCell = null;
    this.spawnedByMultiplier = false;
    this.alreadyMultiplied = false;
    // x of the pipe this ball came from; it is held inside that column until
    // it clears the multiplier so it can only ever pass through its own pill
    this.laneX = null;
    this.distAlongPath = 0;
    this.freeFalling = false;
    this.vx = 0;
    this.vy = 0;
  }

  setColor(color, normalTex, litTex) {
    this.color = color;
    this._normalTex = normalTex;
    this._litTex = litTex;
    this.sprite.texture = normalTex;
  }

  glow(on) {
    this.sprite.texture = on
      ? (this._litTex ?? this._normalTex)
      : this._normalTex;
  }

  reset() {
    this.capturedByCell = false;
    this.takenByBox = false;
    this.owningCell = null;
    this.spawnedByMultiplier = false;
    this.alreadyMultiplied = false;
    this.laneX = null;
    this.distAlongPath = 0;
    this.freeFalling = false;
    this.scale.set(1);
    this.alpha = 1;
    this.rotation = 0;
    this.glow(false);
  }

  static spawn(parent) {
    const b = pool.pop() ?? new Ball();
    b.reset();
    parent.addChild(b);
    return b;
  }

  static despawn(ball) {
    if (!ball) return;
    if (ball.parent) ball.parent.removeChild(ball);
    pool.push(ball);
  }

  // Called when the scene is torn down: the pooled balls are about to be
  // destroyed along with it, so they must not be handed out again.
  static clearPool() {
    pool.length = 0;
  }
}
