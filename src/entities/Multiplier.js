// Port of the original Multiplier.ts and the multiplier bar's visual prefab.
//
// Three pills. Each is a thin sensor line under the bar: an eligible ball
// crossing it keeps falling while two clones pop in just above the contact
// point (x3 total), the bar flashes its "multiply" animation, and all three
// balls play their glow pulse. Clones never multiply again.
import { Container, Sprite, Text } from "pixi.js";
import { LAYOUT, BALL_DIAMETER } from "../config.js";
import { Ball } from "./Ball.js";
import { audio } from "../audio.js";
import { tweenTo, ease } from "../tween.js";

const M = () => LAYOUT.multiplier;

class Pill {
  constructor(world, layer, x) {
    this.world = world;
    this.x = x;
    const m = M();
    const t = world.textures;

    const root = new Container();
    root.position.set(x, m.y);
    layer.addChild(root);
    this.root = root;

    // shadows
    const shadow = new Sprite(t.multShadow);
    shadow.anchor.set(0.5);
    shadow.position.set(0, m.shadow.dy);
    shadow.width = m.shadow.w;
    shadow.height = m.shadow.h;
    root.addChild(shadow);
    for (const side of [-1, 1]) {
      const post = new Sprite(t.multShadowPost);
      post.anchor.set(0.5);
      post.position.set(side * m.shadowPost.dx, m.shadowPost.dy);
      post.width = m.shadowPost.w;
      post.height = m.shadowPost.h;
      root.addChild(post);
    }

    // forcefield body + its lighter top band
    this.field = new Sprite(t.forcefield);
    this.field.anchor.set(0.5);
    this.field.width = m.forcefield.w;
    this.field.height = m.forcefield.h;
    root.addChild(this.field);
    this.fieldTop = new Sprite(t.forcefieldTop);
    this.fieldTop.anchor.set(0.5);
    this.fieldTop.position.set(0, m.forcefieldTop.dy);
    this.fieldTop.width = m.forcefieldTop.w;
    this.fieldTop.height = m.forcefieldTop.h;
    root.addChild(this.fieldTop);

    // ambient lightning, always crackling inside the field
    this.bolts = [];
    for (let i = 0; i < 3; i++) {
      const bolt = new Sprite(
        t.lightning[Math.floor(Math.random() * t.lightning.length)],
      );
      bolt.anchor.set(0.5);
      bolt.blendMode = "add";
      bolt.rotation = Math.PI / 2;
      bolt.alpha = 0;
      root.addChild(bolt);
      this.bolts.push({
        sprite: bolt,
        timer: Math.random() * 0.4,
      });
    }

    // posts with their moon knobs, standing at both pill edges
    for (const side of [-1, 1]) {
      const post = new Sprite(t.multPost);
      post.anchor.set(0.5);
      post.position.set(side * m.post.dx, 0);
      post.width = m.post.w;
      post.height = m.post.h;
      root.addChild(post);
      const knob = new Sprite(t.multPostBall);
      knob.anchor.set(0.5);
      knob.position.set(side * m.post.dx, m.postBall.dy);
      knob.width = m.postBall.w;
      knob.height = m.postBall.h;
      root.addChild(knob);
    }

    const label = new Text({
      text: "x3",
      style: {
        fontFamily: "Azeret Mono",
        fontWeight: "900",
        fontSize: m.labelSize,
        fill: 0xffffff,
        stroke: {
          color: m.labelStrokeColor,
          width: m.labelStroke,
          join: "round",
        },
      },
    });
    label.anchor.set(0.5);
    root.addChild(label);

    // the white flash the "multiply" clip plays over the field
    this.flash = new Sprite(t.forcefield);
    this.flash.anchor.set(0.5);
    this.flash.blendMode = "add";
    this.flash.width = m.forcefield.w;
    this.flash.height = m.forcefield.h;
    this.flash.alpha = 0;
    root.addChildAt(this.flash, root.getChildIndex(this.fieldTop) + 1);

    this._flashT = -1;
  }

  update(dt) {
    const m = M();
    // ambient bolts: short random flickers at random spots inside the field
    for (const b of this.bolts) {
      b.timer -= dt;
      if (b.timer <= 0) {
        const t = this.world.textures;
        b.sprite.texture =
          t.lightning[Math.floor(Math.random() * t.lightning.length)];
        b.sprite.position.set(
          (Math.random() - 0.5) * (m.forcefield.w - 40),
          (Math.random() - 0.5) * m.forcefield.h * 0.4,
        );
        const s = 0.35 + Math.random() * 0.3;
        b.sprite.height = m.forcefield.w * s;
        b.sprite.width = m.forcefield.h * (0.5 + Math.random() * 0.3);
        b.sprite.alpha = 0.5 + Math.random() * 0.5;
        b.timer = 0.05 + Math.random() * 0.35;
      } else {
        b.sprite.alpha *= Math.pow(0.02, dt); // fast decay
      }
    }
    // the "multiply" flash: a 0.5 s additive pulse over the field
    if (this._flashT >= 0) {
      this._flashT += dt;
      const k = Math.min(1, this._flashT / 0.5);
      this.flash.alpha = Math.sin(k * Math.PI) * 0.55;
      if (k >= 1) {
        this._flashT = -1;
        this.flash.alpha = 0;
      }
    }
  }

  playMultiplyAnim() {
    this._flashT = 0;
    // burst of bolts on hit
    for (const b of this.bolts) b.timer = 0;
  }
}

export class Multiplier {
  constructor(world, layer) {
    this.world = world;
    this.pills = M().xs.map((x) => new Pill(world, layer, x));
    this._nextTick = [];
  }

  update(dt) {
    if (this._nextTick.length) {
      const jobs = this._nextTick;
      this._nextTick = [];
      for (const job of jobs) job();
    }
    for (const pill of this.pills) pill.update(dt);

    // the sensor line: an eligible falling ball crossing it multiplies once
    const m = M();
    const r = BALL_DIAMETER / 2;
    for (const ball of Ball.getFreeBalls()) {
      if (ball.spawnedByMultiplier || ball.alreadyMultiplied) continue;
      if (Math.abs(ball.y - m.sensorY) > m.sensorHalfH + r) continue;
      for (const pill of this.pills) {
        if (Math.abs(ball.x - pill.x) > m.sensorHalfW + r) continue;
        ball.alreadyMultiplied = true;
        this._nextTick.push(() => this._triggerMultiply(ball, pill));
        break;
      }
    }
  }

  _triggerMultiply(ball, pill) {
    if (!ball || ball.destroyed) return;
    const contactX = ball.x;
    const contactY = ball.y;
    pill.playMultiplyAnim();
    audio.playMultiplier();
    ball.playGlowEffect();
    // the touched ball moves to the upper ball layer, keeping its position
    this.world.ballLayer2.addChild(ball);
    this._spawnContactEffect(contactX, contactY);
    // two clones at 120 and 240 degrees just above the contact point
    for (const angleDeg of [120, 240]) {
      const s = (angleDeg * Math.PI) / 180;
      const x = contactX + Math.sin(s) * M().spawnOffset;
      const y = contactY + Math.cos(s) * M().spawnOffset;
      this._spawnClone(x, y, ball.color);
    }
  }

  _spawnClone(x, y, color) {
    const clone = Ball.spawn(this.world.textures, this.world.ballLayer2);
    clone.setColor(color);
    clone.position.set(x, y);
    clone.initPhysics();
    clone.spawnedByMultiplier = true;
    this.world.physics.add(clone);
    clone.playGlowEffect();
    // dynamic one tick later, exactly like the original
    this._nextTick.push(() => {
      if (clone.destroyed || clone.capturedByCell || clone.takenByBox) return;
      clone.physicsActive = true;
    });
  }

  _spawnContactEffect(x, y) {
    const fx = new Sprite(this.world.textures.glow);
    fx.anchor.set(0.5);
    fx.blendMode = "add";
    fx.position.set(x, y);
    const size = BALL_DIAMETER * 2.2;
    fx.width = 1;
    fx.height = 1;
    fx.alpha = 1;
    this.world.ballLayer2.addChild(fx);
    const grow = { v: 0 };
    tweenTo(grow, { v: 1 }, 0.4, ease.sineOut, () => fx.destroy());
    const tick = () => {
      if (fx.destroyed) return;
      fx.width = size * grow.v;
      fx.height = size * grow.v;
      requestAnimationFrame(tick);
    };
    tick();
    tweenTo(fx, { alpha: 0 }, 0.4, ease.sineIn);
  }
}
