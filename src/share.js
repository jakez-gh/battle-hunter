// Daily Hunt share-string codec — pure, DOM-free, deterministic. The UI layer
// (screens.js, Phase 1 "1D") imports this; no share logic is inlined there.
//
// A share string is a compact, copy-pasteable encoding of a finished Relic Dive
// run result plus a checksum. The checksum deters casual hand-editing of a
// pasted result; it is NOT anti-cheat (a real leaderboard must re-simulate the
// seed+action log server-side — see ADR-0005). decode() returns null for any
// malformed or tampered string so callers can reject bad input safely.
//
// Result shape: { date:'YYYY-MM-DD', rootSeed:uint, depthsCleared:int,
//                 score:int, won:bool, version:int }

const PREFIX = 'BHD';            // Battle Hunter Daily
const VERSION = 1;
const FIELD_SEP = '.';

// FNV-1a 32-bit — small, deterministic, dependency-free string hash.
function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// "12450" -> "12,450" (locale-independent so encode/format are deterministic).
function groupThousands(n) {
  const s = String(Math.max(0, Math.round(n)));
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

const payloadOf = (parts) => parts.join(FIELD_SEP);

// Encode a run result to a self-verifying share string.
export function encodeRunResult(r = {}) {
  const version = r.version ?? VERSION;
  const date = String(r.date ?? '');
  const seed = (r.rootSeed >>> 0).toString(36);
  const depths = String(Math.max(0, r.depthsCleared | 0));
  const score = Math.max(0, Math.round(r.score ?? 0)).toString(36);
  const won = r.won ? '1' : '0';
  const payload = payloadOf([PREFIX + version, date, seed, depths, score, won]);
  return payload + FIELD_SEP + hash32(payload).toString(36);
}

// Decode + verify. Returns the result object, or null if malformed/tampered.
export function decodeRunResult(str) {
  if (typeof str !== 'string') return null;
  const parts = str.trim().split(FIELD_SEP);
  if (parts.length !== 7) return null;
  const [tag, date, seed, depths, score, won, checksum] = parts;
  if (!tag.startsWith(PREFIX)) return null;
  if (hash32(payloadOf([tag, date, seed, depths, score, won])).toString(36) !== checksum) {
    return null; // tampered or corrupt
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (won !== '0' && won !== '1') return null;
  const version = Number(tag.slice(PREFIX.length));
  const rootSeed = parseInt(seed, 36);
  const depthsCleared = Number(depths);
  const sc = parseInt(score, 36);
  if (![version, rootSeed, depthsCleared, sc].every(Number.isFinite)) return null;
  return { version, date, rootSeed, depthsCleared, score: sc, won: won === '1' };
}

// Human-readable, copy-pasteable share block (ASCII; the encoded string is the
// last line so a recipient can decode/verify it).
export function formatShare(r = {}) {
  const status = r.won ? 'BANKED' : 'WIPED';
  return [
    `Battle Hunter — Daily Hunt ${r.date ?? ''}`,
    `Depth ${Math.max(0, r.depthsCleared | 0)} · ${groupThousands(r.score ?? 0)} pts · ${status}`,
    encodeRunResult(r),
  ].join('\n');
}
