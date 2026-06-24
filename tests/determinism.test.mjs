// Phase-0 acceptance gate (Relic Dive ROADMAP): the deterministic engine must
// replay bit-identically from the same seed. gameplay.test has a basic version
// (event TYPES only); this is the rigorous one the seeded run/daily features
// depend on — full event payloads + step-by-step state digests + terminal state
// must match across runs, and DIFFERENT seeds must diverge (so it can't pass
// vacuously). If this ever goes red, no seed-share / daily / ghost is honest.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, legalActions, applyAction } from '../src/engine/game.js';
import { chooseAction } from '../src/engine/ai.js';

function hunter(id, slot) {
  return {
    id, slot, name: id, spriteId: 0, palette: 'cobalt', human: false,
    archetype: null, level: 1, internal: { mv: 9, at: 3, df: 2, hp: 3 },
    maxHp: 16, items: [],
  };
}
const config = (seed) => ({
  seed, mode: 'normal',
  hunters: [hunter('h0', 0), hunter('h1', 1), hunter('h2', 2), hunter('h3', 3)],
});

// Compact, fully-comparable snapshot of everything that must be reproducible.
function digest(s) {
  return {
    phase: s.phase, round: s.round, deck: s.deck.length,
    current: s.current, targetFound: s.targetFound,
    hunters: s.hunters.map((h) => ({
      pos: h.pos, hp: h.hp, maxHp: h.maxHp,
      items: h.items, status: h.status, tally: h.tally, hasTarget: h.hasTarget,
    })),
    monsters: s.monsters.map((m) => ({ kind: m.kind, pos: m.pos, hp: m.hp })),
    result: s.result ?? null,
  };
}

// Drive a full all-AI game, recording the per-step action, emitted events, and
// the post-step digest — the complete observable trace.
function traceGame(seed, maxSteps = 5000) {
  let state = createGame(config(seed));
  const trace = [];
  let steps = 0;
  while (state.phase !== 'mission.over' && steps < maxSteps) {
    const action = chooseAction({ ...state, legalActions: (s) => legalActions(s) });
    if (!action) break;
    const out = applyAction(state, action);
    trace.push({ action, events: out.state.events ?? [], digest: digest(out.state) });
    state = out.state;
    steps++;
  }
  return { trace, terminal: digest(state), steps };
}

const SEEDS = [7, 42, 123, 2024];

for (const seed of SEEDS) {
  test(`determinism: seed ${seed} replays bit-identically (actions, events, every state)`, () => {
    const a = traceGame(seed);
    const b = traceGame(seed);
    assert.equal(a.steps, b.steps, 'step count diverged');
    // Full per-step equality: actions, event payloads, and the state digest at
    // every single step — the strongest replay guarantee.
    assert.deepEqual(a.trace, b.trace, 'per-step trace (action+events+state) diverged');
    assert.deepEqual(a.terminal, b.terminal, 'terminal state diverged');
  });
}

test('determinism: a game actually does something (trace is non-trivial)', () => {
  const { trace, steps } = traceGame(7);
  assert.ok(steps > 20, `expected a substantial game, got ${steps} steps`);
  assert.ok(trace.some((t) => t.events.length > 0), 'expected emitted events');
});

test('determinism: different seeds diverge (the test is not vacuous)', () => {
  // If two distinct seeds produced identical traces, the equality checks above
  // would be meaningless. At least one pair must differ.
  const traces = SEEDS.map((s) => traceGame(s).trace.map((t) => t.action.type).join(','));
  const allIdentical = traces.every((t) => t === traces[0]);
  assert.ok(!allIdentical, 'different seeds must produce different games');
});
