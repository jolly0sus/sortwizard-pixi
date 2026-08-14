import { LAYOUT } from "../config.js";

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

// Spread n items evenly between two outer centres.
function spread(count, left, right) {
  if (count === 1) return [(left + right) / 2];
  const step = (right - left) / (count - 1);
  return Array.from({ length: count }, (_, i) => Math.round(left + i * step));
}

export function editableObjects() {
  const L = LAYOUT;

  return [
    {
      id: "board",
      label: "Доска / рамка",
      minW: 200,
      minH: 300,
      fields: ["board.x", "board.y", "board.w", "board.bottom"],
      rect: () => ({
        x: L.board.x,
        y: L.board.y,
        w: L.board.w,
        h: L.board.bottom - L.board.y,
      }),
      setRect: (r) => {
        L.board.x = Math.round(r.x);
        L.board.y = Math.round(r.y);
        L.board.w = Math.round(r.w);
        L.board.bottom = Math.round(r.y + r.h);
      },
    },
    {
      id: "pipes",
      label: "Трубы",
      minW: 120,
      minH: 60,
      fields: [
        "pipes.xs.0",
        "pipes.xs.1",
        "pipes.xs.2",
        "pipes.topY",
        "pipes.bottomY",
        "pipes.width",
        "pipes.labelY",
      ],
      rect: () => {
        const half = L.pipes.width / 2;
        const xs = L.pipes.xs;
        return {
          x: xs[0] - half,
          y: L.pipes.topY,
          w: xs[xs.length - 1] + half - (xs[0] - half),
          h: L.pipes.bottomY - L.pipes.topY,
        };
      },
      setRect: (r) => {
        const n = L.pipes.xs.length;
        // width of one pipe scales with the group, so the gaps stay even
        const oldSpan = L.pipes.xs[n - 1] - L.pipes.xs[0] + L.pipes.width;
        const w = Math.round(L.pipes.width * (r.w / oldSpan));
        L.pipes.width = clamp(w, 30);
        const half = L.pipes.width / 2;
        const next = spread(n, r.x + half, r.x + r.w - half);
        for (let i = 0; i < n; i++) L.pipes.xs[i] = next[i];
        const dy = Math.round(r.y) - L.pipes.topY;
        L.pipes.topY = Math.round(r.y);
        L.pipes.bottomY = Math.round(r.y + r.h);
        L.pipes.labelY += dy;
      },
    },
    {
      id: "sourceBox",
      label: "Ящики сверху",
      minW: 60,
      minH: 40,
      fields: [
        "sourceBox.centerY",
        "sourceBox.w",
        "sourceBox.h",
        "sourceBox.marbleW",
        "sourceBox.marbleH",
      ],
      rect: () => {
        const xs = L.pipes.xs;
        return {
          x: xs[0] - L.sourceBox.w / 2,
          y: L.sourceBox.centerY - L.sourceBox.h / 2,
          w: xs[xs.length - 1] - xs[0] + L.sourceBox.w,
          h: L.sourceBox.h,
        };
      },
      setRect: (r) => {
        const xs = L.pipes.xs;
        const oldSpan = xs[xs.length - 1] - xs[0] + L.sourceBox.w;
        const scale = r.w / oldSpan;
        L.sourceBox.w = clamp(Math.round(L.sourceBox.w * scale), 40);
        L.sourceBox.h = clamp(Math.round(r.h), 30);
        L.sourceBox.marbleW = Math.round(L.sourceBox.marbleW * scale);
        L.sourceBox.centerY = Math.round(r.y + r.h / 2);
      },
    },
    {
      id: "multiplier",
      label: "Полоса x3",
      minW: 90,
      minH: 16,
      fields: [
        "multiplier.centerY",
        "multiplier.pillW",
        "multiplier.pillH",
        "multiplier.postW",
        "multiplier.postH",
      ],
      rect: () => {
        const xs = L.pipes.xs;
        const half = L.multiplier.pillW / 2;
        return {
          x: xs[0] - half,
          y: L.multiplier.centerY - L.multiplier.pillH / 2,
          w: xs[xs.length - 1] + half - (xs[0] - half),
          h: L.multiplier.pillH,
        };
      },
      setRect: (r) => {
        const xs = L.pipes.xs;
        const oldSpan = xs[xs.length - 1] - xs[0] + L.multiplier.pillW;
        L.multiplier.pillW = clamp(
          Math.round(L.multiplier.pillW * (r.w / oldSpan)),
          50,
        );
        L.multiplier.pillH = clamp(Math.round(r.h), 14);
        L.multiplier.centerY = Math.round(r.y + r.h / 2);
      },
    },
    {
      id: "grid",
      label: "Сетка на доске",
      minW: 120,
      minH: 80,
      fields: [
        "grid.topY",
        "grid.cols",
        "grid.rows",
        "grid.cellSize",
        "grid.gap",
      ],
      rect: () => {
        const g = L.grid;
        const step = g.cellSize + g.gap;
        const w = g.cols * g.cellSize + (g.cols - 1) * g.gap;
        return {
          x: L.board.x + (L.board.w - w) / 2,
          y: g.topY,
          w,
          h: g.rows * g.cellSize + (g.rows - 1) * g.gap + (step - g.cellSize),
        };
      },
      setRect: (r) => {
        const g = L.grid;
        // keep the gap proportional so the cells stay square
        const cell = (r.w - (g.cols - 1) * g.gap) / g.cols;
        g.cellSize = clamp(Math.round(cell), 20);
        g.topY = Math.round(r.y);
      },
    },
    {
      id: "conveyor",
      label: "Лента",
      minW: 200,
      minH: 40,
      fields: [
        "conveyor.centerY",
        "conveyor.xLeft",
        "conveyor.xRight",
        "conveyor.beltH",
        "conveyor.pathInset",
        "conveyor.pathRadius",
        "conveyor.pathRadiusY",
        // the purple belt's own shape and shadow
        "conveyor.shadowScale",
        "conveyor.shadowDrop",
        "conveyor.shadowAlpha",
        // the moving dots themselves
        "conveyor.cellW",
        "conveyor.cellH",
        "conveyor.cellCount",
        "conveyor.loopSeconds",
      ],
      rect: () => ({
        x: L.conveyor.xLeft,
        y: L.conveyor.centerY - L.conveyor.beltH / 2,
        w: L.conveyor.xRight - L.conveyor.xLeft,
        h: L.conveyor.beltH,
      }),
      setRect: (r) => {
        L.conveyor.xLeft = Math.round(r.x);
        L.conveyor.xRight = Math.round(r.x + r.w);
        L.conveyor.beltH = clamp(Math.round(r.h), 40);
        L.conveyor.centerY = Math.round(r.y + r.h / 2);
      },
    },
    {
      id: "fillColumns",
      label: "Лотки снизу",
      minW: 200,
      minH: 80,
      fields: [
        "fillColumns.xs.0",
        "fillColumns.xs.1",
        "fillColumns.xs.2",
        "fillColumns.xs.3",
        "fillColumns.topY",
        "fillColumns.tileW",
        "fillColumns.closedH",
        "fillColumns.openH",
        "fillColumns.rowStep",
        "fillColumns.slotOffsets.0",
        "fillColumns.slotOffsets.2",
      ],
      rect: () => {
        const f = L.fillColumns;
        return {
          x: f.xs[0] - f.tileW / 2,
          y: f.topY - f.openH / 2,
          w: f.xs[f.xs.length - 1] + f.tileW / 2 - (f.xs[0] - f.tileW / 2),
          h: (f.rowsVisible - 1) * f.rowStep + f.openH,
        };
      },
      setRect: (r) => {
        const f = L.fillColumns;
        const n = f.xs.length;
        const oldSpan = f.xs[n - 1] - f.xs[0] + f.tileW;
        const scale = r.w / oldSpan;
        f.tileW = clamp(Math.round(f.tileW * scale), 60);
        // the moulded wells travel with the tray width
        f.slotOffsets[0] = Math.round(f.slotOffsets[0] * scale);
        f.slotOffsets[2] = -f.slotOffsets[0];
        const half = f.tileW / 2;
        const next = spread(n, r.x + half, r.x + r.w - half);
        for (let i = 0; i < n; i++) f.xs[i] = next[i];
        f.rowStep = clamp(
          Math.round((r.h - f.openH) / Math.max(1, f.rowsVisible - 1)),
          20,
        );
        f.topY = Math.round(r.y + f.openH / 2);
      },
    },
    {
      id: "logo",
      label: "Логотип",
      minW: 80,
      minH: 40,
      fields: ["logo.x", "logo.y", "logo.w"],
      rect: () => ({
        x: L.logo.x,
        y: L.logo.y,
        w: L.logo.w,
        h: L.logo.w * 0.56,
      }),
      setRect: (r) => {
        L.logo.x = Math.round(r.x);
        L.logo.y = Math.round(r.y);
        L.logo.w = clamp(Math.round(r.w), 60);
      },
    },
    {
      id: "cta",
      label: "Кнопка CTA",
      minW: 100,
      minH: 30,
      fields: ["cta.x", "cta.y", "cta.w", "cta.h"],
      rect: () => ({ x: L.cta.x, y: L.cta.y, w: L.cta.w, h: L.cta.h }),
      setRect: (r) => {
        L.cta.x = Math.round(r.x);
        L.cta.y = Math.round(r.y);
        L.cta.w = clamp(Math.round(r.w), 80);
        L.cta.h = clamp(Math.round(r.h), 24);
      },
    },
  ];
}

// Smallest object whose bounds contain the point — so a tray inside the board
// wins over the board itself.
export function pickObject(objects, x, y) {
  let best = null;
  let bestArea = Infinity;
  for (const obj of objects) {
    const r = obj.rect();
    if (x < r.x || x > r.x + r.w || y < r.y || y > r.y + r.h) continue;
    const area = r.w * r.h;
    if (area < bestArea) {
      bestArea = area;
      best = obj;
    }
  }
  return best;
}
