import { SFX } from "./config.js";

// Lightweight SFX player: pools cloned HTMLAudioElements per clip so
// overlapping one-shots (several balls landing at once) don't cut each other off.
class AudioManager {
  constructor() {
    this.sfxVolume = 1;
    this.enabled = true;
    this._pools = new Map();
    this._unlocked = false;
    const unlock = () => {
      if (this._unlocked) return;
      this._unlocked = true;
      window.removeEventListener("pointerdown", unlock);
    };
    window.addEventListener("pointerdown", unlock, { once: true });
  }

  _get(src) {
    let pool = this._pools.get(src);
    if (!pool) {
      pool = { clips: [], idx: 0 };
      this._pools.set(src, pool);
    }
    if (pool.clips.length < 6) {
      const a = new Audio(src);
      a.preload = "auto";
      pool.clips.push(a);
      return a;
    }
    pool.idx = (pool.idx + 1) % pool.clips.length;
    return pool.clips[pool.idx];
  }

  play(src, volume = 1) {
    if (!this.enabled || !src) return;
    try {
      const a = this._get(src);
      a.currentTime = 0;
      a.volume = Math.max(0, Math.min(1, volume * this.sfxVolume));
      const p = a.play();
      if (p && p.catch) p.catch(() => {});
    } catch {
      // ignore playback errors (autoplay policy, etc.)
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
