// Canvas 2D renderer: draws a GameState and animates the engine event queue
// (DESIGN 1.3, 1.4, 3.3). Pure presentation â€” no engine imports; state and
// events arrive as plain data and nothing here mutates them. The engine
// advances instantly; this module's queue plays catch-up visually, one timed
// step per event, all skippable. Module top level is pure (projection math,
// timing table) so importing under Node is safe; only createRenderer() needs
// a DOM (it bakes the sprite atlas).
import { buildAtlas, PALETTE_NAMES } from './sprites.js';

export const TILE = 16;       // sprite-space pixels per board tile
export const HUD_H = 76;      // screen pixels reserved for the bottom strip

// ms per event type â€” every DESIGN 3.3 event animates as one timed step.
export const EVENT_DURATIONS = {
  turnStarted: 150,
  dieRolled: 270,
  cardPlayed: 180,
  cardDrawn: 110,
  deckCount: 90,
  stepped: 75,
  trapTriggered: 300,
  trapDodged: 180,
  trapSet: 150,
  boxOpened: 210,
  targetFound: 360,
  flagClaimed: 330,
  exitWarpedAway: 270,
  drewBlank: 150,
  battleStarted: 300,
  responseChosen: 180,
  escapeRolled: 300,
  strikeRolled: 360,
  statusInflicted: 210,
  critNegated: 180,
  hunterDefeated: 400,
  itemTaken: 210,
  surrendered: 240,
  monsterSpawned: 270,
  monsterMoved: 120,
  monsterKilled: 300,
  wyrmSpawned: 360,
  wyrmRespawned: 300,
  healed: 240,
  actAgain: 180,
  missionWon: 600,
  missionLost: 600,
  scoreTallied: 400,
};

// Events that carry stakes/drama. During fast-AI playback (timeScale > 1) these
// are only mildly compressed so battles, steals, status hits and boss spawns
// stay readable, while trivial locomotion (steps, dice, draws, monster shuffles)
// flies by â€” killing the "watch the AI crawl" dead-air without hiding the drama.
const DECISIVE_EVENTS = new Set([
  'battleStarted', 'responseChosen', 'escapeRolled', 'strikeRolled',
  'statusInflicted', 'critNegated', 'hunterDefeated', 'itemTaken', 'surrendered',
  'targetFound', 'flagClaimed', 'monsterSpawned', 'monsterKilled',
  'wyrmSpawned', 'wyrmRespawned', 'missionWon', 'missionLost',
]);
const MAX_DECISIVE_SPEEDUP = 3; // decisive events compress at most this much
const MIN_EVENT_MS = 16;        // never shorter than ~one frame

// Effective on-screen time for an event at a given playback scale. timeScale<=1
// is full ceremony; >1 compresses trivial events fully (Ã·timeScale) and decisive
// ones gently (capped) so AI dead-air vanishes without hiding the drama. Pure.
export function eventDuration(type, timeScale = 1) {
  const base = EVENT_DURATIONS[type] ?? 200;
  if (!(timeScale > 1)) return base;
  const sc = DECISIVE_EVENTS.has(type) ? Math.min(timeScale, MAX_DECISIVE_SPEEDUP) : timeScale;
  return Math.max(MIN_EVENT_MS, base / sc);
}

// --- Pure projection (camera = { x, y } world px top-left + integer scale) --
export function worldToScreen(tx, ty, cam) {
  return {
    x: Math.round((tx * TILE - cam.x) * cam.scale),
    y: Math.round((ty * TILE - cam.y) * cam.scale),
  };
}

export function screenToWorld(px, py, cam) {
  return {
    x: Math.floor((px / cam.scale + cam.x) / TILE),
    y: Math.floor((py / cam.scale + cam.y) / TILE),
  };
}

// ---------------------------------------------------------------------------
const FONT = '"Consolas", "Cascadia Mono", "Monaco", monospace';
const SLOT_COLORS = ['#3a6ee0', '#cc4a3a', '#e0c63a', '#3aa84a']; // P1..P4
const CARD_MINI = { R: '#cc4a3a', Y: '#d8b83a', B: '#3a6ee0', G: '#3aa84a' };
const RIVAL_VOICE = {
  KELD: {
    targetFound: ["Mine. Try taking it.", "Got it. Come at me.", "Finally â€” a real game."],
    hunterDefeated: ["Next time.", "Lucky shot.", "I'll be back."],
    wyrmSpawned: ["A WYRM. Good.", "Getting interesting.", "Better this than nothing."],
    flagClaimed: ["Count that.", "My board."],
    exitWarpedAway: ["Catch up.", "Easy work.", "Too slow."],
  },
  MIRA: {
    targetFound: ["Already. Sorry.", "See you at exit.", "Too slow."],
    hunterDefeated: ["Well played.", "Noted.", "I'll adjust."],
    wyrmSpawned: ["Move.", "Rerouting.", "Adapt."],
    flagClaimed: ["Swift.", "One more."],
    exitWarpedAway: ["Done.", "First. As usual.", "Better luck."],
  },
  RAVEN: {
    targetFound: ["Asset secured.", "Target acquired.", "Package confirmed."],
    hunterDefeated: ["Unit lost.", "Expected resistance.", "Casualty noted."],
    wyrmSpawned: ["Hazard logged.", "WYRM detected.", "Uncontrolled variable."],
    flagClaimed: ["Objective taken.", "Secured."],
    exitWarpedAway: ["Extraction complete.", "Mission done.", "Assets secured."],
  },
};
const TRAP_COLORS = { damage: '#cc4a3a', stun: '#d8b83a', leg: '#3a6ee0', empty: '#8d8d9e' };
const STATUS_GLOW = { stun: '#d8b83a', leg: '#3a6ee0', panic: '#cc4a3a', empty: '#8d8d9e' };
const MONSTER_AURA = { VAC: 'rgba(80,170,220,0.55)', OOZ: 'rgba(60,200,80,0.50)', FNG: 'rgba(220,130,40,0.52)', WYRM: 'rgba(140,60,220,0.55)' };
const MONSTER_LABEL_COLOR = { VAC: '#50b0e8', OOZ: '#50c84a', FNG: '#e09040', WYRM: '#9870d8' };
const MONSTER_KINDS = new Set(['VAC', 'OOZ', 'FNG', 'WYRM']);
const BATTLE_EVENTS = new Set([
  'battleStarted', 'responseChosen', 'escapeRolled', 'strikeRolled',
  'statusInflicted', 'critNegated', 'hunterDefeated', 'itemTaken',
  'surrendered', 'healed',
]);

const clamp = (v, lo, hi) => (hi < lo ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));
const key = (x, y) => `${x},${y}`;

// Pull every plausible die value (1-6 ints) out of an event's dice payload,
// whatever shape game.js gives it ({a:[..],d:[..]}, flat array, ...).
function flattenDice(v, out = []) {
  if (out.length >= 8) return out;
  if (Array.isArray(v)) for (const x of v) flattenDice(x, out);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) flattenDice(x, out);
  else if (Number.isInteger(v) && v >= 1 && v <= 6) out.push(v);
  return out;
}

export function createRenderer(canvas, opts = {}) {
  const atlas = opts.atlas ?? buildAtlas(1);
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.imageSmoothingEnabled = false;
  // Target ~13 tiles visible across the canvas, integer scale for crispness.
  const scale = opts.scale ?? Math.max(1, Math.round(canvas.width / (13 * TILE)));

  let state = null;
  let clock = 0;                       // wall clock for walk frames / pulses
  const queue = [];                    // pending events
  let anim = null;                     // { ev, t, dur }
  const cam = { x: 0, y: 0, scale };
  let camSnapped = false;
  let manualPan = null;                // {x,y} tile â€” scout mode camera target

  const visual = new Map();            // unitKey -> {x,y} display pos (tiles)
  const facing = new Map();            // unitKey -> 1 | -1 (last horiz move)
  const slides = new Map();            // unitKey -> {fx,fy,tx,ty} for this anim
  const hiddenUnits = new Set();       // not yet spawned (event still queued)
  const closedBoxes = new Set();       // force-closed until boxOpened plays
  const standingFlags = new Set();     // force-standing until flagClaimed plays
  const ghosts = new Map();            // unitKey -> {kind,pos,alpha} dead monsters
  let deckShown = 0;

  let overlays = { range: null, path: null };
  let cursor = null;
  let timeScale = 1;                   // >1 compresses event playback (fast AI)
  let floats = [];                     // {text,color,icon,wx,wy,t,ttl,big}
  let sparkles = [];                   // {wx,wy,vx,vy,t,ttl,color[,round,alpha0]}
  let pulseRings = [];                 // {wx,wy,t,ttl,maxR,color,alpha0} — expanding arc rings (healed, etc.)
  let smokeSeed = 0;                   // timer for torch-smoke emission
  let _hudDotPat = null;               // lazily-baked 4×4 dot-grid canvas pattern for HUD texture
  let shake = null;                    // {t,dur,mag}
  let unitFlash = null;                // {key,t,dur,color}
  let turnFlash = null;                // {color,t,dur} â€” screen-edge glow on turn start
  let battle = null;                   // battle overlay model
  let banner = null;                   // {text,color}

  // --- unit bookkeeping -----------------------------------------------------
  function unitKey(ref) {
    if (ref == null) return null;
    if (typeof ref !== 'object') {
      const s = String(ref);
      return s[0] === 'h' || s[0] === 'm' ? s : `h${s}`;
    }
    if (ref.kind === 'monster' || MONSTER_KINDS.has(ref.kind)) return `m${ref.id ?? ref.index ?? 0}`;
    return `h${ref.id ?? ref.slot ?? ref.index ?? 0}`;
  }

  function findUnit(k) {
    if (!state || k == null) return null;
    const pool = k[0] === 'm' ? state.monsters : state.hunters;
    return (pool ?? []).find((u) => String(u.id) === k.slice(1)) ?? null;
  }

  // Resolve a raw ID (number or string) to the canonical unit key by searching
  // both live pools and the ghost map (for recently killed monsters still animating).
  // Needed wherever events carry raw numeric IDs (stepped, battleStarted, …) that
  // unitKey() would wrongly prefix as 'h'.
  function canonicalKey(rawId) {
    if (rawId == null) return null;
    const sid = String(rawId);
    if (sid[0] === 'h' || sid[0] === 'm') return sid; // already prefixed
    if ((state?.hunters ?? []).some((u) => String(u.id) === sid)) return `h${sid}`;
    if ((state?.monsters ?? []).some((u) => String(u.id) === sid)) return `m${sid}`;
    for (const gk of ghosts.keys()) { if (gk[0] === 'm' && gk.slice(1) === sid) return gk; }
    return `h${sid}`; // fallback: assume hunter
  }

  function evKey(ev) {
    const ref = ev.unit ?? ev.hunter ?? ev.monster ?? null;
    if (ref == null) return null;
    if (typeof ref === 'object') return unitKey(ref);
    return canonicalKey(ref); // raw numeric/string id — resolve against live pools
  }

  function displayPos(k) {
    if (visual.has(k)) return visual.get(k);
    const u = findUnit(k);
    return u?.pos ?? null;
  }

  function activeKey() {
    if (!state?.current) return null;
    const { kind, index } = state.current;
    const u = kind === 'monster' ? state.monsters?.[index] : state.hunters?.[index];
    return u ? unitKey({ ...u, kind: kind === 'monster' ? 'monster' : undefined }) : null;
  }

  function paletteName(h) {
    if (typeof h.palette === 'number') return PALETTE_NAMES[h.palette % PALETTE_NAMES.length];
    return PALETTE_NAMES.includes(h.palette) ? h.palette : PALETTE_NAMES[0];
  }

  function walkFrame() {
    return Math.floor(clock / 400) % 2 ? 'step' : 'idle';
  }

  function spriteFor(k) {
    const ghost = ghosts.get(k);
    if (ghost) return atlas[`monster.${ghost.kind}.idle`];
    const u = findUnit(k);
    if (!u) return null;
    if (k[0] === 'm') return atlas[`monster.${u.kind}.${walkFrame()}`];
    return atlas[`hunter${u.spriteId}.${paletteName(u)}.${walkFrame()}`];
  }

  // --- presentation overrides: keep "not happened yet" things on screen -----
  function diffOverrides(prev, next) {
    if (!prev || !next) return;
    const prevBoxes = new Map((prev.board?.boxes ?? []).map((b) => [key(b.x, b.y), b]));
    for (const b of next.board?.boxes ?? []) {
      const p = prevBoxes.get(key(b.x, b.y));
      if (b.opened && p && !p.opened) closedBoxes.add(key(b.x, b.y));
    }
    const prevFlags = new Map((prev.board?.flags ?? []).map((f) => [key(f.x, f.y), f]));
    for (const f of next.board?.flags ?? []) {
      const p = prevFlags.get(key(f.x, f.y));
      if (f.taken && p && !p.taken) standingFlags.add(key(f.x, f.y));
    }
    const prevIds = new Set((prev.monsters ?? []).map((m) => `m${m.id}`));
    for (const m of next.monsters ?? []) {
      if (!prevIds.has(`m${m.id}`)) hiddenUnits.add(`m${m.id}`);
    }
    for (const m of prev.monsters ?? []) {
      const k = `m${m.id}`;
      if (!(next.monsters ?? []).some((n) => `m${n.id}` === k)) {
        ghosts.set(k, { kind: m.kind, pos: visual.get(k) ?? m.pos, alpha: 1 });
      }
    }
  }

  function popOverride(set, k) {
    if (k != null && set.has(k)) { set.delete(k); return; }
    const first = set.values().next();
    if (!first.done) set.delete(first.value);
  }

  function idleSync() {
    visual.clear();
    slides.clear();
    hiddenUnits.clear();
    closedBoxes.clear();
    standingFlags.clear();
    ghosts.clear();
    battle = null;
    if (state) deckShown = state.deck?.length ?? deckShown;
  }

  // --- event lifecycle -------------------------------------------------------
  function addFloat(k, text, color, extra = {}) {
    const p = extra.pos ?? displayPos(k);
    if (!p) return;
    floats.push({ text, color, icon: extra.icon ?? null, big: extra.big ?? false,
      glow: extra.glow ?? null, wx: p.x + 0.5, wy: p.y, t: 0, ttl: extra.ttl ?? 800 });
  }

  function addSparklesAt(wx, wy, color = '#ffe98a') {
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      sparkles.push({ wx: wx + 0.5, wy: wy + 0.5, vx: Math.cos(a) * 2.2,
        vy: Math.sin(a) * 2.2 - 1, t: 0, ttl: 600, color });
    }
  }

  function addSparkles(k, color = '#ffe98a') {
    const p = displayPos(k);
    if (!p) return;
    addSparklesAt(p.x, p.y, color);
  }

  function addRivalVoice(k, evType) {
    const u = findUnit(k);
    if (!u || u.human) return;
    const name = u.name ?? '';
    const family = name === 'KELD' ? 'KELD' : name === 'MIRA' ? 'MIRA' : name.startsWith('RAVEN') ? 'RAVEN' : null;
    if (!family) return;
    const lines = RIVAL_VOICE[family]?.[evType];
    if (!lines?.length) return;
    const line = lines[Math.floor(Math.random() * lines.length)];
    const col = family === 'KELD' ? '#cc4a3a' : family === 'MIRA' ? '#3a6ee0' : '#e06a5a';
    const p = displayPos(k);
    if (!p) return;
    floats.push({ text: `"${line}"`, color: col, icon: null, big: false, glow: 7,
      wx: p.x + 0.5, wy: p.y - 0.5, t: 0, ttl: 1400 });
  }

  function beginSlide(k, from, to) {
    if (!k || !to) return;
    const f = from ?? displayPos(k) ?? to;
    slides.set(k, { fx: f.x, fy: f.y, tx: to.x, ty: to.y });
    if (to.x !== f.x) facing.set(k, to.x < f.x ? -1 : 1);
    visual.set(k, { x: f.x, y: f.y });
  }

  function startEvent(ev) {
    const k = evKey(ev);
    if (battle && !BATTLE_EVENTS.has(ev.type)) battle = null;
    switch (ev.type) {
      case 'turnStarted':
        manualPan = null;
        if (k?.[0] === 'h') {
          const tu = findUnit(k);
          const tc = SLOT_COLORS[(tu?.slot ?? 0) % 4] ?? '#c8d0ff';
          addSparkles(k, tc);
          turnFlash = { color: tc, t: 0, dur: 520 };
        } else if (k?.[0] === 'm') {
          // Monster turn: type-colored edge flash to signal the threat is moving
          const MONSTER_TURN_COL = { VAC: '#2890c8', OOZ: '#28a838', FNG: '#c87020', WYRM: '#6c1cac' };
          const mu = findUnit(k);
          const mc = MONSTER_TURN_COL[mu?.kind] ?? '#c83a3a';
          turnFlash = { color: mc, t: 0, dur: mu?.kind === 'WYRM' ? 560 : 420 };
          // Small type-branded ring at the monster's feet — tactile "it's your move" pulse
          const mtp = displayPos(k);
          if (mtp) {
            pulseRings.push({ wx: mtp.x + 0.5, wy: mtp.y + 0.5, t: 0, ttl: 340, maxR: 1.3, color: mc, alpha0: 0.60 });
          }
        }
        break;
      case 'stepped': {
        const fromPos = ev.from ?? null;
        beginSlide(k, fromPos, ev.to ?? ev.pos ?? null);
        if (fromPos && k?.[0] === 'h') {
          const su = findUnit(k);
          const sc = SLOT_COLORS[(su?.slot ?? 0) % 4] ?? '#9aa0b0';
          for (let i = 0; i < 5; i++) {
            const a = (i / 5) * Math.PI * 2;
            sparkles.push({ wx: fromPos.x + 0.5, wy: fromPos.y + 0.5,
              vx: Math.cos(a) * 0.5, vy: Math.sin(a) * 0.5 - 0.3,
              t: 0, ttl: 280, color: i === 0 ? '#d8dcf0' : sc });
          }
          // Target carrier: golden wake â€” larger, longer-lived particles
          if (su?.hasTarget) {
            for (let i = 0; i < 10; i++) {
              const a = (i / 10) * Math.PI * 2;
              const spd = 0.8 + (i % 3) * 0.45;
              sparkles.push({ wx: fromPos.x + 0.5, wy: fromPos.y + 0.5,
                vx: Math.cos(a) * spd, vy: Math.sin(a) * spd - 0.5,
                t: 0, ttl: 500, color: i % 3 === 0 ? '#fff' : i % 3 === 1 ? '#ffe98a' : '#ffc840' });
            }
          }
        }
        // Monster departure sparkles (was in dead monsterMoved branch — now wired via fixed evKey)
        if (fromPos && k?.[0] === 'm') {
          const mu = findUnit(k);
          const STEP_COL = { VAC: '#3080a8', OOZ: '#288a38', FNG: '#9a6c20', WYRM: '#5c1c9a' };
          const mc = STEP_COL[mu?.kind] ?? '#664444';
          for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2;
            sparkles.push({ wx: fromPos.x + 0.5, wy: fromPos.y + 0.5,
              vx: Math.cos(a) * 0.6, vy: Math.sin(a) * 0.6, t: 0, ttl: 350, color: mc });
          }
          if (mu?.kind === 'VAC') {
            for (let i = 0; i < 12; i++) {
              const a = (i / 12) * Math.PI * 2; const spd = 2.2 + (i % 3) * 0.5;
              sparkles.push({ wx: fromPos.x + 0.5, wy: fromPos.y + 0.5,
                vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, t: 0, ttl: 420,
                color: i % 3 === 0 ? '#fff' : '#50b0e8' });
            }
          }
          if (mu?.kind === 'OOZ') {
            for (let i = 0; i < 8; i++) {
              const a = (i / 8) * Math.PI * 2; const spd = 0.9 + (i % 3) * 0.4;
              sparkles.push({ wx: fromPos.x + 0.5, wy: fromPos.y + 0.7,
                vx: Math.cos(a) * spd * 0.7, vy: Math.abs(Math.sin(a)) * spd + 0.3,
                t: 0, ttl: 500, color: i % 4 === 0 ? '#a0f0a8' : '#2ea840' });
            }
          }
          if (mu?.kind === 'FNG') {
            for (let i = 0; i < 8; i++) {
              const a = -Math.PI * 0.5 + (i - 3.5) * 0.35; const spd = 1.4 + (i % 3) * 0.6;
              sparkles.push({ wx: fromPos.x + 0.5, wy: fromPos.y + 0.5,
                vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, t: 0, ttl: 380,
                color: i % 3 === 0 ? '#fff880' : i % 3 === 1 ? '#ff8820' : '#cc3010' });
            }
          }
          if (mu?.kind === 'WYRM') {
            for (let i = 0; i < 10; i++) {
              const a = (i / 10) * Math.PI * 2; const spd = 1.8 + (i % 4) * 0.7;
              sparkles.push({ wx: fromPos.x + 0.5, wy: fromPos.y + 0.5,
                vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, t: 0, ttl: 460,
                color: i % 5 === 0 ? '#e8c8ff' : i % 5 === 4 ? '#fff' : '#8030c8' });
            }
          }
        }
        // Puddle splash: blue circular ripple when landing on a wet tile
        { const toPos = ev.to ?? ev.pos ?? null;
          if (toPos) {
            const pudH = ((toPos.x * 1637 + toPos.y * 3571) ^ 997) & 0xFFFF;
            if ((pudH & 0xFF) < 30) {
              for (let i = 0; i < 8; i++) {
                const a = (i / 8) * Math.PI * 2;
                const spd = 0.55 + (i % 3) * 0.28;
                sparkles.push({ wx: toPos.x + 0.5, wy: toPos.y + 0.68,
                  vx: Math.cos(a) * spd, vy: Math.sin(a) * spd * 0.35 - 0.1,
                  t: 0, ttl: 300, color: i % 3 === 0 ? '#c8e8f8' : i % 3 === 1 ? '#7aabe0' : '#a0c8ec',
                  round: true });
              }
            }
          } }
        break;
      }
      case 'monsterMoved': // engine never emits this event; stepped handles all movement
        break;
      case 'cardPlayed': {
        const cc = CARD_MINI[String(ev.card ?? '')[0]] ?? '#c8d0ff';
        if (ev.card) addFloat(k, String(ev.card), cc, { ttl: 560 });
        if (k?.[0] === 'h') {
          const cp = displayPos(k);
          if (cp) {
            for (let i = 0; i < 6; i++) {
              const a = (i / 6) * Math.PI * 2;
              sparkles.push({ wx: cp.x + 0.5, wy: cp.y + 0.5,
                vx: Math.cos(a) * 1.4, vy: Math.sin(a) * 1.4 - 0.5,
                t: 0, ttl: 400, color: cc });
            }
            pulseRings.push({ wx: cp.x + 0.5, wy: cp.y + 0.5, t: 0, ttl: 300, maxR: 1.1, color: cc, alpha0: 0.55 });
          }
        }
        break;
      }
      case 'cardDrawn': {
        deckShown = Math.max(0, deckShown - 1);
        if (k?.[0] === 'h') {
          const dp = displayPos(k);
          if (dp) {
            const dc = CARD_MINI[String(ev.card ?? '')[0]] ?? '#b8bce0';
            for (let i = 0; i < 3; i++) {
              sparkles.push({ wx: dp.x + 0.25 + i * 0.25, wy: dp.y + 0.5,
                vx: (i - 1) * 0.35, vy: -0.7 - i * 0.15,
                t: 0, ttl: 340, color: dc });
            }
            pulseRings.push({ wx: dp.x + 0.5, wy: dp.y + 0.5, t: 0, ttl: 280, maxR: 0.9, color: dc, alpha0: 0.50 });
          }
        }
        break;
      }
      case 'deckCount':
        deckShown = ev.count ?? ev.value ?? deckShown;
        break;
      case 'dieRolled': {
        const dp = displayPos(k);
        if (dp) {
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            sparkles.push({ wx: dp.x + 0.5, wy: dp.y - 0.2, vx: Math.cos(a) * 1.5,
              vy: Math.sin(a) * 1.5 - 1.6, t: 0, ttl: 380, color: i % 2 ? '#ffe98a' : '#c8d8f0' });
          }
          pulseRings.push({ wx: dp.x + 0.5, wy: dp.y + 0.5, t: 0, ttl: 240, maxR: 1.0, color: '#c8d8f0', alpha0: 0.45 });
        }
        break;
      }
      case 'trapTriggered': {
        shake = { t: 0, dur: EVENT_DURATIONS.trapTriggered, mag: 3 };
        addFloat(k, ev.kind === 'damage' ? 'TRAP!' : '', '#ff6a5a',
          { icon: ['stun', 'leg', 'empty'].includes(ev.kind) ? `status.${ev.kind}` : null });
        const tp = displayPos(k);
        if (tp) {
          // Burst pattern varies by trap kind
          const trapBursts = {
            damage: ['#ff6a5a', '#ff3010', '#ffb840', '#fff'],
            stun:   ['#ffe060', '#f8c820', '#fff8b0', '#fff'],
            leg:    ['#3a80e8', '#60b0f8', '#c0d8ff', '#fff'],
            empty:  ['#9aa0b0', '#c0c8d8', '#808898', '#9aa0b0'],
          };
          const cols = trapBursts[ev.kind] ?? trapBursts.damage;
          for (let i = 0; i < 16; i++) {
            const a = (i / 16) * Math.PI * 2;
            const spd = 1.0 + (i % 4) * 0.5;
            sparkles.push({ wx: tp.x + 0.5, wy: tp.y + 0.5,
              vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
              t: 0, ttl: 360, color: cols[i % cols.length] });
          }
        }
        break;
      }
      case 'trapDodged': {
        addFloat(k, 'DODGE', '#9adfe8');
        addSparkles(k, '#9adfe8');
        // Fast sideways scatter â€” suggests a quick roll to the side
        const ddp = displayPos(k);
        if (ddp) {
          for (let i = 0; i < 8; i++) {
            const side = i % 2 === 0 ? 1 : -1;
            sparkles.push({ wx: ddp.x + 0.5, wy: ddp.y + 0.5,
              vx: side * (1.8 + (i >> 1) * 0.6), vy: -0.4 - (i >> 1) * 0.2,
              t: 0, ttl: 320, color: i % 3 === 0 ? '#fff' : '#9adfe8' });
          }
          pulseRings.push({ wx: ddp.x + 0.5, wy: ddp.y + 0.5, t: 0, ttl: 260, maxR: 1.3, color: '#9adfe8', alpha0: 0.70 });
        }
        break;
      }
      case 'trapSet': {
        addFloat(k, 'SET', '#8fd17e');
        if (ev.pos) {
          addSparklesAt(ev.pos.x, ev.pos.y, '#8fd17e');
          pulseRings.push({ wx: ev.pos.x + 0.5, wy: ev.pos.y + 0.5, t: 0, ttl: 300, maxR: 1.1, color: '#8fd17e', alpha0: 0.65 });
        }
        break;
      }
      case 'boxOpened': {
        popOverride(closedBoxes, ev.pos ? key(ev.pos.x, ev.pos.y) : null);
        if (ev.pos) {
          addSparklesAt(ev.pos.x, ev.pos.y, '#e8d87e');
          // Extra fast-moving white specks for a "burst open" feel
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            sparkles.push({ wx: ev.pos.x + 0.5, wy: ev.pos.y + 0.5,
              vx: Math.cos(a) * 3.8, vy: Math.sin(a) * 3.8 - 1.5,
              t: 0, ttl: 420, color: '#fff' });
          }
          pulseRings.push({ wx: ev.pos.x + 0.5, wy: ev.pos.y + 0.5, t: 0, ttl: 320, maxR: 1.5, color: '#ffe98a', alpha0: 0.80 });
          pulseRings.push({ wx: ev.pos.x + 0.5, wy: ev.pos.y + 0.5, t: 80, ttl: 480, maxR: 2.4, color: '#c8a020', alpha0: 0.45 });
        }
        break;
      }
      case 'targetFound':
        addSparkles(k);
        addFloat(k, 'TARGET!', '#ffe98a', { big: true, ttl: 1100 });
        turnFlash = { color: '#ffe98a', t: 0, dur: 700 };
        shake = { t: 0, dur: 300, mag: 2.5 };
        // Gold burst: 20 fast-moving particles in a ring + slow lingering outer ring
        { const tp = displayPos(k);
          if (tp) {
            for (let i = 0; i < 20; i++) {
              const a = (i / 20) * Math.PI * 2;
              const spd = i % 5 === 0 ? 3.5 : 1.8 + (i % 3) * 0.8;
              sparkles.push({ wx: tp.x + 0.5, wy: tp.y + 0.5, vx: Math.cos(a) * spd,
                vy: Math.sin(a) * spd - 0.8, t: 0, ttl: i % 5 === 0 ? 500 : 700,
                color: i % 5 === 0 ? '#fff' : i % 3 === 0 ? '#ffd040' : '#ffe98a' });
            }
            // Gold objective rings: fast bright burst + slower wide wave from the carrier
            pulseRings.push({ wx: tp.x + 0.5, wy: tp.y + 0.5, t: 0, ttl: 320, maxR: 1.8, color: '#fff8c0', alpha0: 1.0 });
            pulseRings.push({ wx: tp.x + 0.5, wy: tp.y + 0.5, t: 0, ttl: 550, maxR: 3.2, color: '#ffe98a', alpha0: 0.65 });
          } }
        // Exit portal also erupts gold â€” exit is now “live”
        { const ex = state?.board?.exit;
          if (ex) {
            for (let i = 0; i < 12; i++) {
              const a = (i / 12) * Math.PI * 2;
              sparkles.push({ wx: ex.x + 0.5, wy: ex.y + 0.5, vx: Math.cos(a) * 2.0,
                vy: Math.sin(a) * 2.0 - 0.8, t: 0, ttl: 550,
                color: i % 4 === 0 ? '#fff' : i % 4 === 1 ? '#ffe98a' : '#7ee8a0' });
            }
            // Portal activation wave — the exit “comes alive”
            pulseRings.push({ wx: ex.x + 0.5, wy: ex.y + 0.5, t: 0, ttl: 600, maxR: 3.0, color: '#7ee8a0', alpha0: 0.70 });
          } }
        addRivalVoice(k, 'targetFound');
        break;
      case 'flagClaimed': {
        popOverride(standingFlags, ev.pos ? key(ev.pos.x, ev.pos.y) : null);
        const FLAG_BURST_COLS = { red: ['#ff7060', '#ff3030', '#ff9080', '#fff'],
          blue: ['#6080f0', '#3050d8', '#90b0ff', '#fff'],
          green: ['#50d870', '#289848', '#90f0a8', '#fff'],
          yellow: ['#ffe060', '#d8a820', '#fff880', '#fff'] };
        const flagBurstCols = FLAG_BURST_COLS[ev.color] ?? ['#e8c040', '#fff88a', '#fff', '#ffe98a'];
        const fcp = ev.pos ?? (k ? displayPos(k) : null);
        if (fcp) {
          for (let i = 0; i < 16; i++) {
            const a = (i / 16) * Math.PI * 2;
            const spd = 1.4 + (i % 4) * 0.6;
            sparkles.push({ wx: fcp.x + 0.5, wy: fcp.y + 0.5, vx: Math.cos(a) * spd,
              vy: Math.sin(a) * spd - 0.6, t: 0, ttl: 600,
              color: flagBurstCols[i % flagBurstCols.length] });
          }
        }
        addFloat(k, ev.color ? ev.color.toUpperCase() + ' FLAG!' : 'FLAG!', flagBurstCols[0], { big: true });
        turnFlash = { color: flagBurstCols[0], t: 0, dur: 480 };
        // Flag capture ring: color-branded wave from the flag's tile
        if (fcp) pulseRings.push({ wx: fcp.x + 0.5, wy: fcp.y + 0.5, t: 0, ttl: 420, maxR: 2.2, color: flagBurstCols[0], alpha0: 0.80 });
        if (Math.random() < 0.6) addRivalVoice(k, 'flagClaimed');
        break;
      }
      case 'exitWarpedAway': {
        unitFlash = { key: k, t: 0, dur: EVENT_DURATIONS.exitWarpedAway, color: '#f7f7ff' };
        const ewu = findUnit(k);
        const ewSlotCol = k?.[0] === 'h' ? (SLOT_COLORS[(ewu?.slot ?? 0) % 4] ?? '#3a6ee0') : '#3a6ee0';
        addSparkles(k, '#7ee8a0');
        // Slot-colored ring from the escaping hunter â€” "I made it out!"
        const ewp = displayPos(k);
        if (ewp) {
          for (let i = 0; i < 10; i++) {
            const a = (i / 10) * Math.PI * 2;
            sparkles.push({ wx: ewp.x + 0.5, wy: ewp.y + 0.3,
              vx: Math.cos(a) * 2.2, vy: Math.sin(a) * 2.2 - 0.9,
              t: 0, ttl: 540, color: i % 3 === 0 ? '#fff' : ewSlotCol });
          }
        }
        turnFlash = { color: '#7ee8a0', t: 0, dur: 650 };
        shake = { t: 0, dur: 260, mag: 2.0 };
        // Portal eruption at the exit tile â€” expanded burst mixing slot + portal green
        const ex = state?.board?.exit;
        if (ex) {
          addSparklesAt(ex.x, ex.y, '#7ee8a0');
          for (let i = 0; i < 20; i++) {
            const a = (i / 20) * Math.PI * 2;
            const spd = i % 5 === 0 ? 4.5 : 2.0 + (i % 4) * 0.7;
            sparkles.push({ wx: ex.x + 0.5, wy: ex.y + 0.5,
              vx: Math.cos(a) * spd, vy: Math.sin(a) * spd - 0.8,
              t: 0, ttl: 520, color: i % 5 === 0 ? '#fff' : i % 5 === 1 ? ewSlotCol : '#7ee8a0' });
          }
          // Portal swallow: green exit ring + slot-colored send-off from hunter
          pulseRings.push({ wx: ex.x + 0.5, wy: ex.y + 0.5, t: 0, ttl: 500, maxR: 3.5, color: '#7ee8a0', alpha0: 0.75 });
        }
        if (ewp) pulseRings.push({ wx: ewp.x + 0.5, wy: ewp.y + 0.5, t: 0, ttl: 380, maxR: 2.2, color: ewSlotCol, alpha0: 0.85 });
        addRivalVoice(k, 'exitWarpedAway');
        break;
      }
      case 'drewBlank': {
        addFloat(k, 'NO CARD', '#8d8d9e');
        const dbp = displayPos(k);
        if (dbp) {
          // Downward scatter — empty hand, spirits fall
          for (let i = 0; i < 6; i++) {
            sparkles.push({ wx: dbp.x + 0.25 + i * 0.1, wy: dbp.y + 0.3,
              vx: (i - 2.5) * 0.22, vy: 0.8 + (i % 3) * 0.3,
              t: 0, ttl: 460, color: i % 2 === 0 ? '#8d8d9e' : '#555568' });
          }
          // Fading grey ring — the moment of helplessness
          pulseRings.push({ wx: dbp.x + 0.5, wy: dbp.y + 0.5, t: 0, ttl: 400, maxR: 1.0, color: '#7a7a8e', alpha0: 0.55 });
        }
        break;
      }
      case 'battleStarted': {
        battle = { a: canonicalKey(ev.attacker) ?? k, d: canonicalKey(ev.defender ?? ev.target),
          response: null, escape: null, strike: null };
        // Pre-combat clash aura: pulse rings at both combatants + flash
        const baKey = battle.a, bdKey = battle.d;
        const bap = baKey ? displayPos(baKey) : null;
        const bdp = bdKey ? displayPos(bdKey) : null;
        if (bap) {
          pulseRings.push({ wx: bap.x + 0.5, wy: bap.y + 0.5, t: 0, ttl: 280, maxR: 1.1, color: '#e88050', alpha0: 0.85 });
        }
        if (bdp) {
          pulseRings.push({ wx: bdp.x + 0.5, wy: bdp.y + 0.5, t: 0, ttl: 280, maxR: 1.1, color: '#e85050', alpha0: 0.85 });
        }
        break;
      }
      case 'responseChosen':
        if (battle) battle.response = ev.response ?? null;
        break;
      case 'escapeRolled':
        if (battle) battle.escape = { aTotal: ev.aTotal, dTotal: ev.dTotal, escaped: !!ev.escaped };
        { const erp = displayPos(battle?.a ?? k);
          if (erp) {
            if (ev.escaped) {
              // Successful escape: green dash-burst upward + expanding ring
              for (let i = 0; i < 10; i++) {
                const a = -Math.PI * 0.5 + (i - 4.5) * 0.35;
                sparkles.push({ wx: erp.x + 0.5, wy: erp.y + 0.4,
                  vx: Math.cos(a) * (1.4 + (i % 3) * 0.5), vy: Math.sin(a) * (1.4 + (i % 3) * 0.5),
                  t: 0, ttl: 420, color: i % 3 === 0 ? '#fff' : i % 3 === 1 ? '#8fd17e' : '#4aaa60' });
              }
              pulseRings.push({ wx: erp.x + 0.5, wy: erp.y + 0.5, t: 0, ttl: 300, maxR: 1.4, color: '#8fd17e', alpha0: 0.80 });
            } else {
              // Failed escape: red scatter — caught
              for (let i = 0; i < 8; i++) {
                const a = (i / 8) * Math.PI * 2;
                sparkles.push({ wx: erp.x + 0.5, wy: erp.y + 0.4,
                  vx: Math.cos(a) * 1.0, vy: Math.sin(a) * 1.0 - 0.4,
                  t: 0, ttl: 360, color: i % 2 === 0 ? '#ff6a5a' : '#cc3030' });
              }
            }
          } }
        break;
      case 'strikeRolled':
        if (battle) battle.strike = { dice: flattenDice(ev.dice), totals: ev.totals,
          damage: ev.damage ?? 0, crit: !!ev.crit };
        if ((ev.damage ?? 0) > 0) {
          const dmg = ev.damage ?? 0;
          const floatCol = dmg >= 9 ? '#ffe050' : dmg >= 6 ? '#ff9a40' : '#ff6a5a';
          const floatGlow = dmg >= 9 ? 22 : dmg >= 6 ? 15 : 10;
          addFloat(battle?.d ?? k, `-${dmg}`, floatCol, { big: true, glow: floatGlow });
          unitFlash = { key: battle?.d ?? k, t: 0, dur: EVENT_DURATIONS.strikeRolled,
            color: ev.crit ? '#ffe060' : dmg >= 6 ? '#ff8820' : '#ff3828' };
        }
        if (ev.crit) {
          addSparkles(battle?.d ?? k, '#ffe98a');
          shake = { t: 0, dur: 450, mag: 3.0 };
          const critp = displayPos(battle?.d ?? k);
          if (critp) {
            pulseRings.push({ wx: critp.x + 0.5, wy: critp.y + 0.5, t: 0, ttl: 300, maxR: 1.4, color: '#ffe060', alpha0: 0.90 });
            pulseRings.push({ wx: critp.x + 0.5, wy: critp.y + 0.5, t: 60, ttl: 380, maxR: 2.2, color: '#ffb820', alpha0: 0.55 });
          }
        } else if ((ev.damage ?? 0) > 0) {
          // Impact burst: red/orange sparks proportional to damage
          const idk = battle?.d ?? k;
          const idp = displayPos(idk);
          if (idp) {
            const cnt = (ev.damage ?? 0) >= 5 ? 10 : 7;
            for (let i = 0; i < cnt; i++) {
              const a = (i / cnt) * Math.PI * 2;
              sparkles.push({ wx: idp.x + 0.5, wy: idp.y + 0.4, vx: Math.cos(a) * 1.1,
                vy: Math.sin(a) * 1.1 - 0.8, t: 0, ttl: 360,
                color: i % 3 === 0 ? '#fff' : i % 3 === 1 ? '#ff9060' : '#ff6a5a' });
            }
            const dmg = ev.damage ?? 0;
            const ringCol = dmg >= 6 ? '#ff8820' : '#ff4030';
            const ringR = dmg >= 6 ? 1.6 : 1.2;
            pulseRings.push({ wx: idp.x + 0.5, wy: idp.y + 0.5, t: 0, ttl: 320, maxR: ringR, color: ringCol, alpha0: 0.70 });
          }
          if ((ev.damage ?? 0) >= 5) shake = { t: 0, dur: 350, mag: 2.5 };
          else if ((ev.damage ?? 0) >= 3) shake = { t: 0, dur: 250, mag: 1.5 };
        }
        break;
      case 'statusInflicted': {
        const STATUS_COL = { stun: '#3ab8e8', panic: '#e87020', leg: '#cc3a40', empty: '#7a7a8e' };
        const STATUS_NAME = { stun: 'STUN', panic: 'PANIC', leg: 'LEG WOUND', empty: 'DRAINED' };
        const stcol = STATUS_COL[ev.kind] ?? '#c0c8e0';
        addFloat(k, STATUS_NAME[ev.kind] ?? String(ev.kind ?? '?').toUpperCase(), stcol,
          { icon: `status.${ev.kind}`, ttl: 900 });
        // Directional burst: particles rain outward + slightly upward from victim
        const stp = displayPos(k);
        if (stp) {
          for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 2;
            sparkles.push({ wx: stp.x + 0.5, wy: stp.y + 0.3, vx: Math.cos(a) * 1.3,
              vy: Math.sin(a) * 1.3 - 0.5, t: 0, ttl: 480,
              color: i % 3 === 0 ? '#fff' : stcol });
          }
          // Status infliction ring — color-coded to the status type
          pulseRings.push({ wx: stp.x + 0.5, wy: stp.y + 0.5, t: 0, ttl: 360, maxR: 1.6, color: stcol, alpha0: 0.65 });
        }
        break;
      }
      case 'critNegated': {
        addFloat(k, 'NEGATED', '#9adfe8');
        addSparkles(k, '#9adfe8');
        const cnp = displayPos(k);
        if (cnp) {
          pulseRings.push({ wx: cnp.x + 0.5, wy: cnp.y + 0.5, t: 0, ttl: 350, maxR: 1.5, color: '#9adfe8', alpha0: 0.75 });
          pulseRings.push({ wx: cnp.x + 0.5, wy: cnp.y + 0.5, t: 80, ttl: 420, maxR: 2.2, color: '#5ac8e0', alpha0: 0.40 });
        }
        break;
      }
      case 'hunterDefeated': {
        unitFlash = { key: k, t: 0, dur: EVENT_DURATIONS.hunterDefeated, color: '#f7f7ff' };
        shake = { t: 0, dur: 500, mag: 4 };
        turnFlash = { color: '#cc3333', t: 0, dur: 600 };
        addFloat(k, 'DEFEATED', '#ff6a5a', { big: true, ttl: 900 });
        const dpu = findUnit(k);
        const dpSlotCol = k?.[0] === 'h' ? (SLOT_COLORS[(dpu?.slot ?? 0) % 4] ?? '#cc4a3a') : '#cc4a3a';
        const dp = displayPos(k);
        if (dp) {
          for (let i = 0; i < 20; i++) {
            const a = (i / 20) * Math.PI * 2;
            const spd = 1.2 + (i % 4) * 0.55;
            sparkles.push({ wx: dp.x + 0.5, wy: dp.y + 0.5, vx: Math.cos(a) * spd,
              vy: Math.sin(a) * spd - 0.6, t: 0, ttl: 700,
              color: i % 4 === 0 ? '#f7f7ff' : i % 4 === 1 ? '#ff6a5a' : dpSlotCol });
          }
          // Death shockwave: fast crimson inner ring + slower slot-tinted outer ring
          pulseRings.push({ wx: dp.x + 0.5, wy: dp.y + 0.5, t: 0, ttl: 480, maxR: 1.8, color: '#cc2020', alpha0: 0.85 });
          pulseRings.push({ wx: dp.x + 0.5, wy: dp.y + 0.5, t: 0, ttl: 700, maxR: 2.8, color: dpSlotCol, alpha0: 0.50 });
        }
        addRivalVoice(k, 'hunterDefeated');
        break;
      }
      case 'itemTaken': {
        addFloat(k, ev.itemId != null ? `GOT ${ev.itemId}` : 'TAKEN', '#ffe98a', { big: true });
        const itp = displayPos(k);
        if (itp) {
          for (let i = 0; i < 14; i++) {
            const a = (i / 14) * Math.PI * 2;
            const spd = 1.2 + (i % 3) * 0.5;
            sparkles.push({ wx: itp.x + 0.5, wy: itp.y + 0.4, vx: Math.cos(a) * spd,
              vy: Math.sin(a) * spd - 0.6, t: 0, ttl: 520,
              color: i % 4 === 0 ? '#fff' : i % 4 === 1 ? '#ffe98a' : i % 4 === 2 ? '#ffc840' : '#e8d87e' });
          }
          pulseRings.push({ wx: itp.x + 0.5, wy: itp.y + 0.5, t: 0, ttl: 350, maxR: 1.4, color: '#ffe98a', alpha0: 0.80 });
        }
        break;
      }
      case 'surrendered': {
        addFloat(k, 'SURRENDER', '#c8ccd8', { big: true, ttl: 900 });
        turnFlash = { color: '#8d8d9e', t: 0, dur: 500 };
        // Falling white-flag debris: particles scattered upward then fall â€” suggests collapse
        const sdp = displayPos(k);
        if (sdp) {
          for (let i = 0; i < 14; i++) {
            const a = -Math.PI * 0.5 + (i - 6.5) * 0.38;
            const spd = 0.7 + (i % 4) * 0.38;
            sparkles.push({ wx: sdp.x + 0.5, wy: sdp.y + 0.4,
              vx: Math.cos(a) * spd * 0.6, vy: Math.sin(a) * spd + 0.4,
              t: 0, ttl: 600, color: i % 3 === 0 ? '#f0f4ff' : i % 3 === 1 ? '#8d8d9e' : '#555568' });
          }
        }
        break;
      }
      case 'monsterSpawned':
      case 'wyrmSpawned':
      case 'wyrmRespawned': {
        // Reveal the matching hidden monster (by kind when we can tell).
        let mk = null;
        const kind = ev.kind ?? (ev.type !== 'monsterSpawned' ? 'WYRM' : null);
        for (const h of hiddenUnits) {
          if (h[0] !== 'm') continue;
          if (!kind || findUnit(h)?.kind === kind) { mk = h; break; }
        }
        if (mk) {
          hiddenUnits.delete(mk);
          const sp = displayPos(mk);
          if (sp) {
            // Kind-specific spawn burst
            const SPAWN_BURST = {
              VAC: { cols: ['#50b0e8', '#fff', '#1860a8'], count: 12, spd: 2.0, ttl: 380 },
              OOZ: { cols: ['#3cc850', '#a0f0a0', '#1a7830'], count: 10, spd: 1.4, ttl: 420 },
              FNG: { cols: ['#e09040', '#fff880', '#c03010'], count: 12, spd: 1.8, ttl: 400 },
            };
            const burst = SPAWN_BURST[kind];
            if (burst) {
              for (let i = 0; i < burst.count; i++) {
                const a = (i / burst.count) * Math.PI * 2;
                const spd = burst.spd + (i % 3) * 0.4;
                sparkles.push({ wx: sp.x + 0.5, wy: sp.y + 0.5, vx: Math.cos(a) * spd,
                  vy: Math.sin(a) * spd - 0.4, t: 0, ttl: burst.ttl,
                  color: burst.cols[i % burst.cols.length] });
              }
            } else {
              const SPAWN_COLORS = { WYRM: '#8c3cdc' };
              addSparkles(mk, SPAWN_COLORS[kind] ?? '#cc3a22');
            }
          }
        }
        if (ev.type === 'wyrmSpawned' || ev.type === 'wyrmRespawned') {
          shake = { t: 0, dur: 520, mag: 3.5 };
          turnFlash = { color: '#6c1cac', t: 0, dur: 620 };
          // WYRM terror burst: 3 rings of particles radiating outward at staggered speeds
          const wp = mk ? displayPos(mk) : null;
          if (wp) {
            for (let ring = 0; ring < 3; ring++) {
              const count = 10 + ring * 4;
              const spd = 1.6 + ring * 0.9;
              for (let i = 0; i < count; i++) {
                const a = (i / count) * Math.PI * 2;
                const isFlair = i % (ring === 0 ? 5 : 4) === 0;
                sparkles.push({ wx: wp.x + 0.5, wy: wp.y + 0.5,
                  vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
                  t: 0, ttl: 480 + ring * 120,
                  color: isFlair ? '#fff' : ring === 0 ? '#e8c8ff' : ring === 1 ? '#9838e8' : '#5c1098' });
              }
            }
            // Void arrival halos: fast bright ring + massive slow outer wave
            pulseRings.push({ wx: wp.x + 0.5, wy: wp.y + 0.5, t: 0, ttl: 400, maxR: 3.0, color: '#e8c8ff', alpha0: 1.0 });
            pulseRings.push({ wx: wp.x + 0.5, wy: wp.y + 0.5, t: 0, ttl: 700, maxR: 5.5, color: '#6c1cac', alpha0: 0.60 });
          }
        } else if (ev.type !== 'monsterSpawned') {
          shake = { t: 0, dur: 400, mag: 2 };
        }
        // Type-branded arrival ring for standard monsters
        if (ev.type === 'monsterSpawned' && mk) {
          const spawnPos = displayPos(mk);
          if (spawnPos) {
            const SPAWN_RING = { VAC: '#50b0e8', OOZ: '#3cc850', FNG: '#e09040' };
            const rCol = SPAWN_RING[kind] ?? '#cc3a22';
            pulseRings.push({ wx: spawnPos.x + 0.5, wy: spawnPos.y + 0.5, t: 0, ttl: 350, maxR: 2.0, color: rCol, alpha0: 0.70 });
          }
        }
        // A visible rival reacts to the WYRM arrival
        if (ev.type === 'wyrmSpawned' || ev.type === 'wyrmRespawned') {
          const wyrmVoicePool = (state?.hunters ?? []).filter(
            (h) => !h.human && h.hp > 0 && !hiddenUnits.has(`h${h.id}`),
          );
          if (wyrmVoicePool.length) {
            const vr = wyrmVoicePool[Math.floor(Math.random() * wyrmVoicePool.length)];
            addRivalVoice(`h${vr.id}`, 'wyrmSpawned');
          }
        }
        break;
      }
      case 'monsterKilled': {
        const gk = k != null && ghosts.has(k) ? k : ghosts.keys().next().value;
        if (gk != null) ghosts.get(gk).dyingKey = gk;
        addFloat(k ?? gk, ev.drop != null ? `DROP ${ev.drop}` : '', '#ffe98a');
        const deadGhost = ghosts.get(gk ?? k);
        const KILL_COLORS = { VAC: '#2890c8', OOZ: '#28a838', FNG: '#c87020', WYRM: '#7c1cc8' };
        const killKind = deadGhost?.kind;
        const killCol = KILL_COLORS[killKind] ?? '#ff8866';
        const kpos = deadGhost?.pos ?? displayPos(gk ?? k);
        if (kpos && killKind === 'WYRM') {
          // WYRM death: void detonation â€” 3 rings at staggered radii + shock wave + screen blowout
          shake = { t: 0, dur: 560, mag: 5.0 };
          turnFlash = { color: '#9c28f8', t: 0, dur: 700 };
          // Shock wave ring: fast, very short-lived
          for (let i = 0; i < 20; i++) {
            const a = (i / 20) * Math.PI * 2;
            sparkles.push({ wx: kpos.x + 0.5, wy: kpos.y + 0.5,
              vx: Math.cos(a) * 5.5, vy: Math.sin(a) * 5.5,
              t: 0, ttl: 210, color: i % 4 === 0 ? '#fff' : '#e0c0ff' });
          }
          // Dense mid ring
          for (let i = 0; i < 28; i++) {
            const a = (i / 28) * Math.PI * 2;
            const spd = 2.2 + (i % 5) * 0.55;
            sparkles.push({ wx: kpos.x + 0.5, wy: kpos.y + 0.5,
              vx: Math.cos(a) * spd, vy: Math.sin(a) * spd - 0.4,
              t: 0, ttl: 600, color: i % 5 === 0 ? '#fff' : i % 5 === 1 ? '#e0c0ff' : i % 5 === 2 ? '#9838e8' : '#5c1098' });
          }
          // Slow lingering void-mist ring
          for (let i = 0; i < 16; i++) {
            const a = (i / 16) * Math.PI * 2;
            sparkles.push({ wx: kpos.x + 0.5, wy: kpos.y + 0.5,
              vx: Math.cos(a) * 0.8, vy: Math.sin(a) * 0.8 - 0.2,
              t: 0, ttl: 900, color: i % 3 === 0 ? '#c898ff' : '#7c1cc8', round: true, alpha0: 0.7 });
          }
          // WYRM void detonation rings: three staggered expanding shockwaves
          pulseRings.push({ wx: kpos.x + 0.5, wy: kpos.y + 0.5, t: 0, ttl: 350, maxR: 2.5, color: '#e0c0ff', alpha0: 1.0 });
          pulseRings.push({ wx: kpos.x + 0.5, wy: kpos.y + 0.5, t: 0, ttl: 600, maxR: 4.5, color: '#9838e8', alpha0: 0.75 });
          pulseRings.push({ wx: kpos.x + 0.5, wy: kpos.y + 0.5, t: 0, ttl: 900, maxR: 6.5, color: '#5c1098', alpha0: 0.45 });
        } else if (kpos) {
          // Standard monster kill: type-colored 20-particle burst
          for (let i = 0; i < 20; i++) {
            const a = (i / 20) * Math.PI * 2;
            const spd = 1.0 + (i % 4) * 0.6;
            sparkles.push({ wx: kpos.x + 0.5, wy: kpos.y + 0.5, vx: Math.cos(a) * spd,
              vy: Math.sin(a) * spd - 0.5, t: 0, ttl: 550, color: i % 4 === 0 ? '#fff' : killCol });
          }
          // Type-branded kill ring expanding from monster's last position
          pulseRings.push({ wx: kpos.x + 0.5, wy: kpos.y + 0.5, t: 0, ttl: 400, maxR: 2.5, color: killCol, alpha0: 0.65 });
        }
        break;
      }
      case 'healed': {
        addFloat(k, `+${ev.amount ?? ''}`, '#8fd17e', { big: true });
        // Rising green cross-sparks (upward only, slight spread) — suggests HP lifting
        const hp = displayPos(k);
        if (hp) {
          for (let i = 0; i < 8; i++) {
            sparkles.push({ wx: hp.x + 0.3 + (i % 4) * 0.12, wy: hp.y + 0.5,
              vx: (i % 3 - 1) * 0.22, vy: -1.4 - (i % 3) * 0.35,
              t: 0, ttl: 600, color: i % 3 === 0 ? '#ffffff' : '#8fd17e' });
          }
          // Expanding halo rings: inner fast pulse + slower outer wave
          pulseRings.push({ wx: hp.x + 0.5, wy: hp.y + 0.5, t: 0, ttl: 300, maxR: 0.9, color: '#c8ffd8', alpha0: 0.9 });
          pulseRings.push({ wx: hp.x + 0.5, wy: hp.y + 0.5, t: 0, ttl: 500, maxR: 1.7, color: '#7ee8a0', alpha0: 0.55 });
        }
        break;
      }
      case 'actAgain': {
        addFloat(k, 'AGAIN!', '#ffe98a', { big: true, ttl: 900 });
        // Slot-colored flash: "this hunter is back for another shot"
        const aau = findUnit(k);
        const aaCol = k?.[0] === 'h' ? (SLOT_COLORS[(aau?.slot ?? 0) % 4] ?? '#ffe98a') : '#ffe98a';
        turnFlash = { color: aaCol, t: 0, dur: 500 };
        // Gold ring burst + extra slot-colored particles
        const ap2 = displayPos(k);
        if (ap2) {
          for (let i = 0; i < 14; i++) {
            const a = (i / 14) * Math.PI * 2;
            const spd = 1.4 + (i % 4) * 0.45;
            sparkles.push({ wx: ap2.x + 0.5, wy: ap2.y + 0.5, vx: Math.cos(a) * spd,
              vy: Math.sin(a) * spd - 0.6, t: 0, ttl: 580,
              color: i % 4 === 0 ? '#fff' : i % 4 === 1 ? '#ffe98a' : aaCol });
          }
          // Second-wind halo: fast gold inner ring + slower slot-colored outer ring
          pulseRings.push({ wx: ap2.x + 0.5, wy: ap2.y + 0.5, t: 0, ttl: 280, maxR: 0.85, color: '#ffe98a', alpha0: 1.0 });
          pulseRings.push({ wx: ap2.x + 0.5, wy: ap2.y + 0.5, t: 0, ttl: 560, maxR: 2.0, color: aaCol, alpha0: 0.65 });
        }
        break;
      }
      case 'missionWon': {
        banner = { text: 'MISSION COMPLETE', color: '#ffe98a', startMs: clock };
        turnFlash = { color: '#7ee8a0', t: 0, dur: 900 };
        shake = { t: 0, dur: 380, mag: 2.5 };
        // Fireworks: 24-particle burst from every hunter + center screen
        const WIN_COLS = ['#fff', '#ffe98a', '#7ee8a0', '#f0a0ff', '#7ec8f8', '#ffc040'];
        for (const h of state?.hunters ?? []) {
          const wp2 = displayPos(`h${h.id}`);
          if (!wp2) continue;
          for (let i = 0; i < 24; i++) {
            const a = (i / 24) * Math.PI * 2;
            const spd = 1.6 + (i % 5) * 0.5;
            sparkles.push({ wx: wp2.x + 0.5, wy: wp2.y + 0.3, vx: Math.cos(a) * spd,
              vy: Math.sin(a) * spd - 0.7, t: 0, ttl: 750,
              color: WIN_COLS[i % WIN_COLS.length] });
          }
          // Victory halos: gold inner burst + green outer wave from each hunter
          pulseRings.push({ wx: wp2.x + 0.5, wy: wp2.y + 0.5, t: 0, ttl: 450, maxR: 1.8, color: '#ffe98a', alpha0: 1.0 });
          pulseRings.push({ wx: wp2.x + 0.5, wy: wp2.y + 0.5, t: 0, ttl: 700, maxR: 3.5, color: '#7ee8a0', alpha0: 0.60 });
        }
        break;
      }
      case 'missionLost': {
        banner = { text: 'MISSION FAILED', color: '#ff6a5a', startMs: clock };
        turnFlash = { color: '#cc3333', t: 0, dur: 700 };
        shake = { t: 0, dur: 400, mag: 3 };
        // Collapse debris: dark falling particles from each hunter position
        for (const mlh of state?.hunters ?? []) {
          const mlp = displayPos(`h${mlh.id}`);
          if (!mlp) continue;
          for (let i = 0; i < 14; i++) {
            const a = -Math.PI * 0.5 + (i - 6.5) * 0.30;
            const spd = 0.8 + (i % 4) * 0.45;
            sparkles.push({ wx: mlp.x + 0.5, wy: mlp.y + 0.4,
              vx: Math.cos(a) * spd, vy: Math.sin(a) * spd + 0.5,
              t: 0, ttl: 680, color: i % 4 === 0 ? '#fff' : i % 4 === 1 ? '#ff6a5a' : i % 4 === 2 ? '#882020' : '#2a1010' });
          }
          // Defeat shockwave: fast scarlet ring + slow deep-crimson outer wave
          pulseRings.push({ wx: mlp.x + 0.5, wy: mlp.y + 0.5, t: 0, ttl: 500, maxR: 2.0, color: '#cc1010', alpha0: 0.80 });
          pulseRings.push({ wx: mlp.x + 0.5, wy: mlp.y + 0.5, t: 0, ttl: 800, maxR: 3.8, color: '#601010', alpha0: 0.40 });
        }
        break;
      }
      case 'scoreTallied':
        banner = banner ?? { text: 'RESULTS', color: '#f0f4ff', startMs: clock };
        break;
      default:
        break;
    }
  }

  function applyAnimProgress() {
    if (!anim) return;
    const p = Math.min(1, anim.t / anim.dur);
    for (const [k, s] of slides) {
      visual.set(k, { x: s.fx + (s.tx - s.fx) * p, y: s.fy + (s.ty - s.fy) * p });
    }
    const gk = [...ghosts.values()].find((g) => g.dyingKey);
    if (gk && anim.ev.type === 'monsterKilled') gk.alpha = 1 - p;
    if (unitFlash) unitFlash.t = anim.t;
  }

  function endEvent(ev) {
    for (const [k, s] of slides) visual.set(k, { x: s.tx, y: s.ty });
    slides.clear();
    switch (ev.type) {
      case 'hunterDefeated':
      case 'exitWarpedAway': {
        const k = evKey(ev);
        if (k) visual.delete(k); // snap to the warped-to state position
        unitFlash = null;
        break;
      }
      case 'monsterKilled':
        for (const [k, g] of ghosts) if (g.dyingKey) ghosts.delete(k);
        break;
      case 'deckCount':
      case 'cardDrawn':
        if (state && !queue.length) deckShown = state.deck?.length ?? deckShown;
        break;
      default:
        break;
    }
  }

  // --- camera ----------------------------------------------------------------
  function viewSize() {
    return { w: canvas.width / cam.scale, h: (canvas.height - HUD_H) / cam.scale };
  }

  function camTarget() {
    const { w, h } = viewSize();
    let cx;
    let cy;
    if (manualPan) { cx = manualPan.x * TILE + TILE / 2; cy = manualPan.y * TILE + TILE / 2; }
    else {
      const p = displayPos(activeKey());
      if (p) { cx = p.x * TILE + TILE / 2; cy = p.y * TILE + TILE / 2; }
      else { cx = (state?.board?.w ?? 0) * TILE / 2; cy = (state?.board?.h ?? 0) * TILE / 2; }
    }
    const bw = (state?.board?.w ?? 0) * TILE;
    const bh = (state?.board?.h ?? 0) * TILE;
    return { x: clamp(cx - w / 2, 0, bw - w), y: clamp(cy - h / 2, 0, bh - h) };
  }

  function moveCamera(dtMs) {
    if (!state) return;
    const t = camTarget();
    if (!camSnapped) { cam.x = t.x; cam.y = t.y; camSnapped = true; return; }
    const k2 = Math.min(1, dtMs / 150);
    cam.x += (t.x - cam.x) * k2;
    cam.y += (t.y - cam.y) * k2;
  }

  // --- drawing ---------------------------------------------------------------
  function setFont(size) {
    ctx.font = `${size}px ${FONT}`;
    ctx.textBaseline = 'top';
  }

  function text(str, x, y, color = '#f0f4ff', size = 12, align = 'left') {
    ctx.fillStyle = color;
    ctx.textAlign = align;
    setFont(size);
    ctx.fillText(str, x | 0, y | 0);
    ctx.textAlign = 'left';
  }

  function blit(name, sx, sy, s = cam.scale) {
    const img = atlas[name];
    if (!img) return;
    ctx.drawImage(img, sx | 0, sy | 0, img.width * s, img.height * s);
  }

  function blitTile(name, tx, ty) {
    const p = worldToScreen(tx, ty, cam);
    blit(name, p.x, p.y);
  }

  function drawBoard() {
    const b = state.board;
    const { w: vw, h: vh } = viewSize();
    const x0 = Math.max(0, Math.floor(cam.x / TILE));
    const y0 = Math.max(0, Math.floor(cam.y / TILE));
    const x1 = Math.min(b.w - 1, Math.ceil((cam.x + vw) / TILE));
    const y1 = Math.min(b.h - 1, Math.ceil((cam.y + vh) / TILE));
    const floors = ['floorA', 'floorB', 'floorC', 'floorD', 'floorE', 'floorF', 'floorG', 'floorH', 'floorI', 'floorJ', 'floorK', 'floorL', 'floorM', 'floorN', 'floorO', 'floorP', 'floorQ', 'floorR', 'floorS', 'floorT', 'floorU', 'floorV', 'floorW', 'floorX', 'floorY', 'floorZ', 'floorAA', 'floorAB', 'floorAC', 'floorAD', 'floorAE', 'floorAF', 'floorAG', 'floorAH', 'floorAI', 'floorAJ', 'floorAK', 'floorAL', 'floorAM', 'floorAN', 'floorAO', 'floorAP', 'floorAQ', 'floorAR', 'floorAS', 'floorAT', 'floorAU', 'floorAV', 'floorAW', 'floorAX', 'floorAY', 'floorAZ', 'floorBA', 'floorBB', 'floorBC', 'floorBD', 'floorBE', 'floorBF', 'floorBG', 'floorBH', 'floorBI', 'floorBJ', 'floorBK', 'floorBL', 'floorBM', 'floorBN', 'floorCA', 'floorCB', 'floorCC', 'floorCD', 'floorCE', 'floorCF', 'floorCG', 'floorCH', 'floorCI', 'floorCJ', 'floorCK', 'floorCL', 'floorCM', 'floorCN', 'floorCO', 'floorCP', 'floorCQ', 'floorCR', 'floorCS', 'floorCT', 'floorCU', 'floorCV', 'floorCW', 'floorCX', 'floorCY', 'floorCZ', 'floorDA', 'floorDB', 'floorDC', 'floorDD', 'floorDE', 'floorDF', 'floorDG', 'floorDH', 'floorDI', 'floorDJ', 'floorDK', 'floorDL', 'floorDM', 'floorDW', 'floorDX', 'floorDY', 'floorDT', 'floorDU', 'floorDV', 'floorDQ', 'floorDR', 'floorDS', 'floorDN', 'floorDO', 'floorDP', 'floorDZ', 'floorEA', 'floorEB', 'floorEC', 'floorED', 'floorEE', 'floorEF', 'floorEG', 'floorEH', 'floorEI', 'floorEJ', 'floorEK', 'floorEL', 'floorEM', 'floorEN', 'floorHF', 'floorHG', 'floorHH', 'floorHC', 'floorHD', 'floorHE', 'floorGZ', 'floorHA', 'floorHB', 'floorGW', 'floorGX', 'floorGY', 'floorGT', 'floorGU', 'floorGV', 'floorGQ', 'floorGR', 'floorGS', 'floorGN', 'floorGO', 'floorGP', 'floorGK', 'floorGL', 'floorGM', 'floorGH', 'floorGI', 'floorGJ', 'floorGE', 'floorGF', 'floorGG', 'floorGB', 'floorGC', 'floorGD', 'floorFY', 'floorFZ', 'floorGA', 'floorFV', 'floorFW', 'floorFX', 'floorFS', 'floorFT', 'floorFU', 'floorFP', 'floorFQ', 'floorFR', 'floorFM', 'floorFN', 'floorFO', 'floorFJ', 'floorFK', 'floorFL', 'floorFG', 'floorFH', 'floorFI', 'floorFD', 'floorFE', 'floorFF', 'floorFA', 'floorFB', 'floorFC', 'floorEX', 'floorEY', 'floorEZ', 'floorEU', 'floorEV', 'floorEW', 'floorER', 'floorES', 'floorET', 'floorEO', 'floorEP', 'floorEQ', 'floorBX', 'floorBY', 'floorBZ', 'floorBU', 'floorBV', 'floorBW', 'floorBR', 'floorBS', 'floorBT', 'floorBO', 'floorBP', 'floorBQ'];
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!b.floor[y]?.[x]) {
          // Show stone wall face where the wall borders a walkable floor below it.
          const wallV = ((x * 2341 + y * 1013) ^ 571) % 218;
          const wallTile = wallV === 0 ? 'tile.wall' : wallV === 1 ? 'tile.wallB' : wallV === 2 ? 'tile.wallC' : wallV === 3 ? 'tile.wallD' : wallV === 4 ? 'tile.wallE' : wallV === 5 ? 'tile.wallF' : wallV === 6 ? 'tile.wallG' : wallV === 7 ? 'tile.wallH' : wallV === 8 ? 'tile.wallI' : wallV === 9 ? 'tile.wallJ' : wallV === 10 ? 'tile.wallK' : wallV === 11 ? 'tile.wallL' : wallV === 12 ? 'tile.wallM' : wallV === 13 ? 'tile.wallN' : wallV === 14 ? 'tile.wallO' : wallV === 15 ? 'tile.wallP' : wallV === 16 ? 'tile.wallQ' : wallV === 17 ? 'tile.wallR' : wallV === 18 ? 'tile.wallS' : wallV === 19 ? 'tile.wallT' : wallV === 20 ? 'tile.wallU' : wallV === 21 ? 'tile.wallV' : wallV === 22 ? 'tile.wallW' : wallV === 23 ? 'tile.wallX' : wallV === 24 ? 'tile.wallY' : wallV === 25 ? 'tile.wallZ' : wallV === 26 ? 'tile.wallAA' : wallV === 27 ? 'tile.wallAB' : wallV === 28 ? 'tile.wallAC' : wallV === 29 ? 'tile.wallAD' : wallV === 30 ? 'tile.wallAE' : wallV === 31 ? 'tile.wallAF' : wallV === 32 ? 'tile.wallAG' : wallV === 33 ? 'tile.wallAH' : wallV === 34 ? 'tile.wallAI' : wallV === 35 ? 'tile.wallAJ' : wallV === 36 ? 'tile.wallAK' : wallV === 37 ? 'tile.wallAL' : wallV === 38 ? 'tile.wallAM' : wallV === 39 ? 'tile.wallAN' : wallV === 40 ? 'tile.wallAO' : wallV === 41 ? 'tile.wallAO' : wallV === 42 ? 'tile.wallAP' : wallV === 43 ? 'tile.wallAQ' : wallV === 44 ? 'tile.wallAR' : wallV === 45 ? 'tile.wallAS' : wallV === 46 ? 'tile.wallAT' : wallV === 47 ? 'tile.wallAU' : wallV === 48 ? 'tile.wallAV' : wallV === 49 ? 'tile.wallAW' : wallV === 50 ? 'tile.wallAX' : wallV === 51 ? 'tile.wallAY' : wallV === 52 ? 'tile.wallAZ' : wallV === 53 ? 'tile.wallBA' : wallV === 54 ? 'tile.wallBB' : wallV === 55 ? 'tile.wallBC' : wallV === 56 ? 'tile.wallBD' : wallV === 57 ? 'tile.wallBE' : wallV === 58 ? 'tile.wallBF' : wallV === 59 ? 'tile.wallBG' : wallV === 60 ? 'tile.wallBH' : wallV === 61 ? 'tile.wallBI' : wallV === 62 ? 'tile.wallBJ' : wallV === 63 ? 'tile.wallBK' : wallV === 64 ? 'tile.wallBL' : wallV === 65 ? 'tile.wallBM' : wallV === 66 ? 'tile.wallBN' : wallV === 67 ? 'tile.wallBO' : wallV === 68 ? 'tile.wallBP' : wallV === 69 ? 'tile.wallBQ' : wallV === 70 ? 'tile.wallBR' : wallV === 71 ? 'tile.wallBS' : wallV === 72 ? 'tile.wallBT' : wallV === 73 ? 'tile.wallBU' : wallV === 74 ? 'tile.wallBV' : wallV === 75 ? 'tile.wallBW' : wallV === 76 ? 'tile.wallBX' : wallV === 77 ? 'tile.wallBY' : wallV === 78 ? 'tile.wallBZ' : wallV === 79 ? 'tile.wallCA' : wallV === 80 ? 'tile.wallCB' : wallV === 81 ? 'tile.wallCC' : wallV === 82 ? 'tile.wallCD' : wallV === 83 ? 'tile.wallCE' : wallV === 84 ? 'tile.wallCF' : wallV === 85 ? 'tile.wallCG' : wallV === 86 ? 'tile.wallCH' : wallV === 87 ? 'tile.wallCI' : wallV === 88 ? 'tile.wallCJ' : wallV === 89 ? 'tile.wallCK' : wallV === 90 ? 'tile.wallCL' : wallV === 91 ? 'tile.wallCM' : wallV === 92 ? 'tile.wallCN' : wallV === 93 ? 'tile.wallCO' : wallV === 94 ? 'tile.wallCP' : wallV === 95 ? 'tile.wallCQ' : wallV === 96 ? 'tile.wallCR' : wallV === 97 ? 'tile.wallCS' : wallV === 98 ? 'tile.wallCT' : wallV === 99 ? 'tile.wallCU' : wallV === 100 ? 'tile.wallCV' : wallV === 101 ? 'tile.wallCW' : wallV === 102 ? 'tile.wallCX' : wallV === 103 ? 'tile.wallCY' : wallV === 104 ? 'tile.wallCZ' : wallV === 105 ? 'tile.wallDA' : wallV === 106 ? 'tile.wallDB' : wallV === 107 ? 'tile.wallDC' : wallV === 108 ? 'tile.wallDD' : wallV === 109 ? 'tile.wallDE' : wallV === 110 ? 'tile.wallDF' : wallV === 111 ? 'tile.wallDG' : wallV === 112 ? 'tile.wallDH' : wallV === 113 ? 'tile.wallDI' : wallV === 114 ? 'tile.wallDJ' : wallV === 115 ? 'tile.wallDK' : wallV === 116 ? 'tile.wallDL' : wallV === 117 ? 'tile.wallDM' : wallV === 118 ? 'tile.wallDN' : wallV === 119 ? 'tile.wallDO' : wallV === 120 ? 'tile.wallDP' : wallV === 121 ? 'tile.wallDQ' : wallV === 122 ? 'tile.wallDR' : wallV === 123 ? 'tile.wallDS' : wallV === 124 ? 'tile.wallDT' : wallV === 125 ? 'tile.wallDU' : wallV === 126 ? 'tile.wallDV' : wallV === 127 ? 'tile.wallDW' : wallV === 128 ? 'tile.wallDX' : wallV === 129 ? 'tile.wallDY' : wallV === 130 ? 'tile.wallDZ' : wallV === 131 ? 'tile.wallEA' : wallV === 132 ? 'tile.wallEB' : wallV === 133 ? 'tile.wallEC' : wallV === 134 ? 'tile.wallED' : wallV === 135 ? 'tile.wallEE' : wallV === 136 ? 'tile.wallEF' : wallV === 137 ? 'tile.wallEG' : wallV === 138 ? 'tile.wallEH' : wallV === 139 ? 'tile.wallEI' : wallV === 140 ? 'tile.wallEJ' : wallV === 141 ? 'tile.wallEK' : wallV === 142 ? 'tile.wallEL' : wallV === 143 ? 'tile.wallEM' : wallV === 144 ? 'tile.wallEN' : wallV === 145 ? 'tile.wallEO' : wallV === 146 ? 'tile.wallEP' : wallV === 147 ? 'tile.wallEQ' : wallV === 148 ? 'tile.wallER' : wallV === 149 ? 'tile.wallES' : wallV === 150 ? 'tile.wallET' : wallV === 151 ? 'tile.wallEU' : wallV === 152 ? 'tile.wallEV' : wallV === 153 ? 'tile.wallEW' : wallV === 154 ? 'tile.wallEX' : wallV === 155 ? 'tile.wallEY' : wallV === 156 ? 'tile.wallEZ' : wallV === 157 ? 'tile.wallFA' : wallV === 158 ? 'tile.wallFB' : wallV === 159 ? 'tile.wallFC' : wallV === 160 ? 'tile.wallFD' : wallV === 161 ? 'tile.wallFE' : wallV === 162 ? 'tile.wallFF' : wallV === 163 ? 'tile.wallFG' : wallV === 164 ? 'tile.wallFH' : wallV === 165 ? 'tile.wallFI' : wallV === 166 ? 'tile.wallFJ' : wallV === 167 ? 'tile.wallFK' : wallV === 168 ? 'tile.wallFL' : wallV === 169 ? 'tile.wallFM' : wallV === 170 ? 'tile.wallFN' : wallV === 171 ? 'tile.wallFO' : wallV === 172 ? 'tile.wallFP' : wallV === 173 ? 'tile.wallFQ' : wallV === 174 ? 'tile.wallFR' : wallV === 175 ? 'tile.wallFS' : wallV === 176 ? 'tile.wallFT' : wallV === 177 ? 'tile.wallFU' : wallV === 178 ? 'tile.wallFV' : wallV === 179 ? 'tile.wallFW' : wallV === 180 ? 'tile.wallFX' : wallV === 181 ? 'tile.wallFY' : wallV === 182 ? 'tile.wallFZ' : wallV === 183 ? 'tile.wallGA' : wallV === 184 ? 'tile.wallGB' : wallV === 185 ? 'tile.wallGC' : wallV === 186 ? 'tile.wallGD' : wallV === 187 ? 'tile.wallGE' : wallV === 188 ? 'tile.wallGF' : wallV === 189 ? 'tile.wallGG' : wallV === 190 ? 'tile.wallGH' : wallV === 191 ? 'tile.wallGI' : wallV === 192 ? 'tile.wallGJ' : wallV === 193 ? 'tile.wallGK' : wallV === 194 ? 'tile.wallGL' : wallV === 195 ? 'tile.wallGM' : wallV === 196 ? 'tile.wallGN' : wallV === 197 ? 'tile.wallGO' : wallV === 198 ? 'tile.wallGP' : wallV === 199 ? 'tile.wallGQ' : wallV === 200 ? 'tile.wallGR' : wallV === 201 ? 'tile.wallGS' : wallV === 202 ? 'tile.wallGT' : wallV === 203 ? 'tile.wallGU' : wallV === 204 ? 'tile.wallGV' : wallV === 205 ? 'tile.wallGW' : wallV === 206 ? 'tile.wallGX' : wallV === 207 ? 'tile.wallGY' : wallV === 208 ? 'tile.wallGZ' : wallV === 209 ? 'tile.wallHA' : wallV === 210 ? 'tile.wallHB' : wallV === 211 ? 'tile.wallHC' : wallV === 212 ? 'tile.wallHD' : wallV === 213 ? 'tile.wallHE' : wallV === 214 ? 'tile.wallHF' : wallV === 215 ? 'tile.wallHG' : wallV === 216 ? 'tile.wallHH' : 'tile.wallHI';
          blitTile(b.floor[y + 1]?.[x] ? wallTile : 'tile.pit', x, y);
          // Pit depth: rim catch-light + slow-pulsing void shimmer
          if (!b.floor[y + 1]?.[x]) {
            const pp = worldToScreen(x, y, cam); const ps = TILE * cam.scale;
            // Ambient light grazing the top rim of the abyss
            { const rimG = ctx.createLinearGradient(pp.x, pp.y, pp.x, pp.y + ps * 0.22);
              rimG.addColorStop(0, 'rgba(70,85,115,0.10)'); rimG.addColorStop(1, 'rgba(0,0,0,0)');
              ctx.fillStyle = rimG; ctx.fillRect(pp.x | 0, pp.y | 0, ps, ps * 0.22); }
            // Slow pulsing depth shimmer deep in the void (every ~12 s per pit)
            { const pph = ((x * 2777 + y * 3571) ^ 1337) & 0xFFFF;
              const pphase = 0.5 + 0.5 * Math.sin(clock / (2600 + (pph & 0x5FF)) + pph * 0.021);
              if (pphase > 0.70) {
                const pa = (pphase - 0.70) / 0.30 * 0.055;
                const pcx = pp.x + ps * 0.5, pcy = pp.y + ps * 0.62;
                const pg = ctx.createRadialGradient(pcx, pcy, 0, pcx, pcy, ps * 0.38);
                pg.addColorStop(0, `rgba(30,45,90,${pa.toFixed(3)})`); pg.addColorStop(1, 'rgba(0,0,0,0)');
                ctx.fillStyle = pg; ctx.fillRect(pp.x | 0, (pp.y + ps * 0.25) | 0, ps, ps * 0.75); } }
            // Void motes: 2 faint phosphorescent particles slowly rising from the abyss
            { const vmh = ((x * 4001 + y * 2963) ^ 7331) & 0xFFFF;
              const vmper = 2800 + ((vmh >> 5) & 0x7FF);
              for (let vmi = 0; vmi < 2; vmi++) {
                const vhh = (vmh >> (vmi * 4)) & 0xFF;
                const vmph = ((clock + vmi * (vmper >> 1) + vhh * 31) % vmper) / vmper;
                const vma = Math.sin(vmph * Math.PI) * 0.19;
                if (vma < 0.03) continue;
                const vmxOff = (vhh & 0xF) % 14 + 1;
                const vmsx = (pp.x + vmxOff * cam.scale + Math.sin(vmph * Math.PI * 2 + vmi * 1.9) * cam.scale) | 0;
                const vmsy = (pp.y + ps - vmph * ps) | 0;
                ctx.save(); ctx.globalAlpha = vma;
                ctx.fillStyle = vmi ? '#1c2448' : '#28203a';
                ctx.fillRect(vmsx, vmsy, cam.scale, cam.scale); ctx.restore();
              } }
          }
          // Section tint on wall faces (matches quadrant identity from floor tint)
          if (b.floor[y + 1]?.[x]) {
            const wp = worldToScreen(x, y, cam); const wts = TILE * cam.scale;
            // Top-edge highlight: thin bright band where ambient light grazes the wall cap
            { const hlg = ctx.createLinearGradient(0, wp.y + cam.scale, 0, wp.y + cam.scale * 4);
              hlg.addColorStop(0, 'rgba(220,228,248,0.18)'); hlg.addColorStop(1, 'rgba(220,228,248,0)');
              ctx.fillStyle = hlg; ctx.fillRect(wp.x + cam.scale | 0, (wp.y + cam.scale) | 0, wts - cam.scale * 2, cam.scale * 3); }
            const wTint = x < 10
              ? (y < 10 ? 'rgba(255,200,60,' : 'rgba(60,200,80,')
              : (y < 10 ? 'rgba(60,130,255,' : 'rgba(140,60,200,');
            ctx.save(); ctx.globalAlpha = 0.05; ctx.fillStyle = wTint + '1)';
            ctx.fillRect(wp.x | 0, wp.y | 0, wts, wts); ctx.restore();
            // Lichen/mineral deposit: section-biased glowing patch in wall mid-face
            { const lh = ((x * 3803 + y * 2441) ^ 3119) & 0xFFFF;
              // BL section (green) gets 7%, others get 3-4%
              const lthresh = (x < 10 && y < 10) ? 8 : (x >= 10 && y >= 10) ? 10 : (x < 10 && y >= 10) ? 18 : 8;
              if ((lh & 0xFF) < lthresh) {
                const lcs = cam.scale;
                const lx = wp.x + ((lh >> 4 & 0xD) + 2) * lcs;
                const ly = wp.y + ((lh >> 9 & 0x5) + 4) * lcs;
                const lw = (2 + (lh >> 12 & 3)) * lcs;
                const [lCol, lgCol] = x < 10
                  ? (y < 10 ? ['#a0820a', 'rgba(220,180,30,'] : ['#2a8040', 'rgba(50,210,80,'])
                  : (y < 10 ? ['#1860b0', 'rgba(60,140,255,'] : ['#701490', 'rgba(160,50,220,']);
                const lpulse = 0.22 + 0.12 * Math.sin(clock / 1400 + (lh & 0xF) * 0.37);
                const lgr = ctx.createRadialGradient(lx + lw / 2, ly, 0, lx + lw / 2, ly, lcs * 4);
                lgr.addColorStop(0, lgCol + lpulse.toFixed(2) + ')'); lgr.addColorStop(1, 'transparent');
                ctx.fillStyle = lgr; ctx.fillRect((lx - lcs * 3) | 0, (ly - lcs * 3) | 0, lcs * 8, lcs * 7);
                ctx.save(); ctx.globalAlpha = lpulse * 1.2; ctx.fillStyle = lCol;
                ctx.fillRect(lx | 0, ly | 0, lw, lcs); ctx.restore();
              } }
            // Moss patch: ~9% of visible wall bases get a green-grey fringe along the bottom edge
            const mh = ((x * 2111 + y * 4073) ^ 1667) & 0xFFFF;
            if ((mh & 0xFF) < 23) {
              const mw = (4 + (mh >> 4 & 0x7)) * cam.scale;
              const mx0 = wp.x + ((mh >> 8 & 0xF) + 1) * cam.scale;
              const my = wp.y + wts - cam.scale * 2;
              ctx.save(); ctx.globalAlpha = 0.20 + (mh >> 12 & 3) * 0.04;
              ctx.fillStyle = '#4a7a3a'; ctx.fillRect(mx0 | 0, my | 0, mw, cam.scale);
              ctx.globalAlpha *= 0.55; ctx.fillStyle = '#6aaa52';
              ctx.fillRect((mx0 + cam.scale) | 0, (my - cam.scale * 0.5) | 0, mw - cam.scale * 2, cam.scale * 0.5 + 1);
              ctx.restore();
            }
            // Water patina: ~8% of visible wall faces show faint horizontal staining streaks
            { const pah = ((x * 1871 + y * 3209) ^ 1433) & 0xFFFF;
              if ((pah & 0xFF) < 20) {
                const pcs = cam.scale;
                const nstreaks = 1 + (pah >> 12 & 1);
                for (let si = 0; si < nstreaks; si++) {
                  const srow = 2 + ((pah >> (4 + si * 3)) & 0x7);
                  const sx = wp.x + pcs;
                  const sy = wp.y + srow * pcs;
                  const sw = (9 + (pah >> 8 & 5)) * pcs;
                  const spg = ctx.createLinearGradient(sx, sy, sx + sw, sy);
                  spg.addColorStop(0, 'rgba(20,24,40,0)');
                  spg.addColorStop(0.25, 'rgba(20,24,40,0.13)');
                  spg.addColorStop(0.75, 'rgba(20,24,40,0.13)');
                  spg.addColorStop(1, 'rgba(20,24,40,0)');
                  ctx.fillStyle = spg;
                  ctx.fillRect(sx | 0, sy | 0, sw, pcs);
                }
              } }
          }
          // Structural crack: ~5% of visible wall faces get a procedural zigzag fissure
          if (b.floor[y + 1]?.[x]) {
            const crh = ((x * 3137 + y * 2963) ^ 2221) & 0xFFFF;
            if ((crh & 0xFF) < 13) {
              const crwp = worldToScreen(x, y, cam); const cs = cam.scale;
              const crx0 = crwp.x + ((crh >> 4 & 0xB) + 2) * cs;
              const cry0 = crwp.y + ((crh >> 8 & 0x3) + 2) * cs;
              const crsteps = 4 + (crh >> 12 & 3);
              ctx.save(); ctx.globalAlpha = 0.28 + (crh >> 10 & 3) * 0.06; ctx.fillStyle = '#101018';
              let cx2 = crx0, cy2 = cry0;
              for (let ci = 0; ci < crsteps; ci++) {
                const nx = cx2 + ((ci & 1) ? cs : -cs), ny = cy2 + cs;
                ctx.fillRect(nx | 0, ny | 0, cs, cs);
                cx2 = nx; cy2 = ny;
              }
              ctx.restore();
            }
          }
          // Moisture drip: ~8% of visible wall faces get an animated droplet
          if (b.floor[y + 1]?.[x]) {
            const wh = ((x * 1637 + y * 3571) ^ 997) & 0xFFFF;
            if ((wh & 0xFF) < 20) {
              const period = 4000 + (wh & 3) * 1400;
              const phase = ((clock + wh * 19) % period) / period;
              if (phase < 0.72) {
                const wp = worldToScreen(x, y, cam);
                ctx.save(); ctx.globalAlpha = 0.40;
                ctx.fillStyle = (wh & 1) ? '#1a2434' : '#14181e';
                const dripX = wp.x + (((wh >> 3) & 7) + 3) * cam.scale;
                const dripY = wp.y + Math.floor(phase / 0.72 * 13) * cam.scale;
                ctx.fillRect(dripX | 0, dripY | 0, cam.scale, cam.scale);
                ctx.restore();
              }
            }
            // Ember/torch wisps: ~6% of wall faces that don't have drips
            if ((wh & 0xFF) >= 20 && ((wh >> 8) & 0xFF) < 16) {
              const ewp = worldToScreen(x, y, cam);
              const cs = cam.scale;
              const etx = ewp.x + (((wh >> 4) & 0xF) + 1) * cs;
              const ety = ewp.y + 9 * cs;
              // Section-tinted flame: TL=amber, TR=cool-blue, BL=green, BR=violet
              const tcol = x < 10
                ? (y < 10
                  ? { bloom: 'rgba(255,155,45,', wick: '#fff090', f0: '#ffca40', f1: '#ff8820', f2: '#dd3812', cup: '#9a6c28', brk: '#6e4e22' }
                  : { bloom: 'rgba(80,200,60,',  wick: '#c0ff90', f0: '#80e840', f1: '#2da816', f2: '#186010', cup: '#244e1c', brk: '#1e3c18' })
                : (y < 10
                  ? { bloom: 'rgba(80,150,255,', wick: '#d8f0ff', f0: '#a0ccff', f1: '#3880e0', f2: '#1040b0', cup: '#2a4878', brk: '#243858' }
                  : { bloom: 'rgba(160,60,220,', wick: '#f0a0ff', f0: '#c040ff', f1: '#8020c0', f2: '#440060', cup: '#3c1a58', brk: '#2c1440' });
              // Glow bloom behind torch
              const tgr = ctx.createRadialGradient(etx + cs * 0.5, ety, 0, etx + cs * 0.5, ety, cs * 5);
              const tgp = 0.10 + 0.05 * Math.sin(clock / 850 + wh * 0.031);
              tgr.addColorStop(0, tcol.bloom + tgp.toFixed(2) + ')'); tgr.addColorStop(1, 'transparent');
              ctx.fillStyle = tgr;
              ctx.fillRect((etx - cs * 4.5) | 0, (ety - cs * 5) | 0, cs * 10, cs * 9);
              // Torch bracket: vertical stem + horizontal arm
              ctx.fillStyle = tcol.brk;
              ctx.fillRect(etx | 0, ety | 0, cs, cs * 3);
              ctx.fillRect((etx - cs) | 0, (ety + cs) | 0, cs * 2, cs);
              // Torch cup at bracket top
              ctx.save(); ctx.globalAlpha = 0.80; ctx.fillStyle = tcol.cup;
              ctx.fillRect((etx - cs) | 0, (ety - cs) | 0, cs * 3, cs); ctx.restore();
              // Animated flame: persistent wick base + three staggered rising streams
              const eper = 1600 + (wh & 3) * 400;
              const fbw = cs * (1.4 + 0.5 * Math.sin(clock / 190 + wh * 0.72));
              ctx.save(); ctx.globalAlpha = 0.78; ctx.fillStyle = tcol.wick;
              ctx.fillRect((etx + cs * 0.5 - fbw * 0.5) | 0, (ety - cs * 1.6) | 0, fbw, cs * 1.2);
              ctx.restore();
              for (let fi = 0; fi < 3; fi++) {
                const eph = ((clock + wh * 41 + fi * (eper / 3 | 0)) % eper) / eper;
                if (eph >= 0.52) continue;
                const frac = eph / 0.52;
                const fey = ety - cs * 1.4 - frac * cs * (3.2 - fi * 0.5);
                const fea = Math.min(frac * 3.5, (1 - frac) * 2.1) * 0.52;
                const ffw = cs * (1.8 - fi * 0.5);
                ctx.save(); ctx.globalAlpha = fea;
                ctx.fillStyle = fi === 0 ? tcol.f0 : (fi === 1 ? tcol.f1 : tcol.f2);
                ctx.fillRect((etx + cs * 0.5 - ffw * 0.5) | 0, fey | 0, ffw, cs);
                ctx.restore();
              }
            }
          }
          // Void depth: dark center + purple pulse + rising motes + rare spark on pit tiles
          if (!b.floor[y + 1]?.[x]) {
            const vp = worldToScreen(x, y, cam);
            const ts = TILE * cam.scale;
            const vh = ((x * 3571 + y * 1637) ^ 1013) & 0xFFFF;
            const vcx = vp.x + ts * 0.5, vcy = vp.y + ts * 0.5;
            // Deep black center â€” gives the pit actual visual depth
            const vdg = ctx.createRadialGradient(vcx, vcy, 0, vcx, vcy, ts * 0.52);
            vdg.addColorStop(0, 'rgba(0,0,0,0.42)'); vdg.addColorStop(0.5, 'rgba(0,0,0,0.22)'); vdg.addColorStop(1, 'transparent');
            ctx.fillStyle = vdg; ctx.fillRect(vp.x | 0, vp.y | 0, ts, ts);
            // Purple void aura (original pulse)
            const vpulse = 0.05 + 0.03 * Math.sin(clock / (4800 + (vh & 0x7FF)) + vh * 0.009);
            const vgr = ctx.createRadialGradient(vcx, vcy, 0, vcx, vcy, ts * 0.6);
            vgr.addColorStop(0, 'rgba(65,20,120,' + vpulse.toFixed(3) + ')'); vgr.addColorStop(1, 'transparent');
            ctx.fillStyle = vgr; ctx.fillRect(vp.x | 0, vp.y | 0, ts, ts);
            // Void motes: 3 tiny purple pixels rising slowly from depth
            const cs = cam.scale;
            for (let vi = 0; vi < 3; vi++) {
              const vmperiod = 3200 + vi * 700 + (vh & 0x3FF);
              const vmphase = ((clock + vi * (vmperiod / 3) + vh * 17) % vmperiod) / vmperiod;
              const vmx = vp.x + (2 + ((vh + vi * 5) & 11)) * cs;
              const vmy = vp.y + ts * (0.85 - vmphase * 0.75);
              const vma = Math.sin(vmphase * Math.PI) * 0.38;
              if (vma < 0.04) continue;
              ctx.save(); ctx.globalAlpha = vma; ctx.fillStyle = vi % 2 === 0 ? '#4a18a0' : '#7030c8';
              ctx.fillRect(vmx | 0, vmy | 0, Math.max(1, cs) | 0, Math.max(1, cs) | 0);
              ctx.restore();
            }
            // Rare brief spark
            const vperiod = 7000 + (vh & 0x1FFF);
            const vphase = ((clock + vh * 23) % vperiod) / vperiod;
            if (vphase < 0.012) {
              ctx.save(); ctx.globalAlpha = Math.sin(vphase / 0.012 * Math.PI) * 0.55; ctx.fillStyle = '#3520a8';
              ctx.fillRect((vp.x + ((vh & 0xF) + 1) * cam.scale) | 0, (vp.y + ((vh >> 4 & 0xF) + 1) * cam.scale) | 0, cam.scale, cam.scale);
              ctx.restore();
            }
          }
          continue;
        }
        blitTile(`tile.${floors[(x * 7 + y * 13) % floors.length]}`, x, y);
        { const fp = worldToScreen(x, y, cam); const ts = TILE * cam.scale;
          // Section color temperature: each quadrant gets a faint ambient tint for character
          { const secTint = x < 10
              ? (y < 10 ? 'rgba(255,200,60,' : 'rgba(60,200,80,')
              : (y < 10 ? 'rgba(60,130,255,' : 'rgba(140,60,200,');
            ctx.save(); ctx.globalAlpha = 0.035; ctx.fillStyle = secTint + '1)';
            ctx.fillRect(fp.x | 0, fp.y | 0, ts, ts); ctx.restore(); }
          // Seam-blend: tiles at the section boundary (x=9..10, y=9..10) get a faint cross-section color bleed
          if (x === 9 || x === 10) {
            const fromRight = x === 9;
            const blendCol = fromRight ? (y < 10 ? 'rgba(60,130,255,' : 'rgba(140,60,200,') : (y < 10 ? 'rgba(255,200,60,' : 'rgba(60,200,80,');
            const sg = ctx.createLinearGradient(fromRight ? fp.x + ts : fp.x, fp.y, fromRight ? fp.x : fp.x + ts, fp.y);
            sg.addColorStop(0, blendCol + '0.05)'); sg.addColorStop(1, blendCol + '0)');
            ctx.fillStyle = sg; ctx.fillRect(fp.x | 0, fp.y | 0, ts, ts);
          }
          if (y === 9 || y === 10) {
            const fromBottom = y === 9;
            const blendCol = fromBottom ? (x < 10 ? 'rgba(60,200,80,' : 'rgba(140,60,200,') : (x < 10 ? 'rgba(255,200,60,' : 'rgba(60,130,255,');
            const sg = ctx.createLinearGradient(fp.x, fromBottom ? fp.y + ts : fp.y, fp.x, fromBottom ? fp.y : fp.y + ts);
            sg.addColorStop(0, blendCol + '0.05)'); sg.addColorStop(1, blendCol + '0)');
            ctx.fillStyle = sg; ctx.fillRect(fp.x | 0, fp.y | 0, ts, ts);
          }
          // Wall overhang shadow: floor tiles directly beneath a wall get a top-edge drop shadow
          if (!b.floor[y - 1]?.[x]) {
            const sg = ctx.createLinearGradient(fp.x, fp.y, fp.x, fp.y + cam.scale * 3.5);
            sg.addColorStop(0, 'rgba(0,0,0,0.36)');
            sg.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = sg;
            ctx.fillRect(fp.x | 0, fp.y | 0, ts, cam.scale * 3.5);
          }
          // Side-wall shadow: floor tiles adjacent to a wall get a lateral shadow
          if (!b.floor[y]?.[x - 1]) {
            const sl = ctx.createLinearGradient(fp.x, fp.y, fp.x + cam.scale * 3, fp.y);
            sl.addColorStop(0, 'rgba(0,0,0,0.20)'); sl.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = sl; ctx.fillRect(fp.x | 0, fp.y | 0, cam.scale * 3, ts);
          }
          if (!b.floor[y]?.[x + 1]) {
            const sr = ctx.createLinearGradient(fp.x + ts - cam.scale * 3, fp.y, fp.x + ts, fp.y);
            sr.addColorStop(0, 'rgba(0,0,0,0)'); sr.addColorStop(1, 'rgba(0,0,0,0.20)');
            ctx.fillStyle = sr; ctx.fillRect((fp.x + ts - cam.scale * 3) | 0, fp.y | 0, cam.scale * 3, ts);
          }
          // Interior-corner AO: extra darkening where two perpendicular walls meet
          { const wallL = !b.floor[y]?.[x - 1], wallR = !b.floor[y]?.[x + 1];
            const wallT = !b.floor[y - 1]?.[x];
            const cr = cam.scale * 4;
            if (wallT && wallL) {
              const cg = ctx.createRadialGradient(fp.x, fp.y, 0, fp.x, fp.y, cr);
              cg.addColorStop(0, 'rgba(0,0,0,0.28)'); cg.addColorStop(1, 'rgba(0,0,0,0)');
              ctx.fillStyle = cg; ctx.fillRect(fp.x | 0, fp.y | 0, cr, cr);
            }
            if (wallT && wallR) {
              const cg = ctx.createRadialGradient(fp.x + ts, fp.y, 0, fp.x + ts, fp.y, cr);
              cg.addColorStop(0, 'rgba(0,0,0,0.28)'); cg.addColorStop(1, 'rgba(0,0,0,0)');
              ctx.fillStyle = cg; ctx.fillRect((fp.x + ts - cr) | 0, fp.y | 0, cr, cr);
            } }
          // Wall moisture drip: ~4% of floor tiles beneath walls get an animated droplet
          if (!b.floor[y - 1]?.[x]) {
            const dh = ((x * 1979 + y * 3761) ^ 1553) & 0xFFFF;
            if ((dh & 0xFF) < 10) {
              const dperiod = 6000 + (dh >> 4 & 0x1FFF);
              const dphase = ((clock + dh * 41) % dperiod) / dperiod;
              const dx = fp.x + ((dh >> 8 & 0xF) + 1) * cam.scale;
              const dy = fp.y + dphase * ts * 1.1;
              const da = Math.sin(dphase * Math.PI) * 0.55;
              if (da > 0.04 && dy < fp.y + ts) {
                ctx.save(); ctx.globalAlpha = da; ctx.fillStyle = '#8ab8d8';
                ctx.fillRect(dx | 0, dy | 0, cam.scale, cam.scale * (1.5 + dphase * 0.5));
                ctx.restore();
              }
              // Splash ring when drop hits floor edge
              if (dphase > 0.88) {
                const sp = (dphase - 0.88) / 0.12;
                ctx.save(); ctx.globalAlpha = (1 - sp) * 0.38;
                ctx.strokeStyle = '#6098b8'; ctx.lineWidth = Math.max(0.5, cam.scale * 0.4);
                ctx.beginPath(); ctx.ellipse(dx | 0, (fp.y + ts * 0.98) | 0, cam.scale * (1 + sp * 2), cam.scale * 0.5, 0, 0, Math.PI * 2);
                ctx.stroke(); ctx.restore();
              }
            }
          }
          // Torch-light pool: if the wall directly above this floor tile has a torch,
          // spill a section-tinted glow onto the top of this tile
          if (!b.floor[y - 1]?.[x]) {
            const twh = ((x * 1637 + (y - 1) * 3571) ^ 997) & 0xFFFF;
            if ((twh & 0xFF) >= 20 && ((twh >> 8) & 0xFF) < 16) {
              const cs = cam.scale;
              const tcx = fp.x + (((twh >> 4) & 0xF) + 1.5) * cs;
              const tcy = fp.y + ts * 0.15;
              const tgp = 0.14 + 0.07 * Math.sin(clock / 850 + twh * 0.031);
              const tspill = x < 10
                ? ((y - 1) < 10 ? 'rgba(255,160,40,' : 'rgba(80,200,60,')
                : ((y - 1) < 10 ? 'rgba(80,150,255,' : 'rgba(160,60,220,');
              const tgr = ctx.createRadialGradient(tcx, tcy, 0, tcx, tcy, cs * 5.5);
              tgr.addColorStop(0, tspill + tgp.toFixed(2) + ')');
              tgr.addColorStop(1, 'transparent');
              ctx.fillStyle = tgr;
              ctx.fillRect((tcx - cs * 5.5) | 0, fp.y | 0, cs * 11, ts);
            }
          }
          // Extended torch falloff: dim glow from torches 1-2 tiles away
          { const cs = cam.scale;
            // Two tiles above: torch at (x, y-2), light passes through floor at (x, y-1)
            if (!b.floor[y - 2]?.[x] && b.floor[y - 1]?.[x]) {
              const t2h = ((x * 1637 + (y - 2) * 3571) ^ 997) & 0xFFFF;
              if ((t2h & 0xFF) >= 20 && ((t2h >> 8) & 0xFF) < 16) {
                const tcx = fp.x + (((t2h >> 4) & 0xF) + 1.5) * cs;
                const tcy = fp.y - ts * 0.5;
                const tgp = (0.07 + 0.035 * Math.sin(clock / 850 + t2h * 0.031)).toFixed(3);
                const tspill = x < 10
                  ? ((y - 2) < 10 ? 'rgba(255,160,40,' : 'rgba(80,200,60,')
                  : ((y - 2) < 10 ? 'rgba(80,150,255,' : 'rgba(160,60,220,');
                const tgr = ctx.createRadialGradient(tcx, tcy, 0, tcx, tcy, cs * 7);
                tgr.addColorStop(0, tspill + tgp + ')'); tgr.addColorStop(1, 'transparent');
                ctx.fillStyle = tgr; ctx.fillRect((tcx - cs * 7) | 0, fp.y | 0, cs * 14, ts);
              }
            }
            // Lateral: torch at (x-1, y-1) or (x+1, y-1) spills sideways onto this tile
            for (const dx of [-1, 1]) {
              if (!b.floor[y - 1]?.[x + dx]) {
                const lth = (((x + dx) * 1637 + (y - 1) * 3571) ^ 997) & 0xFFFF;
                if ((lth & 0xFF) >= 20 && ((lth >> 8) & 0xFF) < 16) {
                  const ltx = fp.x + (dx < 0 ? 0 : ts);
                  const lty = fp.y + ts * 0.1;
                  const lgp = (0.06 + 0.03 * Math.sin(clock / 850 + lth * 0.031)).toFixed(3);
                  const ltspill = (x + dx) < 10
                    ? ((y - 1) < 10 ? 'rgba(255,160,40,' : 'rgba(80,200,60,')
                    : ((y - 1) < 10 ? 'rgba(80,150,255,' : 'rgba(160,60,220,');
                  const lgr = ctx.createRadialGradient(ltx, lty, 0, ltx, lty, cs * 6);
                  lgr.addColorStop(0, ltspill + lgp + ')'); lgr.addColorStop(1, 'transparent');
                  ctx.fillStyle = lgr; ctx.fillRect(fp.x | 0, fp.y | 0, ts, ts);
                }
              }
            }
          }
          // Puddle: ~12% of floor tiles get a reflective wet shimmer
          const ph = ((x * 1637 + y * 3571) ^ 997) & 0xFFFF;
          if ((ph & 0xFF) < 30) {
            const pw = 0.12 + 0.08 * Math.sin(clock / 1600 + ph * 0.009);
            const px = fp.x + ts * 0.18, py = fp.y + ts * 0.56;
            const pw2 = ts * 0.64, ph2 = ts * 0.26;
            const pcx = px + pw2 * 0.45, pcy = py + ph2 * 0.4;
            const pg = ctx.createRadialGradient(pcx, pcy, 0, pcx, pcy, pw2 * 0.6);
            pg.addColorStop(0, '#a8c8e8'); pg.addColorStop(0.45, '#5080b8'); pg.addColorStop(1, '#253060');
            ctx.save(); ctx.globalAlpha = pw;
            ctx.fillStyle = pg; ctx.fillRect(px | 0, py | 0, pw2, ph2);
            // Animated specular streak drifting across the puddle
            const specT = ((clock * 0.00025 + ph * 0.00171) % 1);
            const specX = px + pw2 * (0.06 + specT * 0.72);
            const sg = ctx.createLinearGradient(specX - ts * 0.07, 0, specX + ts * 0.07, 0);
            sg.addColorStop(0, 'transparent'); sg.addColorStop(0.5, 'rgba(210,240,255,0.62)'); sg.addColorStop(1, 'transparent');
            ctx.fillStyle = sg; ctx.fillRect(px | 0, py | 0, pw2, ph2);
            // Torch reflection: puddles below a torch wall pick up a section-tinted shimmer
            if (!b.floor[y - 1]?.[x]) {
              const twh = ((x * 1637 + (y - 1) * 3571) ^ 997) & 0xFFFF;
              if ((twh & 0xFF) >= 20 && ((twh >> 8) & 0xFF) < 16) {
                const tflicker = 0.5 + 0.5 * Math.sin(clock / 850 + twh * 0.031);
                const warmX = px + pw2 * (0.3 + 0.2 * Math.sin(clock / 1400 + twh * 0.019));
                const wsg = ctx.createLinearGradient(warmX - ts * 0.10, 0, warmX + ts * 0.10, 0);
                const reflCol = x < 10
                  ? ((y - 1) < 10 ? 'rgba(255,160,40,' : 'rgba(80,200,60,')
                  : ((y - 1) < 10 ? 'rgba(80,150,255,' : 'rgba(160,60,220,');
                wsg.addColorStop(0, 'transparent');
                wsg.addColorStop(0.5, reflCol + (tflicker * 0.42).toFixed(2) + ')');
                wsg.addColorStop(1, 'transparent');
                ctx.fillStyle = wsg; ctx.fillRect(px | 0, py | 0, pw2, ph2);
              }
            }
            // Section ambient reflection: puddle surface takes on faint section color cast
            { const secTint = x < 10
                ? (y < 10 ? 'rgba(255,170,50,' : 'rgba(50,210,90,')
                : (y < 10 ? 'rgba(80,150,255,' : 'rgba(180,80,240,');
              ctx.save(); ctx.globalAlpha = 0.07; ctx.fillStyle = secTint + '1)';
              ctx.fillRect(px | 0, py | 0, pw2, ph2); ctx.restore(); }
            ctx.restore();
            // Ripple ring: periodic water-drop concentric ring expanding from puddle center
            { const ripPeriod = 5200 + (ph & 0xFFF);
              const ripPhase = ((clock + ph * 23) % ripPeriod) / ripPeriod;
              if (ripPhase < 0.38) {
                const rp = ripPhase / 0.38;
                const rcx = px + pw2 * 0.45, rcy = py + ph2 * 0.40;
                ctx.save(); ctx.globalAlpha = Math.sin(rp * Math.PI) * 0.45;
                ctx.strokeStyle = '#c8e8ff'; ctx.lineWidth = Math.max(0.5, cam.scale * 0.4);
                ctx.beginPath(); ctx.ellipse(rcx, rcy, pw2 * (0.10 + rp * 0.36), ph2 * (0.14 + rp * 0.30), 0, 0, Math.PI * 2); ctx.stroke();
                ctx.restore();
              } }
          }
          // Scorch mark: ~3% of floor tiles get a subtle dark radial burn
          { const sh = ((x * 2237 + y * 4507) ^ 1319) & 0xFFFF;
            if ((sh & 0xFF) < 8) {
              const smcx = fp.x + (4 + (sh & 7)) * cam.scale;
              const smcy = fp.y + (4 + ((sh >> 8) & 7)) * cam.scale;
              const smr = (4 + (sh & 3)) * cam.scale;
              const smg = ctx.createRadialGradient(smcx, smcy, 0, smcx, smcy, smr);
              smg.addColorStop(0, 'rgba(22,18,10,0.30)');
              smg.addColorStop(1, 'transparent');
              ctx.fillStyle = smg;
              ctx.fillRect(smcx - smr, smcy - smr, smr * 2, smr * 2);
            } }
          // Blood stain: ~5% of floor tiles bear a dried reddish-brown battle scar
          { const bsh = ((x * 3719 + y * 2011) ^ 1777) & 0xFFFF;
            if ((bsh & 0xFF) < 12) {
              const bcs = cam.scale;
              const bcx = fp.x + (3 + (bsh >> 4 & 0x9)) * bcs;
              const bcy = fp.y + (4 + (bsh >> 9 & 0x7)) * bcs;
              const br = (3.5 + (bsh & 3)) * bcs;
              ctx.save(); ctx.globalAlpha = 0.30 + ((bsh >> 8) & 3) * 0.04;
              const bsg = ctx.createRadialGradient(bcx, bcy, 0, bcx, bcy, br);
              bsg.addColorStop(0, '#4a1818'); bsg.addColorStop(0.55, '#3a1010'); bsg.addColorStop(1, 'transparent');
              ctx.fillStyle = bsg; ctx.fillRect((bcx - br) | 0, (bcy - br) | 0, br * 2 | 0, br * 2 | 0);
              // Two satellite splotches for an irregular splash pattern
              for (let bi = 0; bi < 2; bi++) {
                const bsx = bcx + (((bsh >> (2 + bi * 5)) & 0xF) - 7) * bcs * 0.55;
                const bsy = bcy + (((bsh >> (6 + bi * 5)) & 0xF) - 7) * bcs * 0.55;
                const bsr = (1.4 + bi) * bcs;
                const bsg2 = ctx.createRadialGradient(bsx, bsy, 0, bsx, bsy, bsr);
                bsg2.addColorStop(0, '#4a1818'); bsg2.addColorStop(1, 'transparent');
                ctx.globalAlpha = 0.18 + bi * 0.06;
                ctx.fillStyle = bsg2; ctx.fillRect((bsx - bsr) | 0, (bsy - bsr) | 0, bsr * 2 | 0, bsr * 2 | 0);
              }
              ctx.restore();
            } }
          // Hairline crack: ~5% of floor tiles get a 3-5 pixel diagonal scratch
          if (((ph >> 8) & 0xFF) < 13) {
            const cs = cam.scale;
            const cx0 = fp.x + (2 + (ph >> 4 & 7)) * cs;
            const cy0 = fp.y + (3 + (ph >> 12 & 5)) * cs;
            const clen = 3 + (ph & 3);
            ctx.save(); ctx.globalAlpha = 0.22; ctx.fillStyle = '#101018';
            for (let ci = 0; ci < clen; ci++) {
              ctx.fillRect((cx0 + ci * cs) | 0, (cy0 + ci * cs) | 0, cs, cs);
            }
            ctx.restore();
            // ~1% of floor tiles: crack glows with a faint section-tinted inner light
            if (((ph >> 8) & 0xFF) < 3) {
              const gcol = x < 10
                ? (y < 10 ? 'rgba(220,110,40,' : 'rgba(40,200,80,')
                : (y < 10 ? 'rgba(60,120,255,' : 'rgba(160,40,220,');
              const gphase = 0.06 + 0.04 * Math.sin(clock / 3200 + (ph & 0xF) * 0.28);
              const gcx = (cx0 + cs * (clen >> 1)) | 0;
              const gcy = (cy0 + cs * (clen >> 1)) | 0;
              const cgr = ctx.createRadialGradient(gcx, gcy, 0, gcx, gcy, cs * 3.5);
              cgr.addColorStop(0, gcol + gphase.toFixed(3) + ')');
              cgr.addColorStop(1, 'transparent');
              ctx.fillStyle = cgr;
              ctx.fillRect(gcx - cs * 3.5, gcy - cs * 3.5, cs * 7, cs * 7);
            }
          }
          // Cobweb: floor tiles in concave wall corners get faint grey diagonal strands
          { const wallL = !b.floor[y]?.[x - 1], wallR = !b.floor[y]?.[x + 1];
            const wallT = !b.floor[y - 1]?.[x];
            const wallTL = !b.floor[y - 1]?.[x - 1], wallTR = !b.floor[y - 1]?.[x + 1];
            const cs = cam.scale;
            if (wallL && wallTL) {
              const wh = ((x * 4231 + y * 3079) ^ 2503) & 0xFF;
              if (wh < 90) {
                ctx.save(); ctx.globalAlpha = 0.08 + (wh & 0xF) * 0.004;
                ctx.strokeStyle = '#9090a8'; ctx.lineWidth = 0.7;
                ctx.beginPath();
                ctx.moveTo(fp.x, fp.y); ctx.lineTo(fp.x + cs * 4, fp.y + cs * 4);
                ctx.moveTo(fp.x, fp.y + cs); ctx.lineTo(fp.x + cs * 3, fp.y + cs * 4);
                ctx.moveTo(fp.x + cs, fp.y); ctx.lineTo(fp.x + cs * 4, fp.y + cs * 3);
                ctx.stroke(); ctx.restore();
              }
            }
            if (wallR && wallTR) {
              const wh = ((x * 3947 + y * 4421) ^ 2917) & 0xFF;
              if (wh < 90) {
                ctx.save(); ctx.globalAlpha = 0.08 + (wh & 0xF) * 0.004;
                ctx.strokeStyle = '#9090a8'; ctx.lineWidth = 0.7;
                ctx.beginPath();
                ctx.moveTo(fp.x + ts, fp.y); ctx.lineTo(fp.x + ts - cs * 4, fp.y + cs * 4);
                ctx.moveTo(fp.x + ts, fp.y + cs); ctx.lineTo(fp.x + ts - cs * 3, fp.y + cs * 4);
                ctx.moveTo(fp.x + ts - cs, fp.y); ctx.lineTo(fp.x + ts - cs * 4, fp.y + cs * 3);
                ctx.stroke(); ctx.restore();
              }
            } }
          // Glowing mushroom: ~3% of floor tiles get a tiny bioluminescent speck
          { const gmh = ((x * 4603 + y * 1193) ^ 2819) & 0xFFFF;
            if ((gmh & 0xFF) < 8) {
              const gmc = cam.scale;
              const gmx = (fp.x + (2 + (gmh >> 4 & 0xD)) * gmc) | 0;
              const gmy = (fp.y + (3 + (gmh >> 9 & 0x9)) * gmc) | 0;
              const gmCol = x < 10
                ? (y < 10 ? '#ffb040' : '#40e870')
                : (y < 10 ? '#60b0ff' : '#c060ff');
              const gmpulse = 0.35 + 0.25 * Math.sin(clock / 1100 + (gmh & 0xF) * 0.4);
              const gmg = ctx.createRadialGradient(gmx, gmy, 0, gmx, gmy, gmc * 3);
              gmg.addColorStop(0, gmCol); gmg.addColorStop(0.4, gmCol); gmg.addColorStop(1, 'transparent');
              ctx.save(); ctx.globalAlpha = gmpulse * 0.55; ctx.fillStyle = gmg;
              ctx.fillRect(gmx - gmc * 3, gmy - gmc * 3, gmc * 6, gmc * 6);
              ctx.globalAlpha = gmpulse * 0.90; ctx.fillStyle = '#ffffff';
              ctx.fillRect(gmx, gmy, Math.max(1, gmc * 0.5), Math.max(1, gmc * 0.5));
              ctx.restore();
            } }
          // Floor vent: ~1.5% of floor tiles show a dark iron grate with heat shimmer
          { const vth = ((x * 5003 + y * 3691) ^ 4127) & 0xFFFF;
            if ((vth & 0xFF) < 4) {
              const vcs = cam.scale;
              const vtx = (fp.x + (1 + (vth >> 4 & 5)) * vcs) | 0;
              const vty = (fp.y + (2 + (vth >> 9 & 5)) * vcs) | 0;
              const vtw = (7 + (vth >> 12 & 3)) * vcs;
              // Dark grate background
              ctx.save(); ctx.globalAlpha = 0.38; ctx.fillStyle = '#0a0a10';
              ctx.fillRect(vtx, vty, vtw, vtw); ctx.restore();
              // Grate bars: 3 horizontal + 3 vertical lines
              ctx.save(); ctx.globalAlpha = 0.55; ctx.strokeStyle = '#1a1a28'; ctx.lineWidth = Math.max(0.5, vcs * 0.4);
              for (let gi = 1; gi <= 2; gi++) {
                ctx.beginPath();
                ctx.moveTo(vtx, vty + vtw * gi / 3); ctx.lineTo(vtx + vtw, vty + vtw * gi / 3);
                ctx.moveTo(vtx + vtw * gi / 3, vty); ctx.lineTo(vtx + vtw * gi / 3, vty + vtw);
                ctx.stroke();
              }
              ctx.restore();
              // Rising heat shimmer: 2 animated motes
              for (let vi = 0; vi < 2; vi++) {
                const vperiod = 2200 + vi * 340;
                const vphase = ((clock + vth * 17 + vi * (vperiod >> 1)) % vperiod) / vperiod;
                const vhx = vtx + vtw * (0.25 + vi * 0.5) + Math.sin(vphase * Math.PI * 4) * vcs;
                const vhy = vty + vtw * (0.85 - vphase * 1.2);
                const vha = Math.sin(vphase * Math.PI) * 0.28;
                if (vha > 0.04 && vhy > fp.y) {
                  ctx.save(); ctx.globalAlpha = vha; ctx.fillStyle = '#d09060';
                  ctx.fillRect(vhx | 0, vhy | 0, vcs, vcs); ctx.restore();
                }
              }
            } }
          // Bone fragment: ~2% of floor tiles bear a faint cross-shaped battle relic
          { const bfh = ((x * 3107 + y * 2477) ^ 1847) & 0xFFFF;
            if ((bfh & 0xFF) < 5) {
              const bcs = cam.scale;
              const bfx = (fp.x + (4 + (bfh >> 4 & 7)) * bcs) | 0;
              const bfy = (fp.y + (4 + (bfh >> 9 & 5)) * bcs) | 0;
              ctx.save(); ctx.globalAlpha = 0.15 + 0.05 * ((bfh >> 12) & 3);
              ctx.fillStyle = '#8a7060';
              ctx.fillRect(bfx, bfy - bcs, bcs, bcs * 3);
              ctx.fillRect(bfx - bcs, bfy, bcs * 3, bcs);
              ctx.restore();
            } }
          ctx.fillStyle = 'rgba(0,0,0,0.22)';
          ctx.fillRect(fp.x, fp.y + ts - 1, ts, 1);
          ctx.fillRect(fp.x + ts - 1, fp.y, 1, ts - 1);
          // Top-left bevel: faint highlight completes the raised-tile depth bevel
          ctx.fillStyle = 'rgba(220,228,255,0.06)';
          ctx.fillRect(fp.x, fp.y, ts, 1);
          ctx.fillRect(fp.x, fp.y, 1, ts);
          const vd = 6 * cam.scale;
          if (y > 0 && !b.floor[y - 1]?.[x]) {
            // Gradient wall-face shadow: stronger and smoother than flat strip
            const wsd = 10 * cam.scale;
            const wsg = ctx.createLinearGradient(0, fp.y, 0, fp.y + wsd);
            wsg.addColorStop(0, 'rgba(0,0,0,0.62)');
            wsg.addColorStop(0.55, 'rgba(0,0,0,0.18)');
            wsg.addColorStop(1, 'transparent');
            ctx.fillStyle = wsg;
            ctx.fillRect(fp.x, fp.y, ts, wsd);
          }
          // Side & bottom edge AO: gradient to match top wall shadow style
          if (!b.floor[y + 1]?.[x]) {
            const bsg = ctx.createLinearGradient(0, fp.y + ts - vd, 0, fp.y + ts);
            bsg.addColorStop(0, 'transparent'); bsg.addColorStop(1, 'rgba(0,0,0,0.45)');
            ctx.fillStyle = bsg; ctx.fillRect(fp.x, fp.y + ts - vd, ts, vd);
          }
          if (!b.floor[y]?.[x + 1]) {
            const rsg = ctx.createLinearGradient(fp.x + ts - vd, 0, fp.x + ts, 0);
            rsg.addColorStop(0, 'transparent'); rsg.addColorStop(1, 'rgba(0,0,0,0.45)');
            ctx.fillStyle = rsg; ctx.fillRect(fp.x + ts - vd, fp.y, vd, ts);
          }
          if (!b.floor[y]?.[x - 1]) {
            const lsg = ctx.createLinearGradient(fp.x, 0, fp.x + vd, 0);
            lsg.addColorStop(0, 'rgba(0,0,0,0.45)'); lsg.addColorStop(1, 'transparent');
            ctx.fillStyle = lsg; ctx.fillRect(fp.x, fp.y, vd, ts);
          }
          // Concave-corner AO: radial darkening where two perpendicular walls meet at a floor corner
          { if (!b.floor[y - 1]?.[x] && !b.floor[y]?.[x - 1]) {
              const cgr = ctx.createRadialGradient(fp.x, fp.y, 0, fp.x, fp.y, ts * 0.48);
              cgr.addColorStop(0, 'rgba(0,0,0,0.26)'); cgr.addColorStop(1, 'transparent');
              ctx.fillStyle = cgr; ctx.fillRect(fp.x, fp.y, ts * 0.48, ts * 0.48);
            }
            if (!b.floor[y - 1]?.[x] && !b.floor[y]?.[x + 1]) {
              const cgr = ctx.createRadialGradient(fp.x + ts, fp.y, 0, fp.x + ts, fp.y, ts * 0.48);
              cgr.addColorStop(0, 'rgba(0,0,0,0.26)'); cgr.addColorStop(1, 'transparent');
              ctx.fillStyle = cgr; ctx.fillRect(fp.x + ts * 0.52, fp.y, ts * 0.48, ts * 0.48);
            } }
          // Pit-edge rim: 1-px bright highlight distinguishes floor-void border from floor-wall border
          { const rw = Math.max(1, cam.scale); const ra = 0.22;
            if (!b.floor[y]?.[x + 1] && !b.floor[y + 1]?.[x + 1]) {
              ctx.save(); ctx.globalAlpha = ra; ctx.fillStyle = '#9ab8cc';
              ctx.fillRect((fp.x + ts - rw) | 0, fp.y | 0, rw, ts); ctx.restore();
            }
            if (!b.floor[y]?.[x - 1] && !b.floor[y + 1]?.[x - 1]) {
              ctx.save(); ctx.globalAlpha = ra; ctx.fillStyle = '#9ab8cc';
              ctx.fillRect(fp.x | 0, fp.y | 0, rw, ts); ctx.restore();
            }
            if (!b.floor[y + 1]?.[x] && !b.floor[y + 2]?.[x]) {
              ctx.save(); ctx.globalAlpha = ra; ctx.fillStyle = '#9ab8cc';
              ctx.fillRect(fp.x | 0, (fp.y + ts - rw) | 0, ts, rw); ctx.restore();
            } }
          // Section seam groove: faint darkening where the four 10Ã—10 quadrants meet
          const sgw = 5 * cam.scale;
          if (x === 9 && b.floor[y]?.[x + 1]) {
            const sg = ctx.createLinearGradient(fp.x + ts - sgw, 0, fp.x + ts, 0);
            sg.addColorStop(0, 'transparent'); sg.addColorStop(1, 'rgba(0,0,0,0.28)');
            ctx.fillStyle = sg; ctx.fillRect(fp.x + ts - sgw, fp.y, sgw, ts);
          }
          if (x === 10 && b.floor[y]?.[x - 1]) {
            const sg = ctx.createLinearGradient(fp.x, 0, fp.x + sgw, 0);
            sg.addColorStop(0, 'rgba(0,0,0,0.28)'); sg.addColorStop(1, 'transparent');
            ctx.fillStyle = sg; ctx.fillRect(fp.x, fp.y, sgw, ts);
          }
          if (y === 9 && b.floor[y + 1]?.[x]) {
            const sg = ctx.createLinearGradient(0, fp.y + ts - sgw, 0, fp.y + ts);
            sg.addColorStop(0, 'transparent'); sg.addColorStop(1, 'rgba(0,0,0,0.28)');
            ctx.fillStyle = sg; ctx.fillRect(fp.x, fp.y + ts - sgw, ts, sgw);
          }
          if (y === 10 && b.floor[y - 1]?.[x]) {
            const sg = ctx.createLinearGradient(0, fp.y, 0, fp.y + sgw);
            sg.addColorStop(0, 'rgba(0,0,0,0.28)'); sg.addColorStop(1, 'transparent');
            ctx.fillStyle = sg; ctx.fillRect(fp.x, fp.y, ts, sgw);
          }
          // Corridor portal shimmer: tiles straddling a section seam glow softly (wayfinding)
          { const isPortal = (x === 9 && b.floor[y]?.[x + 1]) || (x === 10 && b.floor[y]?.[x - 1]) ||
              (y === 9 && b.floor[y + 1]?.[x]) || (y === 10 && b.floor[y - 1]?.[x]);
            if (isPortal) {
              const pa = 0.055 + 0.030 * Math.sin(clock / 2600);
              const pcx = fp.x + ts * 0.5, pcy = fp.y + ts * 0.5;
              const pgr = ctx.createRadialGradient(pcx, pcy, 0, pcx, pcy, ts * 0.85);
              pgr.addColorStop(0, 'rgba(200,215,255,' + pa.toFixed(3) + ')');
              pgr.addColorStop(1, 'transparent');
              ctx.fillStyle = pgr; ctx.fillRect(fp.x | 0, fp.y | 0, ts, ts);
            } }
        }
      }
    }
    // Ambient dust motes: 1-in-5 floor tiles get a gently drifting speck
    ctx.save(); ctx.fillStyle = '#c8d0e8';
    for (let my = y0; my <= y1; my++) {
      for (let mx = x0; mx <= x1; mx++) {
        if (!b.floor[my]?.[mx]) continue;
        const mh = ((mx * 2341 + my * 1013) ^ 571) & 0xFFFF;
        if (mh % 5 !== 0) continue;
        const period = 7600 + (mh & 0x7FF);
        const motePh = ((clock + mh * 23) % period) / period;
        const mp = worldToScreen(mx + 0.5 + Math.sin(motePh * Math.PI * 2) * 0.38,
          my + 0.38 + Math.cos(motePh * Math.PI * 1.5) * 0.28, cam);
        ctx.globalAlpha = Math.max(0, 0.04 + 0.04 * Math.sin(motePh * Math.PI * 2.7 + mh * 0.012));
        ctx.fillRect(mp.x | 0, mp.y | 0, cam.scale, cam.scale);
      }
    }
    ctx.restore();
    // Mineral gleam: 1-in-20 floor tiles briefly shine white â€” quartz embedded in stone
    for (let sy = y0; sy <= y1; sy++) {
      for (let sx = x0; sx <= x1; sx++) {
        if (!b.floor[sy]?.[sx]) continue;
        const sh = ((sx * 3571 + sy * 2341) ^ 1337) & 0xFFFF;
        if (sh % 20 !== 0) continue;
        const speriod = 9000 + (sh & 0x1FFF);
        const sphase = ((clock + sh * 37) % speriod) / speriod;
        if (sphase > 0.014) continue;
        const sa = Math.sin(sphase / 0.014 * Math.PI) * 0.70;
        const soffx = ((sh & 0xF) + 1) * cam.scale;
        const soffy = ((sh >> 4 & 0xF) + 1) * cam.scale;
        const sp = worldToScreen(sx, sy, cam);
        ctx.save(); ctx.globalAlpha = sa; ctx.fillStyle = '#f8faff';
        ctx.fillRect((sp.x + soffx) | 0, (sp.y + soffy) | 0, cam.scale, cam.scale);
        ctx.restore();
      }
    }
    if (b.exit) {
      blitTile('tile.exit', b.exit.x, b.exit.y);
      const ep = worldToScreen(b.exit.x, b.exit.y, cam);
      const es = TILE * cam.scale;
      const ecx = ep.x + es / 2, ecy = ep.y + es / 2;
      const targetActive = state.hunters?.some((h) => h.hasTarget) ?? false;
      const pulse = 0.4 + 0.6 * Math.sin(clock / 700);
      // Ambient portal light spills onto surrounding floor tiles
      const eg = ctx.createRadialGradient(ecx, ecy, 0, ecx, ecy, es * 2.2);
      eg.addColorStop(0, 'rgba(126,232,160,0.55)');
      eg.addColorStop(0.32, 'rgba(126,232,160,0.20)');
      eg.addColorStop(1, 'rgba(126,232,160,0.0)');
      ctx.save(); ctx.globalAlpha = pulse; ctx.fillStyle = eg;
      ctx.fillRect(ep.x - es, ep.y - es, es * 3, es * 3); ctx.restore();
      // Outer pulsing ring (phase offset from inner bloom)
      const ringPulse = 0.3 + 0.7 * Math.sin(clock / 700 + 1.1);
      ctx.save(); ctx.globalAlpha = ringPulse * 0.42;
      ctx.strokeStyle = '#7ee8a0'; ctx.lineWidth = cam.scale;
      ctx.strokeRect(ep.x + cam.scale, ep.y + cam.scale, es - 2 * cam.scale, es - 2 * cam.scale);
      ctx.restore();
      // Gold urgent glow when someone holds the Target â€” "finish line is live"
      if (targetActive) {
        const urgPulse = 0.5 + 0.5 * Math.sin(clock / 380);
        const ug = ctx.createRadialGradient(ecx, ecy, 0, ecx, ecy, es * 0.9);
        ug.addColorStop(0, 'rgba(220,190,50,0.32)'); ug.addColorStop(1, 'transparent');
        ctx.save(); ctx.globalAlpha = urgPulse; ctx.fillStyle = ug;
        ctx.fillRect(ep.x - es * 0.1, ep.y - es * 0.1, es * 1.2, es * 1.2); ctx.restore();
        ctx.save(); ctx.globalAlpha = urgPulse * 0.65;
        ctx.strokeStyle = '#ffe98a'; ctx.lineWidth = cam.scale * 0.5;
        ctx.strokeRect(ep.x + cam.scale * 0.5, ep.y + cam.scale * 0.5, es - cam.scale, es - cam.scale);
        ctx.restore();
      }
      // Rising mist: 6 particles float upward from portal center
      const mistColor = targetActive ? 'rgba(255,230,120,' : 'rgba(126,232,160,';
      for (let j = 0; j < 6; j++) {
        const mperiod = 2200 + j * 280;
        const mphase = ((clock + j * (mperiod / 6)) % mperiod) / mperiod;
        const mx = ecx + (j - 2.5) * es * 0.12 + Math.sin(mphase * Math.PI * 2.3 + j * 1.1) * es * 0.18;
        const my = ecy + es * 0.1 - mphase * es * 1.6;
        const ma = Math.sin(mphase * Math.PI) * 0.35;
        if (ma < 0.04) continue;
        ctx.save(); ctx.globalAlpha = ma; ctx.fillStyle = mistColor + '1)';
        ctx.fillRect((mx - cam.scale * 0.5) | 0, my | 0, cam.scale, cam.scale * 1.5);
        ctx.restore();
      }
      // Four sparkle particles orbiting the exit â€” cross/star shape
      const orbitColor = targetActive ? '#ffe98a' : '#7ee8a0';
      for (let j = 0; j < 4; j++) {
        const angle = clock / 1100 + j * Math.PI / 2;
        const orx = ecx + Math.cos(angle) * es * 0.48;
        const ory = ecy + Math.sin(angle) * es * 0.28;
        const oa = 0.35 + 0.35 * Math.sin(clock / 480 + j * 1.5);
        const oc = cam.scale;
        ctx.save(); ctx.globalAlpha = oa; ctx.fillStyle = orbitColor;
        ctx.fillRect((orx - oc * 0.3) | 0, (ory - oc) | 0, oc * 0.6, oc * 2);
        ctx.fillRect((orx - oc) | 0, (ory - oc * 0.3) | 0, oc * 2, oc * 0.6);
        ctx.restore();
      }
    }
    // Warm torch-light bloom centered on the active unit
    { const ak = activeKey();
      const ap = ak ? displayPos(ak) : null;
      const lightPos = ap
        ? worldToScreen(ap.x + 0.5, ap.y + 0.5, cam)
        : { x: canvas.width / 2, y: (canvas.height - HUD_H) / 2 };
      const lr = Math.max(canvas.width, canvas.height) * 0.65;
      const flicker = 0.08 + 0.04 * Math.sin(clock / 170) + 0.02 * Math.sin(clock / 73);
      const tg = ctx.createRadialGradient(lightPos.x, lightPos.y, 0, lightPos.x, lightPos.y, lr);
      tg.addColorStop(0, `rgba(255,200,100,${flicker.toFixed(3)})`);
      tg.addColorStop(0.35, `rgba(255,160,60,${(flicker * 0.3).toFixed(3)})`);
      tg.addColorStop(1, 'transparent');
      ctx.fillStyle = tg;
      ctx.fillRect(0, 0, canvas.width, canvas.height - HUD_H); }
    if (state.debug) {
      for (const t of b.traps ?? []) drawTrap(t);
    } else {
      for (const t of b.traps ?? []) if (t.revealed) drawTrap(t);
    }
    for (const box of b.boxes ?? []) {
      const closed = !box.opened || closedBoxes.has(key(box.x, box.y));
      const worn = (((box.x * 1847 + box.y * 3529) ^ 743) & 0xFF) < 100; // ~39% worn
      blitTile(closed ? (worn ? 'tile.boxWorn' : 'tile.boxClosed') : (worn ? 'tile.boxWornOpen' : 'tile.boxOpen'), box.x, box.y);
      if (closed) {
        const bp = worldToScreen(box.x, box.y, cam);
        const pulse = 0.10 + 0.08 * Math.sin(clock / 1100 + box.x * 3.7 + box.y * 2.3);
        // Exposed modifier: teal beacon on the TARGET box
        if (state.targetVisible && !state.targetFound && box.contents === 'TARGET') {
          const ts = TILE * cam.scale;
          const bcx = bp.x + ts / 2, bcy = bp.y + ts / 2;
          const tpulse = 0.22 + 0.14 * Math.sin(clock / 600);
          const tg2 = ctx.createRadialGradient(bcx, bcy, 0, bcx, bcy, ts * 1.1);
          tg2.addColorStop(0, '#3aacc8'); tg2.addColorStop(0.5, '#1a6888'); tg2.addColorStop(1, 'transparent');
          ctx.save(); ctx.globalAlpha = tpulse; ctx.fillStyle = tg2;
          ctx.fillRect(bp.x - ts * 0.3, bp.y - ts * 0.3, ts * 1.6, ts * 1.6); ctx.restore();
          // "TARGET" label above box
          const lx = bp.x + ts / 2, ly = bp.y - 4 * cam.scale;
          ctx.save(); ctx.font = `bold ${Math.round(7 * cam.scale)}px monospace`;
          ctx.textAlign = 'center'; ctx.fillStyle = '#7ee8ff';
          ctx.globalAlpha = 0.8 + 0.2 * Math.sin(clock / 400);
          ctx.fillText('TARGET', lx, ly); ctx.restore();
        }
        // Radial glow centered on box â€” fades beyond tile edges for a softer ambient
        { const ts = TILE * cam.scale;
          const bcx = bp.x + ts / 2, bcy = bp.y + ts / 2;
          const bg = ctx.createRadialGradient(bcx, bcy, 0, bcx, bcy, ts * 0.88);
          bg.addColorStop(0, '#e8d87e'); bg.addColorStop(0.52, '#e8d87e'); bg.addColorStop(1, 'transparent');
          ctx.save(); ctx.globalAlpha = pulse; ctx.fillStyle = bg;
          ctx.fillRect(bp.x - ts * 0.18, bp.y - ts * 0.18, ts * 1.36, ts * 1.36); ctx.restore(); }
        // Star-sparkle twinkle above closed boxes â€” 4-arm cross + 4 diagonal corner dots
        const gleamPhase = ((clock * 0.5 + box.x * 417 + box.y * 293) % 2800) / 2800;
        if (gleamPhase < 0.12) {
          const ga = Math.min(gleamPhase, 0.12 - gleamPhase) / 0.06;
          const gs = cam.scale;
          const gcx = (bp.x + 7.5 * gs) | 0;
          const gcy = (bp.y - 3 * gs) | 0;
          ctx.save(); ctx.globalAlpha = ga * 0.90; ctx.fillStyle = '#fff';
          ctx.fillRect(gcx, gcy - 3 * gs, gs, 3 * gs);      // top arm
          ctx.fillRect(gcx, gcy + gs, gs, 3 * gs);           // bottom arm
          ctx.fillRect(gcx - 3 * gs, gcy, 3 * gs, gs);      // left arm
          ctx.fillRect(gcx + gs, gcy, 3 * gs, gs);           // right arm
          ctx.fillRect(gcx, gcy, gs, gs);                     // bright centre
          ctx.globalAlpha = ga * 0.45;
          ctx.fillRect(gcx - 2 * gs, gcy - 2 * gs, gs, gs); // top-left dot
          ctx.fillRect(gcx + 2 * gs, gcy - 2 * gs, gs, gs); // top-right dot
          ctx.fillRect(gcx - 2 * gs, gcy + 2 * gs, gs, gs); // bottom-left dot
          ctx.fillRect(gcx + 2 * gs, gcy + 2 * gs, gs, gs); // bottom-right dot
          ctx.restore();
        }
      }
    }
    for (const f of b.flags ?? []) {
      if (f.taken && !standingFlags.has(key(f.x, f.y))) continue;
      const cap = f.color[0].toUpperCase() + f.color.slice(1);
      // gentle two-axis sway â€” vertical bob + horizontal drift simulate wind
      const sway = Math.sin(clock / 900 + f.x * 1.4 + f.y * 0.9) * 0.4;
      const swayH = Math.cos(clock / 700 + f.x * 1.1 + f.y * 1.3) * 0.25;
      const fp = worldToScreen(f.x, f.y, cam);
      // Color-matched ambient glow pool at the flag base
      const FLAG_GLOW = { Red: 'rgba(220,70,50,', Blue: 'rgba(70,105,220,', Green: 'rgba(50,180,70,', Yellow: 'rgba(200,185,45,' };
      const fgcol = FLAG_GLOW[cap] ?? 'rgba(200,200,200,';
      const fgcx = fp.x + TILE * cam.scale / 2;
      const fgcy = fp.y + (TILE - 3) * cam.scale;
      const fpulse = 0.28 + 0.16 * Math.sin(clock / 900 + f.x * 1.4 + f.y * 0.9);
      const fgr = ctx.createRadialGradient(fgcx, fgcy, 0, fgcx, fgcy, 9 * cam.scale);
      fgr.addColorStop(0, fgcol + fpulse.toFixed(2) + ')');
      fgr.addColorStop(1, 'transparent');
      ctx.fillStyle = fgr;
      ctx.fillRect(fp.x - 2 * cam.scale, fp.y + 4 * cam.scale, TILE * cam.scale + 4 * cam.scale, 14 * cam.scale);
      const img = atlas[`tile.flag${cap}`];
      if (img) ctx.drawImage(img, (fp.x + swayH * cam.scale) | 0, (fp.y + sway * cam.scale) | 0, img.width * cam.scale, img.height * cam.scale);
      // Sparkles drifting off the flag cloth tip (right side, rows 4-6 of sprite)
      const FLAG_EMBER = { Red: '#ff8a6a', Blue: '#80a8ff', Green: '#70e898', Yellow: '#fff070' };
      const fec = FLAG_EMBER[cap] ?? '#ffe0a0';
      for (let fi = 0; fi < 2; fi++) {
        const feh = (f.x * 1847 + f.y * 3529 + fi * 7) & 0x3FFF;
        const feperiod = 1900 + (feh & 0x3FF);
        const fephase = ((clock + fi * (feperiod / 2)) % feperiod) / feperiod;
        const fea = Math.sin(fephase * Math.PI) * 0.50;
        if (fea < 0.06) continue;
        const fesx = (fp.x + (10.5 + fi - fephase * 1.5 + swayH) * cam.scale) | 0;
        const fesy = (fp.y + (4 - fephase * 6 + sway) * cam.scale) | 0;
        ctx.save(); ctx.globalAlpha = fea; ctx.fillStyle = fi % 2 === 0 ? fec : '#fffce0';
        ctx.fillRect(fesx, fesy, cam.scale, cam.scale); ctx.restore();
      }
    }
    // Rescue NPC â€” glowing survivor marker (rescue missions only)
    if (b.rescue && !b.rescue.claimed) {
      const rp = worldToScreen(b.rescue.x, b.rescue.y, cam);
      const rs = TILE * cam.scale;
      const rcx = rp.x + rs / 2, rcy = rp.y + rs / 2;
      const rpulse = 0.5 + 0.5 * Math.sin(clock / 500);
      const rpulse2 = 0.5 + 0.5 * Math.sin(clock / 500 + Math.PI);
      // Distress beacon: pulsing green radial glow
      const rg = ctx.createRadialGradient(rcx, rcy, 0, rcx, rcy, rs * 1.4);
      rg.addColorStop(0, 'rgba(50,220,90,0.6)'); rg.addColorStop(1, 'transparent');
      ctx.save(); ctx.globalAlpha = rpulse * 0.75; ctx.fillStyle = rg;
      ctx.fillRect(rp.x - rs * 0.4, rp.y - rs * 0.4, rs * 1.8, rs * 1.8); ctx.restore();
      // Outer ring pulse (alternating)
      const rg2 = ctx.createRadialGradient(rcx, rcy, rs * 0.5, rcx, rcy, rs * 1.8);
      rg2.addColorStop(0, 'rgba(80,255,120,0.18)'); rg2.addColorStop(1, 'transparent');
      ctx.save(); ctx.globalAlpha = rpulse2 * 0.6; ctx.fillStyle = rg2;
      ctx.fillRect(rp.x - rs * 0.8, rp.y - rs * 0.8, rs * 2.6, rs * 2.6); ctx.restore();
      const s = cam.scale;
      const npcBob = Math.round(Math.sin(clock / 700) * 0.5) * s;
      // Dark shadow block behind figure for readability on any floor tile
      ctx.save(); ctx.globalAlpha = 0.45; ctx.fillStyle = '#001806';
      ctx.fillRect((rp.x + 1 * s) | 0, (rp.y + npcBob) | 0, 5 * s, 12 * s); ctx.restore();
      // Waving arm: right arm rises/falls with sin wave (period ~760ms)
      const armRow = 5 - Math.round((Math.sin(clock / 380) + 1) * 1.5);
      // Person silhouette: head (3×3 at 2,1), body (3×4 at 2,4), arms, legs
      ctx.save();
      ctx.fillStyle = '#e8f8ec';
      const ry = rp.y + npcBob;
      ctx.fillRect((rp.x + 2 * s) | 0, (ry + 1 * s) | 0, 3 * s, 3 * s); // head
      ctx.fillRect((rp.x + 2 * s) | 0, (ry + 4 * s) | 0, 3 * s, 4 * s); // body
      ctx.fillRect((rp.x + 0 * s) | 0, (ry + 5 * s) | 0, 2 * s, s);     // left arm (static)
      ctx.fillRect((rp.x + 5 * s) | 0, (ry + armRow * s) | 0, 2 * s, s); // right arm (waving)
      ctx.fillRect((rp.x + 2 * s) | 0, (ry + 8 * s) | 0, s, 3 * s);     // left leg
      ctx.fillRect((rp.x + 4 * s) | 0, (ry + 8 * s) | 0, s, 3 * s);     // right leg
      ctx.restore();
      // "!" urgency label above the figure â€” flashes with the pulse
      ctx.save();
      ctx.font = `bold ${(3 * s) | 0}px Consolas, monospace`;
      ctx.textAlign = 'center';
      ctx.globalAlpha = 0.25 + 0.75 * rpulse;
      ctx.fillStyle = '#000';
      ctx.fillText('!', (rcx + s * 0.5) | 0, (rp.y - 2.5 * s) | 0);
      ctx.globalAlpha = 0.9 + 0.1 * rpulse;
      ctx.fillStyle = '#3dffa0';
      ctx.fillText('!', rcx | 0, (rp.y - 3 * s) | 0);
      ctx.restore();
    }
  }

  function drawTrap(t) {
    const p = worldToScreen(t.x, t.y, cam);
    const s = cam.scale;
    const cx = p.x + 8 * s;
    const cy = p.y + 8 * s;
    const col = TRAP_COLORS[t.kind] ?? '#f0f4ff';
    // pulsing glow spread across the tile
    const pulse = 0.5 + 0.5 * Math.sin(clock / 420 + t.x * 1.3 + t.y * 1.7);
    const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, 6 * s);
    gr.addColorStop(0, col);
    gr.addColorStop(1, 'transparent');
    ctx.save();
    ctx.globalAlpha = pulse * 0.32;
    ctx.fillStyle = gr;
    ctx.fillRect(p.x, p.y, TILE * s, TILE * s);
    ctx.restore();
    // diamond shape
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 4 * s);
    ctx.lineTo(cx + 4 * s, cy);
    ctx.lineTo(cx, cy + 4 * s);
    ctx.lineTo(cx - 4 * s, cy);
    ctx.fill();
    // bright center flash
    ctx.save();
    ctx.globalAlpha = pulse * 0.55;
    ctx.fillStyle = '#fff';
    ctx.fillRect(cx - s, cy - s, 2 * s, 2 * s);
    ctx.restore();
    // 4 orbiting sentinel markers â€” slow mechanical rotation signals it's armed
    const orbR = 5.2 * s;
    const orbAng = clock / 3200;
    for (let oi = 0; oi < 4; oi++) {
      const oa = orbAng + oi * Math.PI / 2;
      ctx.save();
      ctx.globalAlpha = pulse * 0.55;
      ctx.fillStyle = col;
      ctx.fillRect(((cx + Math.cos(oa) * orbR) - s * 0.5) | 0, ((cy + Math.sin(oa) * orbR) - s * 0.5) | 0, s, s);
      ctx.restore();
    }
    // Status icon in diamond center â€” shows what the trap does (revealed traps only)
    const trapIcon = atlas[`status.${t.kind}`];
    if (trapIcon && s >= 2) {
      ctx.save();
      ctx.globalAlpha = pulse * 0.88;
      ctx.drawImage(trapIcon, (cx - 6) | 0, (cy - 6) | 0, 12, 12);
      ctx.restore();
    }
  }

  function drawOverlays() {
    const s = cam.scale;
    if (overlays.range) {
      const ak = activeKey();
      const au = ak ? findUnit(ak) : null;
      const rangeCol = ak && ak[0] === 'h' && au ? (SLOT_COLORS[(au.slot ?? 0) % 4] ?? '#d2e1ff') : '#d2e1ff';
      for (const cell of overlays.range) {
        const [x, y] = String(cell).split(',').map(Number);
        const p = worldToScreen(x, y, cam);
        const ts = TILE * s;
        const [rx, ry] = String(cell).split(',').map(Number);
        const tpulse = 0.65 + 0.35 * Math.sin(clock / 480 + (rx + ry) * 0.7);
        ctx.save(); ctx.globalAlpha = 0.12 * tpulse; ctx.fillStyle = rangeCol;
        ctx.fillRect(p.x, p.y, ts, ts); ctx.restore();
        const L = 3 * s, W = s;
        ctx.save(); ctx.globalAlpha = tpulse;
        ctx.fillStyle = rangeCol;
        ctx.fillRect(p.x + 1, p.y + 1, L, W); ctx.fillRect(p.x + 1, p.y + 1, W, L);
        ctx.fillRect(p.x + ts - L - 1, p.y + 1, L, W); ctx.fillRect(p.x + ts - W - 1, p.y + 1, W, L);
        ctx.fillRect(p.x + 1, p.y + ts - W - 1, L, W); ctx.fillRect(p.x + 1, p.y + ts - L - 1, W, L);
        ctx.fillRect(p.x + ts - L - 1, p.y + ts - W - 1, L, W); ctx.fillRect(p.x + ts - W - 1, p.y + ts - L - 1, W, L);
        ctx.restore();
      }
    }
    if (overlays.path) {
      const ak = activeKey();
      const au = ak ? findUnit(ak) : null;
      const pathCol = ak && ak[0] === 'h' && au ? (SLOT_COLORS[(au.slot ?? 0) % 4] ?? '#ffe98a') : '#ffe98a';
      const pathPts = overlays.path.map((step) => {
        const c = typeof step === 'string'
          ? { x: +step.split(',')[0], y: +step.split(',')[1] } : step;
        const p = worldToScreen(c.x, c.y, cam);
        return { c, cx: p.x + 8 * s, cy: p.y + 8 * s };
      });
      // Connecting lines + directional chevron arrows between consecutive steps
      for (let i = 1; i < pathPts.length; i++) {
        const a = pathPts[i - 1], b = pathPts[i];
        const la = 0.22 + 0.12 * Math.sin(clock / 340 - i * 0.9);
        ctx.save(); ctx.globalAlpha = la; ctx.strokeStyle = pathCol; ctx.lineWidth = s;
        ctx.beginPath(); ctx.moveTo(a.cx, a.cy); ctx.lineTo(b.cx, b.cy); ctx.stroke();
        ctx.restore();
        // Chevron arrow pointing in the direction of travel
        const mx = (a.cx + b.cx) / 2;
        const my = (a.cy + b.cy) / 2;
        const angle = Math.atan2(b.cy - a.cy, b.cx - a.cx);
        const ar = 3 * s, aw = 1.5 * s;
        ctx.save(); ctx.globalAlpha = la * 0.9; ctx.fillStyle = pathCol;
        ctx.translate(mx, my); ctx.rotate(angle);
        ctx.beginPath();
        ctx.moveTo(ar, 0); ctx.lineTo(-ar, aw); ctx.lineTo(-ar * 0.4, 0); ctx.lineTo(-ar, -aw);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      for (const { c, cx: dcx, cy: dcy } of pathPts) {
        const p = worldToScreen(c.x, c.y, cam);
        const flow = 0.55 + 0.45 * Math.sin(clock / 340 - (c.x + c.y) * 0.9);
        const gr = ctx.createRadialGradient(dcx, dcy, 0, dcx, dcy, 5 * s);
        gr.addColorStop(0, pathCol); gr.addColorStop(1, 'transparent');
        ctx.save(); ctx.globalAlpha = flow;
        ctx.fillStyle = gr;
        ctx.fillRect(dcx - 5 * s, dcy - 5 * s, 10 * s, 10 * s);
        ctx.fillStyle = pathCol;
        ctx.fillRect(p.x + 7 * s, p.y + 7 * s, 2 * s, 2 * s);
        ctx.restore();
      }
    }
  }

  function drawUnit(k, u, pos, alpha = 1) {
    const img = spriteFor(k);
    if (!img || !pos) return;
    const s = cam.scale;
    const p = worldToScreen(pos.x, pos.y, cam);
    const w = img.width * s;
    const h = img.height * s;
    const dx = p.x + (TILE * s - w) / 2;
    // Active unit bobs faster; others breathe subtly so nothing looks frozen
    const uid = u?.id ?? 0;
    const bobPx = k === activeKey()
      ? Math.round(Math.sin(clock / 650) * 1.5) * s
      : Math.round(Math.sin(clock / 2800 + uid * 1.37) * 0.5) * s;
    const dy = p.y + (TILE * s - h) - bobPx;
    // Motion trail: ghost copies while sliding for a blur effect
    if (slides.has(k) && anim) {
      const sl = slides.get(k);
      const p2 = Math.min(1, anim.t / anim.dur);
      const trailFade = p2 < 0.72 ? 1 : (1 - p2) / 0.28;
      for (let tr = 1; tr <= 2; tr++) {
        const tp = Math.max(0, p2 - tr * 0.20);
        const tx2 = sl.fx + (sl.tx - sl.fx) * tp;
        const ty2 = sl.fy + (sl.ty - sl.fy) * tp;
        if (Math.abs(tx2 - pos.x) < 0.02 && Math.abs(ty2 - pos.y) < 0.02) continue;
        const tp2 = worldToScreen(tx2, ty2, cam);
        const tdx = (tp2.x + (TILE * s - w) / 2) | 0;
        const tdy = (tp2.y + (TILE * s - h)) | 0;
        ctx.save();
        ctx.globalAlpha = alpha * (0.20 - tr * 0.07) * trailFade;
        if (facing.get(k) === -1) {
          ctx.translate(tdx + w, tdy); ctx.scale(-1, 1); ctx.drawImage(img, 0, 0, w, h);
        } else {
          ctx.drawImage(img, tdx, tdy, w, h);
        }
        ctx.restore();
      }
    }
    // Target carrier: pulsing gold tile border â€” visible from anywhere on the board
    if (k[0] === 'h' && u?.hasTarget) {
      const gp = 0.14 + 0.12 * Math.sin(clock / 500);
      const ts = TILE * s;
      ctx.save(); ctx.globalAlpha = gp * alpha;
      ctx.strokeStyle = '#ffe98a'; ctx.lineWidth = s;
      ctx.strokeRect(p.x + s * 0.5, p.y + s * 0.5, ts - s, ts - s);
      ctx.restore();
    }
    // Low-HP danger glow: pulsing red around tile edges at â‰¤25% HP
    if (u && u.maxHp && u.hp / u.maxHp <= 0.25) {
      const hpRatio = u.hp / u.maxHp;
      const urgency = 1 - hpRatio * 4; // 0 at 25%, 1 at 0HP
      const danger = (0.15 + 0.18 * urgency) * (1 + Math.sin(clock / 260)) * 0.5;
      const ts = TILE * s;
      ctx.save(); ctx.globalAlpha = danger * alpha;
      ctx.strokeStyle = k[0] === 'h' ? '#ff4a3a' : '#ff6820';
      ctx.lineWidth = s * 0.7;
      ctx.strokeRect(p.x + s * 0.4, p.y + s * 0.4, ts - s * 0.8, ts - s * 0.8);
      ctx.restore();
    }
    ctx.save();
    ctx.globalAlpha = alpha;
    if (facing.get(k) === -1) {
      ctx.translate(dx + w, dy);
      ctx.scale(-1, 1);
      ctx.drawImage(img, 0, 0, w, h);
    } else {
      ctx.drawImage(img, dx | 0, dy | 0, w, h);
    }
    ctx.restore();
    // Torch warmth: units standing directly below a torch wall get a section-tinted glow
    if (state?.board && !state.board.floor[pos.y - 1]?.[pos.x]) {
      const twh = ((pos.x * 1637 + (pos.y - 1) * 3571) ^ 997) & 0xFFFF;
      if ((twh & 0xFF) >= 20 && ((twh >> 8) & 0xFF) < 16) {
        const twGlow = 0.10 + 0.06 * Math.sin(clock / 850 + twh * 0.031);
        const twCol = pos.x < 10
          ? ((pos.y - 1) < 10 ? '#ffa040' : '#40d820')
          : ((pos.y - 1) < 10 ? '#4090ff' : '#c040ff');
        ctx.save(); ctx.globalAlpha = twGlow * alpha; ctx.fillStyle = twCol;
        ctx.fillRect(p.x | 0, dy | 0, TILE * s, h); ctx.restore();
      }
    }
    if (unitFlash && unitFlash.key === k) {
      const ft = unitFlash.t / unitFlash.dur;
      ctx.save();
      ctx.globalAlpha = ft < 0.4 ? 0.8 : Math.max(0, 0.8 - (ft - 0.4) * 2);
      ctx.fillStyle = unitFlash.color;
      ctx.fillRect(p.x, dy, TILE * s, h);
      ctx.restore();
    }
    if (u && k[0] === 'h') {
      if (u.hasTarget) {
        const tmx = p.x + 4 * s, tmy = dy - 9 * s;
        const tmPulse = 0.45 + 0.45 * Math.sin(clock / 480);
        ctx.save(); ctx.globalAlpha = tmPulse * 0.55;
        ctx.fillStyle = '#e8d87e';
        ctx.fillRect(tmx - s, tmy - s, 10 * s, 10 * s);
        ctx.restore();
        blit('ui.targetMark', tmx, tmy);
      }
      const active = Object.entries(u.status ?? {}).filter(([, v]) => v).map(([n]) => n);
      let ix = p.x + (TILE * s - active.length * 8 * s) / 2;
      const statusY = p.y - bobPx;
      const STATUS_PULSE_SPEED = { panic: 280, stun: 520, leg: 620, empty: 800 };
      for (const st of active) {
        if (atlas[`status.${st}`]) {
          if (STATUS_GLOW[st]) {
            const sgAlpha = 0.28 + 0.20 * Math.sin(clock / (STATUS_PULSE_SPEED[st] ?? 450));
            ctx.save();
            ctx.globalAlpha = sgAlpha;
            ctx.fillStyle = STATUS_GLOW[st];
            ctx.fillRect(ix - s, statusY - 9 * s, 8 * s + 2 * s, 8 * s + 2 * s);
            ctx.restore();
          }
          blit(`status.${st}`, ix, statusY - 8 * s);
        }
        ix += 8 * s;
      }
      // Ambient status particles â€” drawn clock-based, no sparkles array
      const scx = p.x + TILE * s / 2, scy = p.y + TILE * s * 0.4 - bobPx;
      if (u.status?.stun) {
        // Stun: 4 yellow stars orbiting above the unit's head
        for (let i = 0; i < 4; i++) {
          const a = (clock / 380 + i * Math.PI * 0.5);
          const orx = Math.cos(a) * 5 * s, ory = Math.sin(a * 0.7) * 2.5 * s;
          const sa = 0.55 + 0.35 * Math.sin(clock / 200 + i * 1.3);
          ctx.save(); ctx.globalAlpha = sa * alpha; ctx.fillStyle = i % 2 === 0 ? '#ffe060' : '#fff880';
          ctx.fillRect((scx + orx - s * 0.5) | 0, (scy - 12 * s + ory) | 0, Math.max(1, s) | 0, Math.max(1, s) | 0);
          ctx.restore();
        }
      }
      if (u.status?.leg) {
        // Leg: slow-drifting cyan frost pixels falling around the unit
        for (let i = 0; i < 5; i++) {
          const fperiod = 1400 + i * 180;
          const fphase = ((clock + i * (fperiod / 5)) % fperiod) / fperiod;
          const fx = scx + (i - 2) * 3.5 * s + Math.sin(fphase * Math.PI * 1.4 + i) * 2 * s;
          const fy = (scy - 10 * s) + fphase * 14 * s;
          const fa = Math.sin(fphase * Math.PI) * 0.6;
          if (fa < 0.05) continue;
          ctx.save(); ctx.globalAlpha = fa * alpha; ctx.fillStyle = i % 2 === 0 ? '#90c8f8' : '#c0e4ff';
          ctx.fillRect(fx | 0, fy | 0, Math.max(1, s) | 0, Math.max(1, s) | 0);
          ctx.restore();
        }
      }
      if (u.status?.panic) {
        // Panic: 5 red sparks racing outward in fast arcs around the unit
        for (let i = 0; i < 5; i++) {
          const a = (clock / 160 + i * Math.PI * 0.4);
          const pr = (3 + 3 * ((clock / 160 + i * 0.4) % 1)) * s;
          const pa = 0.7 - ((clock / 160 + i * 0.4) % 1) * 0.65;
          ctx.save(); ctx.globalAlpha = Math.max(0, pa) * alpha;
          ctx.fillStyle = i % 2 === 0 ? '#ff3820' : '#ff9040';
          ctx.fillRect((scx + Math.cos(a) * pr - s * 0.5) | 0, (scy + Math.sin(a) * pr * 0.55 - s * 0.5) | 0, Math.max(1, s) | 0, Math.max(1, s) | 0);
          ctx.restore();
        }
      }
      if (u.status?.empty) {
        // Empty/drained: 5 grey wisps drifting outward, representing energy leaking away
        for (let i = 0; i < 5; i++) {
          const dperiod = 2200 + i * 280;
          const dphase = ((clock + i * (dperiod / 5)) % dperiod) / dperiod;
          const da = (i / 5) * Math.PI * 2 + clock / 3200;
          const dr = dphase * 9 * s;
          const deAlpha = Math.sin(dphase * Math.PI) * 0.45;
          if (deAlpha < 0.04) continue;
          ctx.save(); ctx.globalAlpha = deAlpha * alpha;
          ctx.fillStyle = i % 2 === 0 ? '#8d8d9e' : '#b0b0bc';
          ctx.fillRect((scx + Math.cos(da) * dr - s * 0.5) | 0, (scy - 8 * s + Math.sin(da) * dr * 0.6 - s * 0.5) | 0, Math.max(1, s) | 0, Math.max(1, s) | 0);
          ctx.restore();
        }
      }
    }
  }

  function drawMonsterAuras() {
    if (!state?.monsters?.length) return;
    const s = cam.scale;
    for (const m of state.monsters ?? []) {
      const k = `m${m.id}`;
      if (hiddenUnits.has(k)) continue;
      const pos = displayPos(k);
      if (!pos) continue;
      const p = worldToScreen(pos.x, pos.y, cam);
      const cx = p.x + TILE * s / 2;
      const cy = p.y + TILE * s / 2;
      const isWyrm = m.kind === 'WYRM';
      const pulse = 0.14 + 0.10 * Math.sin(clock / (isWyrm ? 900 : 680) + m.id * 1.7);
      const auraCol = MONSTER_AURA[m.kind] ?? 'rgba(210,55,35,0.55)';
      const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, (isWyrm ? 16 : 9) * s);
      gr.addColorStop(0, auraCol);
      gr.addColorStop(1, 'transparent');
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.fillStyle = gr;
      ctx.fillRect(p.x - s, p.y - s, TILE * s + 2 * s, TILE * s + 2 * s);
      ctx.restore();
      if (isWyrm) {
        // Floor shadow: large pulsing dark ellipse beneath WYRM
        const wyrmShadowCy = p.y + TILE * s * 0.92;
        const wyrmSrx = (8.5 + 2.5 * Math.sin(clock / 1300 + m.id * 0.8)) * s;
        const wyrmSry = (2.4 + 0.9 * Math.cos(clock / 1100 + m.id * 0.6)) * s;
        ctx.save(); ctx.globalAlpha = 0.38 + 0.12 * Math.sin(clock / 950 + m.id);
        ctx.fillStyle = '#120025';
        ctx.beginPath(); ctx.ellipse(cx, wyrmShadowCy, wyrmSrx, wyrmSry, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        for (let ri = 0; ri < 2; ri++) {
          const ringPhase = ((clock + ri * 1600) / 3200) % 1;
          const ringR = (9 + ringPhase * 18) * s;
          const ringAlpha = (1 - ringPhase) * 0.30;
          ctx.save();
          ctx.globalAlpha = ringAlpha;
          ctx.strokeStyle = 'rgba(140,60,220,0.9)';
          ctx.lineWidth = s * 0.5;
          ctx.beginPath();
          ctx.ellipse(cx, cy, ringR, ringR * 0.28, 0, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
        // Four rotating shadow tendrils extending outward
        const trot = (clock / 6500) * Math.PI * 2;
        for (let ti = 0; ti < 4; ti++) {
          const ta = trot + ti * Math.PI / 2;
          for (let seg = 2; seg <= 5; seg++) {
            const sr = seg * 2.8 * s;
            const talpha = (0.28 - seg * 0.045) + 0.10 * Math.sin(clock / 820 + ti + seg);
            if (talpha <= 0) continue;
            ctx.save(); ctx.globalAlpha = talpha; ctx.fillStyle = '#250850';
            ctx.fillRect((cx + Math.cos(ta) * sr - s) | 0, (cy + Math.sin(ta) * sr - s) | 0, s * 2, s * 2);
            ctx.restore();
          }
        }
      }
      if (m.kind === 'OOZ') {
        // Slime puddle: wobbling translucent ellipse on the floor beneath OOZ
        const slimeCy = p.y + TILE * s * 0.90;
        const slimeRx = (5.5 + 2 * Math.sin(clock / 700 + m.id)) * s;
        const slimeRy = (1.8 + 0.8 * Math.cos(clock / 500 + m.id * 1.3)) * s;
        ctx.save(); ctx.globalAlpha = 0.28 + 0.10 * Math.sin(clock / 600 + m.id * 0.9);
        ctx.fillStyle = '#1a6830';
        ctx.beginPath(); ctx.ellipse(cx, slimeCy, slimeRx, slimeRy, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        // Slime drips: 5 particles fall downward from sprite bottom, staggered phases
        const dripY0 = cy + TILE * s * 0.3;
        for (let j = 0; j < 5; j++) {
          const phase = ((clock / 1100) + j * 0.22 + m.id * 0.41) % 1;
          const dx = cx + (j - 2) * s * 1.6;
          const dy = dripY0 + phase * s * 4.5;
          const da = Math.sin(phase * Math.PI) * 0.55;
          if (da < 0.05) continue;
          ctx.save();
          ctx.globalAlpha = da;
          ctx.fillStyle = '#4fae3f';
          ctx.fillRect((dx - s * 0.5) | 0, dy | 0, Math.max(1, s) | 0, Math.max(1, s * 1.5) | 0);
          ctx.restore();
        }
        // Rising bubbles: 4 small circles float upward through the slime body
        for (let j = 0; j < 4; j++) {
          const bperiod = 1800 + j * 290;
          const bphase = ((clock + j * (bperiod / 4) + m.id * 430) % bperiod) / bperiod;
          const bx = cx + (j - 1.5) * s * 2.2;
          const by = cy + s * 3 - bphase * s * 9;
          const br = (0.7 + j % 2 * 0.5) * s;
          const ba = Math.sin(bphase * Math.PI) * 0.50;
          if (ba < 0.06) continue;
          ctx.save(); ctx.globalAlpha = ba;
          ctx.strokeStyle = j % 2 === 0 ? '#7ae87a' : '#a0f0a0';
          ctx.lineWidth = Math.max(0.5, s * 0.4);
          ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.stroke();
          ctx.restore();
        }
      }
      if (m.kind === 'VAC') {
        // Radar sweep: rotating sector with trailing ghost lines (cyan, consistent with aura)
        const angle = (clock / 2200) * Math.PI * 2;
        const sweepR = 9 * s;
        ctx.save();
        // Three trailing ghost lines fading behind the sweep
        for (let gi = 3; gi >= 0; gi--) {
          ctx.globalAlpha = (4 - gi) / 4 * 0.38;
          ctx.strokeStyle = '#50b0e8';
          ctx.lineWidth = s * 0.5;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + Math.cos(angle - gi * 0.18) * sweepR, cy + Math.sin(angle - gi * 0.18) * sweepR);
          ctx.stroke();
        }
        // Filled sector at current sweep angle
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = '#50b0e8';
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, sweepR, angle - 0.3, angle);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        // Scan pulses: 2 expanding rings (staggered phases) fading outward
        for (let ri = 0; ri < 2; ri++) {
          const rphase = ((clock + ri * 1800) / 3600) % 1;
          const ringR = (5 + rphase * 18) * s;
          const ringA = (1 - rphase) * 0.22;
          ctx.save(); ctx.globalAlpha = ringA;
          ctx.strokeStyle = '#50b0e8'; ctx.lineWidth = s * 0.4;
          ctx.beginPath(); ctx.arc(cx, cy, ringR, 0, Math.PI * 2); ctx.stroke();
          ctx.restore();
        }
      }
      if (m.kind === 'FNG') {
        // Scorch mark: dark burnt ellipse on the floor beneath FNG
        const scorchCy = p.y + TILE * s * 0.92;
        const scorchRx = (5 + 1.5 * Math.sin(clock / 1100 + m.id * 1.1)) * s;
        const scorchRy = (1.6 + 0.5 * Math.cos(clock / 900 + m.id * 0.7)) * s;
        ctx.save(); ctx.globalAlpha = 0.32 + 0.10 * Math.sin(clock / 750 + m.id);
        ctx.fillStyle = '#1a0800';
        ctx.beginPath(); ctx.ellipse(cx, scorchCy, scorchRx, scorchRy, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        // Ember sparks: 6 orange/red particles kicked upward from engine exhaust
        for (let j = 0; j < 6; j++) {
          const phase = ((clock / 900) + j * 0.18 + m.id * 0.37) % 1;
          const ex = cx + (j - 2.5) * s * 1.4 + Math.sin(phase * Math.PI * 2 + j) * s * 0.8;
          const ey = cy + s * 2 - phase * s * 5.5;
          const ea = Math.sin(phase * Math.PI) * 0.60;
          if (ea < 0.05) continue;
          ctx.save();
          ctx.globalAlpha = ea;
          ctx.fillStyle = phase < 0.5 ? '#ffb040' : '#cc4020';
          ctx.fillRect((ex - s * 0.4) | 0, ey | 0, Math.max(1, s * 0.8) | 0, Math.max(1, s) | 0);
          ctx.restore();
        }
      }
    }
  }

  function drawUnitLabels() {
    if (!state?.monsters?.length) return;
    const s = cam.scale;
    for (const m of state.monsters ?? []) {
      const k = `m${m.id}`;
      if (hiddenUnits.has(k)) continue;
      const pos = displayPos(k);
      if (!pos) continue;
      const p = worldToScreen(pos.x, pos.y, cam);
      const cx = p.x + TILE * s / 2;
      const barW = 14 * s;
      const barH = Math.max(1, Math.round(s * 1.5));
      const barX = Math.round(cx - barW / 2);
      const labelY = Math.round(p.y - 7 * s);
      const barY = labelY + 10;
      const ratio = m.maxHp ? clamp(m.hp / m.maxHp, 0, 1) : 0;
      const labelCol = MONSTER_LABEL_COLOR[m.kind] ?? '#ff8866';
      // Kind label above HP bar â€” colored glow matches monster brand color
      ctx.save(); ctx.shadowBlur = 8; ctx.shadowColor = labelCol;
      text(m.kind, cx, labelY, labelCol, 9, 'center');
      ctx.restore();
      // Dark backdrop behind HP bar
      ctx.save(); ctx.globalAlpha = 0.72; ctx.fillStyle = '#080a12';
      ctx.fillRect(barX - 1, barY - 1, barW + 2, barH + 2); ctx.restore();
      // Colored HP fill â€” WYRM gets purple, others red-orange (matches sidebar)
      const fill = Math.round(barW * ratio);
      if (fill > 0) {
        const isWyrm = m.kind === 'WYRM';
        const [mc0, mc1] = isWyrm
          ? (ratio > 0.5 ? ['#9850d8', '#6030a8'] : ratio > 0.25 ? ['#c060f0', '#8030c0'] : ['#e050ff', '#a020d0'])
          : (ratio > 0.5 ? ['#e05a3a', '#a82820'] : ratio > 0.25 ? ['#f07020', '#a04810'] : ['#ff4040', '#c01818']);
        const mg = ctx.createLinearGradient(barX, barY, barX, barY + barH);
        mg.addColorStop(0, mc0); mg.addColorStop(1, mc1);
        ctx.fillStyle = mg;
        ctx.fillRect(barX, barY, fill, barH);
        // Shine
        ctx.save(); ctx.globalAlpha = 0.32; ctx.fillStyle = '#fff';
        ctx.fillRect(barX, barY, fill, Math.max(1, barH >> 1)); ctx.restore();
        // Low-HP urgency flash
        if (ratio <= 0.25) {
          const urgency = 0.5 + 0.5 * Math.sin(clock / 220 + m.id * 0.8);
          ctx.save(); ctx.globalAlpha = urgency * 0.52; ctx.fillStyle = '#ff9a7e';
          ctx.fillRect(barX, barY, fill, barH); ctx.restore();
        }
      }
    }
  }

  function drawUnits() {
    const list = [];
    for (const h of state.hunters ?? []) {
      const k = `h${h.id}`;
      if (!hiddenUnits.has(k)) list.push({ k, u: h, pos: displayPos(k), alpha: 1 });
    }
    for (const m of state.monsters ?? []) {
      const k = `m${m.id}`;
      if (hiddenUnits.has(k)) continue;
      let alpha = 1;
      let pos = displayPos(k);
      // rise-in while a spawn event for this monster is playing
      if (anim && ['monsterSpawned', 'wyrmSpawned', 'wyrmRespawned'].includes(anim.ev.type)
          && evKey(anim.ev) === k) alpha = Math.min(1, anim.t / anim.dur);
      list.push({ k, u: m, pos, alpha });
    }
    for (const [k, g] of ghosts) {
      const ghostAlpha = (g.dyingKey && anim?.ev.type === 'monsterKilled')
        ? 1 - Math.min(1, anim.t / anim.dur) : g.alpha;
      list.push({ k, u: null, pos: g.pos, alpha: ghostAlpha });
    }
    list.sort((a, b) => (a.pos?.y ?? 0) - (b.pos?.y ?? 0));
    // Soft team-color glow beneath each hunter â€” active hunter pulses brighter
    for (const d of list) {
      if (d.k[0] !== 'h' || !d.pos) continue;
      const hslot = d.u?.slot ?? 0;
      const sc = SLOT_COLORS[hslot % 4] ?? '#3a6ee0';
      const sp = worldToScreen(d.pos.x, d.pos.y, cam);
      const hcx = sp.x + TILE * cam.scale / 2, hcy = sp.y + (TILE - 1) * cam.scale;
      const isActiveH = d.k === activeKey();
      const hgAlpha = isActiveH ? (0.28 + 0.12 * Math.sin(clock / 550)) * d.alpha : 0.15 * d.alpha;
      const hgR = isActiveH ? 8.5 * cam.scale : 6.5 * cam.scale;
      const hg = ctx.createRadialGradient(hcx, hcy, 0, hcx, hcy, hgR);
      hg.addColorStop(0, sc); hg.addColorStop(1, 'transparent');
      ctx.save(); ctx.globalAlpha = hgAlpha; ctx.fillStyle = hg;
      ctx.fillRect(sp.x, sp.y, TILE * cam.scale, TILE * cam.scale); ctx.restore();
    }
    drawMonsterAuras();
    drawActiveRing();
    for (const d of list) drawUnitShadow(d.k, d.pos, d.alpha);
    for (const d of list) drawUnit(d.k, d.u, d.pos, d.alpha);
  }

  function drawDieChip() {
    if (!anim) return;
    const ev = anim.ev;
    if (ev.type !== 'dieRolled' && ev.type !== 'flagClaimed') return;
    const k = evKey(ev);
    const pos = displayPos(k);
    if (!pos) return;
    const phase = anim.t / anim.dur;
    const settled = phase >= 0.6;
    const v = settled ? (ev.value ?? ev.roll ?? 1) : 1 + Math.floor(clock / 60) % 6;
    const p = worldToScreen(pos.x, pos.y, cam);
    const s = cam.scale;
    // jitter while rolling; pop scale-up when value locks in
    const jx = settled ? 0 : Math.sin(clock / 38) * 1.5 * s;
    const jy = settled ? 0 : Math.cos(clock / 33) * 1.5 * s;
    const popT = settled && phase < 0.78 ? (phase - 0.6) / 0.18 : 0;
    const chipScale = (1 + Math.sin(popT * Math.PI) * 0.32) * s;
    const cx = p.x + 4 * s + jx;
    const cy = p.y - 18 * s + jy;
    // Drop shadow under the chip
    ctx.save(); ctx.globalAlpha = 0.38; ctx.fillStyle = '#000';
    ctx.fillRect(cx + chipScale * 0.5, cy + chipScale * 0.5, 8 * chipScale, 8 * chipScale);
    ctx.restore();
    // High-roll glow: gold for 6, amber for 5; low-roll: red for 1, coral for 2
    if (settled) {
      const gcol = v >= 6 ? '#ffe98a' : v >= 5 ? '#ffc840' : v <= 1 ? '#ff4a3a' : v <= 2 ? '#ff8060' : null;
      if (gcol) {
        const gcx = cx + 4 * chipScale, gcy = cy + 4 * chipScale;
        const cg = ctx.createRadialGradient(gcx, gcy, 0, gcx, gcy, 8 * chipScale);
        cg.addColorStop(0, gcol); cg.addColorStop(1, 'transparent');
        const ga = v >= 6 ? 0.42 : v >= 5 ? 0.28 : v <= 1 ? 0.35 : 0.20;
        ctx.save(); ctx.globalAlpha = ga; ctx.fillStyle = cg;
        ctx.fillRect(cx - 4 * chipScale, cy - 4 * chipScale, 16 * chipScale, 16 * chipScale); ctx.restore();
      }
    }
    blit(`chip.${clamp(v, 1, 6) | 0}`, cx, cy, chipScale);
    // Diagonal gloss â€” top-left specular highlight fading to transparent
    { const cw = 8 * chipScale;
      const shineG = ctx.createLinearGradient(cx, cy, cx + cw * 0.62, cy + cw * 0.62);
      shineG.addColorStop(0, 'rgba(255,255,255,0.30)');
      shineG.addColorStop(0.48, 'rgba(255,255,255,0.07)');
      shineG.addColorStop(1, 'transparent');
      ctx.save(); ctx.fillStyle = shineG; ctx.fillRect(cx, cy, cw, cw); ctx.restore(); }
    if (ev.type === 'flagClaimed' && settled && ev.effect != null) {
      ctx.save(); ctx.shadowBlur = 7; ctx.shadowColor = '#ffe98a';
      text(String(ev.effect), p.x + 8 * s, p.y - 28 * s, '#ffe98a', 12, 'center');
      ctx.restore();
    }
  }

  function drawFloats() {
    for (const f of floats) {
      const rise = (f.t / f.ttl) * 14;
      const p = worldToScreen(f.wx, f.wy, cam);
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - f.t / f.ttl);
      if (f.icon && atlas[f.icon]) {
        blit(f.icon, p.x - 4 * cam.scale, p.y - rise * cam.scale - 10 * cam.scale);
      }
      if (f.text) {
        const phase = f.t / f.ttl;
        const pop = phase < 0.25 ? 1 + (1 - phase / 0.25) * 0.6 : 1;
        const fy = p.y - (rise + 10) * cam.scale;
        const fsz = Math.round((f.big ? 16 : 12) * pop);
        text(f.text, p.x + 1, fy + 1, 'rgba(0,0,0,0.65)', fsz, 'center');
        if (f.big) {
          ctx.save(); ctx.shadowBlur = f.glow ?? 10; ctx.shadowColor = f.color;
          text(f.text, p.x, fy, f.color, fsz, 'center');
          ctx.restore();
        } else {
          ctx.save(); ctx.shadowBlur = 4; ctx.shadowColor = f.color;
          text(f.text, p.x, fy, f.color, fsz, 'center');
          ctx.restore();
        }
      }
      ctx.restore();
    }
    for (const sp of sparkles) {
      const frac = sp.t / sp.ttl;
      const p = worldToScreen(sp.wx + sp.vx * frac, sp.wy + sp.vy * frac, cam);
      const alpha = Math.max(0, (sp.alpha0 ?? 1) * (1 - frac));
      ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = sp.color;
      if (sp.round) {
        const sz = Math.max(0.5, (1.6 - frac) * 3.5) * cam.scale;
        ctx.beginPath(); ctx.arc(p.x, p.y, sz, 0, Math.PI * 2); ctx.fill();
      } else {
        const sz = Math.max(0.5, (1 - frac) * 2.2) * cam.scale;
        ctx.fillRect(p.x - sz * 0.35, p.y - sz * 1.1, sz * 0.7, sz * 2.2);
        ctx.fillRect(p.x - sz * 1.1, p.y - sz * 0.35, sz * 2.2, sz * 0.7);
        if (frac < 0.28) {
          ctx.globalAlpha = alpha * (1 - frac / 0.28) * 0.85;
          ctx.fillStyle = '#fff';
          ctx.fillRect(p.x - sz * 0.35, p.y - sz * 0.35, sz * 0.7, sz * 0.7);
        }
      }
      ctx.restore();
    }
    // Expanding pulse rings (healed event etc.) — world-space, drawn as arc strokes
    for (const ring of pulseRings) {
      const frac = ring.t / ring.ttl;
      const ease = 1 - Math.pow(1 - frac, 2);
      const p = worldToScreen(ring.wx, ring.wy, cam);
      const r = ease * ring.maxR * TILE * cam.scale;
      const alpha = Math.max(0, ring.alpha0 * Math.sin(frac * Math.PI));
      ctx.save(); ctx.globalAlpha = alpha; ctx.strokeStyle = ring.color;
      ctx.lineWidth = Math.max(0.5, (1.2 - frac) * 2.2 * cam.scale);
      ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(1, r), 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
  }

  function drawCursor() {
    if (!cursor) return;
    const pulse = 0.6 + 0.4 * Math.sin(clock / 160);
    const p = worldToScreen(cursor.x, cursor.y, cam);
    const s = cam.scale;
    const ts = TILE * s;
    const ak = activeKey();
    const u = ak ? findUnit(ak) : null;
    const col = ak && ak[0] === 'h' && u ? (SLOT_COLORS[(u.slot ?? 0) % 4] ?? '#e0e8f8') : '#e0e8f8';
    // Team-color fill
    ctx.save(); ctx.globalAlpha = pulse * 0.15; ctx.fillStyle = col;
    ctx.fillRect(p.x, p.y, ts, ts); ctx.restore();
    // Team-color corner brackets (drawn dynamically, matching sprite dimensions)
    ctx.save(); ctx.globalAlpha = pulse; ctx.fillStyle = col;
    const L = 4 * s;
    ctx.fillRect(p.x, p.y, L, s); ctx.fillRect(p.x, p.y, s, L);                    // top-left
    ctx.fillRect(p.x + ts - L, p.y, L, s); ctx.fillRect(p.x + ts - s, p.y, s, L);  // top-right
    ctx.fillRect(p.x, p.y + ts - s, L, s); ctx.fillRect(p.x, p.y + ts - L, s, L);  // bottom-left
    ctx.fillRect(p.x + ts - L, p.y + ts - s, L, s); ctx.fillRect(p.x + ts - s, p.y + ts - L, s, L); // bottom-right
    ctx.restore();
  }

  function drawFog() {
    const ak = activeKey();
    const ap = ak ? displayPos(ak) : null;
    const lp = ap
      ? worldToScreen(ap.x + 0.5, ap.y + 0.5, cam)
      : { x: canvas.width / 2, y: (canvas.height - HUD_H) / 2 };
    // Slow breathing: outer radius Â±2%, inner radius Â±1.5% â€” gives a "living darkness" feel
    const fogBreathe = 0.02 * Math.sin(clock / 4500);
    const fr = Math.max(canvas.width, canvas.height) * (0.60 + fogBreathe);
    const innerR = fr * (0.15 + 0.015 * Math.sin(clock / 2900 + 1.1));
    const fg = ctx.createRadialGradient(lp.x, lp.y, innerR, lp.x, lp.y, fr);
    fg.addColorStop(0, 'rgba(0,0,0,0)');
    fg.addColorStop(0.45, 'rgba(0,0,0,0.12)');
    fg.addColorStop(0.75, 'rgba(0,0,0,0.38)');
    fg.addColorStop(1, 'rgba(0,0,0,0.65)');
    ctx.fillStyle = fg;
    ctx.fillRect(0, 0, canvas.width, canvas.height - HUD_H);
    // Section-tinted fog edge: outer fog bleeds the active section's hue at low opacity
    if (ap) {
      const secRgb = ap.x < 10
        ? (ap.y < 10 ? '220,160,40' : '40,180,60')
        : (ap.y < 10 ? '60,120,220' : '120,40,200');
      const sfg = ctx.createRadialGradient(lp.x, lp.y, fr * 0.52, lp.x, lp.y, fr);
      sfg.addColorStop(0, `rgba(${secRgb},0)`);
      sfg.addColorStop(1, `rgba(${secRgb},0.14)`);
      ctx.fillStyle = sfg;
      ctx.fillRect(0, 0, canvas.width, canvas.height - HUD_H);
    }
  }

  function drawAmbientShimmer() {
    if (!state?.board) return;
    const b = state.board;
    const { w: vw, h: vh } = viewSize();
    const x0 = Math.max(0, Math.floor(cam.x / TILE));
    const y0 = Math.max(0, Math.floor(cam.y / TILE));
    const x1 = Math.min(b.w - 1, Math.ceil((cam.x + vw) / TILE));
    const y1 = Math.min(b.h - 1, Math.ceil((cam.y + vh) / TILE));
    const s = cam.scale;
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (!b.floor[ty]?.[tx]) continue;
        const h = ((tx * 1637 + ty * 3571) ^ 997) & 0xFFFF;
        const period = 5000 + (h % 4000);
        const phase = ((clock + h * 3) % period) / period;
        if (phase > 0.08) continue;
        const t2 = phase < 0.04 ? phase / 0.04 : (0.08 - phase) / 0.04;
        const sp2 = worldToScreen(tx, ty, cam);
        const spx = sp2.x + ((h >> 4) & 13) * s;
        const spy = sp2.y + ((h >> 8) & 13) * s;
        const secCol = tx < 10
          ? (ty < 10 ? ['#ffd060', '#ffe890'] : ['#60e888', '#a0ffb8'])
          : (ty < 10 ? ['#70b8ff', '#b0d8ff'] : ['#c080ff', '#e0b0ff']);
        ctx.save(); ctx.globalAlpha = t2 * 0.28;
        ctx.fillStyle = secCol[h & 1];
        // Star/cross shape: 4-arm plus sign for a gem-sparkle look
        ctx.fillRect(spx + s, spy, s, s * 3);     // vertical arm
        ctx.fillRect(spx, spy + s, s * 3, s);     // horizontal arm
        ctx.restore();
      }
    }
    // Ambient air dust: 16 tiny motes drifting slowly in screen space
    const vwAir = canvas.width, vhAir = canvas.height - HUD_H;
    for (let ai = 0; ai < 16; ai++) {
      const aperiod = 9000 + ai * 530;
      const aphase = ((clock + ai * (aperiod / 16)) % aperiod) / aperiod;
      const ax = ((ai * 173.5 + 47) % vwAir);
      const ay = ((ai * 251.3 + 83) % vhAir);
      const mx = ax + Math.sin(clock / (2200 + ai * 140) + ai) * 18 + Math.sin(aphase * Math.PI * 2) * 8;
      const my = ay + Math.cos(clock / (1800 + ai * 190) + ai * 1.4) * 12 - aphase * 22;
      const ma = Math.sin(aphase * Math.PI) * 0.09;
      if (ma < 0.01) continue;
      ctx.save(); ctx.globalAlpha = ma;
      ctx.fillStyle = (ai & 3) === 0 ? '#e8c87a' : '#8090a8';
      ctx.fillRect((mx - 0.5) | 0, (my - 0.5) | 0, 1, 2);
      ctx.restore();
    }
  }

  function drawUnitShadow(k, pos, alpha) {
    if (!pos) return;
    const s = cam.scale;
    const p = worldToScreen(pos.x, pos.y, cam);
    const cx = p.x + TILE * s / 2;
    const cy = p.y + (TILE - 1) * s;
    const isActive = k === activeKey();
    const r = isActive ? 6 * s + 1.5 * s * (0.5 + 0.5 * Math.sin(clock / 380)) : 6 * s;
    const sg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    sg.addColorStop(0, 'rgba(0,0,0,0.52)');
    sg.addColorStop(0.5, 'rgba(0,0,0,0.24)');
    sg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.scale(1, 0.32);
    ctx.fillStyle = sg;
    ctx.fillRect(cx - r, (cy / 0.32) - r, r * 2, r * 2);
    ctx.restore();
  }

  function drawActiveRing() {
    const ak = activeKey();
    if (!ak) return;
    const pos = displayPos(ak);
    if (!pos) return;
    const u = findUnit(ak);
    const s = cam.scale;
    const p = worldToScreen(pos.x, pos.y, cam);
    const cx = p.x + TILE * s / 2;
    const cy = p.y + (TILE - 1) * s;
    const pulse = 0.5 + 0.5 * Math.sin(clock / 380);
    const color = ak[0] === 'h' && u ? (SLOT_COLORS[(u.slot ?? 0) % 4] ?? '#fff') : '#e05050';
    ctx.save();
    ctx.globalAlpha = pulse * 0.12;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 7 * s, 2 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = 0.25 + pulse * 0.38;
    ctx.strokeStyle = color;
    ctx.lineWidth = s;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 7 * s, 2 * s, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    // sonar ping: two interleaved rings expanding outward (staggered by half-period)
    for (let pi = 0; pi < 2; pi++) {
      const pingPhase = ((clock + pi * 1100) / 2200) % 1;
      const pingRx = (7 + pingPhase * 6) * s;
      const pingRy = (2 + pingPhase * 1.8) * s;
      ctx.save();
      ctx.globalAlpha = (1 - pingPhase) * 0.38;
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1, s * 0.5);
      ctx.beginPath();
      ctx.ellipse(cx, cy, pingRx, pingRy, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawAmbientShadow() {
    if (!state?.board) return;
    const vw = canvas.width, vh = canvas.height - HUD_H;
    // Two slow drifting elliptical shadows suggesting something large far above
    for (let i = 0; i < 2; i++) {
      const period = 38000 + i * 17000;
      const phase = ((clock + i * (period >> 1)) % period) / period;
      const cx = vw * (0.12 + 0.76 * ((Math.sin(phase * Math.PI * 2 + i * 1.4) + 1) / 2));
      const cy = vh * (0.15 + 0.70 * ((Math.sin(phase * Math.PI * 2 * 0.63 + i * 2.1) + 1) / 2));
      const rx = vw * 0.12;
      const yscale = 0.44;
      ctx.save();
      ctx.scale(1, yscale);
      const sg = ctx.createRadialGradient(cx, cy / yscale, 0, cx, cy / yscale, rx);
      sg.addColorStop(0, 'rgba(0,0,0,0.042)');
      sg.addColorStop(0.55, 'rgba(0,0,0,0.018)');
      sg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = sg;
      ctx.fillRect(cx - rx, cy / yscale - rx, rx * 2, rx * 2);
      ctx.restore();
    }
  }

  function drawLightRays() {
    if (!state?.board) return;
    const vw = canvas.width, vh = canvas.height - HUD_H;
    for (let i = 0; i < 4; i++) {
      const ph = ((clock / 32000 + i * 0.25) % 1);
      const alpha = Math.sin(ph * Math.PI) * 0.036;
      if (alpha < 0.005) continue;
      const xc = vw * (0.12 + i * 0.24 + Math.sin(clock / 15000 + i * 1.7) * 0.05);
      const w2 = vw * (0.025 + i * 0.009);
      const sk = vw * 0.07;
      ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = '#e8f0ff';
      ctx.beginPath();
      ctx.moveTo(xc - w2, 0); ctx.lineTo(xc + w2, 0);
      ctx.lineTo(xc + w2 + sk, vh); ctx.lineTo(xc - w2 + sk, vh);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }

  function drawSectionSeams() {
    if (!state?.board) return;
    const vw = canvas.width, vh = canvas.height - HUD_H;
    const seamX = worldToScreen(10, 0, cam).x;
    const seamY = worldToScreen(0, 10, cam).y;
    const pulse = 0.08 + 0.04 * Math.sin(clock / 4200);
    // Vertical seam: amber (left sections) → white center → blue (right sections)
    { const g = ctx.createLinearGradient(seamX - 3, 0, seamX + 3, 0);
      g.addColorStop(0, 'rgba(255,190,50,0)');
      g.addColorStop(0.28, `rgba(255,190,50,${(pulse * 0.7).toFixed(3)})`);
      g.addColorStop(0.5, `rgba(220,228,255,${pulse.toFixed(3)})`);
      g.addColorStop(0.72, `rgba(60,130,255,${(pulse * 0.7).toFixed(3)})`);
      g.addColorStop(1, 'rgba(60,130,255,0)');
      ctx.fillStyle = g; ctx.fillRect(seamX - 3, 0, 6, vh); }
    // Horizontal seam: lavender (top half) → white center → mint (bottom half)
    { const g = ctx.createLinearGradient(0, seamY - 3, 0, seamY + 3);
      g.addColorStop(0, 'rgba(200,185,230,0)');
      g.addColorStop(0.28, `rgba(200,185,230,${(pulse * 0.7).toFixed(3)})`);
      g.addColorStop(0.5, `rgba(220,228,255,${pulse.toFixed(3)})`);
      g.addColorStop(0.72, `rgba(80,210,130,${(pulse * 0.7).toFixed(3)})`);
      g.addColorStop(1, 'rgba(80,210,130,0)');
      ctx.fillStyle = g; ctx.fillRect(0, seamY - 3, vw, 6); }
    // Center marker: small diamond at the board center where all four sections meet
    { const mx = seamX, my = seamY;
      const mp = (0.12 + 0.06 * Math.sin(clock / 3000)).toFixed(3);
      ctx.save(); ctx.globalAlpha = mp;
      ctx.strokeStyle = '#c8d4f0'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(mx, my - 6); ctx.lineTo(mx + 6, my);
      ctx.lineTo(mx, my + 6); ctx.lineTo(mx - 6, my);
      ctx.closePath(); ctx.stroke();
      ctx.fillStyle = '#c8d4f0'; ctx.fillRect(mx - 1, my - 1, 2, 2);
      ctx.restore(); }
    // Section-center rune markers: faint cross symbol at the midpoint of each quadrant
    const SECTION_CENTERS = [
      { wx: 5.5, wy: 5.5,  col: 'rgba(255,190,50,' },
      { wx: 15.5, wy: 5.5,  col: 'rgba(60,130,255,' },
      { wx: 5.5, wy: 15.5, col: 'rgba(60,200,80,' },
      { wx: 15.5, wy: 15.5, col: 'rgba(140,60,200,' },
    ];
    for (const sc of SECTION_CENTERS) {
      const sp = worldToScreen(sc.wx, sc.wy, cam);
      const rp = (0.06 + 0.03 * Math.sin(clock / 3800 + sc.wx)).toFixed(3);
      const rs = 5;
      ctx.save(); ctx.globalAlpha = rp;
      ctx.strokeStyle = sc.col + '1)'; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(sp.x - rs, sp.y); ctx.lineTo(sp.x + rs, sp.y);
      ctx.moveTo(sp.x, sp.y - rs); ctx.lineTo(sp.x, sp.y + rs);
      ctx.stroke();
      ctx.fillStyle = sc.col + '1)'; ctx.fillRect(sp.x - 1, sp.y - 1, 2, 2);
      ctx.restore();
    }
  }

  function drawDungeonHeartbeat() {
    if (!state?.board) return;
    const vw = canvas.width, vh = canvas.height - HUD_H;
    // Every ~8 s: a faint ring-pulse expands from center — the dungeon breathing
    const period = 8300;
    const phase = (clock % period) / period;
    if (phase > 0.20) return;
    const rp = phase / 0.20;
    const alpha = Math.sin(rp * Math.PI) * 0.030;
    if (alpha < 0.003) return;
    const cx = vw * 0.5, cy = vh * 0.5;
    const rMax = Math.hypot(vw, vh) * 0.5;
    const rInner = rMax * (0.02 + rp * 0.92);
    const rOuter = rInner + rMax * 0.07;
    const sg = ctx.createRadialGradient(cx, cy, Math.max(0, rInner), cx, cy, rOuter);
    sg.addColorStop(0, `rgba(180,165,210,0)`);
    sg.addColorStop(0.4, `rgba(180,165,210,${alpha.toFixed(4)})`);
    sg.addColorStop(1, `rgba(180,165,210,0)`);
    ctx.fillStyle = sg;
    ctx.fillRect(0, 0, vw, vh);
  }

  function drawVignette() {
    const w = canvas.width;
    const h = canvas.height - HUD_H;
    const breathe = 0.018 * Math.sin(clock / 5800);
    const grad = ctx.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, h * 0.9);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, `rgba(0,0,0,${(0.48 + breathe).toFixed(3)})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    // Section corner tint: faint color bloom from corner nearest the active unit's quadrant
    const ak = activeKey();
    if (ak && state?.board) {
      const ap = displayPos(ak);
      if (ap) {
        const [cx, cy, rgb] = ap.x < 10 && ap.y < 10 ? [0, 0, '255,190,50']
          : ap.x >= 10 && ap.y < 10 ? [w, 0, '60,130,255']
          : ap.x < 10 ? [0, h, '60,200,80']
          : [w, h, '140,60,200'];
        const ta = (0.07 + 0.03 * Math.sin(clock / 3800)).toFixed(3);
        const tg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.85);
        tg.addColorStop(0, `rgba(${rgb},${ta})`); tg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = tg; ctx.fillRect(0, 0, w, h);
      }
    }
  }

  function drawHunterWindow(h, i, y) {
    const active = activeKey() === `h${h.id}`;
    const defeated = h.maxHp > 0 && h.hp <= 0;
    const x = 2;
    const w = canvas.width - 4;
    ctx.fillStyle = defeated ? 'rgba(8,4,12,0.55)' : active ? 'rgba(220, 228, 255, 0.10)' : 'rgba(0, 0, 0, 0.30)';
    ctx.fillRect(x, y, w, 16);
    if (active) {
      const sc = SLOT_COLORS[h.slot % 4] ?? '#3a6ee0';
      const rg = ctx.createLinearGradient(x, y, x + 110, y);
      rg.addColorStop(0, sc + '30'); rg.addColorStop(1, sc + '00');
      ctx.fillStyle = rg; ctx.fillRect(x, y, w, 16);
    }
    ctx.fillStyle = defeated ? '#5a2030' : (SLOT_COLORS[h.slot % 4] ?? '#f0f4ff');
    ctx.fillRect(x, y, active ? 4 : 2, 16);
    const icon = atlas[`hunter${h.spriteId}.${paletteName(h)}.icon`];
    if (icon) { ctx.save(); ctx.globalAlpha = defeated ? 0.35 : 1; ctx.drawImage(icon, x + 6, y + 2, 12, 12); ctx.restore(); }
    if (active && !defeated) {
      ctx.save(); ctx.shadowBlur = 7; ctx.shadowColor = '#b07a08';
      text((h.name ?? '').slice(0, 7).padEnd(7), x + 22, y + 3, '#ffe98a');
      ctx.restore();
    } else {
      text((h.name ?? '').slice(0, 7).padEnd(7), x + 22, y + 3,
        defeated ? '#504858' : '#b8bccc');
    }
    text(`L${h.level ?? 1}`, x + 86, y + 3, active ? '#a8b0c4' : '#5e6278');
    // HP bar + number
    const ratio = h.maxHp ? clamp(h.hp / h.maxHp, 0, 1) : 0;
    ctx.fillStyle = '#1c1e28';
    ctx.fillRect(x + 112, y + 5, 52, 6);
    const bw = Math.round(52 * ratio);
    if (bw > 0) {
      const [hc0, hc1] = ratio > 0.5 ? ['#52da68', '#2d8f40'] : ratio > 0.25 ? ['#f2df4a', '#b89818'] : ['#f07060', '#a83028'];
      const hbg = ctx.createLinearGradient(x + 112, y + 5, x + 112, y + 11);
      hbg.addColorStop(0, hc0); hbg.addColorStop(1, hc1);
      ctx.fillStyle = hbg;
      ctx.fillRect(x + 112, y + 5, bw, 6);
    }
    if (bw > 2) { ctx.save(); ctx.globalAlpha = 0.28; ctx.fillStyle = '#fff';
      ctx.fillRect(x + 112, y + 5, bw, 2); ctx.restore(); }
    if (ratio <= 0.25 && bw > 0) {
      const urgency = 0.5 + 0.5 * Math.sin(clock / 240);
      ctx.save(); ctx.globalAlpha = urgency * 0.45; ctx.fillStyle = '#ff9a7e';
      ctx.fillRect(x + 112, y + 5, bw, 6); ctx.restore();
    }
    if (defeated) {
      ctx.save(); ctx.shadowBlur = 5; ctx.shadowColor = '#aa1828';
      text('KO', x + 168, y + 3, '#c03848');
      ctx.restore();
    } else if (active && ratio <= 0.25) {
      ctx.save(); ctx.shadowBlur = 7; ctx.shadowColor = '#a81020';
      text(`${h.hp}/${h.maxHp}`, x + 168, y + 3, '#f07060');
      ctx.restore();
    } else if (active && ratio <= 0.5) {
      ctx.save(); ctx.shadowBlur = 5; ctx.shadowColor = '#b09010';
      text(`${h.hp}/${h.maxHp}`, x + 168, y + 3, '#f2df4a');
      ctx.restore();
    } else {
      text(`${h.hp}/${h.maxHp}`, x + 168, y + 3, active ? '#c0c8d8' : '#8a90a0');
    }
    const iv = h.internal ?? { mv: 0, at: 0, df: 0 };
    { const sSegs = [
        { t: `MV+${Math.floor((iv.mv ?? 0) / 3)}`, c: active ? '#3a6ee0' : '#2a4e8c' },
        { t: ` AT${iv.at ?? 0}`, c: active ? '#cc4a3a' : '#7a2e24' },
        { t: ` DF${Math.floor((iv.df ?? 0) / 2)}`, c: active ? '#e0c63a' : '#8a7828' },
      ];
      setFont(12); ctx.textAlign = 'left';
      let ssx = x + 222;
      for (const seg of sSegs) {
        ctx.fillStyle = seg.c; ctx.fillText(seg.t, ssx | 0, (y + 3) | 0);
        ssx += Math.round(ctx.measureText(seg.t).width);
      } }
    // hand as mini card backs colored by card color
    let cx = x + 340;
    if (active && (h.hand?.length ?? 0) > 0) {
      const sc = SLOT_COLORS[h.slot % 4] ?? '#3a6ee0';
      const cg = ctx.createLinearGradient(x + 340, y, x + 340 + (h.hand.length) * 7 + 8, y);
      cg.addColorStop(0, sc + '28'); cg.addColorStop(1, 'transparent');
      ctx.save(); ctx.fillStyle = cg; ctx.fillRect(x + 340, y, (h.hand.length) * 7 + 8, 16); ctx.restore();
    }
    for (const cardId of h.hand ?? []) {
      const cc = CARD_MINI[String(cardId)[0]] ?? '#8d8d9e';
      // Shadow
      ctx.save(); ctx.globalAlpha = 0.4; ctx.fillStyle = '#000';
      ctx.fillRect(cx + 1, y + 4, 5, 9); ctx.restore();
      ctx.fillStyle = cc;
      ctx.fillRect(cx, y + 3, 5, 9);
      // Top highlight
      ctx.save(); ctx.globalAlpha = 0.38; ctx.fillStyle = '#fff';
      ctx.fillRect(cx + 1, y + 4, 3, 2); ctx.restore();
      // Bottom shadow stripe
      ctx.save(); ctx.globalAlpha = 0.32; ctx.fillStyle = '#000';
      ctx.fillRect(cx, y + 10, 5, 2); ctx.restore();
      ctx.strokeStyle = '#101018';
      ctx.strokeRect(cx + 0.5, y + 3.5, 5, 9);
      cx += 7;
    }
    if (h.hasTarget) {
      const tp = 0.38 + 0.32 * Math.sin(clock / 320);
      const tpg = ctx.createRadialGradient(cx + 6, y + 7, 1, cx + 6, y + 7, 11);
      tpg.addColorStop(0, '#ffe98a'); tpg.addColorStop(1, 'transparent');
      ctx.save(); ctx.globalAlpha = tp * 0.50; ctx.fillStyle = tpg;
      ctx.fillRect(cx - 2, y + 1, 18, 14); ctx.restore();
      blit('ui.targetMark', cx + 2, y + 3, 1);
    }
    // Active status condition indicators: pulsing colored glyph chips after hand
    let sdx = cx + (h.hasTarget ? 12 : 2);
    for (const sk of ['stun', 'leg', 'panic', 'empty']) {
      if (!(h.status?.[sk] > 0)) continue;
      const sp = 0.55 + 0.45 * Math.sin(clock / 350 + (sk === 'stun' ? 0 : sk === 'leg' ? 2.1 : sk === 'panic' ? 4.2 : 1.05));
      ctx.save(); ctx.globalAlpha = sp * 0.85; ctx.fillStyle = STATUS_GLOW[sk];
      ctx.fillRect(sdx, y + 4, 8, 8); ctx.restore();
      const sicon = atlas[`status.${sk}`];
      if (sicon) { ctx.save(); ctx.globalAlpha = sp; ctx.drawImage(sicon, sdx, y + 4, 8, 8); ctx.restore(); }
      sdx += 10;
    }
  }

  function drawHud() {
    const y0 = canvas.height - HUD_H;
    const hudGrad = ctx.createLinearGradient(0, y0, 0, y0 + HUD_H);
    hudGrad.addColorStop(0, '#141520'); hudGrad.addColorStop(1, '#09090f');
    ctx.fillStyle = hudGrad;
    ctx.fillRect(0, y0, canvas.width, HUD_H);
    // Subtle dot-grid texture overlay (browser only — document not available in Node tests)
    if (!_hudDotPat && typeof document !== 'undefined') {
      const off = Object.assign(document.createElement('canvas'), { width: 4, height: 4 });
      const oc = off.getContext('2d');
      oc.fillStyle = 'rgba(255,255,255,0.06)';
      oc.fillRect(0, 0, 1, 1);
      oc.fillStyle = 'rgba(255,255,255,0.03)';
      oc.fillRect(2, 2, 1, 1);
      _hudDotPat = ctx.createPattern(off, 'repeat');
    }
    if (_hudDotPat) {
      ctx.save(); ctx.globalAlpha = 0.55; ctx.fillStyle = _hudDotPat;
      ctx.fillRect(0, y0, canvas.width, HUD_H); ctx.restore();
    }
    const _ak = activeKey();
    const _ah = _ak?.[0] === 'h' ? findUnit(_ak) : null;
    const _sc = _ah ? (SLOT_COLORS[(_ah.slot ?? 0) % 4] ?? '#2a2c3a') : '#2a2c3a';
    // Glow above separator
    const sepGlow = ctx.createLinearGradient(0, y0 - 6, 0, y0 + 1);
    sepGlow.addColorStop(0, 'transparent');
    sepGlow.addColorStop(1, _sc + '55');
    ctx.fillStyle = sepGlow;
    ctx.fillRect(0, y0 - 6, canvas.width, 7);
    ctx.fillStyle = _sc;
    ctx.fillRect(0, y0, canvas.width, 1);
    (state.hunters ?? []).slice(0, 4).forEach((h, i) => drawHunterWindow(h, i, y0 + 3 + i * 18));
    // deck counter, top-right; pulses red when deck is nearly empty (WYRM spawns below 20)
    const deckLow = deckShown < 20;
    const deckUrgent = deckShown < 5;
    const deckPulse = deckLow ? 0.5 + 0.5 * Math.sin(clock / (deckUrgent ? 220 : 550)) : 0;
    if (deckLow) {
      ctx.save(); ctx.globalAlpha = deckPulse * 0.25; ctx.fillStyle = deckUrgent ? '#cc3333' : '#cc8833';
      ctx.fillRect(canvas.width - 80, 2, 78, 22); ctx.restore();
    }
    ctx.fillStyle = 'rgba(13, 14, 22, 0.8)';
    ctx.fillRect(canvas.width - 78, 4, 74, 18);
    ctx.fillStyle = CARD_MINI.B;
    ctx.fillRect(canvas.width - 74, 7, 8, 12);
    const deckColor = deckUrgent ? '#ff6a5a' : deckLow ? '#e0a850' : '#f0f4ff';
    if (deckLow) {
      ctx.save(); ctx.shadowBlur = deckUrgent ? 8 : 4; ctx.shadowColor = deckColor;
      text(`x${deckShown}`, canvas.width - 8, 8, deckColor, 12, 'right');
      ctx.restore();
    } else {
      text(`x${deckShown}`, canvas.width - 8, 8, deckColor, 12, 'right');
    }
  }

  function drawCombatant(k, x, y, flip) {
    const img = spriteFor(k);
    if (!img) return;
    const s3 = 3;
    const sw = img.width * s3;
    const sh = img.height * s3;
    const cx = x + sw / 2;
    const u = findUnit(k);
    const bobY = Math.round(Math.sin(clock / 650 + (flip ? 1.1 : 0)) * 2);
    const shadowScale = 1 - Math.abs(bobY) * 0.04;
    ctx.save(); ctx.globalAlpha = 0.38; ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(cx, y + sh + 3, sw * 0.38 * shadowScale, 5 * shadowScale, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.restore();
    // Unit-color aura behind sprite
    { const auraCol = k[0] === 'h' && u ? (SLOT_COLORS[(u.slot ?? 0) % 4]) : (u ? (MONSTER_LABEL_COLOR[u.kind] ?? '#9060d8') : '#9060d8');
      const ag = ctx.createRadialGradient(cx, y + bobY + sh * 0.52, 0, cx, y + bobY + sh * 0.52, sw * 0.55);
      ag.addColorStop(0, auraCol + '50'); ag.addColorStop(1, 'transparent');
      ctx.fillStyle = ag; ctx.fillRect(x - 4, y + bobY - 4, sw + 8, sh + 8); }
    ctx.save();
    if (flip) {
      ctx.translate(x + sw, y + bobY);
      ctx.scale(-1, 1);
      ctx.drawImage(img, 0, 0, sw, sh);
    } else {
      ctx.drawImage(img, x, y + bobY, sw, sh);
    }
    ctx.restore();
    if (u) {
      // Name in slot color (hunter) or monster label color, with faint glow
      { const nc = k[0] === 'h' ? (SLOT_COLORS[(u.slot ?? 0) % 4] ?? '#f0f4ff') : (MONSTER_LABEL_COLOR[u.kind] ?? '#ff8866');
        ctx.save(); ctx.shadowBlur = 8; ctx.shadowColor = nc;
        text(u.name ?? u.kind ?? '', cx, y + sh + 4, nc, 12, 'center');
        ctx.restore(); }
      // HP bar
      const ratio = u.maxHp ? clamp(u.hp / u.maxHp, 0, 1) : 0;
      const bw2 = sw;
      const barX = x;
      const barY = y + sh + 20;
      ctx.fillStyle = '#131520';
      ctx.fillRect(barX, barY, bw2, 5);
      const [cbc0, cbc1] = ratio > 0.5 ? ['#52da68', '#2d8f40'] : ratio > 0.25 ? ['#f2df4a', '#b89818'] : ['#f07060', '#a83028'];
      const cbg = ctx.createLinearGradient(barX, barY, barX, barY + 5);
      cbg.addColorStop(0, cbc0); cbg.addColorStop(1, cbc1);
      ctx.fillStyle = cbg;
      ctx.fillRect(barX, barY, Math.round(bw2 * ratio), 5);
      // shine on bar
      if (Math.round(bw2 * ratio) > 2) {
        ctx.save(); ctx.globalAlpha = 0.28; ctx.fillStyle = '#fff';
        ctx.fillRect(barX, barY, Math.round(bw2 * ratio), 2); ctx.restore();
      }
      const hpColor = ratio <= 0.25
        ? (0.5 + 0.5 * Math.sin(clock / 240)) > 0.5 ? '#ff8866' : '#cc4a3a'
        : '#8fd17e';
      if (ratio <= 0.25) {
        ctx.save(); ctx.shadowBlur = 7; ctx.shadowColor = '#ff6040';
        text(`${u.hp}/${u.maxHp}`, cx, barY + 8, hpColor, 11, 'center');
        ctx.restore();
      } else {
        text(`${u.hp}/${u.maxHp}`, cx, barY + 8, hpColor, 11, 'center');
      }
      // Active status chips centered below HP readout
      { const sts = ['stun', 'leg', 'panic', 'empty'].filter((sk) => u.status?.[sk] > 0);
        let ssx = Math.round(cx - (sts.length * 10 - 2) / 2);
        for (const sk of sts) {
          const sp2 = 0.55 + 0.45 * Math.sin(clock / 350);
          ctx.save(); ctx.globalAlpha = sp2 * 0.80; ctx.fillStyle = STATUS_GLOW[sk];
          ctx.fillRect(ssx, barY + 20, 8, 8); ctx.restore();
          const sicon = atlas[`status.${sk}`];
          if (sicon) { ctx.save(); ctx.globalAlpha = sp2; ctx.drawImage(sicon, ssx, barY + 20, 8, 8); ctx.restore(); }
          ssx += 10;
        } }
    }
  }

  function drawBattle() {
    const bw = Math.min(canvas.width - 24, 380);
    const bh = Math.min(canvas.height - HUD_H - 24, 230);
    const bx = (canvas.width - bw) / 2 | 0;
    const by = (canvas.height - HUD_H - bh) / 2 | 0;
    // Entry scale-in animation on battleStarted
    const _isEntry = anim?.ev.type === 'battleStarted';
    const _entryP = _isEntry ? 1 - Math.pow(1 - anim.t / anim.dur, 3) : 1;
    const _bScale = 0.78 + 0.22 * _entryP;
    const _bcx = (canvas.width / 2) | 0, _bcy = ((canvas.height - HUD_H) / 2) | 0;
    ctx.save();
    if (_isEntry) {
      ctx.globalAlpha = Math.max(0.05, _entryP);
      ctx.translate(_bcx, _bcy); ctx.scale(_bScale, _bScale); ctx.translate(-_bcx, -_bcy);
    }
    // Background
    ctx.fillStyle = 'rgba(14, 15, 26, 0.96)';
    ctx.fillRect(bx, by, bw, bh);
    // Arena stone-floor texture: small tile grid under fighters
    { const ts = 6, mw = 1;
      const tx0 = bx + 2, ty0 = by + 18, tx1 = bx + bw - 2, ty1 = by + bh - 2;
      for (let ty = ty0; ty < ty1; ty += ts + mw) {
        for (let tx = tx0; tx < tx1; tx += ts + mw) {
          const th = (((tx * 317 + ty * 149) ^ 0x5f3) >>> 0) & 0xFF;
          const shade = 40 + (th % 16);
          const a = (0.35 + (th >> 6) * 0.06).toFixed(2);
          const fw = Math.min(ts, tx1 - tx), fh = Math.min(ts, ty1 - ty);
          if (fw > 0 && fh > 0) {
            ctx.fillStyle = `rgba(${shade + 6},${shade + 4},${shade + 14},${a})`;
            ctx.fillRect(tx, ty, fw, fh);
          }
        }
      }
    }
    // Inner vignette for depth
    { const vg = ctx.createRadialGradient(bx + bw / 2, by + bh / 2, 20, bx + bw / 2, by + bh / 2, bh * 0.85);
      vg.addColorStop(0, 'rgba(30,28,44,0.0)'); vg.addColorStop(1, 'rgba(0,0,0,0.45)');
      ctx.fillStyle = vg; ctx.fillRect(bx, by, bw, bh); }
    // Team color backdrops â€” attacker left (red), defender right (cyan)
    { const al = ctx.createRadialGradient(bx + 70, by + 90, 0, bx + 70, by + 90, 80);
      al.addColorStop(0, 'rgba(200,55,35,0.22)'); al.addColorStop(1, 'transparent');
      ctx.fillStyle = al; ctx.fillRect(bx, by, bw / 2, bh); }
    { const dr = ctx.createRadialGradient(bx + bw - 70, by + 90, 0, bx + bw - 70, by + 90, 80);
      dr.addColorStop(0, 'rgba(60,168,200,0.18)'); dr.addColorStop(1, 'transparent');
      ctx.fillStyle = dr; ctx.fillRect(bx + bw / 2, by, bw / 2, bh); }
    // Outer glow border
    const bglow = 0.4 + 0.6 * Math.sin(clock / 280);
    ctx.save(); ctx.strokeStyle = '#cc4a3a'; ctx.lineWidth = 3 + bglow * 3;
    ctx.globalAlpha = bglow * 0.35; ctx.strokeRect(bx - 2, by - 2, bw + 4, bh + 4); ctx.restore();
    ctx.strokeStyle = '#cc4a3a'; ctx.lineWidth = 2;
    ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
    ctx.strokeStyle = 'rgba(240,180,160,0.18)'; ctx.lineWidth = 1;
    ctx.strokeRect(bx + 3, by + 3, bw - 6, bh - 6);
    // Ornamental corner brackets — L-shaped pixel-art brackets suggest a carved stone frame
    { const ba = 0.35 + 0.18 * Math.sin(clock / 1100);
      const blen = 10, btk = 2;
      ctx.save(); ctx.globalAlpha = ba; ctx.fillStyle = '#e0b090';
      // Top-left
      ctx.fillRect(bx + 5, by + 5, blen, btk); ctx.fillRect(bx + 5, by + 5, btk, blen);
      // Top-right
      ctx.fillRect(bx + bw - 5 - blen, by + 5, blen, btk); ctx.fillRect(bx + bw - 5 - btk, by + 5, btk, blen);
      // Bottom-left
      ctx.fillRect(bx + 5, by + bh - 5 - btk, blen, btk); ctx.fillRect(bx + 5, by + bh - 5 - blen, btk, blen);
      // Bottom-right
      ctx.fillRect(bx + bw - 5 - blen, by + bh - 5 - btk, blen, btk); ctx.fillRect(bx + bw - 5 - btk, by + bh - 5 - blen, btk, blen);
      ctx.restore(); }
    // Title bar
    ctx.fillStyle = 'rgba(180, 50, 40, 0.22)';
    ctx.fillRect(bx + 2, by + 2, bw - 4, 16);
    setFont(11);
    ctx.save(); ctx.shadowBlur = 10; ctx.shadowColor = '#cc3a3a';
    ctx.fillStyle = '#f0c8c0';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText('B A T T L E', (bx + bw / 2) | 0, by + 4);
    ctx.restore();
    ctx.textAlign = 'left';
    text('ATTACKER', bx + 8, by + 5, 'rgba(255,230,180,0.55)', 9, 'left');
    text('DEFENDER', bx + bw - 8, by + 5, 'rgba(154,223,232,0.55)', 9, 'right');
    const defImg = spriteFor(battle.d);
    const defW = defImg ? defImg.width * 3 : 48;
    // Lunge animation: attacker surges toward center on strikeRolled, defender staggers back
    const _isStrike = anim?.ev.type === 'strikeRolled';
    const _sp = _isStrike ? anim.t / anim.dur : 0;
    const _lungeX = _isStrike ? Math.round(Math.sin(_sp * Math.PI) * 24) : 0;
    const _staggerX = (_isStrike && _sp > 0.5) ? Math.round(Math.sin((_sp - 0.5) * Math.PI) * 12) : 0;
    drawCombatant(battle.a, bx + 24 + _lungeX, by + 28, false);
    drawCombatant(battle.d, bx + bw - 24 - defW + _staggerX, by + 28, true);
    // Center divider â€” thin vertical line with gradient fade to top/bottom
    { const dvx = (bx + bw / 2) | 0;
      const dvAlpha = 0.18 + 0.10 * Math.sin(clock / 900);
      const dvg = ctx.createLinearGradient(dvx, by + 18, dvx, by + bh - 8);
      dvg.addColorStop(0, 'transparent'); dvg.addColorStop(0.2, '#ffe98a');
      dvg.addColorStop(0.8, '#ffe98a'); dvg.addColorStop(1, 'transparent');
      ctx.save(); ctx.globalAlpha = dvAlpha; ctx.fillStyle = dvg;
      ctx.fillRect(dvx, by + 18, 1, bh - 26); ctx.restore(); }
    // VS with gold glow
    { const vcx = bx + bw / 2, vcy = by + 50;
      const vg = ctx.createRadialGradient(vcx, vcy, 0, vcx, vcy, 26);
      vg.addColorStop(0, 'rgba(220,190,60,0.38)'); vg.addColorStop(1, 'transparent');
      ctx.fillStyle = vg; ctx.fillRect(vcx - 26, vcy - 18, 52, 36); }
    ctx.save(); ctx.shadowBlur = 10; ctx.shadowColor = '#c09020';
    text('VS', bx + bw / 2, by + 42, '#ffe98a', 16, 'center');
    ctx.restore();
    // Pre-attack advantage readout: show raw AT vs DF stat delta before dice are revealed
    if (!battle.escape && !battle.strike) {
      const au = findUnit(battle.a), du = findUnit(battle.d);
      const atkAt = au ? (au.at ?? au.internal?.at ?? 0) : 0;
      const defDf = du ? (du.df ?? Math.floor((du.internal?.df ?? 0) / 2)) : 0;
      const delta = atkAt - defDf;
      const deltaStr = delta > 0 ? `+${delta}` : String(delta);
      const deltaCol = delta > 2 ? '#ff9a40' : delta > 0 ? '#e0c63a' : delta === 0 ? '#9aa0b4' : '#4a9de0';
      const segs = [
        { t: `AT ${atkAt}`, c: '#cc4a3a', shadow: '#8a2a2a' },
        { t: ' | ', c: '#9aa0b4', shadow: null },
        { t: `DF ${defDf}`, c: '#4a9de0', shadow: '#2a4da0' },
        { t: `  (${deltaStr})`, c: deltaCol, shadow: null },
      ];
      setFont(11); ctx.textBaseline = 'top'; ctx.textAlign = 'left';
      const adW = segs.reduce((w, s) => w + ctx.measureText(s.t).width, 0);
      let ax = (bx + bw / 2 - adW / 2) | 0;
      const ay = (by + 64) | 0;
      ctx.save();
      for (const s of segs) {
        ctx.shadowBlur = s.shadow ? 6 : 0; ctx.shadowColor = s.shadow ?? 'transparent';
        ctx.fillStyle = s.c; ctx.fillText(s.t, ax, ay); ax += ctx.measureText(s.t).width;
      }
      ctx.restore(); ctx.textAlign = 'left';
    }
    if (battle.response) {
      const RESP_COLOR = { counter: '#cc4a3a', guard: '#e0c63a', escape: '#4a7dff', surrender: '#9aa0b4' };
      const rc = RESP_COLOR[battle.response] ?? '#9adfe8';
      ctx.save(); ctx.shadowBlur = 8; ctx.shadowColor = rc;
      text(String(battle.response).toUpperCase(), bx + bw / 2, by + 64, rc, 12, 'center');
      ctx.restore();
    }
    if (battle.escape) {
      const e = battle.escape;
      const ec = e.escaped ? '#8fd17e' : '#ff6a5a';
      const dV = String(e.dTotal ?? '?');
      const aV = String(e.aTotal ?? '?');
      const result = e.escaped ? ' FLED!' : ' CAUGHT';
      const segs = [
        { t: 'ESCAPE ', c: '#9aa0b4', shadow: null },
        { t: dV, c: '#4a7dff', shadow: '#2a4da0' },
        { t: ' vs ', c: '#9aa0b4', shadow: null },
        { t: aV, c: '#cc4a3a', shadow: '#8a2a2a' },
        { t: result, c: ec, shadow: ec },
      ];
      setFont(12); ctx.textBaseline = 'top'; ctx.textAlign = 'left';
      const fullW = segs.reduce((w, s) => w + ctx.measureText(s.t).width, 0);
      let ex = (bx + bw / 2 - fullW / 2) | 0;
      const ey = (by + 84) | 0;
      ctx.save();
      for (const s of segs) {
        ctx.shadowBlur = s.shadow ? 8 : 0; ctx.shadowColor = s.shadow ?? 'transparent';
        ctx.fillStyle = s.c;
        ctx.fillText(s.t, ex, ey);
        ex += ctx.measureText(s.t).width;
      }
      ctx.restore(); ctx.textAlign = 'left';
    }
    if (battle.strike) {
      const st = battle.strike;
      const rolling = anim?.ev.type === 'strikeRolled' && anim.t / anim.dur < 0.5;
      const dice = st.dice.length ? st.dice : [1, 1, 1, 1];
      dice.slice(0, 4).forEach((d, i) => {
        const v = rolling ? 1 + Math.floor(clock / 70 + i * 3) % 6 : d;
        const side = i < dice.length / 2 ? bx + 24 + i * 20 : bx + bw - 64 + (i - dice.length / 2) * 20;
        blit(`chip.${v}`, side, by + 120, 2);
      });
      if (!rolling) {
        if (st.totals) {
          const atkV = String(st.totals.atk ?? '?');
          const defV = String(st.totals.def ?? '?');
          const vsStr = ' vs ';
          setFont(12); ctx.textBaseline = 'top'; ctx.textAlign = 'left';
          const fullW = ctx.measureText(atkV + vsStr + defV).width;
          let sx = (bx + bw / 2 - fullW / 2) | 0;
          const ty2 = (by + 124) | 0;
          ctx.save();
          ctx.shadowBlur = 6; ctx.shadowColor = '#cc4a3a'; ctx.fillStyle = '#cc4a3a';
          ctx.fillText(atkV, sx, ty2); sx += ctx.measureText(atkV).width;
          ctx.shadowBlur = 0; ctx.fillStyle = '#9aa0b4';
          ctx.fillText(vsStr, sx, ty2); sx += ctx.measureText(vsStr).width;
          ctx.shadowBlur = 6; ctx.shadowColor = '#c0a030'; ctx.fillStyle = '#e0c63a';
          ctx.fillText(defV, sx, ty2);
          ctx.restore(); ctx.textAlign = 'left';
        }
        { const dmgCx = (bx + bw / 2) | 0, dmgCy = (by + 150) | 0;
          // popP: 0 at dice-stop (anim 50%), 1 at anim 85%
          const popP = (anim?.ev.type === 'strikeRolled') ? Math.min(1, (anim.t / anim.dur - 0.5) / 0.35) : 1;
          const popScale = 1 + Math.sin(Math.max(0, popP) * Math.PI) * 0.40;
          // Rolling counter: tick from 0 â†’ damage during first half of pop phase,
          // so the number locks at full value exactly when the bounce-in peaks (popP=0.5).
          const showDmg = (anim?.ev.type === 'strikeRolled' && popP < 0.5)
            ? Math.max(1, Math.round(st.damage * (popP / 0.5)))
            : st.damage;
          const dmgCol = showDmg >= 9 ? '#ffe050' : showDmg >= 6 ? '#ff9a40' : '#ff6a5a';
          const dmgShadow = showDmg >= 9 ? '#e0a010' : showDmg >= 6 ? '#d06010' : '#ff5050';
          ctx.save();
          ctx.translate(dmgCx, dmgCy); ctx.scale(popScale, popScale); ctx.translate(-dmgCx, -dmgCy);
          ctx.shadowBlur = showDmg >= 6 ? 20 : 14; ctx.shadowColor = dmgShadow;
          text(`-${showDmg}`, dmgCx, dmgCy, dmgCol, 24, 'center');
          ctx.restore(); }
        if (st.crit && anim?.ev.type === 'strikeRolled') {
          const p = anim.t / anim.dur;
          if (p > 0.5) {
            // Crit flash: instant full-brightness burst at dice-stop, then slow fade to end
            const fp = (p - 0.5) / 0.5;
            const fadeAlpha = fp < 0.12 ? fp / 0.12 : 1 - (fp - 0.12) / 0.88;
            // Gold radial burst from center
            const ccx = bx + bw / 2, ccy = by + bh / 2;
            const cg = ctx.createRadialGradient(ccx, ccy, 0, ccx, ccy, bh * 0.8);
            cg.addColorStop(0, `rgba(255,240,140,${(fadeAlpha * 0.9).toFixed(2)})`);
            cg.addColorStop(0.4, `rgba(220,160,20,${(fadeAlpha * 0.5).toFixed(2)})`);
            cg.addColorStop(1, 'transparent');
            ctx.save(); ctx.fillStyle = cg; ctx.fillRect(bx, by, bw, bh); ctx.restore();
            // White rim flash â€” only during initial burst
            if (fadeAlpha > 0.2) {
              ctx.save(); ctx.globalAlpha = fadeAlpha * 0.35; ctx.fillStyle = '#fff';
              ctx.fillRect(bx, by, bw, bh); ctx.restore();
            }
            ctx.save(); ctx.shadowBlur = 22; ctx.shadowColor = '#ffe060';
            text('CRIT!', bx + bw / 2, by + bh / 2 - 10, '#ffe98a', 28, 'center');
            ctx.restore();
          }
        }
        // Spark burst: pixel particles fly from the damage number on reveal
        { const p2 = anim?.ev.type === 'strikeRolled' ? anim.t / anim.dur : 1;
          if (p2 >= 0.5 && p2 < 0.92) {
            const sp = (p2 - 0.5) / 0.42;
            const dmgCx = (bx + bw / 2) | 0, dmgCy = (by + 150) | 0;
            const dcol = st.crit ? '#ffe98a' : st.damage >= 6 ? '#ff9a40' : '#ff6060';
            for (let i = 0; i < 20; i++) {
              const sh = ((i * 1481 + 397) ^ 0x2b3f) & 0xFFFF;
              const angle = (sh & 0xFF) / 255 * Math.PI * 2;
              const spd = 14 + ((sh >> 8) & 0x1F);
              const px = dmgCx + Math.cos(angle) * sp * spd;
              const py = dmgCy + Math.sin(angle) * sp * spd + sp * sp * 10;
              const sa = Math.sin(Math.min(1, sp * 2.5) * Math.PI) * (0.55 + (sh & 7) * 0.04);
              if (sa < 0.04) continue;
              ctx.save();
              ctx.globalAlpha = sa;
              ctx.fillStyle = (sh >> 12 & 1) ? '#fff8e0' : dcol;
              const ss = Math.max(1, 3 - Math.round(sp * 2));
              ctx.fillRect((px - 0.5) | 0, (py - 0.5) | 0, ss, ss);
              ctx.restore();
            }
          }
        }
      }
    }
    ctx.restore(); // entry scale-in
  }

  function drawBanner() {
    const bw = canvas.width;
    const by = (canvas.height - HUD_H) / 2 - 20;
    ctx.fillStyle = 'rgba(10, 10, 18, 0.88)';
    ctx.fillRect(0, by, bw, 40);
    // Color wash
    ctx.save(); ctx.globalAlpha = 0.12; ctx.fillStyle = banner.color;
    ctx.fillRect(0, by, bw, 40); ctx.restore();
    // Horizontal shimmer scan that sweeps across the banner
    const scanX = ((clock % 1800) / 1800) * (bw + 80) - 40;
    const scan = ctx.createLinearGradient(scanX - 40, 0, scanX + 40, 0);
    scan.addColorStop(0, 'transparent');
    scan.addColorStop(0.5, 'rgba(255,255,255,0.12)');
    scan.addColorStop(1, 'transparent');
    ctx.save(); ctx.fillStyle = scan; ctx.fillRect(0, by, bw, 40); ctx.restore();
    // top & bottom accent lines
    ctx.save();
    ctx.globalAlpha = 0.65;
    ctx.fillStyle = banner.color;
    ctx.fillRect(0, by, bw, 2);
    ctx.fillRect(0, by + 38, bw, 2);
    ctx.restore();
    // drop-shadow + main text â€” scale pop on appear
    const age = clock - (banner.startMs ?? clock);
    const popT = Math.min(age / 280, 1);
    const bscale = 1 + Math.sin(popT * Math.PI) * 0.18;
    const tsz = Math.round(20 * bscale);
    const ty = by + 10 + Math.round((20 - tsz) * 0.5);
    text(banner.text, bw / 2 + 1, ty + 1, 'rgba(0,0,0,0.65)', tsz, 'center');
    ctx.save(); ctx.shadowBlur = 16; ctx.shadowColor = banner.color;
    text(banner.text, bw / 2, ty, banner.color, tsz, 'center');
    ctx.restore();
    // Persistent particles: confetti drifting up on win, falling ash on loss
    const isWin = banner.color === '#ffe98a';
    const isLoss = banner.color === '#ff6a5a';
    if (isWin || isLoss) {
      const WIN_CONF = ['#ffe98a', '#ffffff', '#7ee8a0', '#f0b0ff', '#80d0ff', '#ffc040'];
      const LOSS_ASH = ['#8a3020', '#602010', '#c05040', '#3a2010'];
      const np = isWin ? 28 : 16;
      for (let i = 0; i < np; i++) {
        const period = 2100 + i * 140;
        const phase = ((clock * 0.9 + i * 1733) % period) / period;
        const pa = Math.sin(phase * Math.PI) * (isWin ? 0.75 : 0.55);
        if (pa < 0.05) continue;
        const px = ((bw * ((i * 0.0618 + phase * 0.32) % 1)) | 0);
        const drift = Math.sin(phase * Math.PI * 2.8 + i * 1.9) * 5;
        const py = isWin
          ? ((by - 6 - phase * 34 + drift) | 0)
          : ((by + 46 + phase * 30 + drift) | 0);
        const pcol = isWin ? WIN_CONF[i % WIN_CONF.length] : LOSS_ASH[i % LOSS_ASH.length];
        const psz = phase < 0.45 ? 2 : 1;
        ctx.save(); ctx.globalAlpha = pa; ctx.fillStyle = pcol;
        ctx.fillRect(px, py, psz, psz);
        ctx.restore();
      }
    }
  }

  // --- public API --------------------------------------------------------------
  return {
    setState(s) {
      diffOverrides(state, s);
      state = s;
      if (!s?.result) banner = null;
      if (!anim && !queue.length) deckShown = s?.deck?.length ?? 0;
    },

    pushEvents(events) {
      for (const ev of events ?? []) queue.push(ev);
    },

    update(dtMs) {
      clock += dtMs;
      let rem = dtMs;
      while (rem > 0) {
        if (!anim) {
          if (!queue.length) break;
          const ev = queue.shift();
          anim = { ev, t: 0, dur: eventDuration(ev.type, timeScale) };
          startEvent(ev);
        }
        const step = Math.min(rem, anim.dur - anim.t);
        anim.t += step;
        rem -= step;
        applyAnimProgress();
        if (anim.t >= anim.dur) { endEvent(anim.ev); anim = null; }
      }
      if (!anim && !queue.length && state) idleSync();
      floats = floats.filter((f) => (f.t += dtMs) < f.ttl);
      sparkles = sparkles.filter((s) => (s.t += dtMs) < s.ttl);
      pulseRings = pulseRings.filter((r) => (r.t += dtMs) < r.ttl);
      // Torch smoke: periodically emit a wispy particle from wall torch tiles
      if (state?.board) {
        smokeSeed += dtMs;
        while (smokeSeed > 200) {
          smokeSeed -= 200;
          const b = state.board;
          const { w: vw, h: vh } = viewSize();
          const x0 = Math.max(0, Math.floor(cam.x / TILE));
          const y0 = Math.max(0, Math.floor(cam.y / TILE));
          const x1 = Math.min(b.w - 1, Math.ceil((cam.x + vw) / TILE));
          const y1 = Math.min(b.h - 1, Math.ceil((cam.y + vh) / TILE));
          for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
              if (b.floor[y]?.[x] || !b.floor[y + 1]?.[x]) continue;
              const wh = ((x * 1637 + y * 3571) ^ 997) & 0xFFFF;
              if ((wh & 0xFF) < 20 || ((wh >> 8) & 0xFF) >= 16) continue;
              if (Math.random() > 0.10) continue;
              const wx = x + ((wh >> 4 & 0xF) + 1) / 16;
              sparkles.push({ wx, wy: y + 0.85,
                vx: (Math.random() - 0.5) * 0.18,
                vy: -0.55 - Math.random() * 0.25,
                t: 0, ttl: 1600 + Math.random() * 700,
                color: wh & 1 ? '#241420' : '#1c1428', round: true, alpha0: 0.26 });
              // Rare glowing ember: ~5% chance, faster rise, section-tinted
              if (Math.random() < 0.05) {
                const emberCols = x < 10
                  ? (y < 10 ? ['#ff9030', '#ffc840'] : ['#30c040', '#80e060'])
                  : (y < 10 ? ['#3080ff', '#80c0ff'] : ['#c030ff', '#ff80ff']);
                sparkles.push({ wx, wy: y + 0.82,
                  vx: (Math.random() - 0.5) * 0.10,
                  vy: -0.90 - Math.random() * 0.35,
                  t: 0, ttl: 500 + Math.random() * 320,
                  color: Math.random() < 0.5 ? emberCols[0] : emberCols[1], round: true, alpha0: 0.60 });
              }
            }
          }
          // Cold air wisps rising from pit tiles
          for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
              if (b.floor[y]?.[x] || b.floor[y + 1]?.[x]) continue; // only pits
              if (Math.random() > 0.022) continue;
              const pph = ((x * 3131 + y * 2777) ^ 1783) & 0xFFFF;
              sparkles.push({
                wx: x + ((pph >> 4 & 0xF) + 1) / 16,
                wy: y + 0.38 + ((pph >> 8) & 7) / 14,
                vx: (Math.random() - 0.5) * 0.07,
                vy: -0.30 - Math.random() * 0.18,
                t: 0, ttl: 1300 + Math.random() * 700,
                color: pph & 1 ? '#1e2840' : '#222c4a', round: true, alpha0: 0.15,
              });
            }
          }
        }
      }
      // Status condition ambient particles
      if (state?.hunters || state?.monsters) {
        for (const h of state.hunters ?? []) {
          const hpos = displayPos(`h${h.id}`);
          if (!hpos) continue;
          if ((h.status?.stun ?? 0) > 0 && Math.random() > 0.92) {
            const ang = (clock / 520) + h.id * 2.1 + Math.random() * 0.8;
            sparkles.push({ wx: hpos.x + 0.5 + Math.cos(ang) * 0.38, wy: hpos.y + 0.18 + Math.sin(ang) * 0.22,
              vx: 0, vy: -0.10, t: 0, ttl: 460 + Math.random() * 180,
              color: '#ffe060', round: false, alpha0: 0.62 });
          }
          if ((h.status?.panic ?? 0) > 0 && Math.random() > 0.90) {
            sparkles.push({ wx: hpos.x + 0.1 + Math.random() * 0.8, wy: hpos.y + Math.random() * 0.7,
              vx: (Math.random() - 0.5) * 0.52, vy: -0.16 - Math.random() * 0.10,
              t: 0, ttl: 320 + Math.random() * 180,
              color: Math.random() < 0.6 ? '#70a8ff' : '#d8eeff', round: true, alpha0: 0.48 });
          }
          if ((h.status?.leg ?? 0) > 0 && Math.random() > 0.93) {
            sparkles.push({ wx: hpos.x + 0.25 + Math.random() * 0.5, wy: hpos.y + 0.6 + Math.random() * 0.3,
              vx: (Math.random() - 0.5) * 0.08, vy: 0.18 + Math.random() * 0.12,
              t: 0, ttl: 280 + Math.random() * 140,
              color: Math.random() < 0.7 ? '#cc2828' : '#8a1818', round: true, alpha0: 0.55 });
          }
          if ((h.status?.empty ?? 0) > 0 && Math.random() > 0.94) {
            sparkles.push({ wx: hpos.x + 0.2 + Math.random() * 0.6, wy: hpos.y + 0.1 + Math.random() * 0.6,
              vx: (Math.random() - 0.5) * 0.30, vy: -0.06 - Math.random() * 0.08,
              t: 0, ttl: 500 + Math.random() * 250,
              color: Math.random() < 0.5 ? '#8090a0' : '#b0b8c8', round: true, alpha0: 0.30 });
          }
        }
        for (const m of state.monsters ?? []) {
          const mpos = displayPos(`m${m.id}`);
          if (!mpos) continue;
          if ((m.status?.stun ?? 0) > 0 && Math.random() > 0.92) {
            const ang = (clock / 520) + m.id * 2.1 + Math.random() * 0.8;
            sparkles.push({ wx: mpos.x + 0.5 + Math.cos(ang) * 0.38, wy: mpos.y + 0.18 + Math.sin(ang) * 0.22,
              vx: 0, vy: -0.10, t: 0, ttl: 460 + Math.random() * 180,
              color: '#ffe060', round: false, alpha0: 0.62 });
          }
          if ((m.status?.panic ?? 0) > 0 && Math.random() > 0.90) {
            sparkles.push({ wx: mpos.x + 0.1 + Math.random() * 0.8, wy: mpos.y + Math.random() * 0.7,
              vx: (Math.random() - 0.5) * 0.52, vy: -0.16 - Math.random() * 0.10,
              t: 0, ttl: 320 + Math.random() * 180,
              color: Math.random() < 0.6 ? '#70a8ff' : '#d8eeff', round: true, alpha0: 0.48 });
          }
          if ((m.status?.leg ?? 0) > 0 && Math.random() > 0.93) {
            sparkles.push({ wx: mpos.x + 0.25 + Math.random() * 0.5, wy: mpos.y + 0.6 + Math.random() * 0.3,
              vx: (Math.random() - 0.5) * 0.08, vy: 0.18 + Math.random() * 0.12,
              t: 0, ttl: 280 + Math.random() * 140,
              color: Math.random() < 0.7 ? '#cc2828' : '#8a1818', round: true, alpha0: 0.55 });
          }
        }
      }
      // Rescue NPC distress beacon: rising green motes above the survivor tile
      if (state?.board?.rescue && !state.board.rescue.claimed && Math.random() > 0.88) {
        const rx = state.board.rescue.x, ry = state.board.rescue.y;
        sparkles.push({
          wx: rx + 0.15 + Math.random() * 0.7,
          wy: ry + Math.random() * 0.5,
          vx: (Math.random() - 0.5) * 0.12,
          vy: -0.22 - Math.random() * 0.18,
          t: 0, ttl: 520 + Math.random() * 280,
          color: Math.random() < 0.65 ? '#5ef090' : '#c0ffd8', round: true, alpha0: 0.55,
        });
      }
      // Die chip tumble: scatter small stone-dust flecks while the die is rolling
      if (anim?.ev.type === 'dieRolled' && anim.t / anim.dur < 0.6 && Math.random() > 0.82) {
        const k = evKey(anim.ev);
        const pos = displayPos(k);
        if (pos) {
          sparkles.push({
            wx: pos.x + 0.2 + Math.random() * 0.6,
            wy: pos.y - 0.05 + Math.random() * 0.25,
            vx: (Math.random() - 0.5) * 0.55,
            vy: -0.28 - Math.random() * 0.22,
            t: 0, ttl: 180 + Math.random() * 140,
            color: Math.random() < 0.55 ? '#c4ae8a' : '#e8dfc8', round: false, alpha0: 0.38,
          });
        }
      }
      if (shake && (shake.t += dtMs) >= shake.dur) shake = null;
      if (turnFlash && (turnFlash.t += dtMs) >= turnFlash.dur) turnFlash = null;
      moveCamera(dtMs);
    },

    draw() {
      if (!ctx) return;
      ctx.fillStyle = '#0b0b12';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (!state) return;
      ctx.save();
      if (shake) {
        const m = shake.mag * (1 - shake.t / shake.dur) * cam.scale;
        ctx.translate(Math.round((Math.random() * 2 - 1) * m), Math.round((Math.random() * 2 - 1) * m));
      }
      drawBoard();
      drawAmbientShadow();
      drawFog();
      drawSectionSeams();
      drawLightRays();
      drawAmbientShimmer();
      drawOverlays();
      drawUnits();
      drawUnitLabels();
      drawDieChip();
      drawFloats();
      drawCursor();
      ctx.restore();
      drawVignette();
      drawDungeonHeartbeat();
      // Heartbeat edge glow when any hunter is at critical HP (â‰¤25%)
      if (state?.hunters) {
        for (const hh of state.hunters) {
          if (!(hh.hp > 0) || !hh.maxHp) continue;
          const ratio = hh.hp / hh.maxHp;
          if (ratio > 0.25) continue;
          const hpDanger = 1 - ratio * 4;  // 0 at 25%, 1 at 0%
          const beatCycle = 1300;
          const bp = (clock % beatCycle) / beatCycle;
          const b1 = bp < 0.12 ? Math.sin(bp * Math.PI / 0.12) : 0;
          const b2 = bp > 0.18 && bp < 0.30 ? Math.sin((bp - 0.18) * Math.PI / 0.12) * 0.65 : 0;
          const beatPulse = Math.max(b1, b2);
          if (beatPulse <= 0) continue;
          const maxAlpha = 0.18 + 0.20 * hpDanger;
          const fa = beatPulse * maxAlpha;
          const fw = canvas.width, fh = canvas.height - HUD_H;
          const hg = ctx.createRadialGradient(fw / 2, fh / 2, fh * 0.28, fw / 2, fh / 2, fh * 0.82);
          hg.addColorStop(0, 'transparent');
          hg.addColorStop(1, '#cc2222');
          ctx.save(); ctx.globalAlpha = fa; ctx.fillStyle = hg;
          ctx.fillRect(0, 0, fw, fh); ctx.restore();
          break;  // one heartbeat overlay is enough
        }
      }
      if (turnFlash) {
        const fa = (1 - turnFlash.t / turnFlash.dur) * 0.28;
        const fw = canvas.width, fh = canvas.height - HUD_H;
        const tg = ctx.createRadialGradient(fw / 2, fh / 2, fh * 0.25, fw / 2, fh / 2, fh * 0.85);
        tg.addColorStop(0, 'transparent');
        tg.addColorStop(1, turnFlash.color);
        ctx.save(); ctx.globalAlpha = fa; ctx.fillStyle = tg;
        ctx.fillRect(0, 0, fw, fh); ctx.restore();
      }
      drawHud();
      if (battle) drawBattle();
      if (banner) drawBanner();
    },

    busy() {
      return anim !== null || queue.length > 0;
    },

    skip() {
      while (anim || queue.length) {
        if (!anim) {
          const ev = queue.shift();
          anim = { ev, t: 0, dur: EVENT_DURATIONS[ev.type] ?? 200 };
          startEvent(ev);
        }
        anim.t = anim.dur;
        applyAnimProgress();
        endEvent(anim.ev);
        anim = null;
      }
      floats = [];
      sparkles = [];
      pulseRings = [];
      shake = null;
      turnFlash = null;
      unitFlash = null;
      if (state) idleSync();
      const t = camTarget();
      cam.x = t.x;
      cam.y = t.y;
    },

    tileAtPixel(px, py) {
      if (!state?.board) return null;
      if (py >= canvas.height - HUD_H) return null;
      const t = screenToWorld(px, py, cam);
      if (t.x < 0 || t.y < 0 || t.x >= state.board.w || t.y >= state.board.h) return null;
      return t;
    },

    panTo(x, y) {
      manualPan = { x, y };
    },

    setCursor(pos) {
      cursor = pos ?? null;
    },

    setTimeScale(s) {
      timeScale = typeof s === 'number' && s > 0 ? s : 1;
    },

    showRange(cells) {
      overlays.range = cells instanceof Set ? cells : new Set(cells ?? []);
    },

    showPath(path) {
      overlays.path = path ?? null;
    },

    clearOverlays() {
      overlays = { range: null, path: null };
      cursor = null;
    },
  };
}
