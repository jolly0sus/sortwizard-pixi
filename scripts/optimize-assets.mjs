// Shrinks the source art in place. Run once; `git checkout public/assets` puts
// the originals back if a result looks wrong.
//
// The art came out of the original playable at authoring resolution, which is
// far past what the game draws. The single-file build turns every byte into
// ~1.33 bytes of base64, so this is the difference between a huge file and
// something an ad network will accept.
//
// Each cap below leaves at least 2x headroom over the largest size the sprite
// is drawn at (device pixels at devicePixelRatio 2), which covers
// high-density screens. Everything then goes through palette quantisation:
// these are flat cartoon sprites with few colours, so a 256-colour palette is
// close to lossless on them while cutting the file by more than half.

import sharp from "sharp";
import { readFileSync, writeFileSync, statSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const images = join(root, "public", "assets", "images");

// Longest edge each sprite is allowed to keep. Absent = leave the size alone.
//
// TanBackingRender is the whole board render (wood, pressed grid, shading):
// drawn 820 design px wide, ~820 device px on a phone — 2000 keeps detail.
// The gloves appear at ~110 design px; the logo's largest use is the victory
// window at 634 design px.
const CAPS = {
  "Pointing_glove_hover.png": 512,
  "Pointing_glove_Click_1.png": 512,
  "Pointing_glove_Click_2.png": 512,
  "TanBackingRender.png": 2000,
  "FramePurpleRender.png": 2400,
};

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

// Sprite names are spread across the whole source tree, not just config.js —
// the logo, the result buttons and the tutorial hand are all named where they
// are used. Scanning only config.js quietly left the heaviest files
// untouched, so walk everything.
function sources(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (path.endsWith(".js")) out.push(path);
  }
  return out;
}

const names = new Set();
for (const file of sources(join(root, "src"))) {
  for (const m of readFileSync(file, "utf8").matchAll(/"([\w-]+\.png)"/g)) {
    names.add(m[1]);
  }
}
const used = [...names];

let before = 0;
let after = 0;

for (const name of used) {
  const file = join(images, name);
  let stat;
  try {
    stat = statSync(file);
  } catch {
    continue;
  }
  before += stat.size;

  let img = sharp(file);
  const meta = await img.metadata();

  if (CAPS[name] && Math.max(meta.width, meta.height) > CAPS[name]) {
    img = img.resize({
      width: meta.width >= meta.height ? CAPS[name] : null,
      height: meta.height > meta.width ? CAPS[name] : null,
      fit: "inside",
    });
  }

  const out = await img
    .png({ palette: true, quality: 90, effort: 10 })
    .toBuffer();

  // Never accept a "smaller" file that is actually bigger.
  if (out.length < stat.size) {
    writeFileSync(file, out);
    after += out.length;
    console.log(`${name}: ${kb(stat.size)} -> ${kb(out.length)}`);
  } else {
    after += stat.size;
  }
}

console.log(`total: ${kb(before)} -> ${kb(after)}`);
