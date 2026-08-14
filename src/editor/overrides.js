import { LAYOUT } from "../config.js";

const KEY = "sortwizard.layout";

// A pristine copy taken before anything is applied, so "reset" always has
// something true to go back to.
const DEFAULTS = structuredClone(LAYOUT);

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// Deep-merge `patch` into `target`, in place. Arrays are replaced wholesale
// but keep their identity, because other modules hold references to them.
function mergeInto(target, patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (Array.isArray(value) && Array.isArray(target[key])) {
      target[key].length = value.length;
      for (let i = 0; i < value.length; i++) target[key][i] = value[i];
    } else if (isPlainObject(value) && isPlainObject(target[key])) {
      mergeInto(target[key], value);
    } else {
      target[key] = value;
    }
  }
}

// Only the values that actually differ from the defaults, so a saved file
// stays small and readable and survives later changes to the defaults.
function diff(current, base) {
  const out = {};
  for (const [key, value] of Object.entries(current)) {
    const baseValue = base?.[key];
    if (Array.isArray(value)) {
      if (JSON.stringify(value) !== JSON.stringify(baseValue)) out[key] = value;
    } else if (isPlainObject(value)) {
      const nested = diff(value, baseValue);
      if (Object.keys(nested).length) out[key] = nested;
    } else if (value !== baseValue) {
      out[key] = value;
    }
  }
  return out;
}

export const layoutStore = {
  defaults: DEFAULTS,

  // Pull saved tweaks in. Call before the first scene is built.
  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return false;
      mergeInto(LAYOUT, JSON.parse(raw));
      return true;
    } catch {
      return false;
    }
  },

  save() {
    localStorage.setItem(KEY, JSON.stringify(this.changes()));
  },

  changes() {
    return diff(LAYOUT, DEFAULTS);
  },

  hasChanges() {
    return Object.keys(this.changes()).length > 0;
  },

  reset() {
    mergeInto(LAYOUT, DEFAULTS);
    localStorage.removeItem(KEY);
  },

  set(path, value) {
    const keys = path.split(".");
    let node = LAYOUT;
    for (let i = 0; i < keys.length - 1; i++) node = node[keys[i]];
    node[keys[keys.length - 1]] = value;
  },

  get(path) {
    return path.split(".").reduce((node, key) => node?.[key], LAYOUT);
  },

  getDefault(path) {
    return path.split(".").reduce((node, key) => node?.[key], DEFAULTS);
  },

  // Ready to paste over the LAYOUT block in config.js.
  exportText() {
    return JSON.stringify(this.changes(), null, 2);
  },
};
