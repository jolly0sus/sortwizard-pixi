// Traces the board's outline out of a screenshot of the reference playable and
// prints it as a table of half-widths in design units, ready to paste into
// config.js.
//
// The screenshot must be taken at viewport 414x896, deviceScaleFactor 2, so
// screenshot px = design px * 1.104.
//
// What the camera sees is the outside of the frame, not the wood: the widest
// frame ring is 26px wide and stroked centred on the silhouette, so the
// silhouette sits FRAME_HALF inside the purple boundary.
import sharp from "sharp";

const SCALE = (414 / 750) * 2;
const FRAME_HALF = 13;
const file = process.argv[2];
const from = Number(process.argv[3] ?? 780);
const to = Number(process.argv[4] ?? 1040);
const step = Number(process.argv[5] ?? 4);

const { data, info } = await sharp(file)
  .raw()
  .toBuffer({ resolveWithObject: true });

const purple = (x, y) => {
  const i = (y * info.width + x) * info.channels;
  const r = data[i];
  const g = data[i + 1];
  const b = data[i + 2];
  return b > 90 && r > 40 && r < 150 && g < 70 && b - g > 60;
};

// Boundary of the painted board on each row, in design units.
const edge = new Map();
for (let dy = from - step; dy <= to + step; dy += step) {
  const y = Math.round(dy * SCALE);
  if (y < 0 || y >= info.height) continue;
  let left = 0;
  while (left < info.width && purple(left, y)) left++;
  let right = info.width - 1;
  while (right > left && purple(right, y)) right--;
  edge.set(dy, (right - left) / 2 / SCALE);
}

// The frame is stroked along the outline's NORMAL, so how far it reaches
// sideways on any one scan row depends on how steep the outline is there. On a
// vertical flank that is exactly FRAME_HALF; on the shallow part of the taper,
// where x moves four times faster than y, it is over four times as much.
// Subtracting a flat FRAME_HALF (the obvious thing, and what this script did
// first) leaves the traced waist far too wide through the middle — by 45px at
// y=932 — while looking perfect at the top and bottom, where the flanks
// happen to be vertical.
const MAX_CORRECTION = 55; // guards the near-horizontal shelf, handled below
const rows = [];
for (let dy = from; dy <= to; dy += step) {
  const here = edge.get(dy);
  if (here === undefined) continue;
  const prev = edge.get(dy - step) ?? here;
  const next = edge.get(dy + step) ?? here;
  const slope = (next - prev) / (2 * step); // dx/dy of the outline
  const correction = Math.min(
    MAX_CORRECTION,
    FRAME_HALF * Math.sqrt(1 + slope * slope),
  );
  rows.push([dy, Math.round((here - correction) * 10) / 10]);
}

console.log("// design y -> board half-width");
console.log("[\n" + rows.map(([y, h]) => `  [${y}, ${h}],`).join("\n") + "\n]");
