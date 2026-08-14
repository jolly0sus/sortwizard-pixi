// Fits LAYOUT.board.profile until our rendered outline lands on the reference
// playable's, by closing the loop instead of reasoning about it.
//
// Deriving the silhouette from a screenshot analytically means undoing the
// frame stroke, and the stroke runs along the outline's normal, so the
// correction depends on the local slope and blows up wherever the outline
// turns sharply — exactly at the throat we care about. Rendering our own board
// and comparing the two painted edges sidesteps all of that: whatever the
// frame does to the reference, it does to ours as well, so any difference that
// remains is a difference in the shape underneath.
//
// Each pass nudges every table entry by the gap measured at that row and
// re-renders. Usage:
//   node scripts/fit-profile.mjs <reference.png> [passes]

import { chromium } from "playwright";
import sharp from "sharp";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const configPath = join(root, "src", "config.js");
const reference = process.argv[2];
const passes = Number(process.argv[3] ?? 4);
const SCALE = (414 / 750) * 2;
const shot = join(root, "node_modules", ".cache-fit.png");

// Painted edge of the board on each row, in design units. No frame maths.
async function edges(file, ys) {
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
  for (const dy of ys) {
    const y = Math.round(dy * SCALE);
    if (y < 0 || y >= info.height) continue;
    let left = 0;
    while (left < info.width && purple(left, y)) left++;
    let right = info.width - 1;
    while (right > left && purple(right, y)) right--;
    out.set(dy, (right - left) / 2 / SCALE);
  }
  return out;
}

function readProfile() {
  const src = readFileSync(configPath, "utf8");
  const block = src.match(/profile:\s*\[([\s\S]*?)\n\s*\],/);
  if (!block) throw new Error("could not find LAYOUT.board.profile");
  const rows = [
    ...block[1].matchAll(/\[\s*(-?[\d.]+),\s*(-?[\d.]+)\s*\]/g),
  ].map((m) => [Number(m[1]), Number(m[2])]);
  return { src, rows, block: block[0] };
}

function writeProfile(rows) {
  const { src, block } = readProfile();
  const body = rows
    .map(([y, h]) => `      [${y}, ${Math.round(h * 10) / 10}],`)
    .join("\n");
  writeFileSync(configPath, src.replace(block, `profile: [\n${body}\n    ],`));
}

const browser = await chromium.launch();
for (let pass = 1; pass <= passes; pass++) {
  const { rows } = readProfile();
  const ys = rows.map(([y]) => y);

  const page = await browser.newPage({
    viewport: { width: 414, height: 896 },
    deviceScaleFactor: 2,
  });
  await page.goto("http://localhost:8080/", {
    waitUntil: "load",
    timeout: 60000,
  });
  await page.waitForFunction("window.__sw && window.__sw.getScene()", null, {
    timeout: 60000,
  });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: shot });
  await page.close();

  const [ref, mine] = await Promise.all([
    edges(reference, ys),
    edges(shot, ys),
  ]);

  let worst = 0;
  let sum = 0;
  let n = 0;
  const next = rows.map(([y, h], i) => {
    const a = ref.get(y);
    const b = mine.get(y);
    if (a === undefined || b === undefined) return [y, h];
    const gap = a - b;
    worst = Math.max(worst, Math.abs(gap));
    sum += Math.abs(gap);
    n++;

    // Where the outline turns hard — the wing tip — the painted edge on a row
    // is set by the frame sweeping around the corner, not by the width at that
    // row, so feedback there is meaningless and drives the loop into
    // oscillation. Leave those rows to the hand-placed arc.
    const prev = rows[i - 1] ?? rows[i];
    const nxt = rows[i + 1] ?? rows[i];
    const slope = Math.abs((nxt[1] - prev[1]) / (nxt[0] - prev[0] || 1));
    if (slope > 4) return [y, h];

    // Damped and clamped: a row on a shallow stretch swings the painted edge a
    // long way for a small change of shape.
    const stepChange = Math.max(-8, Math.min(8, gap * 0.35));
    return [y, Math.max(8, h + stepChange)];
  });

  console.log(
    `pass ${pass}: worst ${worst.toFixed(1)}  average ${(sum / n).toFixed(1)}`,
  );
  writeProfile(next);
}
await browser.close();
console.log("done — config.js updated");
