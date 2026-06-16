// AI: choose a legal action for the current unit. Receives the full GameState
// (with an optional legalActions helper attached). Returns an action object.

// Archetype → { priority, restHp } per §2.11. restHp is the HP fraction below
// which the AI rests instead of acting. Panicked = RAVEN agents (random each turn).
const BEHAVIORS = {
  'Normal':       { priority: 'balanced',    restHp: 0.50 },
  'Turtle':       { priority: 'passive',     restHp: 0.75 },
  'Bandit':       { priority: 'aggressive',  restHp: 0.25 },
  'Speedster':    { priority: 'clever',      restHp: 0.50 },
  'Defender':     { priority: 'passive',     restHp: 0.75 },
  'Guardian':     { priority: 'balanced',    restHp: 0.50 },
  'Bully':        { priority: 'aggressive',  restHp: 0.25 },
  'Elite':        { priority: 'clever',      restHp: 0.50 },
  'Battler':      { priority: 'aggressive',  restHp: 0.50 },
  'Survivor':     { priority: 'balanced',    restHp: 1.00 },
  'Collector':    { priority: 'passive',     restHp: 0.75 },
  'Runner':       { priority: 'clever',      restHp: 0.25 },
  'Sprint spec.': { priority: 'clever',      restHp: 0.00 },
  'Attack spec.': { priority: 'aggressive',  restHp: 0.00 },
  'Defense spec.': { priority: 'passive',   restHp: 1.00 },
  'HP spec.':     { priority: 'balanced',    restHp: 1.00 },
  'RAVEN':        { priority: 'panicked',    restHp: 0.50 },
  'Clever':       { priority: 'clever',      restHp: 0.50 },
  'Aggressive':   { priority: 'aggressive',  restHp: 0.25 },
  'Passive':      { priority: 'passive',     restHp: 0.75 },
};

const PANICKED_CYCLE = ['aggressive', 'clever', 'balanced', 'passive'];

function getBehavior(unit, state) {
  // Panicked human: AI controls the turn with a cycling archetype (§2.9).
  if (unit?.human && unit?.status?.panic > 0) {
    return { priority: PANICKED_CYCLE[(state?.round ?? 0) % PANICKED_CYCLE.length], restHp: 0.50 };
  }
  const b = BEHAVIORS[unit?.archetype ?? ''] ?? { priority: 'balanced', restHp: 0.50 };
  if (b.priority !== 'panicked') return b;
  // RAVEN: deterministic but varied — cycle through priorities each round.
  return { priority: PANICKED_CYCLE[(state?.round ?? 0) % PANICKED_CYCLE.length], restHp: b.restHp };
}

function getLegalActions(state) {
  if (!state) return [];
  if (typeof state.legalActions === 'function') return state.legalActions(state) || [];
  if (Array.isArray(state.legalActions)) return state.legalActions;
  return [];
}

function currentUnit(state) {
  const ref = state?.current;
  if (!ref) return null;
  if (ref.kind === 'hunter') return state.hunters?.[ref.index] ?? null;
  if (ref.kind === 'monster') return state.monsters?.[ref.index] ?? null;
  return null;
}

function nearest(pos, targets) {
  if (!targets.length) return null;
  return targets.reduce((best, t) => {
    const d = Math.abs(t.x - pos.x) + Math.abs(t.y - pos.y);
    const bd = Math.abs(best.x - pos.x) + Math.abs(best.y - pos.y);
    return d < bd ? t : best;
  }, targets[0]);
}

// BFS from `from` toward `goal`; returns the direction char to step ('N','S','W','E')
// that starts the shortest path, or null if goal is unreachable.
function bfsDir(board, occupiedKeys, from, goal) {
  if (!board || !from || !goal) return null;
  const W = board.w, H = board.h;
  const enc = (x, y) => y * W + x;
  const fromKey = enc(from.x, from.y);
  const goalKey = enc(goal.x, goal.y);
  if (fromKey === goalKey) return null;

  const STEPS = [{ x: 0, y: -1, d: 'N' }, { x: 0, y: 1, d: 'S' }, { x: -1, y: 0, d: 'W' }, { x: 1, y: 0, d: 'E' }];
  const prev = new Map([[fromKey, -1]]);
  const q = [from];

  while (q.length) {
    const cur = q.shift();
    for (const s of STEPS) {
      const nx = cur.x + s.x, ny = cur.y + s.y;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      if (!board.floor[ny][nx]) continue;
      const nk = enc(nx, ny);
      if (prev.has(nk)) continue;
      if (nk !== goalKey && occupiedKeys.has(`${nx},${ny}`)) continue;
      prev.set(nk, enc(cur.x, cur.y));
      if (nk === goalKey) {
        // Walk back to find the first step from `from`.
        let node = nk;
        let parent = prev.get(node);
        while (parent !== fromKey) { node = parent; parent = prev.get(node); }
        const tx = node % W, ty = Math.floor(node / W);
        return STEPS.find((s) => from.x + s.x === tx && from.y + s.y === ty)?.d ?? null;
      }
      q.push({ x: nx, y: ny });
    }
  }
  return null;
}

function occupiedSet(state) {
  const s = new Set();
  for (const u of [...(state.hunters || []), ...(state.monsters || [])]) {
    if (u.pos && u.hp > 0) s.add(`${u.pos.x},${u.pos.y}`);
  }
  return s;
}

// Pick a navigation goal for a hunter based on their archetype priority.
function hunterGoal(unit, state, priority) {
  const board = state?.board;
  if (!board || !unit?.pos) return null;
  if (unit.hasTarget && board.exit) return board.exit;

  const boxes = (board.boxes || []).filter((b) => !b.opened);
  const flags = (board.flags || []).filter((f) => !f.taken);

  const targetHolder = state.targetHolder?.kind === 'hunter'
    ? state.hunters?.[state.targetHolder.index]
    : null;
  const holderPos = (targetHolder?.pos && targetHolder.id !== unit.id) ? targetHolder.pos : null;

  // Rescue mission: unclaimed NPC drives non-human AI after hold-back rounds expire.
  const rescue = board.rescue && !board.rescue.claimed ? board.rescue : null;
  if (rescue && !unit.human) {
    const holding = state.round > (state.rescueHoldRounds ?? 0);
    if (holding) return rescue; // rush the NPC
    // During hold-back: fall through to normal looting behaviour
  }

  if (priority === 'aggressive') {
    // Chase target holder if target is in play, else nearest other alive hunter.
    if (state.targetFound && holderPos) return holderPos;
    const others = (state.hunters || []).filter((h) => h.id !== unit.id && h.hp > 0 && h.pos);
    if (others.length) return nearest(unit.pos, others.map((h) => h.pos));
    return nearest(unit.pos, boxes) ?? board.exit;
  }

  if (priority === 'passive') {
    // Boxes first, then flags; avoid picking fights.
    return nearest(unit.pos, [...boxes, ...flags]) ?? board.exit;
  }

  if (priority === 'clever') {
    // Loot until target found; then chase holder → exit.
    if (state.targetFound) return holderPos ?? board.exit;
    return nearest(unit.pos, boxes) ?? board.exit;
  }

  // Balanced (default): boxes first, then chase holder once target is found.
  if (state.targetFound && holderPos) return holderPos;
  return nearest(unit.pos, boxes) ?? board.exit;
}

function monsterGoal(state) {
  const holder = state.targetHolder?.kind === 'hunter'
    ? state.hunters?.[state.targetHolder.index]
    : null;
  const target = holder ?? (state.hunters || []).find((h) => h.pos && h.hp > 0);
  return target?.pos ?? null;
}

function chooseBestStep(state, steps, priority) {
  if (!steps.length) return null;
  const unit = currentUnit(state);
  if (!unit?.pos) return steps[0];
  const goal = state.current?.kind === 'monster'
    ? monsterGoal(state)
    : hunterGoal(unit, state, priority ?? 'balanced');
  if (!goal) return steps[0];
  const occ = occupiedSet(state);
  const dir = bfsDir(state.board, occ, unit.pos, goal);
  if (dir) {
    const found = steps.find((s) => s.dir === dir);
    if (found) return found;
  }
  // BFS unreachable or no matching step — pick whichever step reduces distance most.
  return steps.reduce((best, s) => {
    const DELTA = { N: { x: 0, y: -1 }, S: { x: 0, y: 1 }, W: { x: -1, y: 0 }, E: { x: 1, y: 0 } };
    const d = DELTA[s.dir];
    if (!d) return best;
    const newDist = Math.abs((unit.pos.x + d.x) - goal.x) + Math.abs((unit.pos.y + d.y) - goal.y);
    const bd = DELTA[best.dir];
    const bestDist = bd ? Math.abs((unit.pos.x + bd.x) - goal.x) + Math.abs((unit.pos.y + bd.y) - goal.y) : Infinity;
    return newDist < bestDist ? s : best;
  }, steps[0]);
}

function chooseBattleCard(actions) {
  const cards = actions.filter((a) => a.type === 'battleCard');
  const playable = cards.filter((a) => a.card).sort((a, b) => {
    const va = parseInt((a.card ?? '').replace(/\D/g, ''), 10) || 0;
    const vb = parseInt((b.card ?? '').replace(/\D/g, ''), 10) || 0;
    return vb - va;
  });
  return playable[0] ?? cards.find((a) => !a.card) ?? cards[0];
}

function chooseMoveAction(actions) {
  const moves = actions.filter((a) => a.type === 'move');
  // Prefer blue card moves (most range bonus); fall back to plain move.
  const blueMoves = moves.filter((a) => a.card && a.card.startsWith('B'));
  if (blueMoves.length) return blueMoves[blueMoves.length - 1];
  return moves.find((a) => !a.card) ?? moves[0];
}

export function chooseAction(state) {
  try {
    const actions = getLegalActions(state);
    if (!actions.length) return { type: 'pass' };

    const phase = state?.phase;
    const unit = currentUnit(state);
    const beh = getBehavior(unit, state);
    const { priority, restHp } = beh;

    if (phase === 'react.dodge' || phase === 'react.crit') {
      return { type: 'timing', hit: false };
    }

    if (phase === 'turn.steer') {
      const steps = actions.filter((a) => a.type === 'step');
      const stop = actions.find((a) => a.type === 'stop');
      if (!steps.length) return stop || actions[0];
      const best = chooseBestStep(state, steps, priority);
      return best ?? stop ?? actions[0];
    }

    if (phase === 'turn.postMove') {
      // Passive or target-holder: never initiate attack (flee to exit).
      if (priority !== 'passive' && !unit?.hasTarget) {
        const attack = actions.find((a) => a.type === 'attack');
        if (attack) return attack;
      }
      return actions.find((a) => a.type === 'pass') ?? actions[0];
    }

    if (phase === 'battle.defCard' || phase === 'battle.atkCard') {
      return chooseBattleCard(actions);
    }

    if (phase === 'battle.response') {
      const hpFrac = unit ? unit.hp / Math.max(1, unit.maxHp) : 1;
      if (hpFrac < 0.25) {
        const escape = actions.find((a) => a.type === 'respond' && a.response === 'escape');
        if (escape) return escape;
      }
      const order = priority === 'aggressive'
        ? ['counter', 'guard', 'none', 'escape', 'surrender']
        : priority === 'passive'
          ? ['guard', 'none', 'counter', 'escape', 'surrender']
          : ['counter', 'guard', 'none', 'escape', 'surrender'];
      for (const r of order) {
        const found = actions.find((a) => a.type === 'respond' && a.response === r);
        if (found) return found;
      }
      return actions[0];
    }

    if (state?.pendingChoice) return actions[0];

    if (phase === 'turn.action') {
      const hpFrac = unit ? unit.hp / Math.max(1, unit.maxHp) : 1;
      const handLow = (unit?.hand?.length ?? 5) < 2;
      const deckEmpty = (state?.deck?.length ?? 0) === 0;

      // Target-holder: skip attacking and head for the exit.
      if (!unit?.hasTarget) {
        // Aggressive: attack before anything else if possible.
        if (priority === 'aggressive') {
          const attack = actions.find((a) => a.type === 'attack');
          if (attack) return attack;
        }
      }

      // Rest when HP is below archetype threshold or hand is critically low
      // (skip hand-low rest when deck is empty — drawing is impossible).
      if ((hpFrac < restHp || (handLow && !deckEmpty)) && actions.find((a) => a.type === 'rest')) {
        return actions.find((a) => a.type === 'rest');
      }

      // Non-aggressive non-holder: attack adjacent enemies.
      if (priority !== 'passive' && priority !== 'aggressive' && !unit?.hasTarget) {
        const attack = actions.find((a) => a.type === 'attack');
        if (attack) return attack;
      }

      const move = chooseMoveAction(actions);
      if (move) return move;

      return actions.find((a) => a.type === 'rest') ?? actions[0];
    }

    for (const type of ['attack', 'move', 'rest', 'respond', 'battleCard', 'stop', 'pass', 'confirm', 'pick']) {
      const found = actions.find((a) => a.type === type);
      if (found) return found;
    }
    return actions[0];
  } catch {
    return { type: 'pass' };
  }
}
