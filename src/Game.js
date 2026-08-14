import { Application, Assets, Container, Texture, Rectangle } from "pixi.js";
import {
  DESIGN_W,
  DESIGN_H,
  IMG,
  ALL_COLORS,
  BALL_TEXTURES,
  BALL_LIT_TEXTURES,
  BOX_BASE_TEXTURES,
  BOX_LID_TEXTURES,
  TRAY_EMPTY_TEXTURES,
  TRAY_MARBLES_TEXTURES,
  TRAY_INACTIVE_TEXTURES,
  BALL_DIAMETER,
  LAYOUT,
  ECONOMY,
  FONT,
} from "./config.js";
import { buildBoard, ballHalfWidthAt, boardCx } from "./entities/Board.js";
import { Conveyor } from "./entities/Conveyor.js";
import { SourceBoxManager } from "./entities/SourceBoxes.js";
import { FillBoxManager } from "./entities/FillBoxes.js";
import { Multiplier } from "./entities/Multiplier.js";
import { Ball } from "./entities/Ball.js";
import { cancelAll } from "./tween.js";
import { mountHud } from "./hud.js";
import {
  buildLogo,
  buildCTA,
  TapCounter,
  TutorialHand,
  buildPopup,
} from "./ui.js";

const GRAVITY = 900;
// Contact handling for a heap of balls. A little tolerated overlap and a
// partial push stop the pile from vibrating; the rest kills the energy that
// made balls hop off one another.
const SLOP = 1.5;
const SEPARATION = 0.7;
const FRICTION = 0.25;
// Below this, a contact is treated as resting and the motion is dropped.
const SLEEP_SPEED = 26;
// Matches the original's maxFreeBalls: taps are refused (box shakes) while
// this many balls are loose on the board.
// Column pen: half a pill wide, released just past the multiplier line.
// Read live rather than cached, so the editor can move the bar and have the
// physics follow without a reload.
const laneHalf = () => LAYOUT.multiplier.pillW / 2;
const laneReleaseY = () => LAYOUT.multiplier.centerY + 46;
// How fast a ball may sink once the board starts closing in, in px/s. The
// funnel is a bottleneck and has to read as one: in free fall a ball entered
// the waist at ~700px/s and a whole box poured onto the belt in under two
// seconds, which looked like a chute rather than a crowd being squeezed. The
// cap eases from the first of these at the top of the pinch down to the second
// at the waist, and holds there until the belt, so the balls bunch up above
// the neck and go through in single file. Nothing above the funnel is touched
// — the throw out of the box has to stay lively.
const FUNNEL_ENTRY_FALL = 420;
const THROAT_FALL = 150;
// The traced silhouette's first row is where the flanks begin to converge.
const funnelTopY = () => LAYOUT.board.profile[0][0];
function funnelFallCap(y) {
  const top = funnelTopY();
  if (y <= top) return Infinity;
  const t = Math.min(
    1,
    (y - top) / Math.max(1, LAYOUT.board.waistBottom - top),
  );
  return FUNNEL_ENTRY_FALL + (THROAT_FALL - FUNNEL_ENTRY_FALL) * t;
}
// How long a dead board must stay dead before the fail screen shows. Measured
// in laps rather than seconds so it tracks the belt speed: a ball needs one
// full lap to pass every column and prove nothing wants it. One and a half
// laps is the shortest that still cannot fire on a board that is merely busy.
const JAM_FAIL_SECONDS = 1.5 * LAYOUT.conveyor.loopSeconds;

// Phones are the target, and three defaults are wrong for them. MSAA on the
// default framebuffer costs real bandwidth on tile-based mobile GPUs for very
// little here — the art is sprites, and only the procedural board edges gain
// from it. PixiJS also prefers WebGPU when it can, which on Android browsers
// ranges from fine to badly broken, so the renderer is pinned to WebGL. And a
// phone's drawing buffer is capped: at devicePixelRatio 3 a tall screen means
// a canvas of several million pixels to fill every frame.
const isCoarsePointer =
  typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
const MAX_MOBILE_RESOLUTION = 2;

export async function createGame(containerEl) {
  const app = new Application();
  await app.init({
    background: 0x4f0589,
    resizeTo: window,
    antialias: !isCoarsePointer,
    preference: "webgl",
    resolution: isCoarsePointer
      ? Math.min(globalThis.devicePixelRatio || 1, MAX_MOBILE_RESOLUTION)
      : 1,
    autoDensity: isCoarsePointer,
  });
  containerEl.appendChild(app.canvas);

  await loadFont();
  const textures = await loadTextures();

  let scene = buildScene(app, textures);

  // Mobile browsers fire resize continuously while the address bar slides in
  // and out, and each one reallocates the drawing buffer. Coalesce them into
  // the next frame, and ignore the ones that only change height by a little,
  // which is exactly what that address bar does.
  let resizeQueued = false;
  let lastW = globalThis.innerWidth;
  let lastH = globalThis.innerHeight;
  window.addEventListener("resize", () => {
    const w = globalThis.innerWidth;
    const h = globalThis.innerHeight;
    if (w === lastW && Math.abs(h - lastH) < 120) return;
    lastW = w;
    lastH = h;
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(() => {
      resizeQueued = false;
      scene.fit();
    });
  });

  return {
    app,
    textures,
    // The editor overlay mirrors this transform so it can draw in design
    // coordinates; it is replaced on every rebuild, hence the getter.
    getRoot: () => scene.root,
    getScene: () => scene,
    // Tear the board down and lay it out again from the current LAYOUT — this
    // is what lets the editor apply a change without a page reload.
    rebuild() {
      scene.destroy();
      scene = buildScene(app, textures);
    },
  };
}

function buildScene(app, textures) {
  const stageRoot = new Container();
  app.stage.addChild(stageRoot);

  const fit = () => fitToScreen(app, stageRoot);
  fit();

  buildBoard(stageRoot, textures);

  const boxLayer = new Container();
  const pipeLabelLayer = new Container();
  const conveyorLayer = new Container();
  const fillLayer = new Container();
  const ballLayer = new Container();
  const fxLayer = new Container();
  const uiLayer = new Container();
  stageRoot.addChild(
    boxLayer,
    pipeLabelLayer,
    conveyorLayer,
    fillLayer,
    ballLayer,
    fxLayer,
    uiLayer,
  );

  const world = {
    textures,
    boxLayer,
    pipeLabelLayer,
    fillLayer,
    ballLayer,
    fxLayer,
    freeBalls: new Set(),
    // The economy is closed and nothing leaves the belt, so every ball that
    // misses its tray rides forever and slowly strangles the loop. The board
    // refuses a tap it plainly cannot take — the box shakes, as in the
    // original — but it allows a partial fit, and that is where the game
    // lives: take the half-fits and the leftovers pile up until the belt
    // deadlocks; hold out for taps the open trays can swallow whole and it
    // stays clean to the end.
    canLaunchBalls() {
      // Nothing is ever refused. Not the colour — tapping one the front is
      // not asking for is the losing move, and blocking it would remove the
      // only way to lose. And not the belt either: sending several boxes at
      // once is allowed, the surplus simply waits above the loop for a slot
      // to come free. Firing more than the board can take is a mistake the
      // player is entitled to make.
      return true;
    },
    checkVictory() {
      // Only a hint that something finished; the ticker owns the real test so
      // a win can't be missed just because balls were still in flight.
      if (fillBoxManager.totalCleared >= fillBoxManager.totalTilesPlanned) {
        maybeShowResult("win");
      }
    },
  };

  // Nothing ever leaves the belt: a ball that finds no home keeps riding until
  // a tray of its colour opens. That means the economy has to be closed --
  // every ball dealt has a slot waiting somewhere -- because a surplus ball
  // occupies a slot forever and the loop deadlocks. See config.js ECONOMY.
  const conveyor = new Conveyor(conveyorLayer, textures, {
    onBallLost(ball) {
      // Let go rather than deleted: it drops out of the slot, falls past the
      // board and is only recycled once it is off the screen.
      ball.discarded = true;
      ball.freeFalling = true;
      ball.vx = (Math.random() - 0.5) * 40;
      ball.vy = 60;
      world.freeBalls.add(ball);
      conveyor.registerFreeBall(ball);
    },
  });
  world.conveyor = conveyor;

  const fillBoxManager = new FillBoxManager(world);
  world.fillBoxManager = fillBoxManager;

  const multiplier = new Multiplier(world);

  const tutorialHand = new TutorialHand(uiLayer, textures);
  world.tutorialHand = tutorialHand;

  const sourceBoxManager = new SourceBoxManager(world);

  buildLogo(uiLayer, textures);
  const cta = buildCTA(uiLayer, { onClick: () => {} });

  let resultShown = false;
  function maybeShowResult(kind) {
    if (resultShown) return;
    resultShown = true;
    (kind === "win" ? victoryPopup : failPopup).show();
  }

  const victoryPopup = buildPopup(uiLayer, textures, { kind: "win" });
  const failPopup = buildPopup(uiLayer, textures, { kind: "fail" });

  new TapCounter(app.stage, cta, { tapsToRedirect: 5, onRedirect: () => {} });

  let jamTimer = 0;
  let winTimer = 0;
  let spentTimer = 0;

  // initial hint: point at a box whose colour an open tray is waiting for
  const hintTimer = setTimeout(() => {
    const wanted = fillBoxManager.getOpenColors();
    const slot =
      sourceBoxManager.slots.find((s) => wanted.has(s.color)) ??
      sourceBoxManager.slots[0];
    tutorialHand.pointAt(slot.container);
  }, 500);

  const tick = (ticker) => {
    const dt = Math.min(0.05, ticker.deltaMS / 1000);

    updateFreeBalls(world, conveyor, dt);
    conveyor.update(dt);
    multiplier.update(dt);
    fillBoxManager.update();
    tutorialHand.update(dt);

    if (
      !resultShown &&
      fillBoxManager.totalCleared >= fillBoxManager.totalTilesPlanned
    ) {
      winTimer += dt;
      if (winTimer >= 0.6) maybeShowResult("win");
    }

    // Deadlock check. The belt has to stay jammed with nothing the open trays
    // want for a moment before it counts, so a tray swapping mid-frame can't
    // trigger a fail the player had no chance to avoid.
    if (!resultShown) {
      let jammed = false;
      // Balls already committed to the loop: riding it, plus the ones still
      // falling that are on their way to it. Counting the fallers is what
      // makes the verdict prompt — waiting for the belt to physically fill up
      // took 21 seconds after a wrong tap, even though the run was decided the
      // moment those 27 homeless balls left the box.
      const riding = conveyor.getOccupiedCells().map((c) => c.ball);
      const committed = [...riding, ...world.freeBalls];
      const pending = sourceBoxManager.pendingByColor();
      // A ball that has not reached the x3 bar yet is three balls in waiting,
      // and counting it as one was most of the delay: the check sat at 9 of
      // the 27 it needed until the last one had crossed.
      let total = committed.reduce(
        (n, b) => n + (b && !b.alreadyMultiplied ? ECONOMY.multiplier : 1),
        0,
      );
      for (const n of pending.values()) total += n;
      if (total >= conveyor.cells.length) {
        const openColors = fillBoxManager.getOpenColors();
        jammed =
          !committed.some((b) => b && openColors.has(b.color)) &&
          ![...pending.keys()].some((c) => openColors.has(c));
      }
      jamTimer = jammed ? jamTimer + dt : 0;
      if (jamTimer >= JAM_FAIL_SECONDS) maybeShowResult("fail");
    }

    // Out of moves: every box spent, nothing in flight and nothing on the belt
    // any open tray wants. Without this the board would just sit there dead.
    if (!resultShown && sourceBoxManager.allExhausted()) {
      const openColors = fillBoxManager.getOpenColors();
      const playable =
        world.freeBalls.size > 0 ||
        conveyor
          .getOccupiedCells()
          .some((c) => c.ball && openColors.has(c.ball.color));
      spentTimer = playable ? 0 : spentTimer + dt;
      if (spentTimer >= JAM_FAIL_SECONDS) maybeShowResult("fail");
    }
  };
  app.ticker.add(tick);
  mountHud(app, world);

  return {
    fit,
    root: stageRoot,
    world,
    conveyor,
    sourceBoxManager,
    fillBoxManager,
    isFinished: () => resultShown,
    destroy() {
      clearTimeout(hintTimer);
      cancelAll();
      app.ticker.remove(tick);
      Ball.clearPool();
      stageRoot.destroy({ children: true, context: true });
    },
  };
}

function updateFreeBalls(world, conveyor, dt) {
  const radius = BALL_DIAMETER / 2;
  // Balls that have not been picked up heap on the belt's shoulder rather
  // than sinking into it, so the slot rows underneath stay readable.
  const floorY = conveyor.cy - conveyor.beltHeight / 2 - radius + 8;
  for (const ball of world.freeBalls) {
    if (!ball.freeFalling) continue;
    ball.vy += GRAVITY * dt;
    // A ball on its way off the board is falling past everything and keeps its
    // free fall; anything still in play is held to the funnel's pace.
    if (!ball.discarded) {
      const cap = funnelFallCap(ball.y);
      if (ball.vy > cap) ball.vy = cap;
    }
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    ball.rotation += ball.vx * dt * 0.01;

    // A discarded ball is on its way out: no walls, no floor, no belt.
    if (ball.discarded) {
      if (ball.y > DESIGN_H + 60) {
        world.freeBalls.delete(ball);
        conveyor.freeBalls.delete(ball);
        Ball.despawn(ball);
      }
      continue;
    }

    // ride the hourglass walls so balls funnel down through the waist
    const half = Math.max(radius, ballHalfWidthAt(ball.y) - radius);
    if (ball.x < boardCx() - half) {
      ball.x = boardCx() - half;
      ball.vx = Math.abs(ball.vx) * 0.4;
    }
    if (ball.x > boardCx() + half) {
      ball.x = boardCx() + half;
      ball.vx = -Math.abs(ball.vx) * 0.4;
    }

    // until it clears the multiplier a ball is penned into its own column,
    // so it can never drift across into a neighbouring x3
    if (ball.laneX !== null && ball.y < laneReleaseY()) {
      const pen = laneHalf() - radius;
      if (ball.x < ball.laneX - pen) {
        ball.x = ball.laneX - pen;
        ball.vx = Math.abs(ball.vx) * 0.35;
      }
      if (ball.x > ball.laneX + pen) {
        ball.x = ball.laneX + pen;
        ball.vx = -Math.abs(ball.vx) * 0.35;
      }
    }

    if (ball.y >= floorY && ball.vy > 0) {
      ball.y = floorY;
      // No rebound off the shoulder either — it lands and stays.
      ball.vy = 0;
      ball.vx *= 0.6;
    }

    // Anything crawling is put to sleep, which is what stops the last twitch
    // in a settled heap.
    if (Math.abs(ball.vx) < SLEEP_SPEED && Math.abs(ball.vy) < SLEEP_SPEED) {
      ball.vx *= 0.5;
      if (Math.abs(ball.vx) < 3) ball.vx = 0;
    }
  }

  resolveBallCollisions(world, floorY, radius);

  // balls that got captured stop free-falling & drop out of this set
  for (const ball of Array.from(world.freeBalls)) {
    if (ball.capturedByCell || ball.takenByBox) {
      ball.freeFalling = false;
      world.freeBalls.delete(ball);
    }
  }
}

// Balls push each other apart so they heap up in the upper section and
// trickle through the waist, the way the Box2D-driven original behaves.
function resolveBallCollisions(world, floorY, radius) {
  const balls = [];
  // Only balls that have cleared the x3 gate take part. A box drops nine at
  // once from a single point, so before the gate they are on top of each
  // other by construction and shoving them apart just made the drop look like
  // a scuffle. Above the bar they pass through one another and the lane pen
  // keeps them in their own column anyway; below it they behave as solids and
  // heap on the belt properly. alreadyMultiplied is exactly "past the gate":
  // set when a ball crosses the bar, and true from birth for the two the
  // multiplier spawns.
  for (const b of world.freeBalls) {
    if (b.freeFalling && b.alreadyMultiplied) balls.push(b);
  }
  if (balls.length < 2) return;

  const minDist = radius * 2;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < balls.length; i++) {
      const a = balls[i];
      for (let j = i + 1; j < balls.length; j++) {
        const b = balls[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= minDist * minDist || d2 < 1e-6) continue;

        const d = Math.sqrt(d2);
        const nx = dx / d;
        const ny = dy / d;

        // Leave a hair of overlap alone and correct the rest only partly.
        // Pushing every pair fully apart every frame fought gravity pressing
        // them back together, and the pile buzzed.
        const push = Math.max(0, minDist - d - SLOP) * 0.5 * SEPARATION;
        a.x -= nx * push;
        a.y -= ny * push;
        b.x += nx * push;
        b.y += ny * push;

        const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (rel < 0) {
          // Dead stop along the normal instead of a bounce: balls settling on
          // a heap should stay put, not spring off each other.
          a.vx += nx * rel;
          a.vy += ny * rel;

          // Rub off a little of the sideways slide too, so a ball that lands
          // on the pile stops rolling instead of skating along it.
          const tx = -ny;
          const ty = nx;
          const slide = (b.vx - a.vx) * tx + (b.vy - a.vy) * ty;
          a.vx += tx * slide * FRICTION;
          a.vy += ty * slide * FRICTION;
          b.vx -= tx * slide * FRICTION;
          b.vy -= ty * slide * FRICTION;
        }
      }
    }
  }

  // separation can shove balls through the walls or the belt, so re-clamp
  for (const ball of balls) {
    const half = Math.max(radius, ballHalfWidthAt(ball.y) - radius);
    if (ball.x < boardCx() - half) ball.x = boardCx() - half;
    if (ball.x > boardCx() + half) ball.x = boardCx() + half;
    if (ball.y > floorY) {
      ball.y = floorY;
      if (ball.vy > 0) ball.vy = 0;
    }
  }
}

function fitToScreen(app, stageRoot) {
  const w = app.renderer.width;
  const h = app.renderer.height;
  const scale = Math.min(w / DESIGN_W, h / DESIGN_H);
  stageRoot.scale.set(scale);
  stageRoot.x = (w - DESIGN_W * scale) / 2;
  stageRoot.y = (h - DESIGN_H * scale) / 2;
}

async function loadFont() {
  try {
    const font = new FontFace(
      "Azeret Mono",
      `url(${FONT("AzeretMono-Black.ttf")})`,
      { weight: "900" },
    );
    await font.load();
    document.fonts.add(font);
  } catch {
    // fall back silently to default font stack
  }
}

// Shared opaque box across the three glove frames.
const GLOVE_FRAME = [566, 289, 864, 1222];

function crop(texture, x, y, w, h) {
  return new Texture({
    source: texture.source,
    frame: new Rectangle(x, y, w, h),
  });
}

async function loadTextures() {
  const entries = {
    conveyorBase: IMG("ConveyorBeltBaseRender.png"),
    cellDark: IMG("ConveyorBeltSlotDark.png"),
    cellLight: IMG("ConveyorBeltSlotLight.png"),
    pipe: IMG("Pipe.png"),
    logo: IMG("Logo_SW.png"),
    failButton: IMG("Fail_Button.png"),
    glow: IMG("FxGlow01_SW.png"),
    gloveHover: IMG("Pointing_glove_hover.png"),
    gloveClick1: IMG("Pointing_glove_Click_1.png"),
    gloveClick2: IMG("Pointing_glove_Click_2.png"),
    forcefield: IMG("MultiplierForcefield.png"),
    multPost: IMG("MulitiplierPost2.png"),
    multPostBall: IMG("MulitiplierPostBall.png"),
    tanBacking: IMG("TanBackingRender.png"),
    boxShadow: IMG("box_shadow.png"),
    trayShadow: IMG("tray_shadow.png"),
    multShadow: IMG("MultiplierShadowNew.png"),
    lightning: IMG("ParticleMultiplierLightningBlue.png"),
    sparkle: IMG("ParticleSparkleSharpSW.png"),
  };
  for (const c of ALL_COLORS) {
    entries[`ball_${c}`] = BALL_TEXTURES[c];
    entries[`ballLit_${c}`] = BALL_LIT_TEXTURES[c];
    entries[`boxBase_${c}`] = BOX_BASE_TEXTURES[c];
    entries[`boxLid_${c}`] = BOX_LID_TEXTURES[c];
    entries[`trayEmpty_${c}`] = TRAY_EMPTY_TEXTURES[c];
    entries[`trayMarbles_${c}`] = TRAY_MARBLES_TEXTURES[c];
    entries[`trayInactive_${c}`] = TRAY_INACTIVE_TEXTURES[c];
  }

  const keys = Object.keys(entries);
  const urls = keys.map((k) => entries[k]);
  const loaded = await Assets.load(urls);

  const t = {
    base: loaded[entries.conveyorBase],
    cellDark: loaded[entries.cellDark],
    cellLight: loaded[entries.cellLight],
    pipe: loaded[entries.pipe],
    logo: loaded[entries.logo],
    failButton: loaded[entries.failButton],
    glow: loaded[entries.glow],
    // The glove renders are 2048px canvases with the hand filling under half
    // of them. Trimmed to the shared opaque box (same rect for all three, so
    // the hand does not jump between frames) and mip-mapped below, otherwise
    // the ~15x downscale aliases into a pixelated mess.
    gloveHover: crop(loaded[entries.gloveHover], ...GLOVE_FRAME),
    gloveClick1: crop(loaded[entries.gloveClick1], ...GLOVE_FRAME),
    gloveClick2: crop(loaded[entries.gloveClick2], ...GLOVE_FRAME),
    // one sheet, four bolts side by side
    lightning: [0, 1, 2, 3].map((i) =>
      crop(loaded[entries.lightning], i * 64, 0, 64, 128),
    ),
    sparkle: loaded[entries.sparkle],
    // These two ship with wide transparent margins; trim to the artwork so
    // the requested width/height describe what's actually visible.
    forcefield: crop(loaded[entries.forcefield], 87, 76, 419, 186),
    multPost: crop(loaded[entries.multPost], 3, 46, 77, 215),
    multPostBall: loaded[entries.multPostBall],
    boxShadow: loaded[entries.boxShadow],
    trayShadow: loaded[entries.trayShadow],
    multShadow: loaded[entries.multShadow],
    // plain-grain slice of the board render, stretched over the whole board
    wood: crop(
      loaded[entries.tanBacking],
      LAYOUT.woodPatch.x,
      LAYOUT.woodPatch.y,
      LAYOUT.woodPatch.w,
      LAYOUT.woodPatch.h,
    ),
    ball: {},
    ballLit: {},
    boxBase: {},
    boxLid: {},
    trayEmpty: {},
    trayMarbles: {},
    trayInactive: {},
  };
  for (const c of ALL_COLORS) {
    t.ball[c] = loaded[entries[`ball_${c}`]];
    t.ballLit[c] = loaded[entries[`ballLit_${c}`]];
    t.boxBase[c] = loaded[entries[`boxBase_${c}`]];
    t.boxLid[c] = loaded[entries[`boxLid_${c}`]];
    t.trayEmpty[c] = loaded[entries[`trayEmpty_${c}`]];
    t.trayMarbles[c] = loaded[entries[`trayMarbles_${c}`]];
    t.trayInactive[c] = loaded[entries[`trayInactive_${c}`]];
  }
  // Big art shown small needs mip levels, or minification aliases badly.
  for (const tex of [t.gloveHover, t.gloveClick1, t.gloveClick2, t.logo]) {
    tex.source.autoGenerateMipmaps = true;
    tex.source.update();
  }

  return t;
}
