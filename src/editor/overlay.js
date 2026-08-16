import { Container, Graphics } from "pixi.js";
import { DESIGN_W } from "../config.js";
import { editableObjects, pickObject } from "./objects.js";

const HANDLE = 13;
// [x weight, y weight] — which corner/edge each handle drives
const HANDLES = [
  [0, 0],
  [0.5, 0],
  [1, 0],
  [1, 0.5],
  [1, 1],
  [0.5, 1],
  [0, 1],
  [0.5, 0.5], // centre = move
];

// Lives on app.stage (not the game's root) so it survives a rebuild, and
// copies the root's transform each frame so it can be drawn in design space.
export class SelectionOverlay {
  constructor(app, game, { onChange, onSelect }) {
    this.app = app;
    this.game = game;
    this.onChange = onChange;
    this.onSelect = onSelect;
    this.objects = editableObjects(() => this._viewport());
    this.selected = null;
    this.enabled = false;

    this.layer = new Container();
    this.layer.eventMode = "static";
    this.layer.visible = false;
    app.stage.addChild(this.layer);

    this.frame = new Graphics();
    this.layer.addChild(this.frame);

    this.handles = HANDLES.map(([hx, hy]) => {
      const g = new Graphics();
      g.eventMode = "static";
      g.cursor = hx === 0.5 && hy === 0.5 ? "move" : "nwse-resize";
      g.on("pointerdown", (e) => this._startDrag(e, hx, hy));
      this.layer.addChild(g);
      return g;
    });

    this._sync = () => this._update();
    app.ticker.add(this._sync);

    this._onCanvasDown = (e) => this._pick(e);
    app.canvas.addEventListener("pointerdown", this._onCanvasDown, true);

    this._onKey = (e) => this._nudge(e);
    window.addEventListener("keydown", this._onKey);
  }

  setEnabled(on) {
    this.enabled = on;
    this.layer.visible = on;
    if (!on) this.select(null);
  }

  select(obj) {
    this.selected = obj;
    this.onSelect?.(obj);
    this._update();
  }

  selectById(id) {
    this.select(this.objects.find((o) => o.id === id) ?? null);
  }

  // The visible rect in design coordinates — the same left/right edges the
  // scene's fit() feeds to the corner-anchored widgets, derived here from the
  // root transform so the two cannot drift apart.
  _viewport() {
    const root = this.game.getRoot();
    if (!root || root.destroyed) return { left: 0, right: DESIGN_W };
    const s = root.scale.x;
    return {
      left: -root.x / s,
      right: (this.app.renderer.width - root.x) / s,
    };
  }

  // Canvas coordinates -> design coordinates.
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

  _pick(e) {
    if (!this.enabled || this._drag) return;
    const p = this._toDesign(e.clientX, e.clientY);
    // a handle of the current selection takes priority over re-picking
    if (this.selected && this._handleAt(p)) return;
    const hit = pickObject(this.objects, p.x, p.y);
    if (hit) {
      e.stopPropagation();
      e.preventDefault();
      this.select(hit);
    }
  }

  _handleAt(p) {
    if (!this.selected) return false;
    const r = this.selected.rect();
    const s = HANDLE / this.game.getRoot().scale.x;
    return HANDLES.some(([hx, hy]) => {
      const cx = r.x + r.w * hx;
      const cy = r.y + r.h * hy;
      return Math.abs(p.x - cx) <= s && Math.abs(p.y - cy) <= s;
    });
  }

  _startDrag(e, hx, hy) {
    if (!this.selected) return;
    e.stopPropagation();
    // e.global is already in canvas space, so undo the root transform directly
    const root = this.game.getRoot();
    const origin = {
      x: (e.global.x - root.x) / root.scale.x,
      y: (e.global.y - root.y) / root.scale.y,
    };
    const r0 = this.selected.rect();

    const move = (ev) => {
      const p = this._toDesign(ev.clientX, ev.clientY);
      const dx = p.x - origin.x;
      const dy = p.y - origin.y;
      const obj = this.selected;
      let r;
      if (hx === 0.5 && hy === 0.5) {
        r = { x: r0.x + dx, y: r0.y + dy, w: r0.w, h: r0.h };
      } else {
        r = { ...r0 };
        if (hx === 0) {
          r.x = r0.x + dx;
          r.w = r0.w - dx;
        } else if (hx === 1) {
          r.w = r0.w + dx;
        }
        if (hy === 0) {
          r.y = r0.y + dy;
          r.h = r0.h - dy;
        } else if (hy === 1) {
          r.h = r0.h + dy;
        }
        r.w = Math.max(obj.minW ?? 20, r.w);
        r.h = Math.max(obj.minH ?? 20, r.h);
      }
      obj.setRect(r);
      this.onChange?.(obj);
    };

    const up = () => {
      this._drag = false;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    this._drag = true;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  _nudge(e) {
    if (!this.enabled || !this.selected) return;
    if (e.target instanceof HTMLInputElement) return;
    const step = e.shiftKey ? 10 : 1;
    const map = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    if (e.key === "Escape") {
      this.select(null);
      return;
    }
    const d = map[e.key];
    if (!d) return;
    e.preventDefault();
    const r = this.selected.rect();
    this.selected.setRect({ x: r.x + d[0], y: r.y + d[1], w: r.w, h: r.h });
    this.onChange?.(this.selected);
  }

  _update() {
    const root = this.game.getRoot();
    // A rebuild swaps the root out; skip the frames where it is already gone.
    if (!root || root.destroyed) return;
    // the fresh root is appended above us, so climb back on top
    const stage = this.layer.parent;
    if (stage && stage.children[stage.children.length - 1] !== this.layer) {
      stage.addChild(this.layer);
    }
    this.layer.position.set(root.x, root.y);
    this.layer.scale.set(root.scale.x, root.scale.y);

    this.frame.clear();
    const show = this.enabled && this.selected;
    for (const h of this.handles) h.visible = !!show;
    if (!show) return;

    const r = this.selected.rect();
    const s = 1 / root.scale.x;
    this.frame
      .rect(r.x, r.y, r.w, r.h)
      .stroke({ color: 0x00e5ff, width: 2 * s, alpha: 0.95 })
      .rect(r.x, r.y, r.w, r.h)
      .fill({ color: 0x00e5ff, alpha: 0.07 });

    const size = HANDLE * s;
    HANDLES.forEach(([hx, hy], i) => {
      const g = this.handles[i];
      const cx = r.x + r.w * hx;
      const cy = r.y + r.h * hy;
      g.clear();
      if (hx === 0.5 && hy === 0.5) {
        g.circle(cx, cy, size * 0.55)
          .fill({ color: 0x00e5ff, alpha: 0.55 })
          .stroke({ color: 0xffffff, width: 1.5 * s });
      } else {
        g.rect(cx - size / 2, cy - size / 2, size, size)
          .fill({ color: 0xffffff })
          .stroke({ color: 0x00b8d4, width: 1.5 * s });
      }
    });
  }

  destroy() {
    this.app.ticker.remove(this._sync);
    this.app.canvas.removeEventListener(
      "pointerdown",
      this._onCanvasDown,
      true,
    );
    window.removeEventListener("keydown", this._onKey);
    this.layer.destroy({ children: true });
  }
}
