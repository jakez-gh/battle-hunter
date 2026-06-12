// localStorage persistence of the hunter roster and options (DESIGN.md §2.13
// Office, §3.4). Runs under Node too: when localStorage is missing or blocked
// the module falls back to an in-memory store, so the same code backs the
// browser game and the test suite.
//
// Roster shape (versioned):
// { version: 1,
//   hunters: [{ id, name, spriteId, palette, level, internal: {mv,at,df,hp},
//               maxHp, credits, items: [{itemId, identified}],
//               storyProgress, record: {missions, wins} }],
//   options: { volumes: {master, music, sfx}, wallpaper, wallpapersUnlocked } }

export const SAVE_KEY = 'battle-hunter-save-v1';
const VERSION = 1;

function makeMemoryStore() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}

const memory = makeMemoryStore();
let store = null;

// Active backing store: real localStorage when present and writable (probe
// catches private-mode/quota errors), else the in-memory fallback. Exported
// so tests can seed corrupt payloads through the same store the module reads.
export function storageArea() {
  if (store) return store;
  try {
    const ls = globalThis.localStorage;
    if (ls) {
      const probe = '__battle-hunter-probe__';
      ls.setItem(probe, '1');
      ls.removeItem(probe);
      store = ls;
      return store;
    }
  } catch { /* blocked -> memory fallback */ }
  store = memory;
  return store;
}

export function defaultOptions() {
  return {
    volumes: { master: 0.5, music: 0.55, sfx: 1.0 },
    wallpaper: 0,
    wallpapersUnlocked: [],
  };
}

export function freshRoster() {
  return { version: VERSION, hunters: [], options: defaultOptions() };
}

// New level-1 record from the creation screen (§2.1: internal points already
// allocated there; maxHp = 7 + 3*iHP at level 1).
let idCounter = 0;
export function makeHunterRecord({ name, spriteId, palette, internal }) {
  return {
    id: `h${Date.now().toString(36)}-${(idCounter++).toString(36)}`,
    name, spriteId, palette,
    level: 1,
    internal: { ...internal },
    maxHp: 7 + 3 * internal.hp,
    credits: 0,
    items: [],
    storyProgress: 0,
    record: { missions: 0, wins: 0 },
  };
}

function isValid(r) {
  return !!r && typeof r === 'object' && r.version === VERSION &&
    Array.isArray(r.hunters) && !!r.options && typeof r.options === 'object';
}

// Load the saved roster; any missing/corrupt/foreign-version payload yields a
// fresh roster instead of throwing. Option fields are backfilled from
// defaults so older saves stay loadable as options grow.
export function loadRoster() {
  let raw = null;
  try {
    raw = storageArea().getItem(SAVE_KEY);
  } catch { return freshRoster(); }
  if (!raw) return freshRoster();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch { return freshRoster(); }
  if (!isValid(parsed)) return freshRoster();
  const d = defaultOptions();
  return {
    ...freshRoster(),
    ...parsed,
    options: {
      ...d,
      ...parsed.options,
      volumes: { ...d.volumes, ...(parsed.options.volumes || {}) },
    },
  };
}

export function saveRoster(roster) {
  const out = { ...roster, version: VERSION };
  try {
    storageArea().setItem(SAVE_KEY, JSON.stringify(out));
  } catch { /* storage full/blocked: keep playing unsaved */ }
  return out;
}

// JSON-string transfer helpers (manual backup / cross-browser import).
export function exportSave() {
  return JSON.stringify(loadRoster());
}

export function importSave(json) {
  const parsed = JSON.parse(json);
  if (!isValid(parsed)) throw new Error('not a battle-hunter save');
  return saveRoster(parsed);
}
