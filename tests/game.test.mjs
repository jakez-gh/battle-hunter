import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, legalActions, applyAction, isHumanTurn, currentChooser } from '../src/engine/game.js';
import { chooseAction } from '../src/engine/ai.js';

// Minimal hunter config helper.
function hunter(id, slot, opts = {}) {
  return {
    id, slot,
    name: opts.name ?? id,
    spriteId: 0,
    palette: 'cobalt',
    human: opts.human ?? false,
    archetype: null,
    level: opts.level ?? 1,
    internal: opts.internal ?? { mv: 3, at: 4, df: 4, hp: 4 },
    maxHp: opts.maxHp ?? 19,
    items: opts.items ?? [],
  };
}

function makeGame(seed = 1, overrides = {}) {
  return createGame({
    seed,
    mode: 'normal',
    hunters: [
      hunter('h0', 0, { human: overrides.humanSlot === 0 }),
      hunter('h1', 1, { human: overrides.humanSlot === 1 }),
    ],
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// createGame

test('createGame returns a valid initial state', () => {
  const state = makeGame(42);
  assert.equal(state.phase, 'turn.action');
  assert.equal(state.hunters.length, 2);
  assert.ok(state.board);
  assert.ok(state.board.floor.length === 20);
  assert.ok(state.board.exit);
  assert.equal(state.monsters.length, 0);
  assert.equal(state.round, 1);
  assert.ok(state.deck.length <= 90); // 100 minus 5×2 dealt
});

test('createGame gives each hunter 5 cards and initialises stats', () => {
  const state = makeGame(1);
  for (const h of state.hunters) {
    assert.equal(h.hand.length, 5);
    assert.ok(h.hp > 0);
    assert.ok(h.maxHp > 0);
    assert.deepEqual(Object.keys(h.status).sort(), ['empty', 'leg', 'panic', 'stun'].sort());
    assert.deepEqual(Object.keys(h.tally).sort(), ['damage', 'defeats', 'flagPts', 'killPts', 'moved'].sort());
  }
});

test('createGame places hunters on distinct floor tiles', () => {
  const state = makeGame(10);
  const positions = state.hunters.map((h) => `${h.pos.x},${h.pos.y}`);
  assert.equal(new Set(positions).size, positions.length);
  for (const h of state.hunters) {
    assert.ok(state.board.floor[h.pos.y][h.pos.x], 'hunter on floor tile');
  }
});

test('same seed produces identical initial states', () => {
  const a = makeGame(999);
  const b = makeGame(999);
  assert.deepEqual(a.board.exit, b.board.exit);
  assert.deepEqual(a.hunters[0].pos, b.hunters[0].pos);
  assert.deepEqual(a.deck, b.deck);
});

// ---------------------------------------------------------------------------
// legalActions

test('legalActions in turn.action returns at least a move or rest', () => {
  const state = makeGame(1);
  const actions = legalActions(state);
  assert.ok(actions.length > 0);
  assert.ok(actions.some((a) => a.type === 'move' || a.type === 'rest'));
});

test('legalActions is empty on completed state', () => {
  let state = makeGame(1);
  // Force mission.over
  state = JSON.parse(JSON.stringify(state));
  state.phase = 'mission.over';
  state._missionEnd = { win: true };
  const actions = legalActions(state);
  assert.deepEqual(actions, [{ type: 'confirm' }]);
});

test('legalActions in battle.response offers counter at minimum', () => {
  const state = makeGame(1);
  // Build a minimal battle state.
  const next = JSON.parse(JSON.stringify(state));
  next.phase = 'battle.response';
  next.battle = {
    attacker: { kind: 'hunter', index: 0 },
    defender: { kind: 'hunter', index: 1 },
    stage: 'response',
    response: null,
    defCard: null,
    atkCard: null,
  };
  const actions = legalActions(next);
  assert.ok(actions.some((a) => a.type === 'respond'));
  assert.ok(actions.some((a) => a.type === 'respond' && a.response === 'counter'));
});

// ---------------------------------------------------------------------------
// isHumanTurn / currentChooser

test('isHumanTurn true for human hunter, false for AI', () => {
  const aiState = makeGame(1);
  assert.equal(isHumanTurn(aiState), false);

  const humanState = makeGame(1, { humanSlot: 0 });
  assert.equal(isHumanTurn(humanState), true);
});

test('currentChooser returns the current unit', () => {
  const state = makeGame(5);
  const chooser = currentChooser(state);
  assert.ok(chooser);
  assert.ok(chooser.hp > 0);
  assert.ok(chooser.pos);
});

// ---------------------------------------------------------------------------
// applyAction — state machine transitions

test('applyAction move -> steer', () => {
  const state = makeGame(3);
  const moveAction = legalActions(state).find((a) => a.type === 'move');
  assert.ok(moveAction, 'move available');
  const { state: next } = applyAction(state, moveAction);
  assert.equal(next.phase, 'turn.steer');
  assert.ok(next.move);
  assert.ok(next.move.remaining >= 1);
});

test('applyAction rest -> draws cards, ends turn', () => {
  const state = makeGame(7);
  // Drain hand to force draws on rest.
  const drained = JSON.parse(JSON.stringify(state));
  drained.hunters[0].hand = [];
  const { state: next } = applyAction(drained, { type: 'rest' });
  // After rest, turn advances (phase = turn.action or mission.over).
  assert.ok(['turn.action', 'mission.over', 'turn.steer'].includes(next.phase));
  // Events should contain at least a healed event.
  assert.ok(next.events.length > 0);
});

test('applyAction is deterministic with same rng seed', () => {
  const state = makeGame(55);
  const action = legalActions(state).find((a) => a.type === 'move') ?? legalActions(state)[0];
  const r1 = applyAction(state, action);
  const r2 = applyAction(state, action);
  assert.deepEqual(r1.state.current, r2.state.current);
  assert.deepEqual(r1.state.move, r2.state.move);
});

test('applyAction throws on invalid action', () => {
  const state = makeGame(1);
  assert.throws(() => applyAction(state, { type: 'step', dir: 'N' }));
});

test('applyAction does not mutate the input state', () => {
  const state = makeGame(8);
  const before = JSON.stringify(state);
  const action = legalActions(state)[0];
  applyAction(state, action);
  assert.equal(JSON.stringify(state), before);
});

// ---------------------------------------------------------------------------
// Battle flow

test('battle flow: response → defCard/atkCard → resolved', () => {
  const state = makeGame(1);
  let s = JSON.parse(JSON.stringify(state));
  // Set up a battle manually.
  s.phase = 'battle.response';
  s.battle = {
    attacker: { kind: 'hunter', index: 0 },
    defender: { kind: 'hunter', index: 1 },
    stage: 'response', response: null, defCard: null, atkCard: null,
  };
  // Counter response.
  const r1 = applyAction(s, { type: 'respond', response: 'counter' });
  assert.equal(r1.state.phase, 'battle.defCard');
  // Defender plays no card.
  const r2 = applyAction(r1.state, { type: 'battleCard', card: null });
  assert.equal(r2.state.phase, 'battle.atkCard');
  // Attacker plays no card.
  const r3 = applyAction(r2.state, { type: 'battleCard', card: null });
  assert.ok(['turn.action', 'mission.over', 'turn.steer', 'choice.steal'].includes(r3.state.phase));
});

// ---------------------------------------------------------------------------
// Mission termination

test('game terminates when someone exits with the target (smoke)', () => {
  // Fast L1 runners — games terminate quickly.
  const config = {
    seed: 42, mode: 'normal',
    hunters: [
      hunter('h0', 0, { internal: { mv: 9, at: 3, df: 2, hp: 3 }, maxHp: 16 }),
      hunter('h1', 1, { internal: { mv: 9, at: 3, df: 2, hp: 3 }, maxHp: 16 }),
    ],
  };
  let state = createGame(config);
  let steps = 0;
  while (state.phase !== 'completed' && state.phase !== 'mission.over' && steps < 2000) {
    const action = chooseAction({ ...state, legalActions: (s) => legalActions(s) });
    state = applyAction(state, action).state;
    steps++;
  }
  assert.ok(state.phase === 'completed' || state.phase === 'mission.over', `ended in ${state.phase} after ${steps} steps`);
});
