// Boot + game loop + ADAPT layer (DESIGN.md §1.2, §1.3).
//
// main.js owns: the canvas/rAF fixed-dt loop, the shared `app` context for
// screens, mission-config construction (human + AI fill, §2.2/§2.11), and the
// ADAPT layer — every call into the parallel-built game.js / ai.js /
// renderer.js contracts goes through `adapt` so integration drift is patched
// in exactly one place. Engine modules that are already landed (rng, cards,
// items, missions, board, combat, sprites, audio, save) are imported direct.

import { interpolateInternal, RIVALS, rivalStats } from './engine/missions.js';
import { makeRng } from './engine/rng.js';
import { reachableTiles, occupiedSet, movePath } from './engine/board.js';
import { perkHasEffect, perkStatBonuses } from './engine/perks.js';
import { modifierConfig, scoreMultiplier, rollDailyModifier } from './engine/modifiers.js';
import { buildAtlas } from './render/sprites.js';
import { playMusic, stopMusic } from './audio/music.js';
import { setVolumes } from './audio/synth.js';
import { loadRoster, saveRoster, hashRunSeed } from './save.js';
import { createScreenStack, makeTitleScreen, makeGameScreen } from './ui/screens.js';
import { initInput } from './ui/input.js';

// ADAPT: the wave-2 modules load dynamically so the shell (title, office,
// hub, options) still boots if one is missing or broken mid-integration;
// starting a mission is blocked with an on-screen note instead of a crash.
const [game, ai, rendererMod] = await Promise.all([
  import('./engine/game.js').catch((e) => (console.warn('game.js not loaded:', e.message), null)),
  import('./engine/ai.js').catch((e) => (console.warn('ai.js not loaded:', e.message), null)),
  import('./render/renderer.js').catch((e) => (console.warn('renderer.js not loaded:', e.message), null)),
]);

// ---------------------------------------------------------------------------
// AI archetype internal-point lines (§2.11). Derived from the documented
// displayed stat lines via the §2.1 internal model (L1 totals 15 points,
// L15 totals 29; same construction missions.js uses for the rivals).
// ADAPT: if ai.js exports its own archetype stat data, switch to it here.
const ARCHETYPES = {
  'Normal': { l1: { mv: 3, at: 4, df: 5, hp: 3 }, l15: { mv: 9, at: 7, df: 6, hp: 7 } },
  'Turtle': { l1: { mv: 1, at: 2, df: 6, hp: 6 }, l15: { mv: 6, at: 2, df: 14, hp: 7 } },
  'Bandit': { l1: { mv: 3, at: 6, df: 2, hp: 4 }, l15: { mv: 9, at: 12, df: 2, hp: 6 } },
  'Speedster': { l1: { mv: 6, at: 3, df: 2, hp: 4 }, l15: { mv: 12, at: 6, df: 6, hp: 5 } },
  'Defender': { l1: { mv: 3, at: 2, df: 6, hp: 4 }, l15: { mv: 6, at: 5, df: 10, hp: 8 } },
  'Guardian': { l1: { mv: 3, at: 5, df: 4, hp: 3 }, l15: { mv: 3, at: 9, df: 10, hp: 7 } },
  'Bully': { l1: { mv: 1, at: 5, df: 6, hp: 3 }, l15: { mv: 3, at: 10, df: 12, hp: 4 } },
  'Elite': { l1: { mv: 3, at: 6, df: 4, hp: 2 }, l15: { mv: 9, at: 9, df: 8, hp: 3 } },
  'Battler': { l1: { mv: 3, at: 4, df: 4, hp: 4 }, l15: { mv: 6, at: 8, df: 8, hp: 7 } },
  'Survivor': { l1: { mv: 3, at: 3, df: 2, hp: 7 }, l15: { mv: 6, at: 7, df: 4, hp: 12 } },
  'Collector': { l1: { mv: 9, at: 1, df: 4, hp: 1 }, l15: { mv: 15, at: 1, df: 10, hp: 3 } },
  'Runner': { l1: { mv: 9, at: 1, df: 2, hp: 3 }, l15: { mv: 18, at: 1, df: 2, hp: 8 } },
  'Sprint spec.': { l1: { mv: 12, at: 1, df: 1, hp: 1 }, l15: { mv: 24, at: 1, df: 2, hp: 2 } },
  'Attack spec.': { l1: { mv: 3, at: 9, df: 1, hp: 2 }, l15: { mv: 6, at: 20, df: 1, hp: 2 } },
  'Defense spec.': { l1: { mv: 3, at: 1, df: 8, hp: 3 }, l15: { mv: 3, at: 1, df: 20, hp: 5 } },
  'HP spec.': { l1: { mv: 3, at: 1, df: 2, hp: 9 }, l15: { mv: 9, at: 1, df: 2, hp: 17 } },
};
const ARCHETYPE_NAMES = Object.keys(ARCHETYPES);
const AI_NAMES = ['ROOK', 'VEX', 'TALLA', 'BRAM', 'ONNA', 'CRICK', 'JUNO', 'PELL', 'SABLE', 'MOX', 'FERRIS', 'WICK', 'DARA', 'HOLT', 'INES', 'QUILL'];
const SLOT_PALETTES = ['cobalt', 'ember', 'citrine', 'moss']; // P1 blue, P2 red, P3 yellow, P4 green (§2.2)

function archetypeInternal(name, level) {
  const a = ARCHETYPES[name] ?? ARCHETYPES.Normal;
  return interpolateInternal(a.l1, a.l15, Math.max(1, Math.min(15, level)));
}

// Build a §3.1-shaped hunter entry for createGame's config (§1.1).
function aiHunterConfig(opponent, slot, level, used, rng) {
  let name, archetype, internal;
  if (opponent === 'keld' || opponent === 'mira') {
    name = RIVALS[opponent].name.toUpperCase();
    archetype = RIVALS[opponent].priority; // both Clever (§2.15)
    internal = rivalStats(opponent, level).internal;
  } else if (opponent === 'RAVEN') {
    name = `RAVEN-${slot}`;
    archetype = 'RAVEN'; // always behaves Panicked (§2.15)
    internal = archetypeInternal(ARCHETYPE_NAMES[rng.int(ARCHETYPE_NAMES.length)], level);
  } else {
    archetype = ARCHETYPES[opponent] ? opponent : 'Normal';
    internal = archetypeInternal(archetype, level);
    const pool = AI_NAMES.filter((n) => !used.has(n));
    name = pool[rng.int(pool.length)] ?? `CPU-${slot}`;
    used.add(name);
  }
  return {
    id: `ai-${slot}`,
    slot,
    name,
    spriteId: rng.int(8),
    palette: SLOT_PALETTES[slot],
    human: false,
    archetype,
    level,
    internal,
    maxHp: 7 + 3 * internal.hp + (level - 1),
    // NOTE: AI starting items by level (§2.11) are mission setup — left to
    // createGame; if it doesn't grant them, the AIs simply start bare.
    items: [],
  };
}

// Build a createGame config for one depth of a Relic Dive run.
// runState: { rootSeed, depth, startRelicLevel, daily, dateKey, depthResults,
//             perks?, modifiers? }
// recs: human hunter roster records (P1 first). AI fills remaining slots up to 4.
// Hunters carry their items and HP from prior depths; stat perks fold in here.
export function buildRelicDiveConfig(runState, recs) {
  const seed = hashRunSeed(runState.rootSeed, runState.depth);
  const relicLevel = Math.max(1, Math.min(15, runState.startRelicLevel + runState.depth - 1));
  const setupRng = makeRng(seed);
  const used = new Set();
  const aiCount = Math.max(0, 4 - recs.length);
  const opponents = Array.from({ length: aiCount }, () =>
    ARCHETYPE_NAMES[setupRng.int(ARCHETYPE_NAMES.length)]
  );
  const ownedPerks = runState.perks ?? [];
  const luckyBonus = perkHasEffect(ownedPerks, 'reroll+1') ? 1 : 0;
  const bonuses = perkStatBonuses(ownedPerks); // at/df/mv/maxhp deltas from stat perks
  const mods = modifierConfig(runState.modifiers ?? []);
  return {
    seed,
    mode: 'relic-dive',
    fortune: 'fortune' in mods ? mods.fortune : (1 + luckyBonus), // ironhunter overrides to 0
    deckSize: mods.deckSize,
    trapMultiplier: mods.trapMultiplier,
    maxMonsters: mods.maxMonsters,
    restDisabled: mods.restDisabled,
    targetVisible: mods.targetVisible,
    mission: {
      id: `relic-dive-d${runState.depth}`,
      title: `Depth ${runState.depth}`,
      type: 'fetch',
      level: relicLevel,
      opponents: [],
      targetItemId: null,
      carrierIndex: null,
    },
    hunters: [
      ...recs.map((rec, i) => {
        const newMaxHp = rec.maxHp + bonuses.maxhp;
        // Saved HP from end of previous depth; capped to new maxHp
        const savedHp = runState.hunterHps?.[rec.id] ?? newMaxHp;
        const startHp = perkHasEffect(ownedPerks, 'descendHeal')
          ? newMaxHp                              // Survivor: heal to full
          : perkHasEffect(ownedPerks, 'descendBonus')
          ? Math.max(1, Math.floor(newMaxHp / 2)) // Gambler: start at half HP
          : Math.min(savedHp, newMaxHp);           // normal: carry HP, cap to new max
        return {
          id: rec.id,
          slot: i,
          name: rec.name,
          spriteId: rec.spriteId,
          palette: rec.palette,
          human: true,
          archetype: null,
          level: rec.level,
          internal: {
            ...rec.internal,
            at: (rec.internal?.at ?? 1) + bonuses.at,
            df: (rec.internal?.df ?? 1) + bonuses.df,
            mv: (rec.internal?.mv ?? 1) + bonuses.mv,
          },
          maxHp: newMaxHp,
          hp: startHp,
          perks: ownedPerks,
          items: rec.items.map((s) => ({ ...s })),
        };
      }),
      ...opponents.map((o, i) => aiHunterConfig(o, recs.length + i, relicLevel, used, setupRng)),
    ],
  };
}

// recs: array of human hunter records (P1 first); AI fills remaining slots up to 4.
function buildMissionConfig(mission, recs, mode) {
  const used = new Set();
  const level = mode === 'story' ? mission.level : recs[0].level;
  // Generate the game seed first so all subsequent setup (opponent names, sprites,
  // archetypes) derives from it — same seed → identical game every time.
  const seed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
  const setupRng = makeRng(seed);
  let opponents = mission.opponents;
  const aiCount = Math.max(0, 4 - recs.length);
  if (!opponents || !opponents.length) { // normal free-play: random AI fill
    opponents = Array.from({ length: aiCount }, () => ARCHETYPE_NAMES[setupRng.int(ARCHETYPE_NAMES.length)]);
  }
  return {
    seed,
    mode,
    mission,
    hunters: [
      ...recs.map((rec, i) => ({
        id: rec.id,
        slot: i,
        name: rec.name,
        spriteId: rec.spriteId,
        palette: rec.palette,
        human: true,
        archetype: null,
        level: rec.level,
        internal: { ...rec.internal },
        maxHp: rec.maxHp, // hospital damage persists (§2.8)
        items: rec.items.map((s) => ({ ...s })),
      })),
      ...opponents.slice(0, aiCount).map((o, i) => aiHunterConfig(o, recs.length + i, level, used, setupRng)),
    ],
  };
}

// ---------------------------------------------------------------------------
// ADAPT layer — every contact point with game.js / ai.js / renderer.js
// (DESIGN §3.4, §1.2). Anything beyond those documented contracts lives here
// behind small functions so integration can patch ONE place.

// ADAPT: assumed board layout for click->tile mapping and the fallback board
// drawing. If renderer.js draws the board elsewhere, update these numbers.
const BOARD = { ox: 40, oy: 40, tile: 32 };

function resolveUnit(state, ref) {
  if (ref == null || !state) return null;
  if (typeof ref === 'object') {
    if (ref.pos || ref.hp !== undefined || ref.name) return ref; // already a unit
    if (ref.kind !== undefined && ref.index !== undefined) {
      return ref.kind === 'monster' ? state.monsters?.[ref.index] : state.hunters?.[ref.index];
    }
    if (ref.id !== undefined) ref = ref.id;
  }
  for (const u of [...(state.hunters || []), ...(state.monsters || [])]) {
    if (u.id === ref) return u;
  }
  if (typeof ref === 'number') return state.hunters?.find((h) => h.slot === ref) ?? state.hunters?.[ref] ?? null;
  return null;
}

const adapt = {
  // ADAPT: game.js contract (§3.4).
  createGame: (config) => game.createGame(config),
  legalActions: (state) => game.legalActions(state),
  isHumanTurn: (state) => game.isHumanTurn(state),
  currentChooser: (state) => game.currentChooser(state),
  // ADAPT: §3.4 has applyAction -> state with the events inside state.events
  // (drained by the caller); §1.1 sketches {state, events}. Accept both.
  apply(state, action) {
    const out = game.applyAction(state, action);
    const next = out && out.state ? out.state : out;
    const events = (out && Array.isArray(out.events) ? out.events : next.events) || [];
    next.events = [];
    return { state: next, events };
  },
  // ADAPT: renderer.js real API — createRenderer(canvas, {atlas}) returning
  // { setState, pushEvents, update(dtMs), draw(), busy(), skip(),
  //   tileAtPixel(px,py), ... }. Tolerates a missing renderer (null): the
  // fallback board below keeps the game playable.
  makeRenderer(canvas, atlas) {
    try {
      return rendererMod?.createRenderer?.(canvas, { atlas }) ?? null;
    } catch (e) {
      console.warn('renderer init failed, using fallback board:', e);
      return null;
    }
  },
  rendererFeed(r, state, events) {
    try {
      r?.setState?.(state);
      r?.pushEvents?.(events);
    } catch (e) { console.warn(e); }
  },
  rendererBusy(r) {
    try { return !!r?.busy?.(); } catch { return false; }
  },
  rendererSkip(r) {
    try { r?.skip?.(); } catch { /* optional */ }
  },
  rendererDraw(r, state, dt, timeScale = 1) {
    if (r) {
      try {
        r.setTimeScale?.(timeScale); // >1 compresses non-decisive event playback (fast AI)
        r.update(dt * 1000); // renderer clocks in ms
        r.draw();
        return;
      } catch (e) { console.warn('renderer.draw failed, fallback:', e); }
    }
    drawFallbackBoard(state);
  },
  // ADAPT: ai.js may want the game legalActions helper attached to the
  // state object so it can choose actions in a contract-aware way.
  aiAction: (state) => ai.chooseAction({
    ...state,
    legalActions: typeof game?.legalActions === 'function' ? (s) => game.legalActions(s) : undefined,
  }),
  // ADAPT: unitRef shape isn't pinned by §3.1 — accept ids, indices or units.
  resolveUnit,
  unitName(state, ref) {
    const u = resolveUnit(state, ref);
    return u ? (u.name ?? u.kind ?? 'unit') : String(ref);
  },
  tileAt(r, pos) {
    try {
      const t = r?.tileAtPixel?.(pos.x, pos.y);
      if (t !== undefined) return t;
    } catch { /* fall through to fixed layout */ }
    const x = Math.floor((pos.x - BOARD.ox) / BOARD.tile);
    const y = Math.floor((pos.y - BOARD.oy) / BOARD.tile);
    return x >= 0 && y >= 0 && x < 20 && y < 20 ? { x, y } : null;
  },
  // Steering display: feed the reachable-range + walked-path overlays the
  // renderer already knows how to draw (turn.steer only). Pure presentation —
  // composes already-tested reachableTiles/occupiedSet over the live move state.
  steerOverlay(r, state) {
    try {
      if (!r?.showRange || !state?.move) { r?.clearOverlays?.(); return; }
      const me = resolveUnit(state, game?.currentChooser?.(state) ?? state.current);
      if (!me?.pos) { r.clearOverlays?.(); return; }
      r.showRange(reachableTiles(state.board, occupiedSet(state), me.pos, state.move.remaining ?? 0));
      r.showPath(state.move.path?.length ? state.move.path : null);
    } catch { /* presentation only */ }
  },
  clearOverlays(r) {
    try { r?.clearOverlays?.(); } catch { /* optional */ }
  },
  // Tap/click-to-move: shortest legal path (list of 'N'|'S'|'E'|'W' steps) from
  // the current unit to a tapped tile, within the remaining move range. Returns
  // null if the tile isn't one of the reachable "available" squares. The UI walks
  // the unit one step per idle tick so traps/boxes still resolve per step.
  movePath(state, from, to) {
    try { return movePath(state.board, occupiedSet(state), from, to, state.move?.remaining ?? 0); }
    catch { return null; }
  },
};

// Minimal board view used only when renderer.js is absent/broken, so the
// shell is playable stand-alone. Hidden traps stay hidden (§2.2).
const SLOT_HEX = ['#4a7dff', '#e05a4a', '#e0c63a', '#3aa84a'];
const MONSTER_HEX = { VAC: '#9aa6b2', OOZ: '#5fae3f', FNG: '#c25e6a', WYRM: '#7a6ae0' };

function drawFallbackBoard(state) {
  const b = state?.board;
  if (!b) return;
  const T = BOARD.tile;
  for (let y = 0; y < b.h; y++) {
    for (let x = 0; x < b.w; x++) {
      ctx.fillStyle = b.floor[y][x] ? ((x + y) % 2 ? '#262b3a' : '#2b3044') : '#0d0f17';
      ctx.fillRect(BOARD.ox + x * T, BOARD.oy + y * T, T - 1, T - 1);
    }
  }
  const tile = (p, color, inset = 6) => {
    ctx.fillStyle = color;
    ctx.fillRect(BOARD.ox + p.x * T + inset, BOARD.oy + p.y * T + inset, T - inset * 2, T - inset * 2);
  };
  const glyph = (p, s, color) => {
    ctx.fillStyle = color;
    ctx.font = 'bold 13px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(s, BOARD.ox + p.x * T + T / 2, BOARD.oy + p.y * T + T / 2 + 1);
  };
  tile(b.exit, '#2e6e48', 3);
  glyph(b.exit, 'E', '#7ee8a0');
  for (const bx of b.boxes || []) {
    if (!bx.opened) { tile(bx, '#8a6a3a'); glyph(bx, '?', '#e8d87e'); }
  }
  for (const f of b.flags || []) {
    if (!f.taken) tile(f, { red: '#e05a4a', blue: '#4a7dff', green: '#3aa84a', yellow: '#e0c63a' }[f.color], 8);
  }
  for (const mo of state.monsters || []) {
    if (!mo.pos) continue;
    tile(mo.pos, MONSTER_HEX[mo.kind] ?? '#fff', 4);
    glyph(mo.pos, mo.kind[0], '#10131c');
  }
  (state.hunters || []).forEach((h, i) => {
    if (!h.pos) return;
    ctx.fillStyle = SLOT_HEX[h.slot ?? i];
    ctx.beginPath();
    ctx.arc(BOARD.ox + h.pos.x * T + T / 2, BOARD.oy + h.pos.y * T + T / 2, T / 2 - 4, 0, Math.PI * 2);
    ctx.fill();
    glyph(h.pos, (h.name ?? '?')[0], '#0c0e16');
    if (h.hasTarget) {
      ctx.strokeStyle = '#e8d87e';
      ctx.lineWidth = 2;
      ctx.strokeRect(BOARD.ox + h.pos.x * T + 1, BOARD.oy + h.pos.y * T + 1, T - 2, T - 2);
    }
  });
}

// ---------------------------------------------------------------------------
// Boot

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

const atlas = buildAtlas(1);
const stack = createScreenStack();

const app = {
  canvas, ctx, W: canvas.width, H: canvas.height,
  // Touch devices (phones/tablets) get larger, centered in-play dialogs — the
  // compact side menu is too small to read/tap on a phone.
  isTouch: (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0)
    || (typeof window !== 'undefined' && 'ontouchstart' in window),
  atlas, stack, adapt,
  roster: loadRoster(),
  session: { mode: 'normal', hunterId: null, coopIds: [] },
  songName: null,
  bootNote: (game && ai) ? '' : 'engine modules missing - missions disabled (see console)',
  options() { return this.roster.options; },
  save() { saveRoster(this.roster); },
  music(name) {
    this.songName = name;
    if (name) playMusic(name); // no-op before the first user gesture unlocks audio
    else stopMusic();
  },
  // Start one depth of a Relic Dive run. runState carries depth + seed context.
  // The run screen (screens.js) owns the runState; this method just wires engine + renderer.
  startRelicDiveDepth(runState) {
    if (!game || !ai) {
      app.bootNote = 'cannot start: engine/ai module failed to load (console has details)';
      return false;
    }
    const rec = this.roster.hunters.find((h) => h.id === this.session.hunterId);
    if (!rec) return false;
    try {
      // Co-op party only applies to normal mode (D04): solo story / relic dive
      // must not inherit a stale normal-mode co-op roster.
      const coopRecs = this.session.mode === 'normal'
        ? (this.session.coopIds || [])
          .map((id) => this.roster.hunters.find((h) => h.id === id))
          .filter(Boolean)
        : [];
      const config = buildRelicDiveConfig(runState, [rec, ...coopRecs]);
      const state = adapt.createGame(config);
      const renderer = adapt.makeRenderer(canvas, atlas);
      adapt.rendererFeed(renderer, state, state.events ?? []);
      state.events = [];
      stack.replace(makeGameScreen(app, { state, renderer, mission: config.mission, outcome: {}, runState }));
      return true;
    } catch (e) {
      console.error('startRelicDiveDepth failed', e);
      app.bootNote = 'relic dive depth failed to start (see console)';
      return false;
    }
  },
  // Build config, spin up engine + renderer, swap the current screen for GAME.
  startMission(mission) {
    if (!game || !ai) {
      app.bootNote = 'cannot start: engine/ai module failed to load (console has details)';
      return false;
    }
    const rec = this.roster.hunters.find((h) => h.id === this.session.hunterId);
    if (!rec) return false;
    try {
      // Co-op party only applies to normal mode (D04): solo story / Quick Start
      // must not inherit a stale normal-mode co-op roster.
      const coopRecs = this.session.mode === 'normal'
        ? (this.session.coopIds || [])
          .map((id) => this.roster.hunters.find((h) => h.id === id))
          .filter(Boolean)
        : [];
      const config = buildMissionConfig(mission, [rec, ...coopRecs], this.session.mode);
      const state = adapt.createGame(config);
      const renderer = adapt.makeRenderer(canvas, atlas);
      adapt.rendererFeed(renderer, state, state.events ?? []); // initial setState
      state.events = [];
      stack.replace(makeGameScreen(app, { state, renderer, mission, outcome: {} }));
      return true;
    } catch (e) {
      console.error('startMission failed', e);
      app.bootNote = 'mission start failed (see console)';
      return false;
    }
  },
  // Like startMission but pushes GAME on top of the current screen instead of replacing it.
  // Use when there's already a screen below that should be returned to after results.
  pushMission(mission) {
    if (!game || !ai) return false;
    const rec = this.roster.hunters.find((h) => h.id === this.session.hunterId);
    if (!rec) return false;
    try {
      // Co-op party only applies to normal mode (D04): solo story must not
      // inherit a stale normal-mode co-op roster.
      const coopRecs = this.session.mode === 'normal'
        ? (this.session.coopIds || [])
          .map((id) => this.roster.hunters.find((h) => h.id === id))
          .filter(Boolean)
        : [];
      const config = buildMissionConfig(mission, [rec, ...coopRecs], this.session.mode);
      const state = adapt.createGame(config);
      const renderer = adapt.makeRenderer(canvas, atlas);
      adapt.rendererFeed(renderer, state, state.events ?? []);
      state.events = [];
      stack.push(makeGameScreen(app, { state, renderer, mission, outcome: {} }));
      return true;
    } catch (e) {
      console.error('pushMission failed', e);
      return false;
    }
  },
};

initInput(canvas, () => stack.top(), {
  onFirstGesture() {
    setVolumes(app.options().volumes);
    if (app.songName) playMusic(app.songName); // music was muted pre-unlock
  },
});

stack.push(makeTitleScreen(app));

// Fixed-dt update, rAF-paced draw (§1.3): engine state advances instantly on
// actions; screens/renderer animate at their own pace.
const STEP = 1 / 60;
let last = performance.now();
let acc = 0;
function frame(now) {
  acc += Math.min(0.25, (now - last) / 1000);
  last = now;
  while (acc >= STEP) {
    stack.update(STEP);
    acc -= STEP;
  }
  ctx.imageSmoothingEnabled = false;
  ctx.filter = app.options().colorblind ? 'saturate(2.2) contrast(1.1)' : 'none';
  ctx.fillStyle = '#06060c';
  ctx.fillRect(0, 0, app.W, app.H);
  stack.draw(ctx);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
