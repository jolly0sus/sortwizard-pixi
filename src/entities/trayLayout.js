// Builds the full tray colour layout up front, as a sequence of WAVES.
//
// One tap puts a whole beltful of one colour on the loop: 9 balls out of the
// cup, tripled at the x3 bar = 27 balls = exactly 9 trays. Nothing ever leaves
// the belt, so those 27 balls either all find a home during the tap or the
// leftovers ride forever on a 27-slot loop that is now permanently short of
// room. There is no partial credit.
//
// So the board is built so that the front of the four columns always shows
// exactly 9 trays of a single colour — one wave, one tap. Clear them and the
// next wave's colour is exposed underneath. That gives the run a single
// correct line: at every step exactly one of the three pipes is the colour the
// front is asking for, and any other tap dumps 27 homeless balls onto the belt
// and loses on the spot.
//
// A wave's 9 trays are split across the 4 columns as 3/2/2/2, and which column
// carries the 3 rotates, so every column ends up the same depth.
//
// Kept free of PixiJS so the arithmetic can be checked on its own.

// How the 9 trays of one wave are shared out, with `long` taking the extra.
function waveShares(columns, traysPerWave, long) {
  const base = Math.floor(traysPerWave / columns);
  const extra = traysPerWave - base * columns;
  return Array.from(
    { length: columns },
    (_, c) => base + ((c - long + columns) % columns < extra ? 1 : 0),
  );
}

export function buildTrayLayout(
  columns,
  rows,
  colors,
  { traysPerWave = 9 } = {},
) {
  const total = columns * rows;
  if (total % traysPerWave !== 0) {
    throw new Error(
      `tray layout: ${total} trays is not a whole number of ${traysPerWave}-tray waves`,
    );
  }
  const waves = total / traysPerWave;
  if (waves % colors.length !== 0) {
    throw new Error(
      `tray layout: ${waves} waves do not divide evenly between ${colors.length} colours`,
    );
  }

  const grid = Array.from({ length: columns }, () => []);
  for (let w = 0; w < waves; w++) {
    // Cycling the colour means no two consecutive waves ask for the same tap,
    // and each colour gets exactly waves/3 of them.
    const color = colors[w % colors.length];
    const shares = waveShares(columns, traysPerWave, w % columns);
    for (let c = 0; c < columns; c++) {
      for (let i = 0; i < shares[c]; i++) grid[c].push(color);
    }
  }

  // Every column must come out the same depth, or the board would run dry on
  // one side while another still holds trays no tap can reach.
  const depth = grid[0].length;
  if (grid.some((col) => col.length !== depth)) {
    throw new Error(
      `tray layout: columns came out uneven (${grid.map((c) => c.length).join("/")}). ` +
        `waves must be a multiple of the column count for the 3/2/2/2 rotation to even out`,
    );
  }
  if (depth !== rows) {
    throw new Error(`tray layout: built ${depth} rows, expected ${rows}`);
  }

  return grid;
}
