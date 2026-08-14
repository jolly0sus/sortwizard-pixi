// Design-space resolution. Everything is laid out in this space and the
// whole stage is scaled+letterboxed to fit the real screen (see Game.js).
export const DESIGN_W = 750;
export const DESIGN_H = 1624;

export const COLORS = {
  PINK: "pink",
  ORANGE: "orange",
  BLUE: "blue",
};

export const ALL_COLORS = [COLORS.PINK, COLORS.ORANGE, COLORS.BLUE];

// Nothing ever leaves the belt, so the economy must be CLOSED: every ball
// dealt has a tray slot waiting for it somewhere on the board. A single
// surplus ball would sit in a slot forever and eventually deadlock the loop.
//
//   balls dealt = totalBoxes x ballsPerBox x multiplier
//   tray slots  = totalTrays x trayCapacity
//
// With multiplier and trayCapacity both 3 those cancel, and the rule reduces
// to: totalTrays === totalBoxes x ballsPerBox. The assertion below enforces it,
// so changing any one of these numbers fails loudly instead of quietly making
// the board unplayable.
const PIPES = 3;
// One box per wave of its colour: 12 waves / 3 colours = 4 each. There is no
// spare box anywhere, which is the point — every tap must be the right one.
const BOXES_PER_PIPE = 4;
// 9 out of a cup, x3 at the bar = 27 on the belt = the slot count exactly, and
// exactly 9 trays' worth. One tap is one beltful is one wave of the board.
const BALLS_PER_BOX = 9;
const MULTIPLIER = 3;
const TRAY_CAPACITY = 3;
const TRAY_COLUMNS = 4;
// 12 waves x 9 trays = 108 trays = 27 rows down each of the 4 columns.
// The wave count has to be a multiple of the column count (so the 3/2/2/2
// rotation leaves every column the same depth) and of the colour count (so
// each colour gets the same number of waves) — i.e. a multiple of 12.
const TRAY_ROWS = 27;

const dealt = PIPES * BOXES_PER_PIPE * BALLS_PER_BOX * MULTIPLIER;
const slots = TRAY_COLUMNS * TRAY_ROWS * TRAY_CAPACITY;
// The supply must cover the board with room to spare. Run it exactly closed
// and a single leaked ball is unrecoverable: careful play finished 67 of the
// 72 trays with every box spent. The surplus is not waste -- unspent boxes
// simply stay in the pipes, and a leaked ball keeps riding rather than
// vanishing. A deficit, on the other hand, cannot be played out at all.
if (dealt < slots) {
  throw new Error(
    `economy is short: ${dealt} balls dealt vs ${slots} tray slots. ` +
      `The board cannot be cleared with fewer balls than it has slots.`,
  );
}

export const ECONOMY = {
  pipes: PIPES,
  boxesPerPipe: BOXES_PER_PIPE,
  ballsPerBox: BALLS_PER_BOX,
  multiplier: MULTIPLIER,
  trayCapacity: TRAY_CAPACITY,
  columns: TRAY_COLUMNS,
  // the figure printed on each pipe
  ballsPerPipe: BOXES_PER_PIPE * BALLS_PER_BOX,
  totalBoxes: PIPES * BOXES_PER_PIPE,
  beltBalls: PIPES * BOXES_PER_PIPE * BALLS_PER_BOX * MULTIPLIER,
  // trays are their own number here, not derived from the ball count
  totalTrays: TRAY_COLUMNS * TRAY_ROWS,
  rowsPerColumn: TRAY_ROWS,
};

// One colour per pipe, all the way down. With the board built in waves there
// is exactly one right colour at any moment, so all three have to stay on
// offer at all times — a pipe that cycled could leave the wanted colour
// missing entirely and lose the run through no fault of the player. Each pipe
// holds precisely the number of waves of its colour, so running a pipe dry
// early is itself the proof that a tap was wasted.
export const PIPE_COLOR_BAGS = Array.from({ length: PIPES }, (_, pipe) =>
  Array.from({ length: BOXES_PER_PIPE }, () => ALL_COLORS[pipe]),
);

// Order in which BoxManager cycles replacement source boxes.
export const SPAWN_SEQUENCE = [COLORS.BLUE, COLORS.PINK, COLORS.ORANGE];
// Order in which FillBoxManager cycles receiver-box rows.
export const ROW_COLOR_SEQUENCE = [
  COLORS.BLUE,
  COLORS.BLUE,
  COLORS.PINK,
  COLORS.PINK,
  COLORS.ORANGE,
  COLORS.ORANGE,
];

export const PALETTE = {
  bg: 0x4f0589,
  bgLight: 0x6d1cb0,
  frameYellow: 0xffdc00,
  frameYellowDark: 0xe0a800,
  wood: 0xf3bb84,
  woodDark: 0xe0a468,
  woodLine: 0x8a4a2c,
};

// Sized against the conveyor slot pitch so balls riding the belt sit side by
// side without overlapping (see LAYOUT.conveyor.cellCount).
export const BALL_DIAMETER = 46;

// Layout below is derived from the reference screenshot of the original
// playable running on an iPhone 16 Pro viewport. Each source measurement was
// converted to a fraction of the game screen and multiplied into this design
// space, so the arrangement holds at any aspect ratio.
export const LAYOUT = {
  // Traced from the original: the funnel already starts closing at y≈812 and
  // reaches its 146px-wide throat at y≈975.
  board: {
    x: 13.5,
    y: 112,
    w: 723,
    // The silhouette is TRACED off the reference playable, not modelled.
    // scripts/trace-edge.mjs walks a screenshot row by row, finds where the
    // purple background stops, subtracts the frame's half-width and prints
    // this table in design units.
    //
    // Every parametric attempt before this got close and stayed wrong, because
    // the real curve is not the shape the formula could make: there is no
    // parallel throat, for one -- the neck eases through a rounded minimum of
    // 41.3 at y=956 and opens again. Interpolating the measurements is exact
    // by construction, and re-tracing a new screenshot regenerates it.
    //
    // The near-vertical step at 974 -> 976 is real: that is the top edge of
    // the lower section, which begins as an almost horizontal shelf.
    profile: [
      [800, 361.1],
      [808, 359.6],
      [816, 358.7],
      [824, 354.4],
      [832, 345],
      [840, 345.8],
      [848, 330.9],
      [856, 310.1],
      [864, 230.7],
      [872, 282.5],
      [880, 276.9],
      [888, 148.7],
      [896, 197.5],
      [904, 197.7],
      [912, 134.3],
      [920, 93.1],
      [928, 67.5],
      [936, 37],
      [944, 43],
      [952, 40.8],
      [960, 41],
      [962, 41],
      [964, 41.5],
      [966, 42],
      [968, 42.5],
      [970, 43],
      [972, 44],
      [974, 45],
      [976, 46],
      [978, 48],
      [980, 50],
      [982, 53],
      [984, 57],
      [986, 63],
      [988, 78],
      [990, 112],
      [992, 158],
      [994, 203],
      [996, 238],
      [998, 266],
      [1000, 286],
      [1004, 308],
      [1012, 329.7],
      [1020, 331.8],
      [1028, 336.4],
      [1036, 338.4],
      [1044, 340.6],
      [1052, 340.9],
      [1060, 342.4],
      [1068, 342.5],
      [1076, 343.1],
      [1084, 342.9],
      [1092, 342.7],
      [1100, 343.4],
    ],
    // Where the ball funnel ends and the belt's capture span takes over.
    waistBottom: 956,
    lowerX: 32,
    lowerW: 686,
    bottom: 1416,
    radius: 44,
  },

  pipes: {
    xs: [175, 380, 585],
    topY: 130,
    bottomY: 407,
    width: 147,
    labelY: 331,
  },

  // Square cup ("tray_empty") holding a 3x3 grid of marbles = 9 balls.
  sourceBox: {
    centerY: 467,
    w: 130,
    h: 116,
    marbleW: 100,
    marbleH: 94,
  },

  // Three wide forcefield pills forming one continuous bar, with decorative
  // star/moon posts standing at every pill boundary.
  multiplier: {
    centerY: 627,
    pillW: 170,
    pillH: 48,
    postW: 26,
    postH: 76,
  },

  grid: { topY: 140, cols: 7, rows: 7, cellSize: 82, gap: 14 },

  // Plain-wood patch cut out of TanBackingRender, stretched over the board to
  // give it the original's vertical grain.
  // TanBackingRender used to be a 2287x3822 sheet and this was the strip of
  // grain cut out of it at (300, 3300). scripts/optimize-assets.mjs crops the
  // file down to exactly that strip -- 6.4 MB to 139 KB -- so the origin is
  // now 0,0. The script refuses to run if these two ever drift apart.
  woodPatch: { x: 0, y: 0, w: 1700, h: 450 },

  // The slot path has to stay clear of the belt's rim on all four sides, the
  // way the original's does — slots and the balls riding them sit *inside*
  // the walls, never straddling them.
  conveyor: {
    centerY: 1070,
    xLeft: 30,
    xRight: 720,
    beltH: 124,
    // How far the path's rounded ends are held back from the belt's own ends.
    // The capsule is pinched to nothing at its extreme x, so a slot placed
    // there would poke straight out of the artwork.
    // The capsule pinches to nothing at its extreme x, so the turn has to be
    // held well back or the rotated slots clip through the rim on the corners.
    pathInset: 50,
    // Horizontal radius of the loop's turns.
    pathRadius: 14,
    // Vertical half-distance between the two slot rows. The original sets its
    // rows 56 apart, measured centre to centre.
    pathRadiusY: 28,
    // Slot size, measured off the original at 26 x 34 -- ours were 22 x 26,
    // noticeably small and slightly squat against the 89x110 source art.
    // On the turns the slot is rotated, so half its length adds to
    // pathRadiusY; 28 + 17 = 45 still clears the rim's inner edge (~47.7).
    cellW: 26,
    cellH: 34,
    // Exactly one tap's worth: 9 balls x3 = 27. One tap fills the loop, and a
    // tap on the wrong colour fills it with balls no tray will ever take --
    // which is precisely how a wrong move loses.
    // pitch = totalLen / cellCount must stay above BALL_DIAMETER or the balls
    // riding the belt visually overlap.
    cellCount: 27,
    // Seconds for one full trip around the loop. A wave needs several laps
    // before the last tray of its colour comes open, so this sets the pace of
    // the whole run: at 3 a full clear took about seven minutes.
    loopSeconds: 2,
    // 0 = balls never leave the belt. A leftover keeps riding until a tray of
    // its colour opens, so the supply below has to be exactly consumable.
    lapsBeforeLost: 0,
  },

  // 4 columns x 4 visible rows of wide, short receiver trays. Column spacing
  // is set so the outermost wells (±40) sit ~15px inside the belt's straight
  // run — see conveyor.pathInset above.
  fillColumns: {
    xs: [153, 301, 449, 597],
    tileW: 138,
    closedH: 62,
    openH: 78,
    rowStep: 66,
    topY: 1193,
    rowsVisible: 4,
    // Only the top tray of a column takes balls — the original's rule. It
    // holds exactly one tap, which is why the tap is 3 balls: the two have to
    // match, or the remainder rides a belt nothing ever leaves.
    openRows: 1,
    // the three moulded ball wells in the box_base artwork
    slotOffsets: [-38, 0, 38],
    slotY: -4,
    // balls shrink slightly on landing so they nest inside the wells
    ballScale: 0.8,
    // how close (px) a ball must be to a well before it drops in
    catchTolerance: 26,
  },

  logo: { x: 21, y: 1455, w: 277 },
  cta: { x: 352, y: 1470, w: 378, h: 74 },
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
// Receiver trays (bottom): base shows the 3 ball slots, lid covers a queued one.
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
