import { LAYOUT, DESIGN_H, DESIGN_W } from "../config.js";

// Everything on the board is driven by numbers in LAYOUT rather than by
// free-standing sprites, so a "selectable object" is a rectangle plus the rule
// for writing that rectangle back into those numbers.
//
// Each entry exposes:
//   rect()        - current bounds in design space
//   setRect(r)    - push new bounds back into LAYOUT
//   fields        - the LAYOUT paths it owns, for the side panel
//   minW / minH   - guards so a drag cannot collapse it

const clamp = (v, lo) => Math.max(lo, v);

// Insets are written back from mouse coordinates, so they arrive with a tail
// of float noise. Sub-pixel precision means nothing here and makes the
// exported JSON unreadable.
const px = (v) => Math.round(v * 100) / 100;

// A move rewrites the whole rect, width included — and rounding a width that
// nobody touched would land 0.005 away from the default and show up in the
// export as a change. Values that survive the round-trip keep their original
// number instead, so a drag only dirties what the drag actually moved.
const keep = (next, current) => (px(next) === px(current) ? current : px(next));

// Spread n items evenly between two outer centres.
function spread(count, left, right) {
  if (count === 1) return [(left + right) / 2];
  const step = (right - left) / (count - 1);
  return Array.from({ length: count }, (_, i) => Math.round(left + i * step));
}

// A centred sprite described by {x, y, w, h}.
function centred(id, label, node, extraFields = []) {
  return {
    id,
    label,
    minW: 20,
    minH: 20,
    fields: extraFields,
    rect: () => ({
      x: node().x - node().w / 2,
      y: node().y - node().h / 2,
      w: node().w,
      h: node().h,
    }),
    setRect: (r) => {
      const n = node();
      n.x = r.x + r.w / 2;
      n.y = r.y + r.h / 2;
      n.w = r.w;
      n.h = r.h;
    },
  };
}

// The logo and the CTA are described by insets from the edges of the design
// rect rather than by a centre, so they keep their margins instead of their
// coordinates. `edge` picks which side the horizontal inset is measured from;
// both sit above the bottom of the design rect by `bottom`.
function cornerWidget(id, label, node, edge) {
  return {
    id,
    label,
    minW: 30,
    minH: 20,
    fields: [`ui.${id}.${edge}`, `ui.${id}.bottom`, `ui.${id}.w`, `ui.${id}.h`],
    rect: () => {
      const n = node();
      return {
        x: edge === "left" ? n.left : DESIGN_W - n.right - n.w,
        y: DESIGN_H - n.bottom - n.h,
        w: n.w,
        h: n.h,
      };
    },
    setRect: (r) => {
      const n = node();
      if (edge === "left") n.left = keep(r.x, n.left);
      else n.right = keep(DESIGN_W - (r.x + r.w), n.right);
      n.bottom = keep(DESIGN_H - (r.y + r.h), n.bottom);
      n.w = keep(r.w, n.w);
      n.h = keep(r.h, n.h);
    },
  };
}

export function editableObjects() {
  const L = LAYOUT;

  return [
    cornerWidget("logo", "Логотип SortWizard", () => L.ui.logo, "left"),
    cornerWidget("cta", "Кнопка Play now", () => L.ui.cta, "right"),
    centred("wood", "Доска (дерево)", () => L.wood),
    centred("frame", "Рамка", () => L.frame),
    {
      id: "pipes",
      label: "Трубы",
      minW: 120,
      minH: 60,
      fields: [
        "pipes.xs.0",
        "pipes.xs.1",
        "pipes.xs.2",
        "pipes.spriteY",
        "pipes.w",
        "pipes.h",
        "pipes.labelY",
      ],
      rect: () => {
        const half = L.pipes.w / 2;
        const xs = L.pipes.xs;
        return {
          x: xs[0] - half,
          y: L.pipes.spriteY - L.pipes.h / 2,
          w: xs[xs.length - 1] + half - (xs[0] - half),
          h: L.pipes.h,
        };
      },
      setRect: (r) => {
        const n = L.pipes.xs.length;
        const oldSpan = L.pipes.xs[n - 1] - L.pipes.xs[0] + L.pipes.w;
        const w = Math.round(L.pipes.w * (r.w / oldSpan));
        L.pipes.w = clamp(w, 30);
        const half = L.pipes.w / 2;
        const next = spread(n, r.x + half, r.x + r.w - half);
        for (let i = 0; i < n; i++) L.pipes.xs[i] = next[i];
        L.pipes.spriteY = r.y + r.h / 2;
        L.pipes.h = r.h;
      },
    },
    {
      id: "multiplier",
      label: "Бар x3",
      minW: 200,
      minH: 30,
      fields: [
        "multiplier.xs.0",
        "multiplier.xs.1",
        "multiplier.xs.2",
        "multiplier.y",
        "multiplier.sensorY",
      ],
      rect: () => {
        const w = L.multiplier.forcefield.w;
        return {
          x: L.multiplier.xs[0] - w / 2,
          y: L.multiplier.y - L.multiplier.forcefield.h / 2,
          w: L.multiplier.xs[2] + w / 2 - (L.multiplier.xs[0] - w / 2),
          h: L.multiplier.forcefield.h,
        };
      },
      setRect: (r) => {
        const w = L.multiplier.forcefield.w;
        const next = spread(3, r.x + w / 2, r.x + r.w - w / 2);
        for (let i = 0; i < 3; i++) L.multiplier.xs[i] = next[i];
        L.multiplier.y = r.y + r.h / 2;
      },
    },
    centred("belt", "Лента", () => L.conveyor.belt, [
      "conveyor.speed",
      "conveyor.snapSpeed",
      "conveyor.cellCount",
    ]),
    {
      id: "fill",
      label: "Лотки",
      minW: 200,
      minH: 100,
      fields: [
        "fill.xs.0",
        "fill.xs.3",
        "fill.rowYs.0",
        "fill.rowStep",
        "fill.shiftDuration",
      ],
      rect: () => {
        const w = L.fill.base.w;
        return {
          x: L.fill.xs[0] - w / 2,
          y: L.fill.rowYs[0] - L.fill.base.h / 2,
          w: L.fill.xs[3] + w / 2 - (L.fill.xs[0] - w / 2),
          h:
            L.fill.rowYs[3] +
            L.fill.base.h / 2 -
            (L.fill.rowYs[0] - L.fill.base.h / 2),
        };
      },
      setRect: (r) => {
        const w = L.fill.base.w;
        const xs = spread(4, r.x + w / 2, r.x + r.w - w / 2);
        for (let i = 0; i < 4; i++) L.fill.xs[i] = xs[i];
        const ys = spread(
          4,
          r.y + L.fill.base.h / 2,
          r.y + r.h - L.fill.base.h / 2,
        );
        for (let i = 0; i < 4; i++) L.fill.rowYs[i] = ys[i];
      },
    },
  ];
}

export function pickObject(objects, x, y) {
  let best = null;
  let bestArea = Infinity;
  for (const obj of objects) {
    const r = obj.rect();
    if (x < r.x || y < r.y || x > r.x + r.w || y > r.y + r.h) continue;
    const area = r.w * r.h;
    if (area < bestArea) {
      bestArea = area;
      best = obj;
    }
  }
  return best;
}
