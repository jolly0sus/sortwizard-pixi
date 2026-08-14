import { LAYOUT } from "../config.js";
import { layoutStore } from "./overrides.js";
import { SelectionOverlay } from "./overlay.js";

const CSS = `
.sw-ed{position:fixed;top:0;right:0;width:320px;max-height:100vh;overflow:auto;
 background:#141024;color:#e8e2f5;font:12px/1.45 ui-monospace,Menlo,Consolas,monospace;
 z-index:9999;box-shadow:-4px 0 24px #0009;padding:10px 12px 40px}
.sw-ed h2{font-size:13px;margin:0 0 8px;letter-spacing:.04em;color:#ffd94a}
.sw-ed .objs{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px}
.sw-ed .objs button{padding:4px 7px;font-size:11px}
.sw-ed .objs button.on{background:#00596b;border-color:#00b8d4;color:#bff6ff}
.sw-ed .grp{border-top:1px solid #2c2542;margin-top:8px;padding-top:6px}
.sw-ed .grp h3{margin:0 0 4px;font-size:12px;color:#00e5ff}
.sw-ed .row{display:flex;align-items:center;gap:6px;margin:3px 0}
.sw-ed .row label{flex:1;cursor:ew-resize;user-select:none;color:#9d94bd;
 white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sw-ed .row label:hover{color:#ffd94a}
.sw-ed .row label.dirty{color:#7ee081}
.sw-ed input{width:70px;background:#241d3d;border:1px solid #3b3160;color:#fff;
 border-radius:4px;padding:3px 5px;font:inherit;text-align:right}
.sw-ed input:focus{outline:1px solid #ffd94a}
.sw-ed .rev{padding:2px 5px;font-size:10px;min-width:44px;background:#1d1832;
 border-color:#2c2542;color:#5d5580}
.sw-ed .rev.on{color:#ffd94a;border-color:#6b5a20;background:#2a2338;cursor:pointer}
.sw-ed .rev:disabled{cursor:default}
.sw-ed .bar{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}
.sw-ed button{background:#2f2652;color:#e8e2f5;border:1px solid #4a3d7a;
 border-radius:5px;padding:5px 9px;font:inherit;cursor:pointer}
.sw-ed button:hover{background:#3d3169}
.sw-ed button.pri{background:#2f7a3a;border-color:#46a355}
.sw-ed button.dan{background:#7a2f3a;border-color:#a34655}
.sw-ed .hint{color:#6f668c;margin:8px 0 0;font-size:11px}
.sw-ed textarea{width:100%;height:120px;background:#0e0b1a;color:#9fe8a5;
 border:1px solid #3b3160;border-radius:5px;font:11px/1.4 ui-monospace,monospace;
 margin-top:6px;padding:6px}
.sw-ed details{border-top:1px solid #2c2542;margin-top:8px;padding-top:4px}
.sw-ed summary{cursor:pointer;user-select:none;color:#b9aee0}
.sw-ed-tip{position:fixed;left:8px;bottom:8px;z-index:9999;background:#141024cc;
 color:#b9aee0;font:11px ui-monospace,monospace;padding:4px 8px;border-radius:5px}
`;

function numericPaths(obj, prefix) {
  const out = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = `${prefix}.${key}`;
    if (typeof value === "number") out.push(path);
    else if (Array.isArray(value) && value.every((v) => typeof v === "number"))
      value.forEach((_, i) => out.push(`${path}.${i}`));
  }
  return out;
}

export function mountEditor(game) {
  // handle for poking at live state from the console / test scripts. Always
  // set, including in production — it is invisible and the headless tests
  // drive the game through it.
  window.__sw = game;

  // The editor is a development tool, so it stays out of sight on a deployed
  // build: no hint in the corner, no stray keypress opening a debug panel over
  // someone's game. Locally it behaves as before, and ?edit brings it back
  // anywhere.
  const host = location.hostname;
  const editorOffered =
    new URLSearchParams(location.search).has("edit") ||
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "";

  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const tip = document.createElement("div");
  tip.className = "sw-ed-tip";
  const idleTip = "E — редактор сцены";
  tip.textContent = idleTip;
  tip.hidden = !editorOffered;
  document.body.appendChild(tip);

  let panel = null;
  let refresh = () => {};

  // A drag fires many times a frame; coalesce the rebuild into the next one.
  let queued = false;
  const scheduleRebuild = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      game.rebuild();
    });
  };

  const overlay = new SelectionOverlay(game.app, game, {
    onChange: () => {
      refresh();
      scheduleRebuild();
    },
    onSelect: () => refresh(),
  });

  function field(path) {
    const row = document.createElement("div");
    row.className = "row";

    const lab = document.createElement("label");
    lab.textContent = path.split(".").slice(1).join(".");
    lab.title = `${path} — тяните влево/вправо`;

    const input = document.createElement("input");
    input.type = "number";
    input.step = "1";

    // Shows what this value started as, and puts it back when clicked — so
    // the original is always visible, not just recoverable via a global reset.
    const def = layoutStore.getDefault(path);
    const rev = document.createElement("button");
    rev.className = "rev";
    rev.textContent = `↺ ${def}`;
    rev.title = `Вернуть исходное значение: ${def}`;

    const markDirty = () => {
      const changed = layoutStore.get(path) !== def;
      lab.classList.toggle("dirty", changed);
      rev.classList.toggle("on", changed);
      rev.disabled = !changed;
    };

    const push = (v) => {
      if (!Number.isFinite(v)) return;
      layoutStore.set(path, v);
      input.value = String(v);
      markDirty();
      scheduleRebuild();
    };

    input.oninput = () => push(parseFloat(input.value));
    lab.onpointerdown = (e) => {
      e.preventDefault();
      lab.setPointerCapture(e.pointerId);
      const startX = e.clientX;
      const startVal = layoutStore.get(path);
      const move = (ev) =>
        push(
          Math.round(
            (startVal + (ev.clientX - startX) * (ev.shiftKey ? 0.25 : 1)) * 100,
          ) / 100,
        );
      const up = () => {
        lab.removeEventListener("pointermove", move);
        lab.removeEventListener("pointerup", up);
      };
      lab.addEventListener("pointermove", move);
      lab.addEventListener("pointerup", up);
    };

    rev.onclick = () => push(def);

    row.append(lab, input, rev);
    return {
      row,
      sync: () => {
        input.value = String(layoutStore.get(path));
        markDirty();
      },
    };
  }

  function build() {
    panel = document.createElement("div");
    panel.className = "sw-ed";

    const title = document.createElement("h2");
    title.textContent = "Редактор сцены";
    panel.appendChild(title);

    const bar = document.createElement("div");
    bar.className = "bar";
    panel.appendChild(bar);

    const out = document.createElement("textarea");
    out.readOnly = true;
    out.placeholder = "Здесь появится JSON с изменениями";

    const mkBtn = (text, cls, fn, host = bar) => {
      const b = document.createElement("button");
      b.textContent = text;
      if (cls) b.className = cls;
      b.onclick = fn;
      host.appendChild(b);
      return b;
    };

    mkBtn("Сохранить", "pri", () => {
      layoutStore.save();
      out.value = layoutStore.exportText();
      flash("Сохранено в браузере");
    });
    mkBtn("Копировать", "", async () => {
      const text = layoutStore.exportText();
      out.value = text;
      try {
        await navigator.clipboard.writeText(text);
        flash("Скопировано");
      } catch {
        out.select();
      }
    });
    mkBtn("Скачать", "", () => {
      const blob = new Blob([layoutStore.exportText()], {
        type: "application/json",
      });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "layout.json";
      a.click();
      URL.revokeObjectURL(a.href);
    });
    mkBtn("Сброс", "dan", () => {
      layoutStore.reset();
      refresh();
      scheduleRebuild();
      out.value = "";
      flash("Сброшено к исходным");
    });

    // object picker, mirrored with canvas selection
    const objs = document.createElement("div");
    objs.className = "objs";
    panel.appendChild(objs);
    const objButtons = overlay.objects.map((o) => {
      const b = document.createElement("button");
      b.textContent = o.label;
      b.onclick = () => overlay.select(overlay.selected === o ? null : o);
      objs.appendChild(b);
      return { obj: o, el: b };
    });

    const groupBox = document.createElement("div");
    groupBox.className = "grp";
    panel.appendChild(groupBox);

    // everything else, still reachable
    const all = document.createElement("details");
    const sum = document.createElement("summary");
    sum.textContent = "Все параметры";
    all.appendChild(sum);
    const allFields = [];
    for (const key of Object.keys(LAYOUT)) {
      if (typeof LAYOUT[key] !== "object") continue;
      for (const path of numericPaths(LAYOUT[key], key)) {
        const f = field(path);
        all.appendChild(f.row);
        allFields.push(f);
      }
    }
    panel.appendChild(all);

    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent =
      "Кликните объект на сцене — появится рамка с маркерами: тяните центр, " +
      "чтобы двигать, углы и края — чтобы менять размер. Стрелки двигают на 1px " +
      "(Shift — 10px), Esc снимает выделение. Подписи полей тоже можно тянуть.";
    panel.append(hint, out);
    document.body.appendChild(panel);

    let groupFields = [];
    refresh = () => {
      for (const { obj, el } of objButtons)
        el.classList.toggle("on", overlay.selected === obj);

      const sel = overlay.selected;
      if (!sel) {
        groupBox.innerHTML = "";
        groupBox.textContent = "Ничего не выбрано — кликните объект на сцене.";
        groupFields = [];
      } else if (groupBox.dataset.id !== sel.id) {
        groupBox.dataset.id = sel.id;
        groupBox.innerHTML = "";
        const h = document.createElement("h3");
        h.textContent = sel.label;
        groupBox.appendChild(h);
        groupFields = sel.fields.map((p) => {
          const f = field(p);
          groupBox.appendChild(f.row);
          return f;
        });
      }
      groupFields.forEach((f) => f.sync());
      allFields.forEach((f) => f.sync());
    };
    groupBox.dataset.id = "";
    refresh();
  }

  function flash(text) {
    tip.textContent = text;
    setTimeout(() => (tip.textContent = idleTip), 1600);
  }

  function toggle() {
    if (panel) {
      panel.remove();
      panel = null;
      refresh = () => {};
      overlay.setEnabled(false);
      tip.style.display = "";
    } else {
      build();
      overlay.setEnabled(true);
      tip.style.display = "none";
    }
  }

  if (editorOffered) {
    window.addEventListener("keydown", (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if ("eEуУ".includes(e.key)) toggle();
    });
  }

  if (new URLSearchParams(location.search).has("edit")) toggle();

  return { toggle };
}
