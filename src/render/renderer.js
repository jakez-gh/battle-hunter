// Canvas 2D renderer: draws a GameState and animates the engine event queue
// (DESIGN 1.3, 1.4, 3.3). Pure presentation — no engine imports; state and
// events arrive as plain data and nothing here mutates them. The engine
// advances instantly; this module's queue plays catch-up visually, one timed
// step per event, all skippable. Module top level is pure (projection math,
// timing table) so importing under Node is safe; only createRenderer() needs
// a DOM (it bakes the sprite atlas).
import { buildAtlas, PALETTE_NAMES } from './sprites.js';

export const TILE = 16;       // sprite-space pixels per board tile
export const HUD_H = 76;      // screen pixels reserved for the bottom strip

// ms per event type — every DESIGN 3.3 event animates as one timed step.
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
  let manualPan = null;                // {x,y} tile — scout mode camera target

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
  let floats = [];                     // {text,color,icon,wx,wy,t,ttl,big}
  let sparkles = [];                   // {wx,wy,vx,vy,t,ttl,color[,round,alpha0]}
  let smokeSeed = 0;                   // timer for torch-smoke emission
  let shake = null;                    // {t,dur,mag}
  let unitFlash = null;                // {key,t,dur,color}
  let turnFlash = null;                // {color,t,dur} — screen-edge glow on turn start
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

  function evKey(ev) {
    return unitKey(ev.unit ?? ev.hunter ?? ev.monster ?? null);
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
      wx: p.x + 0.5, wy: p.y, t: 0, ttl: extra.ttl ?? 800 });
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
          addSparkles(k, '#c8d0ff');
          const tu = findUnit(k);
          const tc = SLOT_COLORS[(tu?.slot ?? 0) % 4] ?? '#c8d0ff';
          turnFlash = { color: tc, t: 0, dur: 520 };
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
        }
        break;
      }
      case 'monsterMoved': {
        const mfrom = ev.from ?? null;
        beginSlide(k, mfrom,
          ev.to ?? ev.pos ?? (Array.isArray(ev.path) ? ev.path[ev.path.length - 1] : null));
        // Monster footstep dust from departure tile
        if (mfrom) {
          const STEP_COL = { VAC: '#3080a8', OOZ: '#288a38', FNG: '#9a6c20', WYRM: '#5c1c9a' };
          const mu = findUnit(k);
          const mc = STEP_COL[mu?.kind] ?? '#664444';
          for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2;
            sparkles.push({ wx: mfrom.x + 0.5, wy: mfrom.y + 0.5,
              vx: Math.cos(a) * 0.6, vy: Math.sin(a) * 0.6,
              t: 0, ttl: 350, color: mc });
          }
          // VAC sonar burst: fast ring of 12 cyan pixels radiating outward
          if (mu?.kind === 'VAC') {
            for (let i = 0; i < 12; i++) {
              const a = (i / 12) * Math.PI * 2;
              const spd = 2.2 + (i % 3) * 0.5;
              sparkles.push({ wx: mfrom.x + 0.5, wy: mfrom.y + 0.5,
                vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
                t: 0, ttl: 420, color: i % 3 === 0 ? '#fff' : '#50b0e8' });
            }
          }
          // OOZ slime splatter: 8 viscous droplets biased downward
          if (mu?.kind === 'OOZ') {
            for (let i = 0; i < 8; i++) {
              const a = (i / 8) * Math.PI * 2;
              const spd = 0.9 + (i % 3) * 0.4;
              sparkles.push({ wx: mfrom.x + 0.5, wy: mfrom.y + 0.7,
                vx: Math.cos(a) * spd * 0.7, vy: Math.abs(Math.sin(a)) * spd + 0.3,
                t: 0, ttl: 500, color: i % 4 === 0 ? '#a0f0a8' : '#2ea840' });
            }
          }
          // FNG ember spray: 8 sparks kicked upward from exhaust during movement
          if (mu?.kind === 'FNG') {
            for (let i = 0; i < 8; i++) {
              const a = -Math.PI * 0.5 + (i - 3.5) * 0.35;
              const spd = 1.4 + (i % 3) * 0.6;
              sparkles.push({ wx: mfrom.x + 0.5, wy: mfrom.y + 0.5,
                vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
                t: 0, ttl: 380, color: i % 3 === 0 ? '#fff880' : i % 3 === 1 ? '#ff8820' : '#cc3010' });
            }
          }
          // WYRM void burst: 10 dark-purple particles with 2 bright white flares
          if (mu?.kind === 'WYRM') {
            for (let i = 0; i < 10; i++) {
              const a = (i / 10) * Math.PI * 2;
              const spd = 1.8 + (i % 4) * 0.7;
              sparkles.push({ wx: mfrom.x + 0.5, wy: mfrom.y + 0.5,
                vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
                t: 0, ttl: 460, color: i % 5 === 0 ? '#e8c8ff' : i % 5 === 4 ? '#fff' : '#8030c8' });
            }
          }
        }
        break;
      }
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
      case 'trapDodged':
        addFloat(k, 'DODGE', '#9adfe8');
        addSparkles(k, '#9adfe8');
        break;
      case 'trapSet':
        addFloat(k, 'SET', '#8fd17e');
        if (ev.pos) addSparklesAt(ev.pos.x, ev.pos.y, '#8fd17e');
        break;
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
        }
        break;
      }
      case 'targetFound':
        addSparkles(k);
        addFloat(k, 'TARGET!', '#ffe98a', { big: true, ttl: 1100 });
        turnFlash = { color: '#ffe98a', t: 0, dur: 700 };
        // Gold burst: 12 fast-moving particles in a ring
        { const tp = displayPos(k);
          if (tp) {
            for (let i = 0; i < 12; i++) {
              const a = (i / 12) * Math.PI * 2;
              const spd = 1.8 + (i % 3) * 0.8;
              sparkles.push({ wx: tp.x + 0.5, wy: tp.y + 0.5, vx: Math.cos(a) * spd,
                vy: Math.sin(a) * spd - 0.8, t: 0, ttl: 700, color: i % 3 === 0 ? '#fff' : '#ffe98a' });
            }
          } }
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
        break;
      }
      case 'exitWarpedAway': {
        unitFlash = { key: k, t: 0, dur: EVENT_DURATIONS.exitWarpedAway, color: '#f7f7ff' };
        addSparkles(k, '#7ee8a0');
        // Portal eruption at the exit tile
        const ex = state?.board?.exit;
        if (ex) {
          addSparklesAt(ex.x, ex.y, '#7ee8a0');
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            sparkles.push({ wx: ex.x + 0.5, wy: ex.y + 0.5,
              vx: Math.cos(a) * 3.2, vy: Math.sin(a) * 3.2 - 0.5,
              t: 0, ttl: 480, color: '#fff' });
          }
        }
        break;
      }
      case 'drewBlank':
        addFloat(k, 'NO CARD', '#8d8d9e');
        break;
      case 'battleStarted':
        battle = { a: k ?? unitKey(ev.attacker), d: unitKey(ev.defender ?? ev.target),
          response: null, escape: null, strike: null };
        break;
      case 'responseChosen':
        if (battle) battle.response = ev.response ?? null;
        break;
      case 'escapeRolled':
        if (battle) battle.escape = { aTotal: ev.aTotal, dTotal: ev.dTotal, escaped: !!ev.escaped };
        break;
      case 'strikeRolled':
        if (battle) battle.strike = { dice: flattenDice(ev.dice), totals: ev.totals,
          damage: ev.damage ?? 0, crit: !!ev.crit };
        if ((ev.damage ?? 0) > 0) {
          addFloat(battle?.d ?? k, `-${ev.damage}`, '#ff6a5a', { big: true });
          unitFlash = { key: battle?.d ?? k, t: 0, dur: EVENT_DURATIONS.strikeRolled,
            color: ev.crit ? '#ffe060' : '#ff3828' };
        }
        if (ev.crit) {
          addSparkles(battle?.d ?? k, '#ffe98a');
          shake = { t: 0, dur: 450, mag: 3.0 };
        } else if ((ev.damage ?? 0) >= 5) {
          shake = { t: 0, dur: 350, mag: 2.5 };
        } else if ((ev.damage ?? 0) >= 3) {
          shake = { t: 0, dur: 250, mag: 1.5 };
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
        }
        break;
      }
      case 'critNegated':
        addFloat(k, 'NEGATED', '#9adfe8');
        addSparkles(k, '#9adfe8');
        break;
      case 'hunterDefeated': {
        unitFlash = { key: k, t: 0, dur: EVENT_DURATIONS.hunterDefeated, color: '#f7f7ff' };
        shake = { t: 0, dur: 500, mag: 4 };
        addFloat(k, 'DEFEATED', '#ff6a5a', { big: true, ttl: 900 });
        const dp = displayPos(k);
        if (dp) {
          for (let i = 0; i < 18; i++) {
            const a = (i / 18) * Math.PI * 2;
            const spd = 1.2 + (i % 3) * 0.5;
            sparkles.push({ wx: dp.x + 0.5, wy: dp.y + 0.5, vx: Math.cos(a) * spd,
              vy: Math.sin(a) * spd - 0.6, t: 0, ttl: 700, color: i % 3 === 0 ? '#f7f7ff' : '#9a5555' });
          }
        }
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
        }
        break;
      }
      case 'surrendered':
        addFloat(k, 'SURRENDER', '#8d8d9e');
        addSparkles(k, '#8d8d9e');
        break;
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
          const SPAWN_COLORS = { VAC: '#50aadc', OOZ: '#3cc850', FNG: '#dca040', WYRM: '#8c3cdc' };
          addSparkles(mk, SPAWN_COLORS[kind] ?? '#cc3a22');
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
          }
        } else if (ev.type !== 'monsterSpawned') {
          shake = { t: 0, dur: 400, mag: 2 };
        }
        break;
      }
      case 'monsterKilled': {
        const gk = k != null && ghosts.has(k) ? k : ghosts.keys().next().value;
        if (gk != null) ghosts.get(gk).dyingKey = gk;
        addFloat(k ?? gk, ev.drop != null ? `DROP ${ev.drop}` : '', '#ffe98a');
        // Type-colored explosion: 20 particles spread at varied speeds
        const deadGhost = ghosts.get(gk ?? k);
        const KILL_COLORS = { VAC: '#2890c8', OOZ: '#28a838', FNG: '#c87020', WYRM: '#7c1cc8' };
        const killCol = KILL_COLORS[deadGhost?.kind] ?? '#ff8866';
        const kpos = deadGhost?.pos ?? displayPos(gk ?? k);
        if (kpos) {
          for (let i = 0; i < 20; i++) {
            const a = (i / 20) * Math.PI * 2;
            const spd = 1.0 + (i % 4) * 0.6;
            sparkles.push({ wx: kpos.x + 0.5, wy: kpos.y + 0.5, vx: Math.cos(a) * spd,
              vy: Math.sin(a) * spd - 0.5, t: 0, ttl: 550, color: i % 4 === 0 ? '#fff' : killCol });
          }
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
        }
        break;
      }
      case 'actAgain': {
        addFloat(k, 'AGAIN!', '#ffe98a', { big: true, ttl: 900 });
        // Gold ring burst (same as targetFound but smaller)
        const ap2 = displayPos(k);
        if (ap2) {
          for (let i = 0; i < 10; i++) {
            const a = (i / 10) * Math.PI * 2;
            const spd = 1.4 + (i % 3) * 0.5;
            sparkles.push({ wx: ap2.x + 0.5, wy: ap2.y + 0.5, vx: Math.cos(a) * spd,
              vy: Math.sin(a) * spd - 0.6, t: 0, ttl: 550, color: i % 2 === 0 ? '#fff' : '#ffe98a' });
          }
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
        }
        break;
      }
      case 'missionLost':
        banner = { text: 'MISSION FAILED', color: '#ff6a5a', startMs: clock };
        turnFlash = { color: '#cc3333', t: 0, dur: 700 };
        shake = { t: 0, dur: 400, mag: 3 };
        break;
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
    const floors = ['floorA', 'floorB', 'floorC', 'floorD', 'floorE', 'floorF', 'floorG', 'floorH', 'floorI', 'floorJ', 'floorK', 'floorL'];
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!b.floor[y]?.[x]) {
          // Show stone wall face where the wall borders a walkable floor below it.
          const wallV = ((x * 2341 + y * 1013) ^ 571) % 4;
          const wallTile = wallV === 0 ? 'tile.wall' : wallV === 1 ? 'tile.wallB' : wallV === 2 ? 'tile.wallC' : 'tile.wallD';
          blitTile(b.floor[y + 1]?.[x] ? wallTile : 'tile.pit', x, y);
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
              // Warm glow bloom behind torch
              const tgr = ctx.createRadialGradient(etx + cs * 0.5, ety, 0, etx + cs * 0.5, ety, cs * 5);
              const tgp = 0.10 + 0.05 * Math.sin(clock / 850 + wh * 0.031);
              tgr.addColorStop(0, 'rgba(255,155,45,' + tgp.toFixed(2) + ')'); tgr.addColorStop(1, 'transparent');
              ctx.fillStyle = tgr;
              ctx.fillRect((etx - cs * 4.5) | 0, (ety - cs * 5) | 0, cs * 10, cs * 9);
              // Iron torch bracket: vertical stem + horizontal arm
              ctx.fillStyle = '#6e4e22';
              ctx.fillRect(etx | 0, ety | 0, cs, cs * 3);
              ctx.fillRect((etx - cs) | 0, (ety + cs) | 0, cs * 2, cs);
              // Amber torch cup at bracket top
              ctx.save(); ctx.globalAlpha = 0.80; ctx.fillStyle = '#9a6c28';
              ctx.fillRect((etx - cs) | 0, (ety - cs) | 0, cs * 3, cs); ctx.restore();
              // Animated flame: persistent wick base + three staggered rising streams
              const eper = 1600 + (wh & 3) * 400;
              const fbw = cs * (1.4 + 0.5 * Math.sin(clock / 190 + wh * 0.72));
              ctx.save(); ctx.globalAlpha = 0.78; ctx.fillStyle = '#fff090';
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
                ctx.fillStyle = fi === 0 ? '#ffca40' : (fi === 1 ? '#ff8820' : '#dd3812');
                ctx.fillRect((etx + cs * 0.5 - ffw * 0.5) | 0, fey | 0, ffw, cs);
                ctx.restore();
              }
            }
          }
          // Void depth: slow purple pulse + rare brief spark on pit tiles
          if (!b.floor[y + 1]?.[x]) {
            const vp = worldToScreen(x, y, cam);
            const ts = TILE * cam.scale;
            const vh = ((x * 3571 + y * 1637) ^ 1013) & 0xFFFF;
            const vpulse = 0.05 + 0.03 * Math.sin(clock / (4800 + (vh & 0x7FF)) + vh * 0.009);
            const vgr = ctx.createRadialGradient(vp.x + ts * 0.5, vp.y + ts * 0.5, 0,
              vp.x + ts * 0.5, vp.y + ts * 0.5, ts * 0.6);
            vgr.addColorStop(0, 'rgba(65,20,120,' + vpulse.toFixed(3) + ')'); vgr.addColorStop(1, 'transparent');
            ctx.fillStyle = vgr; ctx.fillRect(vp.x | 0, vp.y | 0, ts, ts);
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
        blitTile(`tile.${floors[(x * 7 + y * 13) % 12]}`, x, y);
        { const fp = worldToScreen(x, y, cam); const ts = TILE * cam.scale;
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
            ctx.restore();
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
          }
          ctx.fillStyle = 'rgba(0,0,0,0.22)';
          ctx.fillRect(fp.x, fp.y + ts - 1, ts, 1);
          ctx.fillRect(fp.x + ts - 1, fp.y, 1, ts - 1);
          const vs = 'rgba(10,10,18,0.38)'; const vd = 4 * cam.scale;
          if (y > 0 && !b.floor[y - 1]?.[x]) { ctx.fillStyle = vs; ctx.fillRect(fp.x, fp.y, ts, vd); }
          if (!b.floor[y + 1]?.[x]) { ctx.fillStyle = vs; ctx.fillRect(fp.x, fp.y + ts - vd, ts, vd); }
          if (!b.floor[y]?.[x + 1]) { ctx.fillStyle = vs; ctx.fillRect(fp.x + ts - vd, fp.y, vd, ts); }
          if (!b.floor[y]?.[x - 1]) { ctx.fillStyle = vs; ctx.fillRect(fp.x, fp.y, vd, ts); }
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
    // Mineral gleam: 1-in-20 floor tiles briefly shine white — quartz embedded in stone
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
      // Gold urgent glow when someone holds the Target — "finish line is live"
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
      // Four sparkle particles orbiting the exit — cross/star shape
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
      blitTile(closed ? 'tile.boxClosed' : 'tile.boxOpen', box.x, box.y);
      if (closed) {
        const bp = worldToScreen(box.x, box.y, cam);
        const pulse = 0.10 + 0.08 * Math.sin(clock / 1100 + box.x * 3.7 + box.y * 2.3);
        ctx.save(); ctx.globalAlpha = pulse; ctx.fillStyle = '#e8d87e';
        ctx.fillRect(bp.x, bp.y, TILE * cam.scale, TILE * cam.scale); ctx.restore();
        // Occasional white gleam glint above the box (treasure chest twinkle)
        const gleamPhase = ((clock * 0.5 + box.x * 417 + box.y * 293) % 2800) / 2800;
        if (gleamPhase < 0.12) {
          const ga = Math.min(gleamPhase, 0.12 - gleamPhase) / 0.06;
          ctx.save(); ctx.globalAlpha = ga * 0.85; ctx.fillStyle = '#fff';
          ctx.fillRect((bp.x + 6 * cam.scale) | 0, (bp.y - 3 * cam.scale) | 0, cam.scale * 2, cam.scale * 2);
          ctx.restore();
        }
      }
    }
    for (const f of b.flags ?? []) {
      if (f.taken && !standingFlags.has(key(f.x, f.y))) continue;
      const cap = f.color[0].toUpperCase() + f.color.slice(1);
      // gentle two-axis sway — vertical bob + horizontal drift simulate wind
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
    // Active unit gets a gentle idle bob (±1.5 px)
    const bobPx = k === activeKey() ? Math.round(Math.sin(clock / 650) * 1.5) * s : 0;
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
    // Low-HP danger glow: pulsing red around tile edges at ≤25% HP
    if (k[0] === 'h' && u && u.maxHp && u.hp / u.maxHp <= 0.25) {
      const danger = 0.18 + 0.18 * Math.sin(clock / 260);
      const ts = TILE * s;
      ctx.save(); ctx.globalAlpha = danger * alpha;
      ctx.strokeStyle = '#ff4a3a'; ctx.lineWidth = s * 0.7;
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
      // Ambient status particles — drawn clock-based, no sparkles array
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
      // Kind label above HP bar
      text(m.kind, cx, labelY, labelCol, 9, 'center');
      // Dark backdrop behind HP bar
      ctx.save(); ctx.globalAlpha = 0.72; ctx.fillStyle = '#080a12';
      ctx.fillRect(barX - 1, barY - 1, barW + 2, barH + 2); ctx.restore();
      // Colored HP fill
      const fill = Math.round(barW * ratio);
      if (fill > 0) {
        const [mc0, mc1] = ratio > 0.5 ? ['#e05a3a', '#a82820'] : ratio > 0.25 ? ['#f07020', '#a04810'] : ['#ff4040', '#c01818'];
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
    // Soft team-color glow beneath each hunter
    for (const d of list) {
      if (d.k[0] !== 'h' || !d.pos) continue;
      const hslot = d.u?.slot ?? 0;
      const sc = SLOT_COLORS[hslot % 4] ?? '#3a6ee0';
      const sp = worldToScreen(d.pos.x, d.pos.y, cam);
      const hcx = sp.x + TILE * cam.scale / 2, hcy = sp.y + (TILE - 1) * cam.scale;
      const hg = ctx.createRadialGradient(hcx, hcy, 0, hcx, hcy, 7 * cam.scale);
      hg.addColorStop(0, sc); hg.addColorStop(1, 'transparent');
      ctx.save(); ctx.globalAlpha = 0.22 * d.alpha; ctx.fillStyle = hg;
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
    blit(`chip.${clamp(v, 1, 6) | 0}`, cx, cy, chipScale);
    // Top-left shine overlay
    ctx.save(); ctx.globalAlpha = 0.22; ctx.fillStyle = '#fff';
    ctx.fillRect(cx + chipScale, cy + chipScale, 4 * chipScale, 2 * chipScale);
    ctx.fillRect(cx + chipScale, cy + chipScale, 2 * chipScale, 4 * chipScale);
    ctx.restore();
    if (ev.type === 'flagClaimed' && settled && ev.effect != null) {
      text(String(ev.effect), p.x + 8 * s, p.y - 28 * s, '#ffe98a', 12, 'center');
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
          const isNeg = String(f.text)[0] === '-';
          ctx.save(); ctx.shadowBlur = 10; ctx.shadowColor = isNeg ? '#ff5050' : f.color;
          text(f.text, p.x, fy, f.color, fsz, 'center');
          ctx.restore();
        } else {
          text(f.text, p.x, fy, f.color, fsz, 'center');
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
    const fr = Math.max(canvas.width, canvas.height) * 0.60;
    const fg = ctx.createRadialGradient(lp.x, lp.y, fr * 0.15, lp.x, lp.y, fr);
    fg.addColorStop(0, 'rgba(0,0,0,0)');
    fg.addColorStop(0.45, 'rgba(0,0,0,0.12)');
    fg.addColorStop(0.75, 'rgba(0,0,0,0.38)');
    fg.addColorStop(1, 'rgba(0,0,0,0.65)');
    ctx.fillStyle = fg;
    ctx.fillRect(0, 0, canvas.width, canvas.height - HUD_H);
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
        ctx.save(); ctx.globalAlpha = t2 * 0.28;
        ctx.fillStyle = (h & 1) ? '#e8c87a' : '#9adfe8';
        // Star/cross shape: 4-arm plus sign for a gem-sparkle look
        ctx.fillRect(spx + s, spy, s, s * 3);     // vertical arm
        ctx.fillRect(spx, spy + s, s * 3, s);     // horizontal arm
        ctx.restore();
      }
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
    // sonar ping: expands outward and fades every 2.2s
    const pingPhase = (clock / 2200) % 1;
    const pingRx = (7 + pingPhase * 6) * s;
    const pingRy = (2 + pingPhase * 1.8) * s;
    ctx.save();
    ctx.globalAlpha = (1 - pingPhase) * 0.40;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, s * 0.5);
    ctx.beginPath();
    ctx.ellipse(cx, cy, pingRx, pingRy, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawVignette() {
    const w = canvas.width;
    const h = canvas.height - HUD_H;
    const grad = ctx.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, h * 0.9);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.48)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }

  function drawHunterWindow(h, i, y) {
    const active = activeKey() === `h${h.id}`;
    const x = 2;
    const w = canvas.width - 4;
    ctx.fillStyle = active ? 'rgba(220, 228, 255, 0.10)' : 'rgba(0, 0, 0, 0.30)';
    ctx.fillRect(x, y, w, 16);
    if (active) {
      const sc = SLOT_COLORS[h.slot % 4] ?? '#3a6ee0';
      const rg = ctx.createLinearGradient(x, y, x + 110, y);
      rg.addColorStop(0, sc + '30'); rg.addColorStop(1, sc + '00');
      ctx.fillStyle = rg; ctx.fillRect(x, y, w, 16);
    }
    ctx.fillStyle = SLOT_COLORS[h.slot % 4] ?? '#f0f4ff';
    ctx.fillRect(x, y, active ? 4 : 2, 16);
    const icon = atlas[`hunter${h.spriteId}.${paletteName(h)}.icon`];
    if (icon) ctx.drawImage(icon, x + 6, y + 2, 12, 12);
    text((h.name ?? '').slice(0, 7).padEnd(7), x + 22, y + 3,
      active ? '#ffe98a' : '#b8bccc');
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
    text(`${h.hp}/${h.maxHp}`, x + 168, y + 3, active ? '#c0c8d8' : '#8a90a0');
    const iv = h.internal ?? { mv: 0, at: 0, df: 0 };
    text(`MV+${Math.floor((iv.mv ?? 0) / 3)} AT${iv.at ?? 0} DF${Math.floor((iv.df ?? 0) / 2)}`,
      x + 222, y + 3, active ? '#6e7890' : '#484c5e');
    // hand as mini card backs colored by card color
    let cx = x + 340;
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
    if (h.hasTarget) blit('ui.targetMark', cx + 2, y + 3, 1);
  }

  function drawHud() {
    const y0 = canvas.height - HUD_H;
    const hudGrad = ctx.createLinearGradient(0, y0, 0, y0 + HUD_H);
    hudGrad.addColorStop(0, '#141520'); hudGrad.addColorStop(1, '#09090f');
    ctx.fillStyle = hudGrad;
    ctx.fillRect(0, y0, canvas.width, HUD_H);
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
    text(`x${deckShown}`, canvas.width - 8, 8, deckColor, 12, 'right');
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
    { const auraCol = k[0] === 'h' && u ? (SLOT_COLORS[(u.slot ?? 0) % 4]) : '#9060d8';
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
      text(`${u.hp}/${u.maxHp}`, cx, barY + 8, hpColor, 11, 'center');
    }
  }

  function drawBattle() {
    const bw = Math.min(canvas.width - 24, 380);
    const bh = Math.min(canvas.height - HUD_H - 24, 230);
    const bx = (canvas.width - bw) / 2 | 0;
    const by = (canvas.height - HUD_H - bh) / 2 | 0;
    // Background
    ctx.fillStyle = 'rgba(14, 15, 26, 0.96)';
    ctx.fillRect(bx, by, bw, bh);
    // Inner vignette for depth
    { const vg = ctx.createRadialGradient(bx + bw / 2, by + bh / 2, 20, bx + bw / 2, by + bh / 2, bh * 0.85);
      vg.addColorStop(0, 'rgba(30,28,44,0.0)'); vg.addColorStop(1, 'rgba(0,0,0,0.45)');
      ctx.fillStyle = vg; ctx.fillRect(bx, by, bw, bh); }
    // Team color backdrops — attacker left (red), defender right (cyan)
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
    // Title bar
    ctx.fillStyle = 'rgba(180, 50, 40, 0.22)';
    ctx.fillRect(bx + 2, by + 2, bw - 4, 16);
    setFont(11);
    ctx.fillStyle = '#f0c8c0';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText('B A T T L E', (bx + bw / 2) | 0, by + 4);
    ctx.textAlign = 'left';
    text('ATTACKER', bx + 8, by + 5, 'rgba(255,230,180,0.55)', 9, 'left');
    text('DEFENDER', bx + bw - 8, by + 5, 'rgba(154,223,232,0.55)', 9, 'right');
    const defImg = spriteFor(battle.d);
    const defW = defImg ? defImg.width * 3 : 48;
    drawCombatant(battle.a, bx + 24, by + 28, false);
    drawCombatant(battle.d, bx + bw - 24 - defW, by + 28, true);
    // Center divider — thin vertical line with gradient fade to top/bottom
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
    text('VS', bx + bw / 2, by + 42, '#ffe98a', 16, 'center');
    if (battle.response) text(String(battle.response).toUpperCase(), bx + bw / 2, by + 64, '#9adfe8', 12, 'center');
    if (battle.escape) {
      const e = battle.escape;
      text(`ESCAPE ${e.dTotal ?? '?'} vs ${e.aTotal ?? '?'} ${e.escaped ? 'FLED!' : 'CAUGHT'}`,
        bx + bw / 2, by + 84, e.escaped ? '#8fd17e' : '#ff6a5a', 12, 'center');
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
          const tv = Object.values(st.totals).filter((v) => typeof v === 'number');
          text(tv.join(' vs '), bx + bw / 2, by + 124, '#f0f4ff', 12, 'center');
        }
        { ctx.save(); ctx.shadowBlur = 14; ctx.shadowColor = '#ff5050';
          text(`-${st.damage}`, bx + bw / 2, by + 150, '#ff6a5a', 24, 'center');
          ctx.restore(); }
        if (st.crit && anim?.ev.type === 'strikeRolled') {
          const p = anim.t / anim.dur;
          if (p > 0.5 && p < 0.72) {
            const fp = (p - 0.5) / 0.22;
            const fadeAlpha = fp < 0.5 ? fp * 2 : 2 - fp * 2;
            // Gold radial burst from center
            const ccx = bx + bw / 2, ccy = by + bh / 2;
            const cg = ctx.createRadialGradient(ccx, ccy, 0, ccx, ccy, bh * 0.8);
            cg.addColorStop(0, `rgba(255,240,140,${(fadeAlpha * 0.9).toFixed(2)})`);
            cg.addColorStop(0.4, `rgba(220,160,20,${(fadeAlpha * 0.5).toFixed(2)})`);
            cg.addColorStop(1, 'transparent');
            ctx.save(); ctx.fillStyle = cg; ctx.fillRect(bx, by, bw, bh); ctx.restore();
            // White rim flash on edges
            ctx.save(); ctx.globalAlpha = fadeAlpha * 0.35; ctx.fillStyle = '#fff';
            ctx.fillRect(bx, by, bw, bh); ctx.restore();
            ctx.save(); ctx.shadowBlur = 22; ctx.shadowColor = '#ffe060';
            text('CRIT!', bx + bw / 2, by + bh / 2 - 10, '#ffe98a', 28, 'center');
            ctx.restore();
          }
        }
      }
    }
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
    // drop-shadow + main text — scale pop on appear
    const age = clock - (banner.startMs ?? clock);
    const popT = Math.min(age / 280, 1);
    const bscale = 1 + Math.sin(popT * Math.PI) * 0.18;
    const tsz = Math.round(20 * bscale);
    const ty = by + 10 + Math.round((20 - tsz) * 0.5);
    text(banner.text, bw / 2 + 1, ty + 1, 'rgba(0,0,0,0.65)', tsz, 'center');
    ctx.save(); ctx.shadowBlur = 16; ctx.shadowColor = banner.color;
    text(banner.text, bw / 2, ty, banner.color, tsz, 'center');
    ctx.restore();
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
          anim = { ev, t: 0, dur: EVENT_DURATIONS[ev.type] ?? 200 };
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
            }
          }
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
      drawFog();
      drawAmbientShimmer();
      drawOverlays();
      drawUnits();
      drawUnitLabels();
      drawDieChip();
      drawFloats();
      drawCursor();
      ctx.restore();
      drawVignette();
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
