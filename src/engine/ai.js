// AI: choose a legal action for the current unit. Receives the full GameState
// (with an optional legalActions helper attached). Returns an action object.

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
    if (u.pos) s.add(`${u.pos.x},${u.pos.y}`);
  }
  return s;
}

function hunterGoal(unit, board) {
  if (!board || !unit?.pos) return null;
  if (unit.hasTarget && board.exit) return board.exit;
  const candidates = [
    ...(board.boxes || []).filter((b) => !b.opened),
    ...(board.flags || []).filter((f) => !f.taken),
  ];
  if (!candidates.length) return board.exit;
  return candidates.reduce((best, t) => {
    const d = Math.abs(t.x - unit.pos.x) + Math.abs(t.y - unit.pos.y);
    const bd = Math.abs(best.x - unit.pos.x) + Math.abs(best.y - unit.pos.y);
    return d < bd ? t : best;
  }, candidates[0]);
}

function monsterGoal(state) {
  const holder = state.targetHolder?.kind === 'hunter'
    ? state.hunters?.[state.targetHolder.index]
    : null;
  const target = holder ?? (state.hunters || []).find((h) => h.pos && h.hp > 0);
  return target?.pos ?? null;
}

function chooseBestStep(state, steps) {
  if (!steps.length) return null;
  const unit = currentUnit(state);
  if (!unit?.pos) return steps[0];
  const goal = state.current?.kind === 'monster'
    ? monsterGoal(state)
    : hunterGoal(unit, state.board);
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

    if (phase === 'react.dodge' || phase === 'react.crit') {
      return { type: 'timing', hit: false };
    }

    if (phase === 'turn.steer') {
      const steps = actions.filter((a) => a.type === 'step');
      const stop = actions.find((a) => a.type === 'stop');
      if (!steps.length) return stop || actions[0];
      return chooseBestStep(state, steps);
    }

    if (phase === 'turn.postMove') {
      return actions.find((a) => a.type === 'attack')
        ?? actions.find((a) => a.type === 'pass')
        ?? actions[0];
    }

    if (phase === 'battle.defCard' || phase === 'battle.atkCard') {
      return chooseBattleCard(actions);
    }

    if (phase === 'battle.response') {
      const unit = currentUnit(state);
      const hpFrac = unit ? unit.hp / Math.max(1, unit.maxHp) : 1;
      if (hpFrac < 0.25) {
        const escape = actions.find((a) => a.type === 'respond' && a.response === 'escape');
        if (escape) return escape;
      }
      for (const r of ['counter', 'guard', 'none', 'escape', 'surrender']) {
        const found = actions.find((a) => a.type === 'respond' && a.response === r);
        if (found) return found;
      }
      return actions[0];
    }

    if (state?.pendingChoice) return actions[0];

    if (phase === 'turn.action') {
      const unit = currentUnit(state);
      const attack = actions.find((a) => a.type === 'attack');
      if (attack) return attack;

      // Rest to draw cards when hand is low or HP is very low.
      const hpFrac = unit ? unit.hp / Math.max(1, unit.maxHp) : 1;
      const handLow = (unit?.hand?.length ?? 5) < 2;
      if ((hpFrac < 0.35 || handLow) && actions.find((a) => a.type === 'rest')) {
        return actions.find((a) => a.type === 'rest');
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
