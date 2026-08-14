// On-screen diagnostics, off unless the page is opened with ?fps=1.
//
// A phone that stutters cannot be profiled from here, and guessing at causes
// from a desktop is how time gets wasted. This puts the numbers that matter on
// the device's own screen: frame rate, the worst frame in the last second, how
// many balls are alive, which renderer was picked and at what resolution.
//
// Read it like this:
//   fps low + worst frame high        -> something stalls: GC, texture upload
//   fps low + worst frame near steady -> steadily too much work per frame
//   renderer webgpu                   -> mobile WebGPU, worth forcing to webgl
//   res 3 on a tall screen            -> filling millions of pixels a frame

export function mountHud(app, world) {
  if (!new URLSearchParams(location.search).has("fps")) return;

  const el = document.createElement("div");
  el.style.cssText =
    "position:fixed;left:6px;top:6px;z-index:99999;background:#000000cc;" +
    "color:#0f0;font:12px ui-monospace,monospace;padding:6px 8px;" +
    "border-radius:5px;white-space:pre;pointer-events:none";
  document.body.appendChild(el);

  const r = app.renderer;
  const head = `${r.name} res=${r.resolution} ${r.width}x${r.height}`;

  let frames = 0;
  let worst = 0;
  let since = performance.now();
  let last = since;

  app.ticker.add(() => {
    const now = performance.now();
    const dt = now - last;
    last = now;
    frames++;
    if (dt > worst) worst = dt;

    if (now - since >= 1000) {
      const fps = Math.round((frames * 1000) / (now - since));
      el.textContent =
        `${fps} fps   worst ${worst.toFixed(0)}ms\n` +
        `balls ${world.freeBalls.size + world.conveyor.getOccupiedCells().length}\n` +
        head;
      frames = 0;
      worst = 0;
      since = now;
    }
  });
}
