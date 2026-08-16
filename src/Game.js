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
  BOX_FRONT_TEXTURES,
  TRAY_EMPTY_TEXTURES,
  TRAY_MARBLES_TEXTURES,
  TRAY_INACTIVE_TEXTURES,
  FONT,
} from "./config.js";
import { buildBackground, buildFrame } from "./entities/Board.js";
import { Conveyor } from "./entities/Conveyor.js";
import { SourceBoxManager } from "./entities/SourceBoxes.js";
import { FillBoxManager } from "./entities/FillBoxes.js";
import { Multiplier } from "./entities/Multiplier.js";
import { Ball } from "./entities/Ball.js";
import { PhysicsWorld } from "./physics.js";
import { cancelAll } from "./tween.js";
import { mountHud } from "./hud.js";
import {
  buildLogo,
  buildCTA,
  buildVictoryWindow,
  buildFailWindow,
  TapCounter,
  TutorialHand,
} from "./ui.js";

// Phones are the target, and three defaults are wrong for them. MSAA on the
// default framebuffer costs real bandwidth on tile-based mobile GPUs for
// nothing here — the art is all sprites. PixiJS also prefers WebGPU when it
// can, which on Android browsers ranges from fine to badly broken, so the
// renderer is pinned to WebGL. And a phone's drawing buffer is capped: at
// devicePixelRatio 3 a tall screen means a canvas of several million pixels
// to fill every frame.
const MAX_RESOLUTION = 2;

export async function createGame(containerEl) {
  const app = new Application();
  await app.init({
    background: 0x4c0088,
    resizeTo: window,
    antialias: false,
    preference: "webgl",
    resolution: Math.min(globalThis.devicePixelRatio || 1, MAX_RESOLUTION),
    autoDensity: true,
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
    getRoot: () => scene.root,
    getScene: () => scene,
    rebuild() {
      scene.destroy();
      scene = buildScene(app, textures);
    },
  };
}

function buildScene(app, textures) {
  const stageRoot = new Container();
  app.stage.addChild(stageRoot);

  // Layer stack mirrors the original scene tree exactly. The frame renders
  // ABOVE the belt, balls and trays — it is what clips them at the board's
  // edges — and the UI and the tutorial hand sit above the frame.
  const bgLayer = new Container();
  const pipeLayer = new Container();
  const boxLayer = new Container();
  const conveyorLayer = new Container();
  const ballLayer = new Container(); // balls fresh out of a box
  const multiplierLayer = new Container();
  const ballLayer2 = new Container(); // balls past the x3 bar
  const fillLayer = new Container();
  const topLayer = new Container(); // filled boxes rise here
  const frameLayer = new Container();
  const uiLayer = new Container();
  const handLayer = new Container();
  stageRoot.addChild(
    bgLayer,
    pipeLayer,
    boxLayer,
    conveyorLayer,
    ballLayer,
    multiplierLayer,
    ballLayer2,
    fillLayer,
    topLayer,
    frameLayer,
    uiLayer,
    handLayer,
  );

  buildBackground(bgLayer, textures);
  buildFrame(frameLayer, textures);

  const world = {
    textures,
    pipeLayer,
    boxLayer,
    ballLayer,
    ballLayer2,
    fillLayer,
    topLayer,
    physics: new PhysicsWorld(),
    despawnBall(ball) {
      world.physics.remove(ball);
      Ball.despawn(ball);
    },
  };

  world.conveyor = new Conveyor(conveyorLayer, textures);
  world.fillBoxManager = new FillBoxManager(world);
  const multiplier = new Multiplier(world, multiplierLayer);

  const tutorialHand = new TutorialHand(handLayer, textures, world);
  world.tutorialHand = tutorialHand;

  world.victoryWindow = buildVictoryWindow(uiLayer, textures, world);
  world.failWindow = buildFailWindow(uiLayer, textures, world);

  const sourceBoxManager = new SourceBoxManager(world);
  world.sourceBoxManager = sourceBoxManager;
  world.fillBoxManager.onAllBoxesFilled = () =>
    sourceBoxManager.onAllBoxesFilled();

  const logo = buildLogo(uiLayer, textures);
  const cta = buildCTA(uiLayer, textures, { onClick: () => {} });

  const tapCounter = new TapCounter(app.canvas, {
    tapsToRedirect: 1000,
    onFirstTap: () => cta.reveal(),
    onRedirect: () => {},
  });
  sourceBoxManager.tapCounter = tapCounter;
  sourceBoxManager.tutorialHand = tutorialHand;

  // Fixed-height fit, like the original: the board always fills the height and
  // wider screens see more purple. The logo and the CTA sit in design space
  // now, so only the fail backdrop still needs the visible edges — it has to
  // reach past the board to dim that purple too.
  const fit = () => {
    const w = app.renderer.width;
    const h = app.renderer.height;
    const scale = h / DESIGN_H;
    stageRoot.scale.set(scale);
    stageRoot.x = (w - DESIGN_W * scale) / 2;
    stageRoot.y = 0;
    const left = 375 - w / scale / 2;
    const right = 375 + w / scale / 2;
    logo.layoutWidget();
    cta.layoutWidget();
    world.failWindow.layoutWidget(left, right);
  };
  fit();

  // initial hint 0.5 s in, pointing at the blue box
  const hintTimer = setTimeout(() => tutorialHand.showInitialHint(), 500);

  const tick = (ticker) => {
    const dt = Math.min(0.05, ticker.deltaMS / 1000);
    world.physics.step(dt);
    multiplier.update(dt);
    world.conveyor.update(dt);
    world.fillBoxManager.update(dt);
    sourceBoxManager.update(dt);
    tutorialHand.update(dt);
  };
  app.ticker.add(tick);
  mountHud(app, world);

  return {
    fit,
    root: stageRoot,
    world,
    conveyor: world.conveyor,
    sourceBoxManager,
    fillBoxManager: world.fillBoxManager,
    // the editor reaches for these to show the CTA before the first tap
    logo,
    cta,
    destroy() {
      clearTimeout(hintTimer);
      cancelAll();
      tapCounter.destroy();
      app.ticker.remove(tick);
      Ball.clearPool();
      stageRoot.destroy({ children: true, context: true });
    },
  };
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

// Trim rects for art shipped with transparent padding, matching the trimmed
// sprite frames the original uses (alpha-tight boxes of the textures).
const GLOVE_FRAME = [141, 72, 217, 302]; // shared by all three 512px frames

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
    cta: IMG("CTA_PlayNow.png"),
    failButton: IMG("Fail_Button.png"),
    glow: IMG("FxGlow01_SW.png"),
    gloveHover: IMG("Pointing_glove_hover.png"),
    gloveClick1: IMG("Pointing_glove_Click_1.png"),
    gloveClick2: IMG("Pointing_glove_Click_2.png"),
    forcefield: IMG("MultiplierForcefield.png"),
    forcefieldTop: IMG("MultiplierForcefieldTop.png"),
    multPost: IMG("MulitiplierPost2.png"),
    multPostBall: IMG("MulitiplierPostBall.png"),
    tanBacking: IMG("TanBackingRender.png"),
    framePurple: IMG("FramePurpleRender.png"),
    boxShadow: IMG("box_shadow.png"),
    trayShadow: IMG("tray_shadow.png"),
    multShadow: IMG("MultiplierShadowNew.png"),
    multShadowPost: IMG("MultiplierShadowPost.png"),
    lightning: IMG("ParticleMultiplierLightningBlue.png"),
    boxTrayPink: IMG("box_tray_pink.png"),
    beam: IMG("ParticleBallLitBeam.png"),
  };
  for (const c of ALL_COLORS) {
    entries[`ball_${c}`] = BALL_TEXTURES[c];
    entries[`ballLit_${c}`] = BALL_LIT_TEXTURES[c];
    entries[`boxBase_${c}`] = BOX_BASE_TEXTURES[c];
    entries[`boxLid_${c}`] = BOX_LID_TEXTURES[c];
    entries[`boxFront_${c}`] = BOX_FRONT_TEXTURES[c];
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
    // bottom-left logo draws the trimmed art; the victory window stretches
    // the full texture — same as the original's two sprite modes
    logo: crop(loaded[entries.logo], 17, 10, 1425, 800),
    cta: loaded[entries.cta],
    failButton: loaded[entries.failButton],
    glow: loaded[entries.glow],
    gloveHover: crop(loaded[entries.gloveHover], ...GLOVE_FRAME),
    gloveClick1: crop(loaded[entries.gloveClick1], ...GLOVE_FRAME),
    gloveClick2: crop(loaded[entries.gloveClick2], ...GLOVE_FRAME),
    // one sheet, four bolts side by side
    lightning: [0, 1, 2, 3].map((i) =>
      crop(loaded[entries.lightning], i * 64, 0, 64, 128),
    ),
    forcefield: crop(loaded[entries.forcefield], 87, 66, 419, 202),
    forcefieldTop: crop(loaded[entries.forcefieldTop], 87, 38, 419, 111),
    multPost: crop(loaded[entries.multPost], 3, 46, 77, 215),
    multPostBall: loaded[entries.multPostBall],
    tanBacking: loaded[entries.tanBacking],
    framePurple: loaded[entries.framePurple],
    boxShadow: crop(loaded[entries.boxShadow], 5, 5, 458, 271),
    trayShadow: loaded[entries.trayShadow],
    multShadow: loaded[entries.multShadow],
    multShadowPost: loaded[entries.multShadowPost],
    boxTrayPink: loaded[entries.boxTrayPink],
    beam: crop(loaded[entries.beam], 140, 28, 107, 258),
    ball: {},
    ballLit: {},
    boxBase: {},
    boxLid: {},
    boxFront: {},
    trayEmpty: {},
    trayMarbles: {},
    trayInactive: {},
  };
  for (const c of ALL_COLORS) {
    t.ball[c] = loaded[entries[`ball_${c}`]];
    t.ballLit[c] = loaded[entries[`ballLit_${c}`]];
    t.boxBase[c] = loaded[entries[`boxBase_${c}`]];
    t.boxLid[c] = loaded[entries[`boxLid_${c}`]];
    t.boxFront[c] = loaded[entries[`boxFront_${c}`]];
    t.trayEmpty[c] = loaded[entries[`trayEmpty_${c}`]];
    t.trayMarbles[c] = loaded[entries[`trayMarbles_${c}`]];
    t.trayInactive[c] = loaded[entries[`trayInactive_${c}`]];
  }

  // Big art shown small needs mip levels, or minification aliases badly. The
  // lightning sheet is the one exception: its four bolts would average into
  // each other in the lower mips.
  const sheetSources = new Set(t.lightning.map((tex) => tex.source));
  const sources = new Set();
  const collect = (v) => {
    if (!v) return;
    if (Array.isArray(v)) v.forEach(collect);
    else if (v instanceof Texture) sources.add(v.source);
    else if (typeof v === "object") Object.values(v).forEach(collect);
  };
  collect(t);
  for (const source of sources) {
    if (sheetSources.has(source)) continue;
    source.autoGenerateMipmaps = true;
    source.update();
  }

  return t;
}
