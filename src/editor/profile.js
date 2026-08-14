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
    this.selected = null; // { contour, index }

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
    if (!on) this.selected = null;
    this.redraw();
  }

  // The two point-defined outlines in the scene. The board is a column of
  // half-widths mirrored about its vertical centre; the belt is the same idea
  // lying down — half-heights along its length, mirrored about centerY. Both
  // are edited the same way, so the difference is kept to this table.
  get contours() {
    return [
      {
        id: "board",
        points: LAYOUT.board.profile,
        // point -> screen: [across, along]
        place: ([along, half], side) => ({
          x: LAYOUT.board.x + LAYOUT.board.w / 2 + side * half,
          y: along,
        }),
        // screen -> point
        read: (p) => ({
          along: p.y,
          half: Math.abs(p.x - (LAYOUT.board.x + LAYOUT.board.w / 2)),
        }),
        side: (p) => (p.x >= LAYOUT.board.x + LAYOUT.board.w / 2 ? 1 : -1),
        color: 0x00e5ff,
      },
      {
        id: "belt",
        points: LAYOUT.conveyor.shape,
        place: ([along, half], side) => ({
          x: along,
          y: LAYOUT.conveyor.centerY + side * half,
        }),
        read: (p) => ({
          along: p.x,
          half: Math.abs(p.y - LAYOUT.conveyor.centerY),
        }),
        side: (p) => (p.y >= LAYOUT.conveyor.centerY ? 1 : -1),
        color: 0xff7ae0,
      },
    ];
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

  // Nearest point across both outlines, on either flank, or null.
  _pointAt(p) {
    let best = null;
    let bestD = HIT / this.game.getRoot().scale.x;
    for (const c of this.contours) {
      c.points.forEach((row, i) => {
        for (const side of [1, -1]) {
          const at = c.place(row, side);
          const d = Math.hypot(p.x - at.x, p.y - at.y);
          if (d < bestD) {
            bestD = d;
            best = { contour: c, index: i };
          }
        }
      });
    }
    return best;
  }

  _pick(e) {
    if (!this.enabled) return;
    const p = this._toDesign(e.clientX, e.clientY);
    const hit = this._pointAt(p);
    if (!hit) return;
    e.stopPropagation();
    e.preventDefault();
    this.selected = hit;
    this._drag = hit;
  }

  // Points stay ordered along their axis, so an outline can never fold back on
  // itself and turn inside out mid-drag.
  _clampAlong(points, index, along) {
    const prev = points[index - 1];
    const next = points[index + 1];
    const lo = prev ? prev[0] + 1 : -Infinity;
    const hi = next ? next[0] - 1 : Infinity;
    return Math.round(Math.min(hi, Math.max(lo, along)));
  }

  _move(e) {
    if (!this._drag) return;
    const { contour, index } = this._drag;
    const p = this._toDesign(e.clientX, e.clientY);
    const row = contour.points[index];
    const read = contour.read(p);
    row[1] = Math.max(0, Math.round(read.half * 10) / 10);
    row[0] = this._clampAlong(contour.points, index, read.along);
    this.onChange?.();
  }

  _release() {
    if (!this._drag) return;
    this._drag = null;
    this.onChange?.();
  }

  _key(e) {
    if (!this.enabled || !this.selected) return;
    if (e.target instanceof HTMLInputElement) return;
    const { contour, index } = this.selected;
    const points = contour.points;
    const row = points[index];
    const step = e.shiftKey ? 5 : 1;

    // insert a point halfway to the next one, or drop this one
    if (e.key === "+" || e.key === "=") {
      const next = points[index + 1];
      if (!next) return;
      points.splice(index + 1, 0, [
        Math.round((row[0] + next[0]) / 2),
        Math.round(((row[1] + next[1]) / 2) * 10) / 10,
      ]);
      e.preventDefault();
      this.onChange?.();
      return;
    }
    if (e.key === "Delete" || e.key === "-") {
      if (points.length <= 2) return;
      points.splice(index, 1);
      this.selected = { contour, index: Math.min(index, points.length - 1) };
      e.preventDefault();
      this.onChange?.();
      return;
    }

    // Arrows always mean "wider/narrower" and "further along", whichever way
    // the outline happens to lie.
    const nudge = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }[e.key];
    if (!nudge) return;
    e.preventDefault();
    const acrossFirst = contour.id === "board";
    const dHalf = acrossFirst ? nudge[0] : nudge[1];
    const dAlong = acrossFirst ? nudge[1] : nudge[0];
    row[1] = Math.max(0, Math.round((row[1] + dHalf) * 10) / 10);
    row[0] = this._clampAlong(points, index, row[0] + dAlong);
    this.onChange?.();
  }

  redraw() {
    if (!this.enabled) return;
    const root = this.game.getRoot();
    this.layer.position.set(root.x, root.y);
    this.layer.scale.set(root.scale.x, root.scale.y);
    const s = 1 / root.scale.x;

    this.line.clear();
    this.dots.clear();

    for (const c of this.contours) {
      for (const side of [1, -1]) {
        c.points.forEach((row, i) => {
          const at = c.place(row, side);
          if (i === 0) this.line.moveTo(at.x, at.y);
          else this.line.lineTo(at.x, at.y);
        });
        this.line.stroke({ color: c.color, width: 1.5 * s, alpha: 0.9 });
      }

      c.points.forEach((row, i) => {
        const on =
          this.selected?.contour.id === c.id && this.selected.index === i;
        for (const side of [1, -1]) {
          const at = c.place(row, side);
          this.dots
            .circle(at.x, at.y, (on ? HANDLE : HANDLE - 3) * s)
            .fill({ color: on ? 0xffdc00 : c.color, alpha: on ? 1 : 0.75 })
            .stroke({ color: 0x102030, width: 1.5 * s });
        }
      });
    }
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
