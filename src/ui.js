// UI ports: TapCounter.ts (global tap counting, first-tap CTA reveal),
// TutorialHand.ts (pointing glove with idle re-hints), the logo/CTA widgets,
// and VictoryWindow.ts / FailWindow.ts.
import { Container, Graphics, Sprite } from "pixi.js";
import { DESIGN_H, LAYOUT, WINDOWS } from "./config.js";
import { audio } from "./audio.js";
import { tweenTo, ease, delay, stopTweensOf } from "./tween.js";

// ---------------------------------------------------------------------------
// TapCounter — counts every tap anywhere (deduped against the box handler's
// explicit registerTap within 120 ms), reveals the CTA on tap #1 and calls
// the store redirect from tap #tapsToRedirect on. The shipped playable sets
// the threshold to 1000, so in practice only the reveal matters.
// ---------------------------------------------------------------------------
export class TapCounter {
  constructor(canvas, { tapsToRedirect = 1000, onFirstTap, onRedirect } = {}) {
    this.tapsToRedirect = tapsToRedirect;
    this.onFirstTap = onFirstTap;
    this.onRedirect = onRedirect;
    this._count = 0;
    this._lastTapTime = -1;
    // A DOM listener, not a stage hitArea: in Pixi v8 a hitArea on the stage
    // would swallow hit-testing for every interactive child.
    this._canvas = canvas;
    this._handler = () => this._tryCount();
    canvas.addEventListener("pointerup", this._handler, { passive: true });
  }

  // Scene teardown (the editor's rebuild) must drop the listener, or every
  // rebuild stacks another one still pointing at a destroyed CTA.
  destroy() {
    this._canvas.removeEventListener("pointerup", this._handler);
  }

  registerTap() {
    this._tryCount();
  }

  _tryCount() {
    const now = Date.now();
    if (this._lastTapTime >= 0 && now - this._lastTapTime < 120) return;
    this._lastTapTime = now;
    this._count++;
    if (this._count === 1) this.onFirstTap?.();
    if (this._count >= this.tapsToRedirect) this.onRedirect?.();
  }
}

// ---------------------------------------------------------------------------
// Tutorial hand
// ---------------------------------------------------------------------------
export class TutorialHand {
  constructor(layer, textures, world) {
    this.textures = textures;
    this.world = world;
    const H = LAYOUT.ui.hand;

    this.node = new Container();
    this.glove = new Sprite(textures.gloveHover);
    this.glove.anchor.set(0.5);
    this.glove.position.set(H.glove.dx, H.glove.dy);
    this.glove.width = H.glove.w;
    this.glove.height = H.glove.h;
    this.node.addChild(this.glove);
    this.node.visible = true;
    this.node.alpha = 0;
    this.node.scale.set(0);
    layer.addChild(this.node);

    this.visible = false;
    this.firstTapDone = false;
    this.idleTimer = 0;
    this.bobTimer = 0;
    this.baseX = 0;
    this.baseY = 0;
    this.currentTarget = null;
  }

  _setGlove(texture) {
    const H = LAYOUT.ui.hand;
    this.glove.texture = texture;
    this.glove.width = H.glove.w;
    this.glove.height = H.glove.h;
  }

  pointAt(target) {
    const H = LAYOUT.ui.hand;
    this.currentTarget = target;
    this.bobTimer = 0;
    this.baseX = target.x + H.offX;
    this.baseY = target.y + H.offY;
    this.node.position.set(this.baseX, this.baseY);
    this._setGlove(this.textures.gloveHover);
    if (!this.visible) this._show();
  }

  _pointAtSmooth(target) {
    const H = LAYOUT.ui.hand;
    this.currentTarget = target;
    this.bobTimer = 0;
    this.baseX = target.x + H.offX;
    this.baseY = target.y + H.offY;
    if (!this.visible) {
      this.node.position.set(this.baseX, this.baseY);
      this._show();
      return;
    }
    stopTweensOf(this.node);
    tweenTo(this.node, { x: this.baseX, y: this.baseY }, 0.3, ease.sineInOut);
  }

  _show() {
    if (this.visible) return;
    this.visible = true;
    stopTweensOf(this.node);
    stopTweensOf(this.node.scale);
    this.node.scale.set(0.5);
    this.node.alpha = 0;
    const d = LAYOUT.ui.hand.animDuration;
    tweenTo(this.node.scale, { x: 1, y: 1 }, d, ease.outBack);
    tweenTo(this.node, { alpha: 1 }, d, ease.sineOut);
  }

  hide() {
    if (!this.visible) return;
    this.visible = false;
    this.currentTarget = null;
    stopTweensOf(this.node);
    stopTweensOf(this.node.scale);
    const d = LAYOUT.ui.hand.animDuration;
    tweenTo(this.node.scale, { x: 0, y: 0 }, d, ease.inBack);
    tweenTo(this.node, { alpha: 0 }, d, ease.sineIn);
  }

  onBoxTapped() {
    this.firstTapDone = true;
    this.idleTimer = 0;
    if (!this.visible) return;
    this._setGlove(this.textures.gloveClick1);
    delay(0.1, () => this._setGlove(this.textures.gloveClick2));
    delay(0.2, () => this._setGlove(this.textures.gloveHover));
    delay(0.25, () => this.hide());
  }

  pointAtCTA(target) {
    this.firstTapDone = false;
    this.idleTimer = 0;
    if (!target) return;
    if (this.visible) this._pointAtSmooth(target);
    else this.pointAt(target);
  }

  showInitialHint() {
    const mgr = this.world.sourceBoxManager;
    if (!mgr.canLaunchBalls()) return;
    const boxes = mgr.getActiveBoxes();
    const blue = boxes.find((b) => b.color === "blue");
    const box = blue ?? boxes[0];
    if (box) this.pointAt(box.container);
  }

  _showIdleHint() {
    const mgr = this.world.sourceBoxManager;
    if (!mgr.canLaunchBalls()) return;
    const open = this.world.fillBoxManager.getOpenBoxColors();
    if (!open.size) return;
    const box = mgr.getActiveBoxes().find((b) => open.has(b.color));
    if (box) this.pointAt(box.container);
  }

  update(dt) {
    const H = LAYOUT.ui.hand;
    if (this.visible && !this.world.sourceBoxManager.canLaunchBalls()) {
      this.hide();
    }
    if (this.firstTapDone) {
      this.idleTimer += dt;
      if (this.idleTimer >= H.idleTimeout) {
        this.idleTimer = 0;
        this._showIdleHint();
      }
    }
    if (this.visible && this.currentTarget) {
      this.bobTimer += dt;
      const t =
        Math.sin((this.bobTimer / H.bobPeriod) * Math.PI * 2) * H.bobAmp;
      this.node.position.set(this.baseX, this.baseY + t);
    }
  }
}

// ---------------------------------------------------------------------------
// Logo + CTA (widget-anchored to the visible rect; Game re-lays them on fit)
// ---------------------------------------------------------------------------
export function buildLogo(layer, textures) {
  const L = LAYOUT.ui.logo;
  const logo = new Sprite(textures.logo);
  logo.anchor.set(0.5);
  logo.width = L.w;
  logo.height = L.h;
  layer.addChild(logo);
  logo.layoutWidget = (left) => {
    logo.position.set(left + L.left + L.w / 2, DESIGN_H - L.bottom - L.h / 2);
  };
  return logo;
}

export function buildCTA(layer, textures, { onClick } = {}) {
  const C = LAYOUT.ui.cta;
  const cta = new Sprite(textures.cta);
  cta.anchor.set(0.5);
  cta.width = C.w;
  cta.height = C.h;
  cta.visible = false;
  cta.scale.set(0);
  cta.eventMode = "static";
  cta.cursor = "pointer";
  cta.on("pointertap", () => onClick?.());
  layer.addChild(cta);
  cta.layoutWidget = (left, right) => {
    cta.position.set(right - C.right - C.w / 2, DESIGN_H - C.bottom - C.h / 2);
  };

  let revealed = false;
  // `instant` skips the pop-in. The editor uses it: you cannot drag a widget
  // that is waiting for a tap to appear, and a scene rebuild on every drag
  // frame would otherwise restart the tween and leave it pulsing under the
  // cursor.
  cta.reveal = (instant = false) => {
    if (revealed) return;
    revealed = true;
    const sx = C.w / cta.texture.width;
    const sy = C.h / cta.texture.height;
    cta.visible = true;
    if (instant) {
      cta.scale.set(sx, sy);
      return;
    }
    cta.scale.set(0);
    tweenTo(cta.scale, { x: sx * 1.15, y: sy * 1.15 }, 0.15, ease.outBack, () =>
      tweenTo(cta.scale, { x: sx, y: sy }, 0.1, ease.sineOut),
    );
  };
  return cta;
}

// ---------------------------------------------------------------------------
// Victory / Fail windows
// ---------------------------------------------------------------------------
export function buildVictoryWindow(layer, textures, world) {
  const V = LAYOUT.ui.victory;
  const win = new Container();
  win.visible = false;
  layer.addChild(win);

  const dark = new Graphics();
  dark
    .rect(375 - V.darkW / 2, 812 - V.darkH / 2, V.darkW, V.darkH)
    .fill(0x000000);
  dark.alpha = 0;
  dark.eventMode = "static"; // swallow touches like the original backdrop
  win.addChild(dark);

  const logo = new Sprite(textures.logo);
  logo.anchor.set(0.5);
  logo.position.set(375, V.logo.y);
  win.addChild(logo);

  const cta = new Sprite(textures.cta);
  cta.anchor.set(0.5);
  cta.position.set(375, V.cta.y);
  cta.eventMode = "static";
  cta.cursor = "pointer";
  win.addChild(cta);

  const logoScale = {
    x: V.logo.w / logo.texture.width,
    y: V.logo.h / logo.texture.height,
  };
  const ctaScale = {
    x: V.cta.w / cta.texture.width,
    y: V.cta.h / cta.texture.height,
  };

  win.show = () => {
    win.visible = true;
    dark.alpha = 0;
    logo.scale.set(0);
    cta.scale.set(0);
    audio.playVictory();
    world.tutorialHand?.pointAtCTA(cta);
    tweenTo(
      dark,
      { alpha: WINDOWS.backdropOpacity },
      WINDOWS.backdropFadeDuration,
      ease.sineInOut,
    );
    delay(0.5 * WINDOWS.backdropFadeDuration + WINDOWS.popInDelay, () => {
      tweenTo(logo.scale, logoScale, WINDOWS.popInDuration, ease.bounceOut);
      tweenTo(
        cta.scale,
        { x: ctaScale.x, y: ctaScale.y },
        WINDOWS.popInDuration,
        ease.bounceOut,
        () => {
          const pulse = () =>
            tweenTo(
              cta.scale,
              {
                x: ctaScale.x * WINDOWS.ctaPulseScale,
                y: ctaScale.y * WINDOWS.ctaPulseScale,
              },
              WINDOWS.ctaPulseDuration,
              ease.sineInOut,
              () =>
                tweenTo(
                  cta.scale,
                  ctaScale,
                  WINDOWS.ctaPulseDuration,
                  ease.sineInOut,
                  pulse,
                ),
            );
          pulse();
        },
      );
    });
  };
  return win;
}

export function buildFailWindow(layer, textures, world) {
  const F = LAYOUT.ui.fail;
  const win = new Container();
  win.visible = false;
  layer.addChild(win);

  // The original FailWindow has no visible backdrop (its Dark sprite has no
  // frame assigned) and its CTA node is inactive — just the FAIL badge.
  const badge = new Sprite(textures.failButton);
  badge.anchor.set(0.5);
  badge.position.set(375, F.badge.y);
  win.addChild(badge);
  const badgeScale = {
    x: F.badge.w / badge.texture.width,
    y: F.badge.h / badge.texture.height,
  };

  win.show = () => {
    win.visible = true;
    badge.scale.set(0);
    audio.playFail();
    world.tutorialHand?.pointAtCTA(null);
    delay(0.5 * WINDOWS.backdropFadeDuration + WINDOWS.popInDelay, () => {
      tweenTo(badge.scale, badgeScale, WINDOWS.popInDuration, ease.bounceOut);
    });
  };
  return win;
}
