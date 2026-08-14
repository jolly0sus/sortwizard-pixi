import { defineConfig } from "vite";

// SW_SINGLE is set by scripts/build-single.mjs.
//
// PixiJS v8 pulls its renderers in through dynamic import(), so a normal build
// splits them into sibling chunks — WebGLRenderer, browserAll and friends.
// That is what we want on the web, where they load in parallel and the WebGPU
// half is never fetched. It is fatal for a one-file build though: inlining
// only the entry chunk leaves `import("./WebGLRenderer-xxxx.js")` pointing at
// files that are not there, so the renderer never arrives and nothing draws.
// Rolling everything into one chunk is what makes the single file standalone.
const single = !!process.env.SW_SINGLE;

// https://vite.dev/config/
export default defineConfig({
  server: {
    port: 8080,
    open: true,
  },
  build: single
    ? {
        rollupOptions: {
          output: { inlineDynamicImports: true },
        },
      }
    : {},
});
