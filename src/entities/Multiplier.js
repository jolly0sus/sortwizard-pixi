import { Container, Graphics, Text, TextStyle, Sprite } from "pixi.js";
import { LAYOUT } from "../config.js";
import { audio } from "../audio.js";
import { spawnFreeBall } from "./spawnBall.js";
import { tweenTo, ease } from "../tween.js";

const SPARKS_PER_PILL = 8;

const labelStyle = new TextStyle({
  fontFamily: "Azeret Mono, monospace",
  fontWeight: "900",
  fontSize: 30,
  fill: 0xffffff,
  stroke: { color: 0x0a4a8a, width: 6, join: "round" },
});

// Three forcefield pills sitting edge to edge to form one continuous bar,
// with a star/moon post standing at every pill boundary. A ball falling
// through a pill is tripled.
export class Multiplier {
  constructor(world) {
    this.world = world;
    const m = LAYOUT.multiplier;
    this.y = m.centerY;
    this.halfW = m.pillW / 2;
    this.spans = LAYOUT.pipes.xs.map((x) => [x - this.halfW, x + this.halfW]);

    this.layer = new Container();
    world.pipeLabelLayer.addChild(this.layer);

    // shadow cast by the whole bar onto the board
    for (const x of LAYOUT.pipes.xs) {
      const shade = new Sprite(world.textures.multShadow);
      shade.anchor.set(0.5);
      shade.width = m.pillW * 1.15;
      shade.height = m.pillH * 0.9;
      shade.x = x;
      shade.y = this.y + m.pillH * 0.55;
      shade.alpha = 0.3;
      this.layer.addChild(shade);
    }

    for (const x of LAYOUT.pipes.xs) {
      const field = new Sprite(world.textures.forcefield);
      field.anchor.set(0.5);
      field.width = m.pillW;
      field.height = m.pillH;
      field.x = x;
      field.y = this.y;
      this.layer.addChild(field);
    }

    // posts at every pill edge (adjacent pills therefore show a pair)
    const postLayer = new Container();
    this.layer.addChild(postLayer);
    for (const x of LAYOUT.pipes.xs) {
      for (const px of [x - this.halfW, x + this.halfW]) {
        const post = new Sprite(world.textures.multPost);
        post.anchor.set(0.5);
        post.width = m.postW;
        post.height = m.postH;
        post.x = px;
        post.y = this.y;
        postLayer.addChild(post);

        const knob = new Sprite(world.textures.multPostBall);
        knob.anchor.set(0.5);
        knob.width = m.postW * 0.92;
        knob.height = m.postW * 0.92;
        knob.x = px;
        knob.y = this.y - m.postH / 2;
        postLayer.addChild(knob);
      }
    }

    // Drifting bolts and sparkles inside each pill — the "white swirls on
    // water" the original animates across its forcefields. Clipped to the
    // pill so nothing leaks out over the board.
    this._t = 0;
    this.sparks = [];
    const fxLayer = new Container();
    this.layer.addChild(fxLayer);

    for (const x of LAYOUT.pipes.xs) {
      const clip = new Container();
      const mask = new Graphics()
        .roundRect(
          x - m.pillW / 2 + 3,
          this.y - m.pillH / 2 + 3,
          m.pillW - 6,
          m.pillH - 6,
          12,
        )
        .fill(0xffffff);
      fxLayer.addChild(mask);
      clip.mask = mask;
      fxLayer.addChild(clip);

      for (let i = 0; i < SPARKS_PER_PILL; i++) {
        const isBolt = i % 2 === 0;
        const spr = new Sprite(
          isBolt
            ? world.textures.lightning[i % world.textures.lightning.length]
            : world.textures.sparkle,
        );
        spr.anchor.set(0.5);
        spr.scale.set(
          isBolt ? 0.2 + Math.random() * 0.16 : 0.25 + Math.random() * 0.22,
        );
        spr.blendMode = "add";
        clip.addChild(spr);
        this.sparks.push({
          spr,
          minX: x - m.pillW / 2,
          span: m.pillW,
          offX: Math.random() * m.pillW,
          baseY: this.y + (Math.random() - 0.5) * (m.pillH - 16),
          speed: 12 + Math.random() * 26,
          phase: Math.random() * Math.PI * 2,
          rate: 1.5 + Math.random() * 2.2,
          peak: isBolt ? 0.7 : 0.9,
        });
      }
    }

    for (const x of LAYOUT.pipes.xs) {
      const label = new Text({ text: "x3", style: labelStyle });
      label.anchor.set(0.5);
      label.x = x;
      label.y = this.y;
      this.layer.addChild(label);
    }
  }

  _animateSparks(dt) {
    this._t += dt;
    for (const s of this.sparks) {
      s.offX = (s.offX + s.speed * dt) % s.span;
      const wave = Math.sin(this._t * s.rate + s.phase);
      s.spr.x = s.minX + s.offX;
      s.spr.y = s.baseY + wave * 3;
      s.spr.alpha = s.peak * (0.2 + 0.8 * (0.5 + 0.5 * wave));
    }
  }

  _inPill(x) {
    return this.spans.some(([a, b]) => x >= a && x <= b);
  }

  update(dt) {
    this._animateSparks(dt);
    for (const ball of this.world.freeBalls) {
      if (ball.alreadyMultiplied) continue;
      if (ball.vy <= 0) continue; // only while falling downward
      if (ball.y < this.y) continue;
      if (!this._inPill(ball.x)) continue;
      ball.alreadyMultiplied = true;
      this._trigger(ball);
    }
  }

  _trigger(ball) {
    audio.playMultiplier();
    this._popFx(ball.x, ball.y);
    for (const deg of [120, 240]) {
      const rad = (deg * Math.PI) / 180;
      const offset = 40;
      spawnFreeBall(this.world, {
        x: ball.x + Math.sin(rad) * offset,
        y: ball.y - Math.cos(rad) * offset,
        color: ball.color,
        vx: (Math.random() - 0.5) * 120,
        vy: -40,
        alreadyMultiplied: true,
        // children stay in the parent's column so they clear the same pill
        laneX: ball.laneX,
      });
    }
  }

  _popFx(x, y) {
    const spr = new Sprite(this.world.textures.glow);
    spr.anchor.set(0.5);
    spr.x = x;
    spr.y = y;
    spr.alpha = 0.9;
    spr.scale.set(0.2);
    spr.blendMode = "add";
    this.world.fxLayer.addChild(spr);
    tweenTo(spr.scale, { x: 1.4, y: 1.4 }, 0.35, ease.sineOut);
    tweenTo(spr, { alpha: 0 }, 0.35, ease.sineIn, () => spr.destroy());
  }
}
