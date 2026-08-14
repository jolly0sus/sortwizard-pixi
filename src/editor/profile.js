import { Container, Graphics } from "pixi.js";
import { LAYOUT } from "../config.js";

// Hand-editing for the board's outline.
//
// The rest of the editor works on rectangles, because everything else on the
// board is positioned by a handful of numbers. The silhouette is not: it is a
// table of measured half-widths (LAYOUT.board.profile) that boardHalfWidthAt
// interpolates, so there is no box to drag. This draws a handle on every point
// of that table and lets them be moved directly, which is the only practical
// way to adjust the throat and the wing tip — the row-by-row measuring the
// fitting script does stops being meaningful exactly where the outline turns.
//
// Dragging sideways changes the half-width at that row, dragging up and down
// moves the row itself. The mirror handle on the other flank follows, since
// the board is symmetrical about its centre.

const HANDLE = 9;
const HIT = 16;

export class ProfileEditor {
  constructor(app, game, { onChange } = {}) {
    this.app = app;
    this.game = game;
    this.onChange = onChange;
    this.enabled = false;
    this.selected = -1;

    this.layer = new Container();
    this.layer.eventMode = "static";
    this.layer.visible = false;
    app.stage.addChild(this.layer);

    this.line = new Graphics();
    this.dots = new Graphics();
    this.layer.addChild(this.line, this.dots);

    this._drag = null;
    this._sync = () => this.redraw();
    app.ticker.add(this._sync);

    this._onDown = (e) => this._pick(e);
    this._onMove = (e) => this._move(e);
    this._onUp = () => this._release();
    app.canvas.addEventListener("pointerdown", this._onDown, true);
    window.addEventListener("pointermove", this._onMove);
    window.addEventListener("pointerup", this._onUp);

    this._onKey = (e) => this._key(e);
    window.addEventListener("keydown", this._onKey);
  }

  setEnabled(on) {
    this.enabled = on;
    this.layer.visible = on;
    if (!on) this.selected = -1;
    this.redraw();
  }

  get profile() {
    return LAYOUT.board.profile;
  }

  _cx() {
    return LAYOUT.board.x + LAYOUT.board.w / 2;
  }

  _toDesign(clientX, clientY) {
    const root = this.game.getRoot();
    const box = this.app.canvas.getBoundingClientRect();
    const px = (clientX - box.left) * (this.app.canvas.width / box.width);
    const py = (clientY - box.top) * (this.app.canvas.height / box.height);
    return {
      x: (px - root.x) / root.scale.x,
      y: (py - root.y) / root.scale.y,
    };
  }

  // Index of the point nearest the pointer, on either flank, or -1.
  _pointAt(p) {
    const cx = this._cx();
    let best = -1;
    let bestD = HIT / this.game.getRoot().scale.x;
    this.profile.forEach(([y, half], i) => {
      for (const x of [cx + half, cx - half]) {
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    });
    return best;
  }

  _pick(e) {
    if (!this.enabled) return;
    const p = this._toDesign(e.clientX, e.clientY);
    const i = this._pointAt(p);
    if (i < 0) return;
    e.stopPropagation();
    e.preventDefault();
    this.selected = i;
    this._drag = { index: i, side: p.x >= this._cx() ? 1 : -1 };
  }

  _move(e) {
    if (!this._drag) return;
    const p = this._toDesign(e.clientX, e.clientY);
    const row = this.profile[this._drag.index];
    // half-width from the pointer's distance to the centre line, whichever
    // flank was grabbed
    row[1] = Math.max(8, Math.round(Math.abs(p.x - this._cx()) * 10) / 10);
    // y stays ordered, so the table never folds back on itself
    const prev = this.profile[this._drag.index - 1];
    const next = this.profile[this._drag.index + 1];
    const lo = prev ? prev[0] + 1 : -Infinity;
    const hi = next ? next[0] - 1 : Infinity;
    row[0] = Math.round(Math.min(hi, Math.max(lo, p.y)));
    this.onChange?.();
  }

  _release() {
    if (!this._drag) return;
    this._drag = null;
    this.onChange?.();
  }

  _key(e) {
    if (!this.enabled || this.selected < 0) return;
    if (e.target instanceof HTMLInputElement) return;
    const row = this.profile[this.selected];
    const step = e.shiftKey ? 5 : 1;

    // insert a point halfway to the next one, or drop this one
    if (e.key === "+" || e.key === "=") {
      const next = this.profile[this.selected + 1];
      if (!next) return;
      this.profile.splice(this.selected + 1, 0, [
        Math.round((row[0] + next[0]) / 2),
        Math.round(((row[1] + next[1]) / 2) * 10) / 10,
      ]);
      e.preventDefault();
      this.onChange?.();
      return;
    }
    if (e.key === "Delete" || e.key === "-") {
      if (this.profile.length <= 2) return;
      this.profile.splice(this.selected, 1);
      this.selected = Math.min(this.selected, this.profile.length - 1);
      e.preventDefault();
      this.onChange?.();
      return;
    }

    const nudge = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }[e.key];
    if (!nudge) return;
    e.preventDefault();
    row[1] = Math.max(8, Math.round((row[1] + nudge[0]) * 10) / 10);
    const prev = this.profile[this.selected - 1];
    const next = this.profile[this.selected + 1];
    const lo = prev ? prev[0] + 1 : -Infinity;
    const hi = next ? next[0] - 1 : Infinity;
    row[0] = Math.round(Math.min(hi, Math.max(lo, row[0] + nudge[1])));
    this.onChange?.();
  }

  redraw() {
    if (!this.enabled) return;
    const root = this.game.getRoot();
    this.layer.position.set(root.x, root.y);
    this.layer.scale.set(root.scale.x, root.scale.y);

    const cx = this._cx();
    const s = 1 / root.scale.x;

    this.line.clear();
    const p = this.profile;
    for (const side of [1, -1]) {
      p.forEach(([y, half], i) => {
        const x = cx + side * half;
        if (i === 0) this.line.moveTo(x, y);
        else this.line.lineTo(x, y);
      });
      this.line.stroke({ color: 0x00e5ff, width: 1.5 * s, alpha: 0.9 });
    }

    this.dots.clear();
    p.forEach(([y, half], i) => {
      const on = i === this.selected;
      for (const side of [1, -1]) {
        this.dots
          .circle(cx + side * half, y, (on ? HANDLE : HANDLE - 3) * s)
          .fill({ color: on ? 0xffdc00 : 0x00e5ff, alpha: on ? 1 : 0.75 })
          .stroke({ color: 0x102030, width: 1.5 * s });
      }
    });
  }

  destroy() {
    this.app.ticker.remove(this._sync);
    this.app.canvas.removeEventListener("pointerdown", this._onDown, true);
    window.removeEventListener("pointermove", this._onMove);
    window.removeEventListener("pointerup", this._onUp);
    window.removeEventListener("keydown", this._onKey);
    this.layer.destroy({ children: true });
  }
}
