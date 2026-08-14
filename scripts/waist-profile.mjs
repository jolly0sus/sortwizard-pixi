// Reads the wooden neck width per row out of two screenshots and prints them
// side by side in design units, so the board silhouette can be fitted to the
// reference instead of guessed at.
//
// Both shots must be taken at viewport 414x896, deviceScaleFactor 2, which
// makes screenshot px = design px * 1.104.
import sharp from "sharp";

const SCALE = (414 / 750) * 2; // design -> screenshot px
const files = process.argv.slice(2);

async function profile(file) {
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
  const out = new Map();
  for (let dy = 780; dy <= 1060; dy += 10) {
    const y = Math.round(dy * SCALE);
    if (y < 0 || y >= info.height) continue;
    // widest stretch of non-purple: the wood bridging the two purple wings
    let best = 0;
    let run = 0;
    for (let x = 0; x < info.width; x++) {
      if (!purple(x, y)) {
        run++;
        if (run > best) best = run;
      } else run = 0;
    }
    out.set(dy, +(best / SCALE).toFixed(0));
  }
  return out;
}

const [a, b] = await Promise.all(files.map(profile));
console.log("design y | reference | mine  | diff");
for (const [y, ref] of a) {
  const mine = b.get(y);
  console.log(
    String(y).padStart(8) +
      " |" +
      String(ref).padStart(10) +
      " |" +
      String(mine).padStart(6) +
      " |" +
      String(mine - ref).padStart(6),
  );
}
