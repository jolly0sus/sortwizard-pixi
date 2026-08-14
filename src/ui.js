import { Container, Sprite, Graphics, Text, TextStyle } from "pixi.js";
import { DESIGN_W, DESIGN_H, LAYOUT } from "./config.js";
import { audio } from "./audio.js";
import { tweenTo, ease, delay } from "./tween.js";

export function buildLogo(root, textures) {
  const logo = new Sprite(textures.logo);
  logo.anchor.set(0, 1);
  logo.x = LAYOUT.logo.x;
  logo.y = LAYOUT.logo.y + 154;
  logo.width = LAYOUT.logo.w;
  logo.height = LAYOUT.logo.w * (textures.logo.height / textures.logo.width);
  root.addChild(logo);
  return logo;
}

const ctaTextStyle = new TextStyle({
  fontFamily: "Azeret Mono, monospace",
  fontWeight: "900",
  fontSize: 26,
  fill: 0xffffff,
  stroke: { color: 0x0a5a1e, width: 5, join: "round" },
});

export function buildCTA(root, { label = "Play Now For Free", onClick } = {}) {
  const c = LAYOUT.cta;
  const container = new Container();
  container.x = c.x + c.w / 2;
  container.y = c.y + c.h / 2;
  container.visible = false;
  container.scale.set(0);
  container.eventMode = "static";
  container.cursor = "pointer";

  const bg = new Graphics()
    .roundRect(-c.w / 2, -c.h / 2, c.w, c.h, c.h / 2)
    .fill({ color: 0x35c422 })
    .stroke({ color: 0x1c7a10, width: 5, alignment: 1 });
  container.addChild(bg);

  const text = new Text({ text: label, style: ctaTextStyle });
  text.anchor.set(0.5);
  container.addChild(text);

  container.on("pointertap", () => onClick?.());
  root.addChild(container);
  return container;
}

export function revealCTA(container) {
  if (container.visible) return;
  container.visible = true;
  tweenTo(container.scale, { x: 1.15, y: 1.15 }, 0.15, ease.outBack, () => {
    tweenTo(container.scale, { x: 1, y: 1 }, 0.1, ease.sineOut, () =>
      startPulse(container),
    );
  });
}

function startPulse(container) {
  const loop = () => {
    tweenTo(container.scale, { x: 1.08, y: 1.08 }, 0.6, ease.sineInOut, () => {
      tweenTo(container.scale, { x: 1, y: 1 }, 0.6, ease.sineInOut, loop);
    });
  };
  loop();
}

// Global tap counter: reveals the persistent CTA after the first tap
// anywhere, and fires onRedirect after N total taps (mirrors TapCounter.ts).
export class TapCounter {
  constructor(stage, cta, { tapsToRedirect = 5, onRedirect } = {}) {
    this.count = 0;
    this.tapsToRedirect = tapsToRedirect;
    this.onRedirect = onRedirect;
    this.cta = cta;
    stage.eventMode = "static";
    stage.hitArea = { contains: () => true };
    stage.on("pointerdown", () => this._tap());
  }
  registerTap() {
    this._tap();
  }
  _tap() {
    this.count++;
    if (this.count === 1) revealCTA(this.cta);
    if (this.count >= this.tapsToRedirect) this.onRedirect?.();
  }
}

export class TutorialHand {
  constructor(root, textures) {
    this.container = new Container();
    this.container.visible = false;
    this.container.scale.set(0);
    root.addChild(this.container);

    // texture is trimmed to the hand itself, so these are its real on-screen
    // dimensions; anchor sits on the fingertip
    this.sprite = new Sprite(textures.gloveHover);
    this.sprite.anchor.set(0.3, 0.04);
    this.sprite.width = 112;
    this.sprite.height = 158;
    this.container.addChild(this.sprite);
    this.textures = textures;

    this._visible = false;
    this._bobTimer = 0;
    this._target = null;
    this._base = { x: 0, y: 0 };
  }

  pointAt(node) {
    this._target = node;
    this._base = { x: node.x + 40, y: node.y - 30 };
    this.container.x = this._base.x;
    this.container.y = this._base.y;
    this.sprite.texture = this.textures.gloveHover;
    if (!this._visible) this._show();
  }

  _show() {
    this._visible = true;
    this.container.visible = true;
    tweenTo(this.container.scale, { x: 1, y: 1 }, 0.35, ease.outBack);
  }

  hide() {
    if (!this._visible) return;
    this._visible = false;
    tweenTo(
      this.container.scale,
      { x: 0, y: 0 },
      0.3,
      ease.inBack,
      () => (this.container.visible = false),
    );
  }

  onBoxTapped() {
    if (!this._visible) return;
    this.sprite.texture = this.textures.gloveClick1;
    delay(0.1, () => {
      this.sprite.texture = this.textures.gloveClick2;
      delay(0.15, () => this.hide());
    });
  }

  update(dt) {
    if (!this._visible || !this._target) return;
    this._bobTimer += dt;
    const off = Math.sin((this._bobTimer / 0.9) * Math.PI * 2) * 10;
    this.container.y = this._base.y + off;
  }
}

const popupLabelStyle = new TextStyle({
  fontFamily: "Azeret Mono, monospace",
  fontWeight: "900",
  fontSize: 30,
  fill: 0xffffff,
  stroke: { color: 0x0a5a1e, width: 5, join: "round" },
});

export function buildPopup(root, textures, { kind, onCta } = {}) {
  const container = new Container();
  container.visible = false;
  root.addChild(container);

  // Fill at full alpha and fade the node instead — a zero-alpha fill would
  // stay invisible no matter what the tween does to the node's alpha.
  //
  // Drawn far past the design rect on every side. The stage is letterboxed:
  // scaled to fit and centred, with no mask, so on any screen whose aspect
  // ratio is not exactly 750x1624 there are bands outside those bounds. A
  // backdrop of exactly DESIGN_W x DESIGN_H leaves them undimmed and the
  // overlay stops visibly short of the edges. The overscan costs nothing —
  // it is a flat fill — and covers anything up to a 5:1 screen.
  const OVERSCAN = 2;
  const backdrop = new Graphics()
    .rect(
      -DESIGN_W * OVERSCAN,
      -DESIGN_H * OVERSCAN,
      DESIGN_W * (1 + 2 * OVERSCAN),
      DESIGN_H * (1 + 2 * OVERSCAN),
    )
    .fill({ color: 0x000000 });
  backdrop.alpha = 0;
  container.addChild(backdrop);

  const centerX = DESIGN_W / 2;
  // Centred in the upper board section, which ends where the traced silhouette
  // starts closing into the funnel. Read from the profile rather than from a
  // constant: the outline is traced off the reference and re-traceable, and the
  // constant this used to read (board.bottomTop) went away with the modelled
  // shape — leaving centerY as NaN, which parked the badge and the button
  // nowhere at all. The backdrop still faded in, so a lost run dimmed the
  // screen and showed nothing else.
  const funnelTop = LAYOUT.board.profile[0][0];
  const centerY = LAYOUT.board.y + (funnelTop - LAYOUT.board.y) / 2;

  let badge;
  if (kind === "fail") {
    badge = new Sprite(textures.failButton);
    badge.anchor.set(0.5);
    badge.width = badge.height = 420;
  } else {
    badge = new Sprite(textures.logo);
    badge.anchor.set(0.5);
    badge.width = 420;
    badge.height = 420 * (textures.logo.height / textures.logo.width);
  }
  badge.x = centerX;
  badge.y = centerY;
  container.addChild(badge);
  // width/height leave the sprite at a fractional scale, so the pop-in has to
  // animate back to *that*, not to 1 — otherwise it snaps to texture size.
  const badgeScale = badge.scale.x;

  const cta = new Container();
  cta.x = centerX;
  cta.y = centerY + 300;
  cta.eventMode = "static";
  cta.cursor = "pointer";
  const ctaBg = new Graphics()
    .roundRect(-160, -45, 320, 90, 45)
    .fill({ color: 0x35c422 })
    .stroke({ color: 0x1c7a10, width: 6 });
  cta.addChild(ctaBg);
  const ctaText = new Text({
    text: "Play Now For Free",
    style: popupLabelStyle,
  });
  ctaText.anchor.set(0.5);
  ctaText.scale.set(0.75);
  cta.addChild(ctaText);
  cta.on("pointertap", () => onCta?.());
  container.addChild(cta);

  return {
    container,
    show() {
      container.visible = true;
      backdrop.alpha = 0;
      badge.scale.set(0);
      cta.scale.set(0);
      kind === "fail" ? audio.playFail() : audio.playVictory();
      tweenTo(backdrop, { alpha: 0.7 }, 0.4, ease.sineInOut);
      delay(0.4, () => {
        tweenTo(
          badge.scale,
          { x: badgeScale, y: badgeScale },
          0.45,
          ease.bounceOut,
        );
        delay(0.1, () => {
          tweenTo(cta.scale, { x: 1, y: 1 }, 0.45, ease.bounceOut, () => {
            const loop = () => {
              tweenTo(
                cta.scale,
                { x: 1.08, y: 1.08 },
                0.6,
                ease.sineInOut,
                () => {
                  tweenTo(cta.scale, { x: 1, y: 1 }, 0.6, ease.sineInOut, loop);
                },
              );
            };
            loop();
          });
        });
      });
    },
  };
}
