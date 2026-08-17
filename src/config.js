// Every number in this file is read straight out of the original playable's
// live scene graph (scripts in the repo scratchpad dumped it via Playwright,
// see README). The original is a Cocos Creator 3.8 build with a 720x1280
// design resolution, FIXED-HEIGHT fit and the whole level under a 0.9-scaled
// "Level" node. On the reference viewport (iPhone, 375x812 CSS) the visible
// world is 591.133x1280 units, which maps onto this design space by a single
// uniform factor:
//
//   design = 1.26875 * (world_x, 1280 - world_y)
//
// so a point given in the original's Level space (y up, origin at screen
// centre) converts with the two helpers below and nothing is ever eyeballed.
export const DESIGN_W = 750;
export const DESIGN_H = 1624;

// world (canvas) px -> design px. 1280 * K = 1624 exactly.
const K = DESIGN_H / 1280;
// Level px -> design px (the Level node is scaled 0.9)
const S = K * 0.9;

// Level-space point -> design point. Level origin is the screen centre.
const lx = (x) => 375 + S * x;
const ly = (y) => 812 - S * y;
// UI/canvas-space y (scale-1 children of Canvas) -> design y.
const uy = (y) => 812 - K * y;
// sizes / deltas
const ls = (v) => S * v;
const us = (v) => K * v;
// vertical delta: original y grows up, ours grows down
const ld = (v) => -S * v;

export const COLORS = {
  PINK: "pink",
  ORANGE: "orange",
  BLUE: "blue",
};

export const ALL_COLORS = [COLORS.PINK, COLORS.ORANGE, COLORS.BLUE];

// ---------------------------------------------------------------------------
// Economy — the original BoxManager/FillBoxManager numbers, from scene data.
// ---------------------------------------------------------------------------
export const ECONOMY = {
  ballsPerBox: 9,
  multiplier: 3,
  // Every pipe can deliver this many replacement boxes; the figure printed on
  // the pipe. Decrements when an emptied box finishes disappearing.
  pipeCharges: [7, 7, 7],
  // While this many balls are loose on the board (not riding the belt, not in
  // a tray), taps are refused and the box shakes. The reference's value.
  maxFreeBalls: 27,

  // --- the run's economy, balanced colour by colour ------------------------
  //
  // A run delivers 3 standing boxes + 3 pipes x 7 = 24 boxes of 9 balls, and
  // every ball crosses a multiplier bar on its way down, so 216 balls become
  // 648. The receivers hold 3 each, and 216 of them is exactly 648 slots —
  // which is why the tray count matches the balls as they leave the boxes,
  // before the x3.
  //
  // Each pipe is one colour for the whole run: slot 0 (centre) pink, slot 1
  // (left) orange, slot 2 (right) blue — the reference's opening layout, held
  // for all eight boxes a pipe delivers. This is what makes careful play
  // always able to win: the tape's waves ask for specific colours at specific
  // times, and with all three colours on tap at any moment the player can
  // always answer. Every shuffled queue tried before this could refuse the
  // needed colour for boxes on end, and every such drought was a measured
  // loss the player could do nothing about. 8 boxes per pipe x 9 balls x 3 =
  // 216 per colour, exactly its 72 trays.
  slotColors: [COLORS.PINK, COLORS.ORANGE, COLORS.BLUE],
  // The reference's tray tape, restored: rows repeat blue, blue, pink, pink,
  // orange, orange; the four initial rows consume indices 0..3 and afterwards
  // every column continues the tape at its own pace. This is what makes the
  // reference's loss REAL — the colours open at any moment are whatever the
  // tape happens to be showing, so a belt full of colours nothing is open for
  // is a jam, and the jam is the fail. One-colour columns were tried and made
  // the game unlosable: every riding ball always had an open tray, so the
  // belt always drained. (An overflow-heap loss patched over that; the
  // reference was probed instead — flooding it jams the belt and fails in
  // ~20 s — and this is that mechanism.)
  //
  // Unlike the reference, the totals still come out even: 54 trays per
  // column x 4 = 216 = the balls the boxes release before the x3, and each
  // column's 54 walk the 6-tape exactly 9 times, so every colour gets 72
  // trays = its 216 multiplied balls. A clean run can still finish.
  rowColorSequence: [
    COLORS.BLUE,
    COLORS.BLUE,
    COLORS.PINK,
    COLORS.PINK,
    COLORS.ORANGE,
    COLORS.ORANGE,
  ],
  // The columns start the tape aligned, exactly like the reference: whole
  // monochrome rows, so a tapped box meets a 24-slot wave of its colour.
  // (A phase-shifted start was tried to spread the colours and measured
  // strictly worse — 33 trays against the aligned tape's 174 — because
  // shifting kills the waves: a 27-ball burst met 6-12 open slots and the
  // rest silted up the belt at once.)
  //
  // The 216 are a quota for the BOARD, not 54 per column. The belt feeds the
  // leftmost matching column first, so the left columns do far more of the
  // work: with a per-column cap they hit it and went dead while the right
  // ones still lagged, and both a patient and an ordinary player stalled at
  // exactly 200 of 216 with 48 balls that no surviving column wanted. Any
  // column may keep producing until the board's total is reached, which also
  // keeps every colour served — a prefix of the 6-tape is always within one
  // of even.
  traysTotal: 216,
  // With the pipes dry and the board locked, this long before the ending
  // screen — enough for a tray already swallowing a ball to finish and open
  // the next one, which can unlock the board after all.
  outOfBallsGrace: 1.5,
  // Backstop for the case the colour test cannot see: a ball that matches an
  // open tray but can never reach it, resting on the floor below the belt
  // where nothing picks it up. It reads as progress still being possible, so
  // without a limit on going nowhere the run would wait on it forever.
  outOfBallsStall: 6,
};

// ---------------------------------------------------------------------------
// Physics — the original runs Box2D (PTM 32, gravity -10 m/s^2) with these
// ball properties. Converted to design px: 10 m/s^2 * 10 gravityScale * 32
// px/m = 3200 world px/s^2.
// ---------------------------------------------------------------------------
export const PHYSICS = {
  gravity: us(3200),
  // CircleCollider2D on the ball prefab: radius 25 in Level units.
  ballRadius: ls(25),
  restitution: 0.45,
  // Box2D's velocity threshold: impacts slower than 1 m/s don't bounce.
  restitutionThreshold: us(32),
  // RigidBody2D.linearDamping = -0.5 in the original — yes, negative: bodies
  // gain ~0.8%/frame. Kept as-is.
  linearDamping: -0.5,
  // engine settings: sleepThreshold 0.1 m/s, fixed step 1/60, 1 substep max
  sleepSpeed: us(3.2),
  fixedStep: 1 / 60,
};

// The launch out of a source box: the ball is tweened 30 world px straight
// down over 0.28 s (quadIn), then handed to physics with the tween's exit
// velocity and a random +-1.5 m/s sideways kick.
export const LAUNCH = {
  drop: us(30),
  duration: 0.28,
  releaseVY: us((2 * 30) / 0.28),
  releaseVXRange: us(48),
};

// Static collision shapes ("InvisibleWalls"), one entry per collider in the
// scene. Positions are Level-space (group offset +59.67 baked in); angles are
// negated for the y-flip. `off` is the collider's local offset, rotated into
// place here.
const wallBox = (px, py, angleDeg, w, h, offX = 0, offY = 0) => {
  const a = (angleDeg * Math.PI) / 180;
  const cx = px + offX * Math.cos(a) - offY * Math.sin(a);
  const cy = py + offX * Math.sin(a) + offY * Math.cos(a);
  return {
    type: "box",
    x: lx(cx),
    y: ly(cy + 59.67),
    hw: ls(w / 2),
    hh: ls(h / 2),
    angle: (-angleDeg * Math.PI) / 180,
  };
};
const wallCircle = (px, py, r) => ({
  type: "circle",
  x: lx(px),
  y: ly(py + 59.67),
  r: ls(r),
});

export const WALLS = [
  // right funnel assembly (Wall1)
  wallBox(380.22, 190.94, 0, 100, 600),
  wallBox(337.04, -124.4, -74.27, 70, 530),
  wallCircle(72.31, -195.69, 30),
  wallBox(351.35, -210.37, 90, 60, 600, -7.3),
  // left funnel assembly (Wall2 — mirrored, values differ slightly for real)
  wallBox(-380.22, 190.94, 0, 100, 600),
  wallBox(-336.27, -129.08, 74.27, 70, 510.7),
  wallCircle(-71.15, -197.62, 30),
  wallBox(-351.35, -210.37, -90, 60, 600, -7.3),
  // throat and outer slopes
  wallBox(-89, 308.05, 0, 10, 600),
  wallBox(89, 308.05, 0, 10, 600),
  wallBox(-304.63, 219.08, 21.3, 10, 300),
  wallBox(304.63, 219.08, -21.3, 10, 300),
  // Belt shoulder — the floor free balls heap on. Thickened and widened from
  // the original's 5x600 collider, which leaked.
  //
  // Measured: a free ball reaches 2163 px/s, which is 36 design px in one
  // fixed 1/60 s step, and the original shoulder is 6 design px thick. There
  // is no CCD here, so a ball falling hard simply appears on the far side of
  // it. It also stopped 6 px short of the right-hand tray wall, leaving a slot
  // in the corner. Either way the ball ends up in the tray area, where nothing
  // can ever pick it up — trays only take balls riding the belt — so it lies
  // there for the rest of the run.
  //
  // 50 px thick beats the worst single step, and the span now overlaps both
  // side walls. The top surface stays where it was, so balls still heap in the
  // same place, and the belt sits below the underside: balls riding it are out
  // of the solver, so a thicker wall cannot disturb them.
  wallBox(-3.5, -270.7, 90, 43.8, 614.8),
  // tray-area side walls and floor (balls normally never reach these)
  wallBox(-300.89, -393.96, 0, 10, 500),
  wallBox(298.73, -393.96, 0, 10, 500),
  wallBox(0, -579.38, 90, 10, 600),
];

export const PALETTE = {
  // PurpleBG sprite colour in the scene (NOT 0x4f0589)
  bg: 0x4c0088,
};

// Ball visuals from the Ball prefab: a 56x56 node with a 50x50 "Visual"
// sprite and a 60x70 glow overlay offset (-0.894, +2.383).
export const BALL = {
  visual: ls(50),
  glowW: ls(60),
  glowH: ls(70),
  glowDX: ls(-0.894),
  glowDY: ld(2.383),
};
export const BALL_DIAMETER = ls(50);

// ---------------------------------------------------------------------------
// Layout. Group offset: Background / GameManager / Conveyer / Multipliers /
// FramePurpleRender sit +59.67 up inside Level; Pipes and FillBoxes don't.
// ---------------------------------------------------------------------------
const Y0 = 59.67;

export const LAYOUT = {
  wood: {
    x: lx(0),
    y: ly(Y0),
    w: ls(2287 * 0.314),
    h: ls(3822 * 0.314),
  },
  frame: {
    x: lx(0),
    y: ly(Y0),
    w: ls(3820 * 0.314),
    h: ls(5348 * 0.314),
  },

  pipes: {
    xs: [lx(-180), lx(0), lx(180)],
    spriteY: ly(463.28 + 11.16),
    w: ls(130),
    h: ls(250),
    labelY: ly(463.28 - 32.62),
    labelSize: ls(50),
    labelStroke: ls(2),
  },

  // Source boxes. All child offsets converted from the prefab (visual root is
  // scaled 1.25 there; baked in here).
  sourceBox: {
    slotY: ly(Y0 + 265),
    slotXs: [lx(0), lx(-180), lx(180)], // slot0 centre, slot1 left, slot2 right
    shadow: { w: ls(85 * 1.25), h: ls(90 * 1.25), dy: ld(-21.32 * 1.25) },
    cup: { w: ls(80 * 1.25), h: ls(90 * 1.25), dy: ld(-13.68 * 1.25) },
    marbles: { w: ls(70 * 1.25), h: ls(65 * 1.25), dy: ld(-9.52 * 1.25) },
    lid: { w: ls(80 * 1.25), h: ls(75 * 1.25), dy: ld((30 - 36.03) * 1.25) },
    // 3x3 launch points: SpawnPoints node is scaled (1.6, 1) in the prefab
    spawnDX: ls(23 * 1.6 * 1.25),
    spawnRowDY: [
      ld((20 - 9.16) * 1.25),
      ld(-9.16 * 1.25),
      ld((-20 - 9.16) * 1.25),
    ],
    entryDrop: ls(40),
  },

  multiplier: {
    xs: [lx(-178), lx(0), lx(178)],
    y: ly(Y0 + 88.39),
    // Visual child chain is scaled 0.9 (Multiplier) * 0.35 (Visual)
    visualScale: 0.9 * 0.35,
    forcefield: { w: ls(419 * 0.315), h: ls(202 * 0.315) },
    forcefieldTop: {
      w: ls(419 * 0.315),
      h: ls(111 * 0.315),
      dy: ld(51.55 * 0.315),
    },
    shadow: { w: ls(500 * 0.315), h: ls(92 * 0.315), dy: ld(-64 * 0.315) },
    shadowPost: {
      w: ls(104 * 0.315),
      h: ls(70 * 0.315),
      dx: ls(230 * 0.315),
      dy: ld(-90 * 0.315),
    },
    post: { w: ls(77 * 0.315), h: ls(215 * 0.315), dx: ls(230 * 0.315) },
    postBall: { w: ls(85 * 0.315), h: ls(85 * 0.315), dy: ld(106.9 * 0.315) },
    labelSize: ls(100 * 0.315),
    labelStroke: ls(4 * 0.315),
    labelStrokeColor: 0x000aff,
    // BoxCollider2D: 180x10 at offset (0, -42.7), node scale 0.9 — the sensor
    // is a thin line under the bar.
    sensorY: ly(Y0 + 88.39 - 42.7 * 0.9),
    sensorHalfW: ls((180 / 2) * 0.9),
    sensorHalfH: ls((10 / 2) * 0.9),
    // Multiplier.spawnOffset (scene): clones appear this far from the contact
    // point at 120 and 240 degrees.
    spawnOffset: us(10),
  },

  conveyor: {
    // waypoint polyline, traversal order; the path closes automatically
    waypoints: [
      [lx(0), ly(Y0 - 270)],
      [lx(-225), ly(Y0 - 270)],
      [lx(-245), ly(Y0 - 292)],
      [lx(-225), ly(Y0 - 318)],
      [lx(225), ly(Y0 - 318)],
      [lx(245), ly(Y0 - 292)],
      [lx(225), ly(Y0 - 270)],
    ],
    // 0 = straight, 1 = curve (affects cell rotation + top-line test only)
    waypointTypes: [0, 0, 1, 0, 0, 1, 0],
    cellCount: 27,
    speed: ls(350),
    snapSpeed: ls(250),
    snapDuration: 0.15,
    belt: { x: lx(0), y: ly(Y0 - 295.42), w: ls(1853 * 0.3), h: ls(399 * 0.3) },
    // capture zone: BoxCollider2D 500x150 at offset (0, +85), node scale 0.3
    capture: {
      x: lx(0),
      y: ly(Y0 - 295.42 + 85 * 0.3),
      halfW: ls((500 / 2) * 0.3),
      halfH: ls((150 / 2) * 0.3),
    },
    cell: { w: ls(89 * 0.3), h: ls(110 * 0.3) },
  },

  fill: {
    xs: [lx(-205), lx(-68), lx(68), lx(205)],
    rowYs: [ly(-335), ly(-405), ly(-475), ly(-545)],
    rowStep: ls(70),
    base: { w: ls(437 * 0.3), h: ls(250 * 0.3) },
    // the pink prefab's extra deep-wells overlay
    trayPink: { w: ls(437 * 0.3), h: ls(218 * 0.3), dy: ld(5.28) },
    front: { w: ls(437 * 0.3), h: ls(59 * 0.3), dy: ld(-5.07) },
    lid: { w: ls(130), h: ls(62), dy: ld(14.81) },
    shadow: { w: ls(458 * 0.31), h: ls(271 * 0.35), dy: ld(-5) },
    slotDX: [ls(-38.59), 0, ls(36)],
    slotDY: ld(4 + 7.24),
    // ball resting scale inside a well (of the ball node)
    ballScale: 0.8,
    // FillBox trigger: BoxCollider2D 130x80 at offset (0, +37)
    colliderHalfW: ls(65),
    colliderHalfH: ls(40),
    colliderDY: ld(37),
    // swept-recovery band = collider half extents + 25
    pickupHalfW: ls(90),
    pickupHalfH: ls(65),
    // sqrt(65^2+40^2) + 55 — the zone-prune radius
    triggerRadius: ls(131.32),
    shiftDuration: 0.3,
    // sideways bulge of the ball's arc into a well (20 in the original)
    bulge: ls(20),
    // filled-box rise before it pops (+40 local)
    rise: ls(40),
    // the landing light: a narrow vertical column, ball-wide (the original's
    // ParticleBallLitBeam), never a square blob
    hitEffect: { w: ls(50), h: ls(112) },
  },

  ui: {
    // widget-anchored to the visible rect (insets in design px)
    // The four insets below are the one place in this file that is eyeballed
    // rather than converted: they were dragged in the scene editor and are
    // design px as they came out of it, not the original's numbers. They are
    // measured from the design rect — see the anchoring note in ui.js.
    logo: {
      w: us(1425 * 0.15),
      h: us(800 * 0.15),
      left: 41.35,
      bottom: 36.5,
    },
    cta: { w: us(300), h: us(90), right: 39.43, bottom: 61.39 },
    victory: {
      darkW: us(920),
      darkH: us(1480),
      logo: { w: us(500), h: us(270), y: uy(270.69) },
      cta: { w: us(500), h: us(130), y: uy(-217.76) },
    },
    fail: {
      badge: { w: us(500), h: us(500), y: uy(33.5) },
    },
    hand: {
      // pointer offset from the target node (+30, -40 in world units)
      offX: us(30),
      offY: -us(-40),
      bobAmp: us(12),
      bobPeriod: 0.9,
      idleTimeout: 10,
      animDuration: 0.35,
      glove: {
        w: us(866 * 0.1),
        h: us(1208 * 0.1),
        dx: us(33.69),
        dy: -us(-37),
      },
    },
  },
};

// Window presentation constants (VictoryWindow / FailWindow components).
export const WINDOWS = {
  backdropOpacity: 180 / 255,
  backdropFadeDuration: 0.4,
  popInDelay: 0.2,
  popInDuration: 0.45,
  ctaPulseScale: 1.08,
  ctaPulseDuration: 0.6,
};

// Asset paths go through here so the single-file build can serve them from
// memory. `npm run build:single` bakes every asset into the HTML as a data
// URI and leaves the lookup table on window.__SW_ASSETS; with no table
// present — dev server, normal build — the plain path is returned unchanged.
const asset = (path) => globalThis.__SW_ASSETS?.[path] ?? path;

export const IMG = (name) => asset(`/assets/images/${name}`);
export const AUD = (name) => asset(`/assets/audio/${name}`);
export const FONT = (name) => asset(`/assets/fonts/${name}`);

export const BALL_TEXTURES = {
  [COLORS.PINK]: IMG("ball_pink.png"),
  [COLORS.ORANGE]: IMG("ball_orange.png"),
  [COLORS.BLUE]: IMG("ball_blue.png"),
};
export const BALL_LIT_TEXTURES = {
  [COLORS.PINK]: IMG("ball_lit_pink.png"),
  [COLORS.ORANGE]: IMG("ball_lit_orange.png"),
  [COLORS.BLUE]: IMG("ball_lit_blue.png"),
};
// Receiver trays (bottom): base shows the 3 ball wells, lid covers a queued one.
export const BOX_BASE_TEXTURES = {
  [COLORS.PINK]: IMG("box_base_pink.png"),
  [COLORS.ORANGE]: IMG("box_base_orange.png"),
  [COLORS.BLUE]: IMG("box_base_blue.png"),
};
export const BOX_LID_TEXTURES = {
  [COLORS.PINK]: IMG("box_lid_pink.png"),
  [COLORS.ORANGE]: IMG("box_lid_orange.png"),
  [COLORS.BLUE]: IMG("box_lid_blue.png"),
};
export const BOX_FRONT_TEXTURES = {
  [COLORS.PINK]: IMG("box_tray_pink_front.png"),
  [COLORS.ORANGE]: IMG("box_tray_orange_front.png"),
  [COLORS.BLUE]: IMG("box_tray_blue_front.png"),
};
// Source boxes (top): square cup + 3x3 marble fill indicator + square lid.
export const TRAY_EMPTY_TEXTURES = {
  [COLORS.PINK]: IMG("tray_empty_pink.png"),
  [COLORS.ORANGE]: IMG("tray_empty_orange.png"),
  [COLORS.BLUE]: IMG("tray_empty_blue.png"),
};
export const TRAY_MARBLES_TEXTURES = {
  [COLORS.PINK]: IMG("tray_marbles_pink.png"),
  [COLORS.ORANGE]: IMG("tray_marbles_orange.png"),
  [COLORS.BLUE]: IMG("tray_marbles_blue.png"),
};
export const TRAY_INACTIVE_TEXTURES = {
  [COLORS.PINK]: IMG("tray_inactive_pink.png"),
  [COLORS.ORANGE]: IMG("tray_inactive_orange.png"),
  [COLORS.BLUE]: IMG("tray_inactive_blue.png"),
};

export const SFX = {
  boxTap: AUD("sfxBallOnConveyor__sfxBoxTap.mp3"),
  boxAppear: AUD("sfxBoxAppear.mp3"),
  boxTapBlocked: AUD("sfxBoxTapBlocked.mp3"),
  multiplier: AUD("sfxMultiplier.mp3"),
  ballOnConveyor: AUD("sfxBallOnConveyor__sfxBoxTap.mp3"),
  ballInBox: AUD("sfxBallInBox.mp3"),
  boxFilled: AUD("sfxBoxFilled.mp3"),
  wand: AUD("sfxWand__sfxWandHit.mp3"),
  wandHit: AUD("sfxWand__sfxWandHit.mp3"),
  shuffle: AUD("sfxShuffle.mp3"),
  hat: AUD("sfxHat__sfxHatSuck.mp3"),
  hatSuck: AUD("sfxHat__sfxHatSuck.mp3"),
  victory: AUD("sfxVictory.mp3"),
  fail: AUD("sfxFail.wav"),
};
