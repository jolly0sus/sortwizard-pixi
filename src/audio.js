import { SFX } from "./config.js";

// SFX through the Web Audio API, decoded once per clip.
//
// This used to pool up to six HTMLAudioElements per sound, created lazily on
// demand. On iOS Safari that was the whole game freezing on the first tap: the
// sources are data: URIs in the single-file build, several hundred KB of
// base64 each, and one tap fires dozens of sounds — 27 balls landing on the
// belt, nine multiplier hits. Safari defers all audio work until the first
// user gesture, so every one of those clips got parsed and decoded right then,
// six copies apiece, on the main thread. iOS also caps how many audio elements
// can exist at once, which the pool walked straight into.
//
// Web Audio fixes both: decodeAudioData runs off the main thread and yields a
// buffer that is decoded exactly once. Playing it afterwards is just wiring a
// source node to the output — no parsing, no element limit, and overlapping
// one-shots come for free.
class AudioManager {
  constructor() {
    this.sfxVolume = 1;
    this.enabled = true;
    this.ctx = null;
    this._buffers = new Map(); // src -> AudioBuffer
    this._pending = new Map(); // src -> Promise, so a clip decodes once
    this._unlocked = false;

    // Browsers only allow an AudioContext to start inside a user gesture, and
    // iOS additionally starts it suspended. Both are handled on first touch.
    const unlock = () => {
      if (this._unlocked) return;
      this._unlocked = true;
      this._ensureContext();
      // Warm every clip now rather than mid-game. The decodes are async and
      // off-thread, so this costs the player nothing.
      for (const src of new Set(Object.values(SFX))) this._load(src);
    };
    for (const evt of ["pointerdown", "touchstart"]) {
      window.addEventListener(evt, unlock, { once: true, passive: true });
    }
  }

  _ensureContext() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
      return this.ctx;
    }
    const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctor) return null;
    try {
      this.ctx = new Ctor();
      if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
    } catch {
      this.ctx = null;
    }
    return this.ctx;
  }

  _load(src) {
    if (this._buffers.has(src) || this._pending.has(src)) return;
    const ctx = this._ensureContext();
    if (!ctx) return;
    const job = fetch(src)
      .then((r) => r.arrayBuffer())
      .then((bytes) => ctx.decodeAudioData(bytes))
      .then((buf) => {
        this._buffers.set(src, buf);
        this._pending.delete(src);
      })
      .catch(() => {
        // A clip that will not decode simply stays silent; it must never take
        // the game down with it.
        this._pending.delete(src);
      });
    this._pending.set(src, job);
  }

  play(src, volume = 1) {
    if (!this.enabled || !src) return;
    const ctx = this.ctx;
    if (!ctx) return; // before the first gesture there is nothing to play into
    const buf = this._buffers.get(src);
    if (!buf) {
      this._load(src); // still decoding: skip this one rather than stall
      return;
    }
    try {
      const gain = ctx.createGain();
      gain.gain.value = Math.max(0, Math.min(1, volume * this.sfxVolume));
      gain.connect(ctx.destination);
      const node = ctx.createBufferSource();
      node.buffer = buf;
      node.connect(gain);
      node.onended = () => {
        node.disconnect();
        gain.disconnect();
      };
      node.start();
    } catch {
      // ignore playback errors (context closed, autoplay policy, etc.)
    }
  }

  playBoxTap() {
    this.play(SFX.boxTap);
  }
  playBoxAppear() {
    this.play(SFX.boxAppear);
  }
  playBoxTapBlocked() {
    this.play(SFX.boxTapBlocked);
  }
  playMultiplier() {
    this.play(SFX.multiplier);
  }
  playBallOnConveyor() {
    this.play(SFX.ballOnConveyor, 0.5);
  }
  playBallInBox() {
    this.play(SFX.ballInBox);
  }
  playBoxFilled() {
    this.play(SFX.boxFilled);
  }
  playWand() {
    this.play(SFX.wand);
  }
  playWandHit() {
    this.play(SFX.wandHit);
  }
  playShuffle() {
    this.play(SFX.shuffle);
  }
  playHat() {
    this.play(SFX.hat);
  }
  playHatSuck() {
    this.play(SFX.hatSuck);
  }
  playVictory() {
    this.play(SFX.victory);
  }
  playFail() {
    this.play(SFX.fail);
  }
}

export const audio = new AudioManager();
