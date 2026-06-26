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
//   options: { volumes: {master, music, sfx}, wallpaper, wallpapersUnlocked, aiSpeed } }

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

let memory = makeMemoryStore();
let store = null;

// For tests: wipe the in-memory store and force re-detection of the backing store.
export function resetMemoryStore() {
  memory = makeMemoryStore();
  store = null;
}

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
    aiSpeed: 8,
    colorblind: false,
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

// ---------------------------------------------------------------------------
// Relic Dive — run-mode persistence (separate key; does not touch the roster)
// ---------------------------------------------------------------------------

export const RELIC_DIVE_KEY = 'battle-hunter-relic-dive-v1';

// Best-score record shape:
// { best: { score, depths, shareStr } | null,
//   daily: { dateKey, score, depths, shareStr } | null,
//   streak: number }
export function freshRelicDiveBest() {
  return { best: null, daily: null, streak: 0 };
}

export function loadRelicDiveBest() {
  let raw = null;
  try { raw = storageArea().getItem(RELIC_DIVE_KEY); } catch { return freshRelicDiveBest(); }
  if (!raw) return freshRelicDiveBest();
  try {
    const p = JSON.parse(raw);
    if (!p || typeof p !== 'object') return freshRelicDiveBest();
    return { best: p.best ?? null, daily: p.daily ?? null, streak: p.streak ?? 0 };
  } catch { return freshRelicDiveBest(); }
}

export function saveRelicDiveBest(record) {
  try { storageArea().setItem(RELIC_DIVE_KEY, JSON.stringify(record)); } catch { /* quota/blocked */ }
}

// ---------------------------------------------------------------------------
// Run seeding helpers — pure, no I/O
// ---------------------------------------------------------------------------

// Deterministic uint32 from a UTC date string 'YYYY-MM-DD'.
// Uses a simple string hash so the result is stable across implementations.
export function dateToSeed(dateKey) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < dateKey.length; i++) {
    h = Math.imul(h ^ dateKey.charCodeAt(i), 16777619) >>> 0;
  }
  return h || 1;
}

// Per-depth seed: mix rootSeed with depth so each depth is a different dungeon
// but the whole run is reproducible from rootSeed alone.
export function hashRunSeed(rootSeed, depth) {
  let h = (rootSeed >>> 0) ^ (depth * 0x9e3779b9 >>> 0);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0 || 1;
}

// Today's UTC date key 'YYYY-MM-DD'.
export function todayDateKey() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ---------------------------------------------------------------------------
// Share string generation
// ---------------------------------------------------------------------------

// runResult: { daily, dateKey?, startLevel, depthResults: [{won, score}] }
// Returns a compact multi-line string for clipboard sharing.
export function buildShareString(runResult) {
  const { daily, dateKey, startLevel, depthResults } = runResult;
  const depthsReached = depthResults.length;
  const totalScore = depthResults.reduce((s, d) => s + (d.score ?? 0), 0);
  const header = daily
    ? `Battle Hunter — Daily Hunt ${dateKey}`
    : 'Battle Hunter — Relic Dive';
  const depthRow = depthResults
    .map((d) => (d.won ? '🟩' : '🟥'))
    .join('');
  const footer = `Depth ${depthsReached} | Score ${totalScore} | L${startLevel}`;
  return `${header}\n${depthRow}\n${footer}`;
}

// ---------------------------------------------------------------------------
// Leaderboard — top-10 per mode, separate key (does not touch the roster)
// ---------------------------------------------------------------------------
// Entry shape: { name, score, mode, ts, extras }
// extras: mode-specific, e.g. { missionId } for story, { depths } for relic-dive.
// ts is a numeric timestamp used only to keep entries stable across equal scores.

export const LEADERBOARD_KEY = 'battle-hunter-leaderboard-v1';
const LEADERBOARD_MAX = 10;

function loadAllLeaderboards() {
  try {
    const raw = storageArea().getItem(LEADERBOARD_KEY);
    if (!raw) return {};
    const p = JSON.parse(raw);
    return (p && typeof p === 'object' && !Array.isArray(p)) ? p : {};
  } catch { return {}; }
}

function saveAllLeaderboards(all) {
  try { storageArea().setItem(LEADERBOARD_KEY, JSON.stringify(all)); } catch { /* quota/blocked */ }
}

// Returns sorted entries (best first) for the given mode.
export function getLeaderboard(mode) {
  const all = loadAllLeaderboards();
  return Array.isArray(all[mode]) ? all[mode] : [];
}

// Add an entry { name, score, extras? } and persist the updated top-N list.
// Returns 0-based rank of the new entry, or -1 if it didn't make the top-N.
export function addLeaderboardEntry(mode, entry) {
  const all = loadAllLeaderboards();
  const board = Array.isArray(all[mode]) ? [...all[mode]] : [];
  const newEntry = { name: entry.name, score: entry.score, mode, ts: Date.now(), extras: entry.extras ?? {} };
  board.push(newEntry);
  board.sort((a, b) => b.score - a.score || a.ts - b.ts);
  const rank = board.indexOf(newEntry); // object identity — immune to ts collisions
  const trimmed = board.slice(0, LEADERBOARD_MAX);
  all[mode] = trimmed;
  saveAllLeaderboards(all);
  return rank < LEADERBOARD_MAX ? rank : -1;
}

export function clearLeaderboard(mode) {
  const all = loadAllLeaderboards();
  delete all[mode];
  saveAllLeaderboards(all);
}
