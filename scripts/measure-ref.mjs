// One-off measuring tape for the reference playable's screenshot.
// Finds the dark conveyor slots on a scan line and reports their pixel size,
// converted into the game's 750-wide design space.
import sharp from "sharp";

const file = process.argv[2];
const scanY = Number(process.argv[3]);
const scanX = Number(process.argv[4]);

const img = sharp(file);
const { width, height } = await img.metadata();
const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
const at = (x, y) => {
  const i = (y * info.width + x) * info.channels;
  return [data[i], data[i + 1], data[i + 2]];
};
// the slots are a desaturated dark grey against a light lavender belt
const isSlot = (x, y) => {
  const [r, g, b] = at(x, y);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max < 150 && max - min < 60;
};

function runs(pick, from, to) {
  const out = [];
  let start = -1;
  for (let i = from; i < to; i++) {
    if (pick(i)) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      out.push([start, i - start]);
      start = -1;
    }
  }
  return out;
}

console.log(`image ${width}x${height}`);

const across = runs((x) => isSlot(x, scanY), 0, info.width).filter(
  (r) => r[1] > 4 && r[1] < 120,
);
console.log(
  `horizontal @y=${scanY}: ${across.length} slots, widths ` +
    across
      .map((r) => r[1])
      .slice(0, 12)
      .join(","),
);
if (across.length > 1) {
  const pitch = across[1][0] - across[0][0];
  console.log(`  pitch ${pitch}px`);
}

const down = runs((y) => isSlot(scanX, y), 0, info.height).filter(
  (r) => r[1] > 4 && r[1] < 120,
);
console.log(
  `vertical @x=${scanX}: heights ` +
    down
      .map((r) => r[1])
      .slice(0, 6)
      .join(","),
);
