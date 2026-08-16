export const ease = {
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  inQuad: (t) => t * t,
  outBack: (t) => {
    const c1 = 1.70158,
      c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  inBack: (t) => {
    const c1 = 1.70158,
      c3 = c1 + 1;
    return c3 * t * t * t - c1 * t * t;
  },
  sineOut: (t) => Math.sin((t * Math.PI) / 2),
  sineIn: (t) => 1 - Math.cos((t * Math.PI) / 2),
  sineInOut: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  linear: (t) => t,
  quadInOut: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  cubicOut: (t) => 1 - Math.pow(1 - t, 3),
  elasticOut: (t) => {
    const c4 = (2 * Math.PI) / 3;
    if (t === 0 || t === 1) return t;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
  bounceOut: (t) => {
    const n1 = 7.5625,
      d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
};

const active = new Set();
const timers = new Set();

export function tweenTo(
  obj,
  target,
  duration,
  easeFn = ease.linear,
  onComplete,
) {
  const start = {};
  for (const k in target) start[k] = obj[k];
  const t0 = performance.now();
  const rec = { obj, done: false };
  active.add(rec);
  const step = () => {
    if (rec.cancelled) return;
    const t =
      duration <= 0
        ? 1
        : Math.min(1, (performance.now() - t0) / (duration * 1000));
    const e = easeFn(t);
    for (const k in target) obj[k] = start[k] + (target[k] - start[k]) * e;
    if (t < 1) {
      requestAnimationFrame(step);
    } else {
      active.delete(rec);
      onComplete?.();
    }
  };
  step();
  return rec;
}

export function delay(seconds, fn) {
  const id = setTimeout(() => {
    timers.delete(id);
    fn();
  }, seconds * 1000);
  timers.add(id);
  return id;
}

// The original's Tween.stopAllByTarget: kill any in-flight tween driving the
// given object (used when a tray snaps its balls into place mid-flight).
export function stopTweensOf(obj) {
  for (const rec of active) {
    if (rec.obj === obj) {
      rec.cancelled = true;
      active.delete(rec);
    }
  }
}

// Tearing the scene down leaves tweens and timers pointing at destroyed
// display objects — the CTA pulse loops forever, a lid finishes popping on a
// box that no longer exists — and they throw on the next frame. Anything that
// disposes of the scene must call this first.
export function cancelAll() {
  for (const rec of active) rec.cancelled = true;
  active.clear();
  for (const id of timers) clearTimeout(id);
  timers.clear();
}
