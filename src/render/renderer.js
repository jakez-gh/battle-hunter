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
const FONT = '"Courier New", monospace';
const SLOT_COLORS = ['#3a6ee0', '#cc4a3a', '#e0c63a', '#3aa84a']; // P1..P4
const CARD_MINI = { R: '#cc4a3a', Y: '#d8b83a', B: '#3a6ee0', G: '#3aa84a' };
const TRAP_COLORS = { damage: '#cc4a3a', stun: '#d8b83a', leg: '#3a6ee0', empty: '#8d8d9e' };
const STATUS_GLOW = { stun: '#d8b83a', leg: '#3a6ee0', panic: '#cc4a3a', empty: '#8d8d9e' };
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
  let sparkles = [];                   // {wx,wy,vx,vy,t,ttl,color}
  let shake = null;                    // {t,dur,mag}
  let unitFlash = null;                // {key,t,dur,color}
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

  function addSparkles(k, color = '#ffe98a') {
    const p = displayPos(k);
    if (!p) return;
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      sparkles.push({ wx: p.x + 0.5, wy: p.y + 0.5, vx: Math.cos(a) * 2.2,
        vy: Math.sin(a) * 2.2 - 1, t: 0, ttl: 600, color });
    }
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
        break;
      case 'stepped':
        beginSlide(k, ev.from ?? null, ev.to ?? ev.pos ?? null);
        break;
      case 'monsterMoved':
        beginSlide(k, ev.from ?? null,
          ev.to ?? ev.pos ?? (Array.isArray(ev.path) ? ev.path[ev.path.length - 1] : null));
        break;
      case 'cardDrawn':
        deckShown = Math.max(0, deckShown - 1);
        break;
      case 'deckCount':
        deckShown = ev.count ?? ev.value ?? deckShown;
        break;
      case 'trapTriggered':
        shake = { t: 0, dur: EVENT_DURATIONS.trapTriggered, mag: 3 };
        addFloat(k, ev.kind === 'damage' ? 'TRAP!' : '', '#ff6a5a',
          { icon: ['stun', 'leg', 'empty'].includes(ev.kind) ? `status.${ev.kind}` : null });
        break;
      case 'trapDodged':
        addFloat(k, 'DODGE', '#9adfe8');
        break;
      case 'trapSet':
        addFloat(k, 'SET', '#8fd17e');
        break;
      case 'boxOpened':
        popOverride(closedBoxes, ev.pos ? key(ev.pos.x, ev.pos.y) : null);
        break;
      case 'targetFound':
        addSparkles(k);
        addFloat(k, 'TARGET!', '#ffe98a', { big: true, ttl: 1100 });
        break;
      case 'flagClaimed':
        popOverride(standingFlags, ev.pos ? key(ev.pos.x, ev.pos.y) : null);
        break;
      case 'exitWarpedAway':
        unitFlash = { key: k, t: 0, dur: EVENT_DURATIONS.exitWarpedAway, color: '#f7f7ff' };
        break;
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
        if ((ev.damage ?? 0) > 0) addFloat(battle?.d ?? k, `-${ev.damage}`, '#ff6a5a', { big: true });
        break;
      case 'statusInflicted':
        addFloat(k, '', '#f0f4ff', { icon: `status.${ev.kind}`, ttl: 700 });
        break;
      case 'critNegated':
        addFloat(k, 'NEGATED', '#9adfe8');
        break;
      case 'hunterDefeated':
        unitFlash = { key: k, t: 0, dur: EVENT_DURATIONS.hunterDefeated, color: '#f7f7ff' };
        break;
      case 'itemTaken':
        addFloat(k, ev.itemId != null ? `GOT ${ev.itemId}` : 'TAKEN', '#ffe98a');
        break;
      case 'surrendered':
        addFloat(k, 'SURRENDER', '#8d8d9e');
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
        if (mk) hiddenUnits.delete(mk);
        shake = ev.type === 'monsterSpawned' ? shake : { t: 0, dur: 400, mag: 2 };
        break;
      }
      case 'monsterKilled': {
        const gk = k != null && ghosts.has(k) ? k : ghosts.keys().next().value;
        if (gk != null) ghosts.get(gk).dyingKey = gk;
        addFloat(k ?? gk, ev.drop != null ? `DROP ${ev.drop}` : '', '#ffe98a');
        break;
      }
      case 'healed':
        addFloat(k, `+${ev.amount ?? ''}`, '#8fd17e');
        break;
      case 'actAgain':
        addFloat(k, 'AGAIN!', '#ffe98a');
        break;
      case 'missionWon':
        banner = { text: 'MISSION COMPLETE', color: '#ffe98a' };
        break;
      case 'missionLost':
        banner = { text: 'MISSION FAILED', color: '#ff6a5a' };
        break;
      case 'scoreTallied':
        banner = banner ?? { text: 'RESULTS', color: '#f0f4ff' };
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
    const floors = ['floorA', 'floorB', 'floorC', 'floorD'];
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!b.floor[y]?.[x]) {
          // Show stone wall face where the wall borders a walkable floor below it.
          blitTile(b.floor[y + 1]?.[x] ? 'tile.wall' : 'tile.pit', x, y);
          continue;
        }
        blitTile(`tile.${floors[(x * 7 + y * 13) % 4]}`, x, y);
        { const fp = worldToScreen(x, y, cam); const ts = TILE * cam.scale;
          ctx.fillStyle = 'rgba(0,0,0,0.22)';
          ctx.fillRect(fp.x, fp.y + ts - 1, ts, 1);
          ctx.fillRect(fp.x + ts - 1, fp.y, 1, ts - 1); }
        if (y > 0 && !b.floor[y - 1]?.[x]) { // contact shadow where floor meets wall
          const p = worldToScreen(x, y, cam);
          ctx.fillStyle = 'rgba(10, 10, 18, 0.38)';
          ctx.fillRect(p.x, p.y, TILE * cam.scale, 4 * cam.scale);
        }
      }
    }
    if (b.exit) {
      blitTile('tile.exit', b.exit.x, b.exit.y);
      const pulse = 0.3 + 0.3 * Math.sin(clock / 800);
      const ep = worldToScreen(b.exit.x, b.exit.y, cam);
      ctx.save(); ctx.globalAlpha = pulse * 0.35; ctx.fillStyle = '#7ee8a0';
      ctx.fillRect(ep.x, ep.y, TILE * cam.scale, TILE * cam.scale); ctx.restore();
    }
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
        ctx.globalAlpha = pulse; ctx.fillStyle = '#e8d87e';
        ctx.fillRect(bp.x, bp.y, TILE * cam.scale, TILE * cam.scale);
        ctx.globalAlpha = 1;
      }
    }
    for (const f of b.flags ?? []) {
      if (f.taken && !standingFlags.has(key(f.x, f.y))) continue;
      const cap = f.color[0].toUpperCase() + f.color.slice(1);
      // gentle sway — each flag offset by position for phase variety
      const sway = Math.sin(clock / 900 + f.x * 1.4 + f.y * 0.9) * 0.4;
      const fp = worldToScreen(f.x, f.y, cam);
      const img = atlas[`tile.flag${cap}`];
      if (img) ctx.drawImage(img, fp.x | 0, (fp.y + sway * cam.scale) | 0, img.width * cam.scale, img.height * cam.scale);
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
      for (const cell of overlays.range) {
        const [x, y] = String(cell).split(',').map(Number);
        const p = worldToScreen(x, y, cam);
        const ts = TILE * s;
        ctx.fillStyle = 'rgba(240, 244, 255, 0.12)';
        ctx.fillRect(p.x, p.y, ts, ts);
        const L = 3 * s, W = s;
        ctx.fillStyle = 'rgba(210, 225, 255, 0.82)';
        ctx.fillRect(p.x + 1, p.y + 1, L, W); ctx.fillRect(p.x + 1, p.y + 1, W, L);
        ctx.fillRect(p.x + ts - L - 1, p.y + 1, L, W); ctx.fillRect(p.x + ts - W - 1, p.y + 1, W, L);
        ctx.fillRect(p.x + 1, p.y + ts - W - 1, L, W); ctx.fillRect(p.x + 1, p.y + ts - L - 1, W, L);
        ctx.fillRect(p.x + ts - L - 1, p.y + ts - W - 1, L, W); ctx.fillRect(p.x + ts - W - 1, p.y + ts - L - 1, W, L);
      }
    }
    if (overlays.path) {
      for (const step of overlays.path) {
        const c = typeof step === 'string'
          ? { x: +step.split(',')[0], y: +step.split(',')[1] } : step;
        const p = worldToScreen(c.x, c.y, cam);
        const dcx = p.x + 8 * s, dcy = p.y + 8 * s;
        const gr = ctx.createRadialGradient(dcx, dcy, 0, dcx, dcy, 5 * s);
        gr.addColorStop(0, '#ffe98a');
        gr.addColorStop(1, 'transparent');
        ctx.fillStyle = gr;
        ctx.fillRect(dcx - 5 * s, dcy - 5 * s, 10 * s, 10 * s);
        ctx.fillStyle = '#ffe98a';
        ctx.fillRect(p.x + 7 * s, p.y + 7 * s, 2 * s, 2 * s);
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
    const dy = p.y + (TILE * s - h);
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
      if (u.hasTarget) blit('ui.targetMark', p.x + 4 * s, dy - 9 * s);
      const active = Object.entries(u.status ?? {}).filter(([, v]) => v).map(([n]) => n);
      let ix = p.x + (TILE * s - active.length * 8 * s) / 2;
      for (const st of active) {
        if (atlas[`status.${st}`]) {
          if (STATUS_GLOW[st]) {
            ctx.save();
            ctx.globalAlpha = 0.42;
            ctx.fillStyle = STATUS_GLOW[st];
            ctx.fillRect(ix - s, p.y - 9 * s, 8 * s + 2 * s, 8 * s + 2 * s);
            ctx.restore();
          }
          blit(`status.${st}`, ix, p.y - 8 * s);
        }
        ix += 8 * s;
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
      const pulse = 0.14 + 0.10 * Math.sin(clock / 680 + m.id * 1.7);
      const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, 9 * s);
      gr.addColorStop(0, 'rgba(210, 55, 35, 0.55)');
      gr.addColorStop(1, 'transparent');
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.fillStyle = gr;
      ctx.fillRect(p.x - s, p.y - s, TILE * s + 2 * s, TILE * s + 2 * s);
      ctx.restore();
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
    for (const [k, g] of ghosts) list.push({ k, u: null, pos: g.pos, alpha: g.alpha });
    list.sort((a, b) => (a.pos?.y ?? 0) - (b.pos?.y ?? 0));
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
    blit(`chip.${clamp(v, 1, 6) | 0}`, p.x + 4 * s + jx, p.y - 18 * s + jy, chipScale);
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
        const fy = p.y - (rise + 10) * cam.scale;
        const fsz = f.big ? 16 : 12;
        text(f.text, p.x + 1, fy + 1, 'rgba(0,0,0,0.55)', fsz, 'center');
        text(f.text, p.x, fy, f.color, fsz, 'center');
      }
      ctx.restore();
    }
    for (const sp of sparkles) {
      const p = worldToScreen(sp.wx + sp.vx * (sp.t / 600), sp.wy + sp.vy * (sp.t / 600), cam);
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - sp.t / sp.ttl);
      ctx.fillStyle = sp.color;
      ctx.fillRect(p.x, p.y, 2 * cam.scale, 2 * cam.scale);
      ctx.restore();
    }
  }

  function drawCursor() {
    if (!cursor) return;
    const pulse = 0.6 + 0.4 * Math.sin(clock / 160);
    const p = worldToScreen(cursor.x, cursor.y, cam);
    const s = cam.scale;
    // team-color fill under the cursor brackets
    const ak = activeKey();
    const u = ak ? findUnit(ak) : null;
    const col = ak && ak[0] === 'h' && u ? (SLOT_COLORS[(u.slot ?? 0) % 4] ?? '#e0e8f8') : '#e0e8f8';
    ctx.save();
    ctx.globalAlpha = pulse * 0.15;
    ctx.fillStyle = col;
    ctx.fillRect(p.x, p.y, TILE * s, TILE * s);
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = pulse;
    blitTile('tile.cursor', cursor.x, cursor.y);
    ctx.restore();
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
        ctx.globalAlpha = t2 * 0.14;
        ctx.fillStyle = (h & 1) ? '#e8c87a' : '#9adfe8';
        ctx.fillRect(spx, spy, s * 2, s * 2);
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawUnitShadow(k, pos, alpha) {
    if (!pos) return;
    const s = cam.scale;
    const p = worldToScreen(pos.x, pos.y, cam);
    const cx = p.x + TILE * s / 2;
    const cy = p.y + (TILE - 1) * s;
    ctx.save();
    ctx.globalAlpha = 0.42 * alpha;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(cx, cy, 5 * s, 1.5 * s, 0, 0, Math.PI * 2);
    ctx.fill();
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
    ctx.globalAlpha = 0.25 + pulse * 0.38;
    ctx.strokeStyle = color;
    ctx.lineWidth = s;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 7 * s, 2 * s, 0, 0, Math.PI * 2);
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
    ctx.fillStyle = ratio > 0.5 ? '#3aa84a' : ratio > 0.25 ? '#d8b83a' : '#cc4a3a';
    const bw = Math.round(52 * ratio);
    ctx.fillRect(x + 112, y + 5, bw, 6);
    if (bw > 2) { ctx.save(); ctx.globalAlpha = 0.28; ctx.fillStyle = '#fff';
      ctx.fillRect(x + 112, y + 5, bw, 2); ctx.restore(); }
    text(`${h.hp}/${h.maxHp}`, x + 168, y + 3, active ? '#c0c8d8' : '#8a90a0');
    const iv = h.internal ?? { mv: 0, at: 0, df: 0 };
    text(`MV+${Math.floor((iv.mv ?? 0) / 3)} AT${iv.at ?? 0} DF${Math.floor((iv.df ?? 0) / 2)}`,
      x + 222, y + 3, active ? '#6e7890' : '#484c5e');
    // hand as mini card backs colored by card color
    let cx = x + 340;
    for (const cardId of h.hand ?? []) {
      ctx.fillStyle = CARD_MINI[String(cardId)[0]] ?? '#8d8d9e';
      ctx.fillRect(cx, y + 3, 5, 9);
      ctx.strokeStyle = '#101018';
      ctx.strokeRect(cx + 0.5, y + 3.5, 5, 9);
      cx += 7;
    }
    if (h.hasTarget) blit('ui.targetMark', cx + 2, y + 3, 1);
  }

  function drawHud() {
    const y0 = canvas.height - HUD_H;
    ctx.fillStyle = '#0d0e16';
    ctx.fillRect(0, y0, canvas.width, HUD_H);
    const _ak = activeKey();
    const _ah = _ak?.[0] === 'h' ? findUnit(_ak) : null;
    ctx.fillStyle = _ah ? (SLOT_COLORS[(_ah.slot ?? 0) % 4] ?? '#2a2c3a') : '#2a2c3a';
    ctx.fillRect(0, y0, canvas.width, 1);
    (state.hunters ?? []).slice(0, 4).forEach((h, i) => drawHunterWindow(h, i, y0 + 3 + i * 18));
    // deck counter, top-right
    ctx.fillStyle = 'rgba(13, 14, 22, 0.8)';
    ctx.fillRect(canvas.width - 78, 4, 74, 18);
    ctx.fillStyle = CARD_MINI.B;
    ctx.fillRect(canvas.width - 74, 7, 8, 12);
    text(`x${deckShown}`, canvas.width - 8, 8, '#f0f4ff', 12, 'right');
  }

  function drawCombatant(k, x, y, flip) {
    const img = spriteFor(k);
    if (!img) return;
    const s3 = 3;
    const sw = img.width * s3;
    const sh = img.height * s3;
    const cx = x + sw / 2;
    ctx.save(); ctx.globalAlpha = 0.38; ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(cx, y + sh + 3, sw * 0.38, 5, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.restore();
    ctx.save();
    if (flip) {
      ctx.translate(x + sw, y);
      ctx.scale(-1, 1);
      ctx.drawImage(img, 0, 0, sw, sh);
    } else {
      ctx.drawImage(img, x, y, sw, sh);
    }
    ctx.restore();
    const u = findUnit(k);
    if (u) {
      text(u.name ?? u.kind ?? '', cx, y + sh + 4, '#f0f4ff', 12, 'center');
      text(`HP ${u.hp}`, cx, y + sh + 18, '#8fd17e', 12, 'center');
    }
  }

  function drawBattle() {
    const bw = Math.min(canvas.width - 24, 380);
    const bh = Math.min(canvas.height - HUD_H - 24, 210);
    const bx = (canvas.width - bw) / 2 | 0;
    const by = (canvas.height - HUD_H - bh) / 2 | 0;
    // Background + outer glow border
    ctx.fillStyle = 'rgba(14, 15, 26, 0.96)';
    ctx.fillRect(bx, by, bw, bh);
    const bglow = 0.4 + 0.6 * Math.sin(clock / 280);
    ctx.save(); ctx.strokeStyle = '#cc4a3a'; ctx.lineWidth = 3 + bglow * 3;
    ctx.globalAlpha = bglow * 0.35; ctx.strokeRect(bx - 2, by - 2, bw + 4, bh + 4); ctx.restore();
    ctx.strokeStyle = '#cc4a3a';
    ctx.lineWidth = 2;
    ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
    // Inner accent line
    ctx.strokeStyle = 'rgba(240,180,160,0.18)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 3, by + 3, bw - 6, bh - 6);
    // Title bar
    ctx.fillStyle = 'rgba(180, 50, 40, 0.22)';
    ctx.fillRect(bx + 2, by + 2, bw - 4, 16);
    setFont(11);
    ctx.fillStyle = '#f0c8c0';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('B A T T L E', (bx + bw / 2) | 0, by + 4);
    ctx.textAlign = 'left';
    text('ATTACKER', bx + 8, by + 5, 'rgba(255,230,180,0.55)', 9, 'left');
    text('DEFENDER', bx + bw - 8, by + 5, 'rgba(154,223,232,0.55)', 9, 'right');
    const defImg = spriteFor(battle.d);
    const defW = defImg ? defImg.width * 3 : 48;
    drawCombatant(battle.a, bx + 24, by + 28, false);
    drawCombatant(battle.d, bx + bw - 24 - defW, by + 28, true);
    text('VS', bx + bw / 2, by + 36, '#ffe98a', 16, 'center');
    if (battle.response) text(String(battle.response).toUpperCase(), bx + bw / 2, by + 60, '#9adfe8', 12, 'center');
    if (battle.escape) {
      const e = battle.escape;
      text(`ESCAPE ${e.dTotal ?? '?'} vs ${e.aTotal ?? '?'} ${e.escaped ? 'FLED!' : 'CAUGHT'}`,
        bx + bw / 2, by + 78, e.escaped ? '#8fd17e' : '#ff6a5a', 12, 'center');
    }
    if (battle.strike) {
      const st = battle.strike;
      const rolling = anim?.ev.type === 'strikeRolled' && anim.t / anim.dur < 0.5;
      const dice = st.dice.length ? st.dice : [1, 1, 1, 1];
      dice.slice(0, 4).forEach((d, i) => {
        const v = rolling ? 1 + Math.floor(clock / 70 + i * 3) % 6 : d;
        const side = i < dice.length / 2 ? bx + 24 + i * 20 : bx + bw - 64 + (i - dice.length / 2) * 20;
        blit(`chip.${v}`, side, by + 100, 2);
      });
      if (!rolling) {
        if (st.totals) {
          const tv = Object.values(st.totals).filter((v) => typeof v === 'number');
          text(tv.join(' vs '), bx + bw / 2, by + 104, '#f0f4ff', 12, 'center');
        }
        text(`-${st.damage}`, bx + bw / 2, by + 128, '#ff6a5a', 24, 'center');
        if (st.crit && anim?.ev.type === 'strikeRolled') {
          const p = anim.t / anim.dur;
          if (p > 0.5 && p < 0.72) {
            ctx.save();
            ctx.globalAlpha = 0.6;
            ctx.fillStyle = '#f7f7ff';
            ctx.fillRect(bx, by, bw, bh);
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
    // top & bottom accent lines in the banner's own color
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = banner.color;
    ctx.fillRect(0, by, bw, 1);
    ctx.fillRect(0, by + 39, bw, 1);
    ctx.restore();
    // drop-shadow + main text
    text(banner.text, bw / 2 + 1, by + 11, 'rgba(0,0,0,0.65)', 20, 'center');
    text(banner.text, bw / 2, by + 10, banner.color, 20, 'center');
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
      if (shake && (shake.t += dtMs) >= shake.dur) shake = null;
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
      drawAmbientShimmer();
      drawOverlays();
      drawUnits();
      drawDieChip();
      drawFloats();
      drawCursor();
      ctx.restore();
      drawVignette();
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
