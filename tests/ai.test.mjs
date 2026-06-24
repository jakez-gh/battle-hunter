import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseAction } from '../src/engine/ai.js';
import { createGame, legalActions, applyAction } from '../src/engine/game.js';

// Minimal hunter for state construction.
function mkHunter(opts = {}) {
  return {
    id: opts.id ?? 'h0',
    archetype: opts.archetype ?? 'Normal',
    hp: opts.hp ?? 10,
    maxHp: opts.maxHp ?? 10,
    hand: opts.hand ?? [],
    items: opts.items ?? [],
    hasTarget: opts.hasTarget ?? false,
    status: opts.status ?? { stun: 0, leg: false, panic: 0, empty: 0 },
    pos: opts.pos ?? { x: 0, y: 0 },
    level: opts.level ?? 1,
    human: opts.human ?? false,
    internal: opts.internal ?? { mv: 3, at: 4, df: 4, hp: 4 },
  };
}

// Minimal state with legalActions as an array (AI's getLegalActions accepts this).
function mkState(phase, actions, opts = {}) {
  return {
    phase,
    legalActions: actions,
    current: opts.current ?? { kind: 'hunter', index: 0 },
    round: opts.round ?? 1,
    hunters: opts.hunters ?? [mkHunter()],
    monsters: opts.monsters ?? [],
    board: opts.board ?? null,
    pendingChoice: opts.pendingChoice ?? null,
    targetHolder: opts.targetHolder ?? null,
    targetFound: opts.targetFound ?? false,
    mode: opts.mode ?? 'normal',
    relicLevel: opts.relicLevel ?? 1,
    deck: opts.deck ?? Array(90).fill('R1'),
    events: opts.events ?? [],
  };
}

// ---------------------------------------------------------------------------
// Timing phases (react.dodge / react.crit) → archetype-scaled probability.

test('react.dodge: AI returns a timing action', () => {
  const state = mkState('react.dodge', [{ type: 'timing', hit: false }, { type: 'timing', hit: true }]);
  const act = chooseAction(state);
  assert.equal(act.type, 'timing');
  assert.equal(typeof act.hit, 'boolean');
});

test('react.crit: AI returns a timing action', () => {
  const state = mkState('react.crit', [{ type: 'timing', hit: false }, { type: 'timing', hit: true }]);
  const act = chooseAction(state);
  assert.equal(act.type, 'timing');
  assert.equal(typeof act.hit, 'boolean');
});

test('react.crit: clever archetype succeeds more than passive over 100 rounds', () => {
  // Deterministic hash produces different hit rates per archetype.
  let cleverHits = 0, passiveHits = 0;
  for (let round = 0; round < 100; round++) {
    const clever = mkState('react.crit', [{ type: 'timing', hit: false }, { type: 'timing', hit: true }],
      { hunters: [mkHunter({ archetype: 'Elite' })], round });
    const passive = mkState('react.crit', [{ type: 'timing', hit: false }, { type: 'timing', hit: true }],
      { hunters: [mkHunter({ archetype: 'Turtle' })], round });
    if (chooseAction(clever).hit) cleverHits++;
    if (chooseAction(passive).hit) passiveHits++;
  }
  assert.ok(cleverHits > passiveHits,
    `clever hits (${cleverHits}) should exceed passive hits (${passiveHits}) over 100 rounds`);
});

// ---------------------------------------------------------------------------
// turn.steer → picks a step action (or stop if no steps).

test('turn.steer: AI picks a step when steps are available', () => {
  const steps = [{ type: 'step', dir: 'N' }, { type: 'step', dir: 'E' }];
  const stop = { type: 'stop' };
  const state = mkState('turn.steer', [...steps, stop],
    { hunters: [mkHunter({ pos: { x: 1, y: 1 } })] });
  const act = chooseAction(state);
  assert.equal(act.type, 'step');
});

test('turn.steer: AI picks stop when no steps available', () => {
  const state = mkState('turn.steer', [{ type: 'stop' }]);
  const act = chooseAction(state);
  assert.equal(act.type, 'stop');
});

// ---------------------------------------------------------------------------
// turn.postMove — attack vs pass choice.

test('turn.postMove: non-passive, non-holder AI picks attack over pass', () => {
  const attack = { type: 'attack', target: { kind: 'monster', index: 0 } };
  const pass = { type: 'pass' };
  const state = mkState('turn.postMove', [attack, pass],
    { hunters: [mkHunter({ archetype: 'Normal', hasTarget: false })] });
  const act = chooseAction(state);
  assert.equal(act.type, 'attack');
});

test('turn.postMove: passive AI picks pass over attack', () => {
  const attack = { type: 'attack', target: { kind: 'monster', index: 0 } };
  const pass = { type: 'pass' };
  const state = mkState('turn.postMove', [attack, pass],
    { hunters: [mkHunter({ archetype: 'Turtle', hasTarget: false })] });
  const act = chooseAction(state);
  assert.equal(act.type, 'pass');
});

test('turn.postMove: target-holder AI picks pass (flee to exit, do not fight)', () => {
  const attack = { type: 'attack', target: { kind: 'monster', index: 0 } };
  const pass = { type: 'pass' };
  const state = mkState('turn.postMove', [attack, pass],
    { hunters: [mkHunter({ archetype: 'Bully', hasTarget: true })] });
  const act = chooseAction(state);
  assert.equal(act.type, 'pass');
});

// ---------------------------------------------------------------------------
// Battle card phases.

test('battle.defCard: AI picks no-card (always available fallback)', () => {
  const state = mkState('battle.defCard', [{ type: 'battleCard', card: null }]);
  const act = chooseAction(state);
  assert.equal(act.type, 'battleCard');
});

test('battle.atkCard: AI picks highest numeric card over no-card', () => {
  const acts = [
    { type: 'battleCard', card: null },
    { type: 'battleCard', card: 'R3' },
    { type: 'battleCard', card: 'R7' },
    { type: 'battleCard', card: 'Y2' },
  ];
  const state = mkState('battle.atkCard', acts);
  const act = chooseAction(state);
  assert.equal(act.type, 'battleCard');
  // Should pick the highest numeric value card (R7 = 7).
  assert.equal(act.card, 'R7');
});

// ---------------------------------------------------------------------------
// battle.response — preference ordering by archetype.

test('battle.response: aggressive AI prefers counter', () => {
  const acts = [
    { type: 'respond', response: 'counter' },
    { type: 'respond', response: 'guard' },
    { type: 'respond', response: 'escape' },
  ];
  const state = mkState('battle.response', acts,
    { hunters: [mkHunter({ archetype: 'Bully', hp: 10, maxHp: 10, hand: ['B1'] })] });
  const act = chooseAction(state);
  assert.equal(act.response, 'counter');
});

test('battle.response: passive AI prefers guard', () => {
  const acts = [
    { type: 'respond', response: 'counter' },
    { type: 'respond', response: 'guard' },
  ];
  const state = mkState('battle.response', acts,
    { hunters: [mkHunter({ archetype: 'Turtle', hp: 10, maxHp: 10 })] });
  const act = chooseAction(state);
  assert.equal(act.response, 'guard');
});

test('battle.response: AI bails to escape when HP is critically low', () => {
  const acts = [
    { type: 'respond', response: 'counter' },
    { type: 'respond', response: 'guard' },
    { type: 'respond', response: 'escape' },
  ];
  // HP < 25% of maxHp triggers the escape-first path.
  const state = mkState('battle.response', acts,
    { hunters: [mkHunter({ archetype: 'Normal', hp: 2, maxHp: 10, hand: ['B1'] })] });
  const act = chooseAction(state);
  assert.equal(act.response, 'escape');
});

// ---------------------------------------------------------------------------
// pendingChoice → first available pick action.

test('pendingChoice: AI returns the first pick action', () => {
  const picks = [
    { type: 'pick', option: { itemId: 'TARGET', label: 'TARGET ITEM' } },
    { type: 'pick', option: { itemId: 'gold', identified: true } },
  ];
  const state = mkState('choice.steal', picks,
    { pendingChoice: { kind: 'steal', chooser: { kind: 'hunter', index: 0 }, options: [] } });
  const act = chooseAction(state);
  assert.equal(act.type, 'pick');
  assert.equal(act.option.itemId, 'TARGET');
});

// ---------------------------------------------------------------------------
// turn.action priority logic.

test('turn.action: aggressive AI attacks before moving when attack is available', () => {
  const acts = [
    { type: 'attack', target: { kind: 'monster', index: 0 } },
    { type: 'move' },
    { type: 'rest' },
  ];
  const state = mkState('turn.action', acts,
    { hunters: [mkHunter({ archetype: 'Bully', hp: 10, maxHp: 10 })] });
  const act = chooseAction(state);
  assert.equal(act.type, 'attack');
});

test('turn.action: non-aggressive AI attacks when available and not holding target', () => {
  const acts = [
    { type: 'attack', target: { kind: 'monster', index: 0 } },
    { type: 'move' },
    { type: 'rest' },
  ];
  // Provide 5 hand cards so the hand-low rest heuristic doesn't fire.
  const state = mkState('turn.action', acts, {
    hunters: [mkHunter({ archetype: 'Normal', hp: 10, maxHp: 10, hasTarget: false,
      hand: ['R1', 'R2', 'R3', 'Y1', 'Y2'] })],
  });
  const act = chooseAction(state);
  assert.equal(act.type, 'attack');
});

test('turn.action: target-holder AI does not initiate attack (moves instead)', () => {
  const acts = [
    { type: 'attack', target: { kind: 'monster', index: 0 } },
    { type: 'move' },
    { type: 'rest' },
  ];
  // hasTarget = true → skip all attacks in turn.action
  const state = mkState('turn.action', acts,
    { hunters: [mkHunter({ archetype: 'Bully', hp: 10, maxHp: 10, hasTarget: true })] });
  const act = chooseAction(state);
  assert.ok(act.type !== 'attack', 'target-holder does not attack');
});

test('turn.action: AI rests when HP is critically low', () => {
  const acts = [
    { type: 'move' },
    { type: 'rest' },
  ];
  // HP well below restHp threshold (Normal: 0.50)
  const state = mkState('turn.action', acts,
    { hunters: [mkHunter({ archetype: 'Normal', hp: 2, maxHp: 20 })] });
  const act = chooseAction(state);
  assert.equal(act.type, 'rest');
});

test('turn.action: AI rests when hand is low and deck not empty', () => {
  const acts = [{ type: 'move' }, { type: 'rest' }];
  // hand < 2 cards and deck has cards → rest to draw
  const state = mkState('turn.action', acts, {
    hunters: [mkHunter({ archetype: 'Sprint spec.', hp: 10, maxHp: 10, hand: ['R1'] })],
    deck: Array(5).fill('R2'),
  });
  const act = chooseAction(state);
  assert.equal(act.type, 'rest');
});

test('turn.action: AI moves when hand is low but deck is empty (rest is useless)', () => {
  const acts = [{ type: 'move' }, { type: 'rest' }];
  const state = mkState('turn.action', acts, {
    hunters: [mkHunter({ archetype: 'Sprint spec.', hp: 10, maxHp: 10, hand: ['R1'] })],
    deck: [],
  });
  const act = chooseAction(state);
  assert.equal(act.type, 'move');
});

// ---------------------------------------------------------------------------
// RAVEN panicked archetype: cycles through priorities each round.

test('RAVEN cycles through all four priority archetypes over rounds', () => {
  const acts = [
    { type: 'attack', target: { kind: 'monster', index: 0 } },
    { type: 'move' },
    { type: 'rest' },
    { type: 'pass' },
  ];
  // Round 0 → aggressive, 1 → clever, 2 → balanced, 3 → passive (PANICKED_CYCLE).
  // Aggressive attacks first; passive avoids attacks.
  const hunter = mkHunter({ archetype: 'RAVEN', hp: 10, maxHp: 10 });
  const aggressiveRound = mkState('turn.action', acts, { hunters: [hunter], round: 0 });
  assert.equal(chooseAction(aggressiveRound).type, 'attack');
  const passiveRound = mkState('turn.action', acts, { hunters: [hunter], round: 3 });
  // Passive: no attack in turn.action (falls through to move)
  assert.ok(chooseAction(passiveRound).type !== 'attack');
});

// ---------------------------------------------------------------------------
// Full game integration: AI drives a real game state via legalActions.

test('chooseAction picks a legal action on a fresh game state', () => {
  const state = createGame({
    seed: 7, mode: 'normal',
    hunters: [
      { id: 'h0', slot: 0, name: 'A', spriteId: 0, palette: 'cobalt',
        human: false, archetype: 'Normal', level: 1,
        internal: { mv: 3, at: 4, df: 4, hp: 4 }, items: [] },
    ],
  });
  const acts = legalActions(state);
  const chosen = chooseAction({ ...state, legalActions: (s) => legalActions(s) });
  assert.ok(chosen, 'got an action');
  assert.ok(acts.some((a) => a.type === chosen.type), 'action type is legal');
});
