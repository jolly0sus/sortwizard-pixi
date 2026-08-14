// Packs the whole game into one self-contained .html file.
//
// The normal build leaves the JS, the CSS and 14 MB of art and audio as
// separate files that the page fetches at runtime. Ad networks want a single
// document, so this bakes all of it in: the bundle and the stylesheet inline,
// every asset as a data: URI in a lookup table on window.__SW_ASSETS. The
// asset() helper in config.js reads that table when it exists, so the same
// source runs unchanged from the dev server, a normal build, or this file
// opened straight off disk with no server at all.

import { execFileSync } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  mkdirSync,
} from "node:fs";
import { join, extname, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = join(root, "dist");
// Deliberately not inside dist/: vite empties that directory on every build,
// so a single file left there quietly disappears the next time anyone runs
// `npm run build` — which looks exactly like "the html does not work".
const out = join(root, "single", "sortwizard.html");

const MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".ttf": "font/ttf",
  ".woff2": "font/woff2",
};

function walk(dir) {
  const found = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) found.push(...walk(path));
    else found.push(path);
  }
  return found;
}

const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;

console.log("building...");
execFileSync("npm", ["run", "build"], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
  // Tells vite.config.js to roll PixiJS's dynamically imported renderers into
  // the one chunk we are about to inline. Without it the file loads, finds no
  // sibling chunks to import, and never draws anything.
  env: { ...process.env, SW_SINGLE: "1" },
});

// --- the bundle and stylesheet -------------------------------------------
const html = readFileSync(join(dist, "index.html"), "utf8");

const jsMatch = html.match(/<script[^>]+src="([^"]+)"[^>]*>\s*<\/script>/);
if (!jsMatch)
  throw new Error("could not find the bundle <script> in dist/index.html");
const js = readFileSync(join(dist, jsMatch[1].replace(/^\//, "")), "utf8");

// A leftover import of a sibling chunk means the file is not self-contained:
// it would open, sit there, and draw nothing, with the failure buried in a
// dynamic import rejection. Better to refuse to write it.
const orphan = js.match(/\bimport\(\s*["'](\.\/[^"']+)["']\s*\)/);
if (orphan) {
  throw new Error(
    `bundle still imports a sibling chunk (${orphan[1]}) — the single file ` +
      `would not run standalone. Is SW_SINGLE reaching vite.config.js?`,
  );
}

const cssHrefs = [
  ...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"[^>]*>/g),
];
const css = cssHrefs
  .map((m) => readFileSync(join(dist, m[1].replace(/^\//, "")), "utf8"))
  .join("\n");

// --- assets, but only the ones the bundle actually asks for ---------------
// Paths are built at runtime (`/assets/images/${name}`), so the bundle holds
// the file names rather than whole paths — matching on the basename is what
// tells us a file is really used. Skipping the rest keeps ~4 MB of unused art
// out of the file.
const assetsDir = join(root, "public", "assets");
const table = {};
let packed = 0;
let skipped = 0;

for (const file of walk(assetsDir)) {
  const name = file.split(/[\\/]/).pop();
  if (!js.includes(name)) {
    skipped++;
    continue;
  }
  const mime = MIME[extname(file).toLowerCase()];
  if (!mime) {
    skipped++;
    continue;
  }
  const key = "/" + relative(join(root, "public"), file).split("\\").join("/");
  const bytes = readFileSync(file);
  table[key] = `data:${mime};base64,${bytes.toString("base64")}`;
  packed += bytes.length;
}

// --- stitch it together ---------------------------------------------------
// Derived from the real dist/index.html rather than written out by hand. The
// markup matters: main.js mounts into #pixi-container, which sits inside #app,
// and a hand-rolled body that dropped it produced a blank page and a null
// appendChild. Editing index.html now carries over automatically.
let doc = html;

// External references become inline content: the stylesheet, the favicon, and
// the bundle itself.
doc = doc.replace(/<link[^>]+rel="stylesheet"[^>]*>/g, "");
doc = doc.replace(
  /<link[^>]+rel="icon"[^>]+href="([^"]+)"[^>]*>/g,
  (tag, href) => {
    const key = href.replace(/^\//, "");
    try {
      const bytes = readFileSync(join(root, "public", key));
      const mime = MIME[extname(key).toLowerCase()] ?? "image/png";
      return `<link rel="icon" href="data:${mime};base64,${bytes.toString("base64")}" />`;
    } catch {
      return ""; // no favicon on disk: drop the tag rather than 404
    }
  },
);
doc = doc.replace(/<script[^>]+src="[^"]+"[^>]*>\s*<\/script>/g, "");

doc = doc.replace("</head>", `<style>\n${css}\n</style>\n</head>`);

// The table has to exist before the bundle runs, since config.js reads it
// while the module initialises.
doc = doc.replace(
  "</body>",
  `<script>window.__SW_ASSETS = ${JSON.stringify(table)};</script>\n` +
    `<script type="module">\n${js}\n</script>\n</body>`,
);

// Refuse to ship a document that lost the mount point.
if (!doc.includes('id="pixi-container"')) {
  throw new Error("generated page has no #pixi-container — main.js would fail");
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, doc);

console.log(
  `\npacked ${Object.keys(table).length} assets (${mb(packed)} raw), skipped ${skipped} unused`,
);
console.log(
  `bundle ${mb(js.length)}, css ${(css.length / 1024).toFixed(1)} KB`,
);
console.log(`\n-> ${relative(root, out)}  ${mb(statSync(out).size)}`);
