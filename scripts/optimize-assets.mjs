// Shrinks the source art in place. Run once; `git checkout public/assets` puts
// the originals back if a result looks wrong.
//
// The art came out of the original playable at authoring resolution, which is
// far past what the game draws. The single-file build turns every byte into
// ~1.33 bytes of base64, so this is the difference between a 19 MB file and
// something an ad network will accept.
//
// Two kinds of waste are dealt with here:
//
//   1. TanBackingRender is a 2287x3822 sheet of which the board uses one
//      1700x450 strip of wood grain (LAYOUT.woodPatch). The rest is carried
//      for nothing, so it gets cropped away and the patch origin moves to 0,0.
//
//   2. Several sprites are stored many times larger than they are ever drawn —
//      the tutorial hand is 2048x2048 and appears at roughly 150 design px.
//      Each cap below leaves at least 2x headroom over the drawn size, which
//      covers high-density screens.
//
// Everything then goes through palette quantisation. These are flat cartoon
// sprites with few colours, so a 256-colour palette is close to lossless on
// them while cutting the file by more than half.

import sharp from "sharp";
import { readFileSync, writeFileSync, statSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const images = join(root, "public", "assets", "images");

// Region of TanBackingRender the board actually samples, straight from
// LAYOUT.woodPatch. Kept in sync by the assertion below.
const PATCH = { left: 300, top: 3300, width: 1700, height: 450 };

// Longest edge each sprite is allowed to keep. Absent = leave the size alone.
const CAPS = {
  "Pointing_glove_hover.png": 512,
  "Pointing_glove_Click_1.png": 512,
  "Pointing_glove_Click_2.png": 512,
  "Logo_SW.png": 640,
  "Fail_Button.png": 512,
  "Win_Button.png": 512,
};

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

// Guard: if woodPatch is edited without updating PATCH, the crop would silently
// take the wrong strip and the board's grain would change.
const config = readFileSync(join(root, "src", "config.js"), "utf8");
const inUse = config.match(
  /woodPatch:\s*\{\s*x:\s*(-?\d+),\s*y:\s*(-?\d+),\s*w:\s*(\d+),\s*h:\s*(\d+)/,
);
if (!inUse) throw new Error("could not read LAYOUT.woodPatch from config.js");
const [, px, py, pw, ph] = inUse.map(Number);
const alreadyCropped = px === 0 && py === 0;
if (!alreadyCropped && (px !== PATCH.left || py !== PATCH.top)) {
  throw new Error(
    `woodPatch (${px},${py},${pw},${ph}) does not match the crop this script ` +
      `performs (${PATCH.left},${PATCH.top},${PATCH.width},${PATCH.height})`,
  );
}

// Sprite names are spread across the whole source tree, not just config.js —
// the logo, the result buttons and the tutorial hand are all named where they
// are used. Scanning only config.js quietly left the four heaviest files
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
names.add("TanBackingRender.png");
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

  if (name === "TanBackingRender.png") {
    if (meta.width <= PATCH.width && meta.height <= PATCH.height) {
      after += stat.size;
      continue; // already cropped by an earlier run
    }
    img = img.extract(PATCH);
  } else if (CAPS[name] && Math.max(meta.width, meta.height) > CAPS[name]) {
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
    console.log(
      `${name.padEnd(32)} ${kb(stat.size).padStart(8)} -> ${kb(out.length).padStart(8)}`,
    );
  } else {
    after += stat.size;
  }
}

// --- audio ---------------------------------------------------------------
// sfxFail.wav ships as 96 kHz / 24-bit / stereo — mastering quality for a
// three-second jingle, and on its own bigger than every sprite put together.
// There is no ffmpeg here, but a PCM WAV needs no codec: read the samples,
// average the channels, and decimate to 32 kHz / 16-bit. 96000 divides by
// three exactly, so each output sample is the mean of three input ones, which
// doubles as the low-pass that keeps decimation from aliasing.
const TARGET_RATE = 32000;

function downsampleWav(buf) {
  if (buf.toString("ascii", 0, 4) !== "RIFF") return null;

  // Walk the chunk list rather than assuming the canonical 44-byte header.
  let fmt = null;
  let data = null;
  let pos = 12;
  while (pos + 8 <= buf.length) {
    const id = buf.toString("ascii", pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    if (id === "fmt ") fmt = pos + 8;
    else if (id === "data") data = { start: pos + 8, size };
    pos += 8 + size + (size % 2);
  }
  if (fmt === null || !data) return null;

  const format = buf.readUInt16LE(fmt);
  const channels = buf.readUInt16LE(fmt + 2);
  const rate = buf.readUInt32LE(fmt + 4);
  const bits = buf.readUInt16LE(fmt + 14);
  if (format !== 1) return null; // not plain PCM
  if (rate % TARGET_RATE !== 0) return null; // not a whole-number decimation
  if (bits !== 24 && bits !== 16) return null;

  const step = rate / TARGET_RATE;
  const bytesPerSample = bits / 8;
  const frame = bytesPerSample * channels;
  const frames = Math.floor(data.size / frame);
  const outFrames = Math.floor(frames / step);

  const readSample = (offset) =>
    bits === 24
      ? ((buf[offset + 2] << 24) |
          (buf[offset + 1] << 16) |
          (buf[offset] << 8)) /
        65536 // sign-extend via the top byte, then scale to 16-bit
      : buf.readInt16LE(offset);

  const pcm = Buffer.alloc(outFrames * 2);
  for (let i = 0; i < outFrames; i++) {
    let sum = 0;
    for (let s = 0; s < step; s++) {
      const base = data.start + (i * step + s) * frame;
      for (let c = 0; c < channels; c++)
        sum += readSample(base + c * bytesPerSample);
    }
    const avg = Math.round(sum / (step * channels));
    pcm.writeInt16LE(Math.max(-32768, Math.min(32767, avg)), i * 2);
  }

  const out = Buffer.alloc(44 + pcm.length);
  out.write("RIFF", 0, "ascii");
  out.writeUInt32LE(36 + pcm.length, 4);
  out.write("WAVEfmt ", 8, "ascii");
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20); // PCM
  out.writeUInt16LE(1, 22); // mono
  out.writeUInt32LE(TARGET_RATE, 24);
  out.writeUInt32LE(TARGET_RATE * 2, 28); // byte rate
  out.writeUInt16LE(2, 32); // block align
  out.writeUInt16LE(16, 34); // bits
  out.write("data", 36, "ascii");
  out.writeUInt32LE(pcm.length, 40);
  pcm.copy(out, 44);
  return out;
}

const audioDir = join(root, "public", "assets", "audio");
for (const name of readdirSync(audioDir)) {
  if (!name.endsWith(".wav")) continue; // mp3s are already compressed
  const file = join(audioDir, name);
  const size = statSync(file).size;
  before += size;
  const out = downsampleWav(readFileSync(file));
  if (out && out.length < size) {
    writeFileSync(file, out);
    after += out.length;
    console.log(
      `${name.padEnd(32)} ${kb(size).padStart(8)} -> ${kb(out.length).padStart(8)}`,
    );
  } else {
    after += size;
  }
}

console.log(`\ntotal ${kb(before)} -> ${kb(after)}`);
if (!alreadyCropped) {
  console.log(
    "\nNow set LAYOUT.woodPatch to { x: 0, y: 0, w: 1700, h: 450 } in config.js.",
  );
}
