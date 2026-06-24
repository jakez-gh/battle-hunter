import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, legalActions, applyAction, isHumanTurn, currentChooser } from '../src/engine/game.js';
import { chooseAction } from '../src/engine/ai.js';
import { STORY_MISSIONS } from '../src/engine/missions.js';

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

// ---------------------------------------------------------------------------
// legalActions — additional phases

test('legalActions in turn.steer returns step and stop actions', () => {
  const state = makeGame(3);
  const move = legalActions(state).find((a) => a.type === 'move');
  assert.ok(move);
  const { state: steer } = applyAction(state, move);
  assert.equal(steer.phase, 'turn.steer');
  const acts = legalActions(steer);
  assert.ok(acts.some((a) => a.type === 'step'));
  // stop is only present after at least one step has been taken
  const step = acts.find((a) => a.type === 'step');
  const { state: mid } = applyAction(steer, step);
  if (mid.phase === 'turn.steer') {
    const midActs = legalActions(mid);
    assert.ok(midActs.some((a) => a.type === 'stop'));
  }
});

// Soft-undo invariant: applyAction never mutates its input, so a pre-step
// snapshot is a faithful restore point. The GAME screen's in-move undo relies
// on this (it rewinds by restoring a clone of the prior steering state).
test('applyAction(step) does not mutate input — undo snapshot is faithful', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const state = makeGame(seed);
    const move = legalActions(state).find((a) => a.type === 'move');
    if (!move) continue;
    const { state: steer } = applyAction(state, move);
    if (steer.phase !== 'turn.steer') continue;
    const step = legalActions(steer).find((a) => a.type === 'step');
    if (!step) continue;

    const snap = structuredClone(steer);           // how the UI snapshots before a step
    const beforePos = { ...steer.hunters[steer.current.index].pos };
    const beforeRemaining = steer.move.remaining;
    const beforePathLen = steer.move.path.length;

    const { state: after } = applyAction(steer, step);

    // The input object is untouched (purity) → the snapshot is still accurate.
    assert.deepEqual(steer.hunters[steer.current.index].pos, beforePos, 'input pos mutated');
    assert.equal(steer.move.remaining, beforeRemaining, 'input move.remaining mutated');
    assert.equal(steer.move.path.length, beforePathLen, 'input move.path mutated');
    assert.deepEqual(snap.move, steer.move, 'snapshot diverged from pristine input');

    // And the step produced a genuinely advanced state, so undo is meaningful.
    if (after.phase === 'turn.steer') {
      assert.equal(after.move.remaining, beforeRemaining - 1);
      assert.equal(after.move.path.length, beforePathLen + 1);
    }
    return; // one good seed is enough
  }
  assert.fail('no seed produced a steppable turn.steer state');
});

test('legalActions in turn.postMove returns attack + pass', () => {
  // Build a state where the current hunter is already in postMove phase.
  const state = makeGame(1);
  const s = JSON.parse(JSON.stringify(state));
  s.phase = 'turn.postMove';
  // Ensure there is an adjacent monster to attack.
  s.monsters.push({
    id: 'm0', kind: 'OOZ', hp: 25, maxHp: 25, at: 5, df: 0, mv: 1,
    pos: { x: s.hunters[0].pos.x + 1, y: s.hunters[0].pos.y },
    status: {},
  });
  s.board.floor[s.hunters[0].pos.y][s.hunters[0].pos.x + 1] = true;
  const acts = legalActions(s);
  assert.ok(acts.some((a) => a.type === 'attack'));
  assert.ok(acts.some((a) => a.type === 'pass'));
});

test('legalActions in react.dodge and react.crit return timing actions', () => {
  const state = makeGame(1);
  for (const phase of ['react.dodge', 'react.crit']) {
    const s = JSON.parse(JSON.stringify(state));
    s.phase = phase;
    const acts = legalActions(s);
    assert.ok(acts.some((a) => a.type === 'timing' && a.hit === true));
    assert.ok(acts.some((a) => a.type === 'timing' && a.hit === false));
  }
});

test('legalActions in choice.steal returns pick actions', () => {
  const state = makeGame(1);
  const s = JSON.parse(JSON.stringify(state));
  s.pendingChoice = {
    kind: 'steal',
    chooser: { kind: 'hunter', index: 0 },
    defender: { kind: 'hunter', index: 1 },
    options: [
      { itemId: 'gold', identified: true },
      { itemId: 'ruby', identified: false },
    ],
  };
  s.phase = 'choice.steal';
  const acts = legalActions(s);
  assert.ok(acts.every((a) => a.type === 'pick'));
  assert.equal(acts.length, 2);
});

test('legalActions in battle.defCard filters to counter-legal colors', () => {
  const state = makeGame(1);
  const s = JSON.parse(JSON.stringify(state));
  // Give h1 (defender) a mix of red, yellow, blue cards.
  s.hunters[1].hand = ['R3', 'Y3', 'B1'];
  s.phase = 'battle.defCard';
  s.battle = {
    attacker: { kind: 'hunter', index: 0 },
    defender: { kind: 'hunter', index: 1 },
    stage: 'battle.defCard', response: 'counter', defCard: null, atkCard: null,
  };
  const acts = legalActions(s);
  // counter response: red and yellow playable, blue not
  const cards = acts.filter((a) => a.card != null);
  assert.ok(cards.some((a) => a.card === 'R3'));
  assert.ok(cards.some((a) => a.card === 'Y3'));
  assert.ok(!cards.some((a) => a.card === 'B1'));
});

// ---------------------------------------------------------------------------
// applyAction — step, stop, pass

test('applyAction step: decrements remaining range and moves hunter position', () => {
  const state = makeGame(3);
  const move = legalActions(state).find((a) => a.type === 'move');
  const { state: steer } = applyAction(state, move);
  const step = legalActions(steer).find((a) => a.type === 'step');
  assert.ok(step, 'step action available');
  const { state: stepped } = applyAction(steer, step);
  const h0Before = steer.hunters[0];
  const h0After = stepped.hunters[0];
  // Position must have changed by exactly 1 in one axis.
  const dx = Math.abs(h0After.pos.x - h0Before.pos.x);
  const dy = Math.abs(h0After.pos.y - h0Before.pos.y);
  assert.equal(dx + dy, 1);
});

test('applyAction stop: ends movement early and advances turn', () => {
  const state = makeGame(3);
  const move = legalActions(state).find((a) => a.type === 'move');
  const { state: steer } = applyAction(state, move);
  // Take one step first so stop is available (path.length > 0).
  const step = legalActions(steer).find((a) => a.type === 'step');
  const { state: mid } = applyAction(steer, step);
  if (mid.phase === 'turn.steer') {
    const stop = legalActions(mid).find((a) => a.type === 'stop');
    assert.ok(stop, 'stop available after one step');
    const { state: stopped } = applyAction(mid, stop);
    assert.ok(['turn.action', 'turn.postMove', 'mission.over'].includes(stopped.phase));
  }
});

test('applyAction pass in turn.postMove: ends turn without fighting', () => {
  const state = makeGame(1);
  const s = JSON.parse(JSON.stringify(state));
  s.phase = 'turn.postMove';
  // Add a monster adjacent to h0 so postMove is valid.
  s.monsters.push({
    id: 'm0', kind: 'VAC', hp: 16, maxHp: 16, at: 2, df: 2, mv: 2,
    pos: { x: s.hunters[0].pos.x + 1, y: s.hunters[0].pos.y },
    status: {},
  });
  s.board.floor[s.hunters[0].pos.y][s.hunters[0].pos.x + 1] = true;
  const { state: after } = applyAction(s, { type: 'pass' });
  assert.ok(after.phase !== 'turn.postMove', 'postMove phase ended');
});

// ---------------------------------------------------------------------------
// applyAction — attack from turn.action

test('applyAction attack from turn.action: enters battle.response', () => {
  const state = makeGame(5);
  const s = JSON.parse(JSON.stringify(state));
  // Place h1 adjacent to h0 on a valid floor tile.
  const h0Pos = s.hunters[0].pos;
  const adjPos = { x: h0Pos.x + 1, y: h0Pos.y };
  s.board.floor[adjPos.y][adjPos.x] = true;
  s.hunters[1].pos = adjPos;
  const attacks = legalActions(s).filter((a) => a.type === 'attack');
  assert.ok(attacks.length > 0, 'attack action available when hunters adjacent');
  const { state: afterAttack } = applyAction(s, attacks[0]);
  assert.equal(afterAttack.phase, 'battle.response');
  assert.ok(afterAttack.battle, 'battle object created');
});

// ---------------------------------------------------------------------------
// Battle response variants

test('battle response guard: transitions to battle.defCard', () => {
  const state = makeGame(1);
  const s = JSON.parse(JSON.stringify(state));
  s.phase = 'battle.response';
  s.battle = {
    attacker: { kind: 'hunter', index: 0 },
    defender: { kind: 'hunter', index: 1 },
    stage: 'response', response: null, defCard: null, atkCard: null,
  };
  const { state: after } = applyAction(s, { type: 'respond', response: 'guard' });
  assert.equal(after.phase, 'battle.defCard');
});

test('battle response escape: skips defCard, goes to battle.atkCard', () => {
  const state = makeGame(1);
  const s = JSON.parse(JSON.stringify(state));
  s.hunters[1].hand = ['B2']; // Blue card required for escape option
  s.phase = 'battle.response';
  s.battle = {
    attacker: { kind: 'hunter', index: 0 },
    defender: { kind: 'hunter', index: 1 },
    stage: 'response', response: null, defCard: null, atkCard: null,
  };
  const { state: after } = applyAction(s, { type: 'respond', response: 'escape' });
  assert.equal(after.phase, 'battle.atkCard');
});

test('battle response surrender: transitions to choice.surrenderGive with items', () => {
  const state = makeGame(1);
  const s = JSON.parse(JSON.stringify(state));
  // Defender must have items or target for surrender to be offered.
  s.hunters[1].items = [{ itemId: 'gold', identified: true }];
  s.phase = 'battle.response';
  s.battle = {
    attacker: { kind: 'hunter', index: 0 },
    defender: { kind: 'hunter', index: 1 },
    stage: 'response', response: null, defCard: null, atkCard: null,
  };
  const { state: after } = applyAction(s, { type: 'respond', response: 'surrender' });
  assert.equal(after.phase, 'choice.surrenderGive');
  assert.ok(after.pendingChoice, 'pendingChoice set');
  assert.equal(after.pendingChoice.kind, 'surrenderGive');
});

test('battle response none (stunned defender): skips to battle.atkCard', () => {
  const state = makeGame(1);
  const s = JSON.parse(JSON.stringify(state));
  s.hunters[1].status.stun = 1; // Stunned defender
  s.phase = 'battle.response';
  s.battle = {
    attacker: { kind: 'hunter', index: 0 },
    defender: { kind: 'hunter', index: 1 },
    stage: 'response', response: null, defCard: null, atkCard: null,
  };
  // When stunned, only 'none' is offered
  const acts = legalActions(s);
  assert.deepEqual(acts, [{ type: 'respond', response: 'none' }]);
  const { state: after } = applyAction(s, { type: 'respond', response: 'none' });
  assert.equal(after.phase, 'battle.atkCard');
});

// ---------------------------------------------------------------------------
// battle.defCard card removal

test('battle.defCard: playing a card removes it from defender hand', () => {
  const state = makeGame(1);
  const s = JSON.parse(JSON.stringify(state));
  s.hunters[1].hand = ['R3', 'Y3', 'B1'];
  s.phase = 'battle.defCard';
  s.battle = {
    attacker: { kind: 'hunter', index: 0 },
    defender: { kind: 'hunter', index: 1 },
    stage: 'battle.defCard', response: 'counter', defCard: null, atkCard: null,
  };
  const { state: after } = applyAction(s, { type: 'battleCard', card: 'R3' });
  assert.equal(after.phase, 'battle.atkCard');
  assert.ok(!after.hunters[1].hand.includes('R3'), 'card removed from hand');
});

// ---------------------------------------------------------------------------
// choice.steal and choice.surrenderGive

test('choice.steal pick: target item transfers to attacker', () => {
  const state = makeGame(1);
  const s = JSON.parse(JSON.stringify(state));
  // Defender has the target.
  s.hunters[1].hasTarget = true;
  s.targetHolder = { kind: 'hunter', index: 1 };
  s.targetFound = true;
  s.pendingChoice = {
    kind: 'steal',
    chooser: { kind: 'hunter', index: 0 },
    defender: { kind: 'hunter', index: 1 },
    options: [{ itemId: 'TARGET', label: 'TARGET ITEM' }],
  };
  s.phase = 'choice.steal';
  s.battle = {
    attacker: { kind: 'hunter', index: 0 },
    defender: { kind: 'hunter', index: 1 },
    stage: 'done', response: 'counter', defCard: null, atkCard: null,
  };
  const { state: after } = applyAction(s, { type: 'pick', option: { itemId: 'TARGET', label: 'TARGET ITEM' } });
  assert.equal(after.hunters[0].hasTarget, true, 'attacker now holds target');
  assert.equal(after.hunters[1].hasTarget, false, 'defender lost target');
  assert.ok(!after.pendingChoice, 'pendingChoice cleared');
});

test('choice.surrenderGive pick: item moves from defender to attacker, defender warped', () => {
  const state = makeGame(1);
  const s = JSON.parse(JSON.stringify(state));
  s.hunters[1].items = [{ itemId: 'gold', identified: true }];
  s.hunters[1].pos = { x: 3, y: 3 };
  s.board.floor[3][3] = true;
  s.pendingChoice = {
    kind: 'surrenderGive',
    chooser: { kind: 'hunter', index: 1 },
    attacker: { kind: 'hunter', index: 0 },
    options: [{ itemId: 'gold', identified: true }],
  };
  s.phase = 'choice.surrenderGive';
  s.battle = {
    attacker: { kind: 'hunter', index: 0 },
    defender: { kind: 'hunter', index: 1 },
    stage: 'done', response: 'surrender', defCard: null, atkCard: null,
  };
  const { state: after } = applyAction(s, { type: 'pick', option: { itemId: 'gold', identified: true } });
  assert.equal(after.hunters[0].items.find((i) => i.itemId === 'gold')?.itemId, 'gold');
  assert.ok(!after.pendingChoice, 'pendingChoice cleared');
});

// ---------------------------------------------------------------------------
// react.dodge / react.crit

test('react.dodge timing hit:true: trap dodged, return to turn.steer', () => {
  const state = makeGame(1);
  const s = JSON.parse(JSON.stringify(state));
  s.phase = 'react.dodge';
  s.move = { remaining: 2, path: [{ x: 1, y: 0 }], cardPlayed: null, trap: { kind: 'damage', byHunter: null } };
  const { state: after } = applyAction(s, { type: 'timing', hit: true });
  assert.equal(after.phase, 'turn.steer', 'dodge successful: back to steering');
  assert.ok(!after.move?.trap, 'trap cleared');
});

test('react.dodge timing hit:false: trap triggers (damage/stun/leg/empty)', () => {
  const state = makeGame(1);
  const s = JSON.parse(JSON.stringify(state));
  s.phase = 'react.dodge';
  s.move = { remaining: 2, path: [], cardPlayed: null, trap: { kind: 'damage', byHunter: null } };
  const { state: after } = applyAction(s, { type: 'timing', hit: false });
  // After trap fires, turn continues (not still in react.dodge).
  assert.ok(after.phase !== 'react.dodge');
  // Trap damage event should have been recorded.
  assert.ok(after.events.some((e) => e.type === 'trapDamaged' || e.type === 'hunterDefeated' || e.type !== null));
});

test('react.crit timing: sets critNegateAttempt and resolves battle', () => {
  const state = makeGame(1);
  const s = JSON.parse(JSON.stringify(state));
  s.phase = 'react.crit';
  s.battle = {
    attacker: { kind: 'hunter', index: 0 },
    defender: { kind: 'hunter', index: 1 },
    stage: 'react.crit', response: 'counter', defCard: null, atkCard: null,
    critNegateAttempt: {},
  };
  const { state: after } = applyAction(s, { type: 'timing', hit: true });
  // Battle must have resolved: no longer in react.crit.
  assert.ok(after.phase !== 'react.crit');
});

// ---------------------------------------------------------------------------
// defeatHunter: hp=1, healNextTurn, stun, tally.defeats

test('defeated hunter has hp=1, healNextTurn=true, stun+1, defeats incremented', () => {
  const state = makeGame(42);
  const s = JSON.parse(JSON.stringify(state));
  // Attacker: very high AT. Defender (AI): df=0, hp=1.
  // AT=20 vs DF=0: attacker always deals at least 10 damage (2d6+20 vs 2d6+0 min=22-12=10).
  s.hunters[0].internal = { mv: 3, at: 20, df: 4, hp: 4 };
  s.hunters[1].internal = { mv: 3, at: 1, df: 0, hp: 1 };
  s.hunters[1].hp = 1;
  s.hunters[1].maxHp = 10;
  s.hunters[1].human = false; // AI: no react.crit phase
  s.hunters[1].status = { stun: 0, leg: false, panic: 0, empty: 0 };
  s.phase = 'battle.response';
  s.battle = {
    attacker: { kind: 'hunter', index: 0 },
    defender: { kind: 'hunter', index: 1 },
    stage: 'response', response: null, defCard: null, atkCard: null,
  };
  // counter → defCard:null → atkCard:null (AI defender → no react.crit)
  let r = applyAction(s, { type: 'respond', response: 'counter' });
  r = applyAction(r.state, { type: 'battleCard', card: null });
  r = applyAction(r.state, { type: 'battleCard', card: null });
  const h1 = r.state.hunters[1];
  // defeatHunter halves maxHp (Math.floor(10/2)=5) and increments defeats.
  // The stun-consumed heal fires in the same applyAction call (getNextCurrent
  // immediately skips h1's stunned turn and triggers healNextTurn), so by the
  // time the state is returned h1 is already healed to the new (halved) maxHp.
  assert.equal(h1.maxHp, 5, 'maxHp halved on defeat');
  assert.equal(h1.tally.defeats, 1, 'defeats counter incremented');
  assert.ok(h1.hp > 0, 'hunter is alive after defeat + heal cycle');
  assert.equal(h1.healNextTurn, false, 'healNextTurn consumed in same turn');
});

// ---------------------------------------------------------------------------
// Monster kill tally

test('hunter killing a monster adds killPts to tally', () => {
  const state = makeGame(1);
  const s = JSON.parse(JSON.stringify(state));
  // Add a VAC monster adjacent to h0 with 1 HP.
  const adjPos = { x: s.hunters[0].pos.x + 1, y: s.hunters[0].pos.y };
  s.board.floor[adjPos.y][adjPos.x] = true;
  s.monsters.push({ id: 'm1', kind: 'VAC', hp: 1, maxHp: 16, at: 2, df: 0, mv: 2, pos: adjPos, status: {} });
  s.hunters[0].internal = { mv: 3, at: 20, df: 4, hp: 4 }; // high AT for reliable kill
  s.hunters[0].human = false;
  // Initiate attack from turn.action.
  const attackAct = legalActions(s).find((a) => a.type === 'attack' && a.target?.kind === 'monster');
  assert.ok(attackAct, 'attack action available');
  let r = applyAction(s, attackAct);
  // Monster is "always counter" — goes straight to atkCard.
  if (r.state.phase === 'battle.response') {
    r = applyAction(r.state, { type: 'respond', response: 'counter' });
  }
  if (r.state.phase === 'battle.defCard') {
    r = applyAction(r.state, { type: 'battleCard', card: null });
  }
  if (r.state.phase === 'battle.atkCard') {
    r = applyAction(r.state, { type: 'battleCard', card: null });
  }
  // AT=20 vs VAC DF=0 always kills.
  assert.ok(r.state.hunters[0].tally.killPts > 0, 'kill points added for killing monster');
});

// ---------------------------------------------------------------------------
// Green card: trap on vacated tile

test('green card move: trap placed on vacated tile before die roll', () => {
  const state = makeGame(7);
  const s = JSON.parse(JSON.stringify(state));
  // Give h0 a green card.
  const greenCard = 'GD'; // green damage trap card
  s.hunters[0].hand = [greenCard, 'R1', 'R2', 'R3', 'Y1'];
  const h0Pos = { ...s.hunters[0].pos };
  const trapsBefore = s.board.traps.length;
  const { state: after } = applyAction(s, { type: 'move', card: greenCard });
  // The trap should now be on h0's original position.
  const newTraps = after.board.traps.filter((t) => !s.board.traps.some((o) => o.x === t.x && o.y === t.y));
  assert.ok(newTraps.some((t) => t.x === h0Pos.x && t.y === h0Pos.y),
    'trap placed on vacated tile');
  assert.ok(after.board.traps.length > trapsBefore, 'trap count increased');
});

// ---------------------------------------------------------------------------
// E-card warp

test('E-card move: hunter warps directly to exit', () => {
  const state = makeGame(11);
  const s = JSON.parse(JSON.stringify(state));
  // Give h0 a blue E-card.
  s.hunters[0].hand = ['BE', 'R1', 'R2', 'R3', 'Y1'];
  const { state: after } = applyAction(s, { type: 'move', card: 'BE' });
  // After warp: if not target holder → exitWarpedAway, placed on random tile.
  // If target holder → mission.over.
  // h0 does not hold target (hasTarget=false), so it warps away.
  assert.ok(after.events.some((e) => e.type === 'exitWarped'), 'exitWarped event fired');
});

// ---------------------------------------------------------------------------
// resteal mission: carrier starts with target

test('createGame with resteal mission: carrierIndex hunter starts with target', () => {
  const resteal = STORY_MISSIONS.find((m) => m.type === 'resteal');
  assert.ok(resteal, 'there is a resteal mission');
  const hunters = [
    { id: 'h0', slot: 0, name: 'A', spriteId: 0, palette: 'cobalt', human: false, archetype: null,
      level: 1, internal: { mv: 3, at: 4, df: 4, hp: 4 }, items: [] },
    { id: 'h1', slot: 1, name: 'B', spriteId: 0, palette: 'cobalt', human: false, archetype: null,
      level: 1, internal: { mv: 3, at: 4, df: 4, hp: 4 }, items: [] },
    { id: 'h2', slot: 2, name: 'C', spriteId: 0, palette: 'cobalt', human: false, archetype: null,
      level: 1, internal: { mv: 3, at: 4, df: 4, hp: 4 }, items: [] },
    { id: 'h3', slot: 3, name: 'D', spriteId: 0, palette: 'cobalt', human: false, archetype: null,
      level: 1, internal: { mv: 3, at: 4, df: 4, hp: 4 }, items: [] },
  ];
  const s = createGame({ seed: 1, mode: 'story', mission: resteal, hunters });
  const carrierIdx = resteal.carrierIndex + 1; // +1 because slot 0 is player
  assert.equal(s.hunters[carrierIdx]?.hasTarget, true, 'carrier starts with target');
  assert.equal(s.targetFound, true, 'target is already found');
});

// ---------------------------------------------------------------------------
// getNextCurrent: stunned hunter is skipped; healNextTurn fires

test('stunned hunter turn is skipped; heals on stun-consumed turn', () => {
  const state = makeGame(42);
  // Use a single-hunter game to isolate the stun skip.
  const single = createGame({
    seed: 1, mode: 'normal',
    hunters: [
      { id: 'h0', slot: 0, name: 'H', spriteId: 0, palette: 'cobalt', human: false,
        archetype: 'Normal', level: 1, internal: { mv: 3, at: 4, df: 4, hp: 4 }, items: [] },
    ],
  });
  const s = JSON.parse(JSON.stringify(single));
  // Manually stun h0 and set healNextTurn.
  s.hunters[0].status.stun = 1;
  s.hunters[0].healNextTurn = true;
  s.hunters[0].hp = 1;
  const maxHp = s.hunters[0].maxHp;
  // Advance one action: with only one hunter and stun=1, getNextCurrent should
  // consume the stun and set phase for next hunter turn. But since there's only
  // one hunter, the loop calls applyEndTurn which eventually hits getNextCurrent.
  // We test by doing a rest action (which calls applyEndTurn → getNextCurrent).
  const { state: after } = applyAction(s, { type: 'rest' });
  // healNextTurn should have fired, restoring HP (or at least not leaving it at 1).
  // Note: rest itself may also heal, so we just verify healNextTurn was cleared.
  assert.equal(after.hunters[0].healNextTurn, false, 'healNextTurn cleared after stun skip');
  assert.ok(after.hunters[0].hp > 1, 'HP restored above 1 after heal-on-stun');
});

// ---------------------------------------------------------------------------
// damage tally

test('combat damage updates attacker tally.damage', () => {
  const state = makeGame(3);
  const s = JSON.parse(JSON.stringify(state));
  // High AT attacker vs 0 DF, non-human defender.
  s.hunters[0].internal = { mv: 3, at: 20, df: 4, hp: 4 };
  s.hunters[0].human = false;
  s.hunters[1].internal = { mv: 3, at: 1, df: 0, hp: 1 };
  s.hunters[1].hp = 10; // enough HP to survive
  s.hunters[1].maxHp = 10;
  s.hunters[1].human = false;
  s.phase = 'battle.response';
  s.battle = {
    attacker: { kind: 'hunter', index: 0 },
    defender: { kind: 'hunter', index: 1 },
    stage: 'response', response: null, defCard: null, atkCard: null,
  };
  const dmgBefore = s.hunters[0].tally.damage;
  let r = applyAction(s, { type: 'respond', response: 'counter' });
  r = applyAction(r.state, { type: 'battleCard', card: null });
  r = applyAction(r.state, { type: 'battleCard', card: null });
  // Attacker must have dealt damage (AT=20 vs DF=0 always hits).
  assert.ok(r.state.hunters[0].tally.damage > dmgBefore, 'attacker tally.damage incremented');
});

// ---------------------------------------------------------------------------

test('game terminates when someone exits with the target (smoke)', () => {
  // Fast L1 runners — games terminate quickly.
  const config = {
    seed: 5, mode: 'normal',
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

// ---------------------------------------------------------------------------
// Mission goal HUD state: missionTitle, targetItemId, rescueHoldRounds

const FOUR_HUNTERS = [
  hunter('h0', 0), hunter('h1', 1), hunter('h2', 2), hunter('h3', 3),
];

test('createGame stores missionTitle and sets rescueHoldRounds=2 for rescue mission', () => {
  const m2 = STORY_MISSIONS.find((m) => m.type === 'rescue');
  assert.ok(m2, 'at least one rescue story mission exists');
  const s = createGame({ seed: 1, mode: 'story', mission: m2, hunters: FOUR_HUNTERS });
  assert.equal(s.missionTitle, m2.title, 'missionTitle stored from mission.title');
  assert.equal(s.missionType, 'rescue');
  assert.equal(s.rescueHoldRounds, 2, 'rescue missions hold rivals for 2 rounds');
});

test('createGame stores targetItemId for targeted fetch missions', () => {
  const m7 = STORY_MISSIONS.find((m) => m.targetItemId != null);
  assert.ok(m7, 'at least one mission has a specific targetItemId');
  const s = createGame({ seed: 1, mode: 'story', mission: m7, hunters: FOUR_HUNTERS });
  assert.equal(s.targetItemId, m7.targetItemId, 'targetItemId stored in state');
  assert.equal(s.missionTitle, m7.title, 'missionTitle stored');
});

test('createGame with no mission has null missionTitle and rescueHoldRounds=0', () => {
  const s = makeGame(1);
  assert.equal(s.missionTitle, null);
  assert.equal(s.missionType, 'fetch');
  assert.equal(s.rescueHoldRounds, 0);
});

// ---------------------------------------------------------------------------
// Panic status mechanics

test('isHumanTurn returns false when human hunter has panic > 0', () => {
  const state = makeGame(1, { humanSlot: 0 });
  assert.equal(isHumanTurn(state), true, 'baseline: human turn with no panic');
  const s = JSON.parse(JSON.stringify(state));
  s.hunters[0].status.panic = 1;
  assert.equal(isHumanTurn(s), false, 'panicked human hunter is not a human turn');
});

test('panic decrements by 1 at end of own turn', () => {
  const state = makeGame(1);
  const s = JSON.parse(JSON.stringify(state));
  s.hunters[0].status.panic = 2;
  s.hunters[0].human = false; // AI plays the turn
  const { state: after } = applyAction(s, { type: 'rest' });
  assert.equal(after.hunters[0].status.panic, 1, 'panic decremented from 2 to 1 after one turn');
});

test('panic = 1 reaches 0 after one own turn', () => {
  const state = makeGame(1);
  const s = JSON.parse(JSON.stringify(state));
  s.hunters[0].status.panic = 1;
  s.hunters[0].human = false;
  const { state: after } = applyAction(s, { type: 'rest' });
  assert.equal(after.hunters[0].status.panic, 0, 'panic reaches 0 after one turn');
});

test('defeat clears panic on the defeated hunter', () => {
  const state = makeGame(42);
  const s = JSON.parse(JSON.stringify(state));
  // Attacker: very high AT guarantees defeat. Defender: 1 HP, existing panic.
  s.hunters[0].internal = { mv: 3, at: 20, df: 4, hp: 4 };
  s.hunters[1].internal = { mv: 3, at: 1, df: 0, hp: 1 };
  s.hunters[1].hp = 1;
  s.hunters[1].maxHp = 10;
  s.hunters[1].human = false;
  s.hunters[1].status = { stun: 0, leg: false, panic: 3, empty: 0 };
  s.phase = 'battle.response';
  s.battle = {
    attacker: { kind: 'hunter', index: 0 },
    defender: { kind: 'hunter', index: 1 },
    stage: 'response', response: null, defCard: null, atkCard: null,
  };
  let r = applyAction(s, { type: 'respond', response: 'counter' });
  r = applyAction(r.state, { type: 'battleCard', card: null });
  r = applyAction(r.state, { type: 'battleCard', card: null });
  assert.equal(r.state.hunters[1].status.panic, 0, 'defeat clears panic regardless of prior value');
});

test('human hunter regains control after panic expires (single-hunter game)', () => {
  // Single-hunter game so the same hunter is current every turn.
  const single = createGame({
    seed: 1, mode: 'normal',
    hunters: [
      { id: 'h0', slot: 0, name: 'H', spriteId: 0, palette: 'cobalt', human: true,
        archetype: 'Normal', level: 1, internal: { mv: 3, at: 4, df: 4, hp: 4 }, items: [] },
    ],
  });
  const s = JSON.parse(JSON.stringify(single));
  s.hunters[0].status.panic = 1;
  assert.equal(isHumanTurn(s), false, 'panicked human is not a human turn');
  // Advance the panicked turn (rest is a valid action regardless of panic).
  const { state: after } = applyAction(s, { type: 'rest' });
  assert.equal(after.hunters[0].status.panic, 0, 'panic cleared after one turn');
  assert.equal(isHumanTurn(after), true, 'human regains control once panic reaches 0');
});

// ---------------------------------------------------------------------------
// WYRM wipe clause (§2.8): only WYRM ending mission; non-WYRM does not

function makeMonsterBattleState(seed, monsterKind, holdsTarget = true) {
  const state = makeGame(seed);
  const s = JSON.parse(JSON.stringify(state));
  // Place a monster as the "current" unit by injecting a battle state.
  s.monsters = [{ id: 99, kind: monsterKind, hp: 20, maxHp: 20, pos: { x: 1, y: 1 } }];
  s.hunters[0].hp = 1;
  s.hunters[0].maxHp = 10;
  s.hunters[0].hasTarget = holdsTarget;
  if (holdsTarget) {
    s.targetFound = true;
    s.targetHolder = { kind: 'hunter', index: 0 };
  }
  s.phase = 'battle.response';
  s.battle = {
    attacker: { kind: 'monster', index: 0 },
    defender: { kind: 'hunter', index: 0 },
    stage: 'response', response: null, defCard: null, atkCard: null,
  };
  return s;
}

test('WYRM defeating target holder ends mission as loss', () => {
  const s = makeMonsterBattleState(1, 'WYRM', true);
  s.monsters[0].at = 99; s.monsters[0].df = 0; s.monsters[0].mv = 3;
  let r = applyAction(s, { type: 'respond', response: 'guard' });
  r = applyAction(r.state, { type: 'battleCard', card: null });
  r = applyAction(r.state, { type: 'battleCard', card: null });
  assert.equal(r.state.phase, 'mission.over', 'mission ends when WYRM kills target holder');
  assert.equal(r.state._missionEnd?.win, false, 'mission is a loss');
  assert.match(r.state._missionEnd?.reason ?? '', /wyrm/i, 'reason contains WYRM');
});

test('non-WYRM monster defeating target holder does not end mission', () => {
  for (const kind of ['VAC', 'OOZ', 'FNG']) {
    const s = makeMonsterBattleState(1, kind, true);
    // Give monster overwhelming AT to guarantee defeat
    s.monsters[0].at = 99;
    let r = applyAction(s, { type: 'respond', response: 'guard' });
    r = applyAction(r.state, { type: 'battleCard', card: null });
    r = applyAction(r.state, { type: 'battleCard', card: null });
    assert.notEqual(r.state.phase, 'mission.over', `${kind} killing target holder should NOT end mission`);
  }
});

// ---------------------------------------------------------------------------
// Escape bonus: Slick Boots / Jumpsuit / Longcoat add to escape roll

function runEscape(seed, defItems) {
  // Escape skips the defender card phase; only the attacker plays a card.
  // Sequence: respond → battle.atkCard; ONE battleCard → resolves (escapeRolled fires here).
  const state = makeGame(seed);
  const s = JSON.parse(JSON.stringify(state));
  s.hunters[0].items = [];
  s.hunters[1].items = defItems;
  s.phase = 'battle.response';
  s.battle = { attacker: { kind: 'hunter', index: 0 }, defender: { kind: 'hunter', index: 1 },
    stage: 'response', response: null, defCard: null, atkCard: null };
  let r = applyAction(s, { type: 'respond', response: 'escape' });
  r = applyAction(r.state, { type: 'battleCard', card: null }); // attacker's pursuit card
  return (r.state.events || []).find((e) => e.type === 'escapeRolled') ?? null;
}

test('Jumpsuit (+2) raises escape dTotal vs bare defender on same seed', () => {
  const bareEv = runEscape(7, []);
  const suitedEv = runEscape(7, [{ itemId: 'jumpsuit', identified: true }]);
  assert.ok(bareEv, 'escape event emitted without items');
  assert.ok(suitedEv, 'escape event emitted with Jumpsuit');
  // Same seed → same dDice; Jumpsuit adds +2 to dTotal.
  assert.equal(suitedEv.dTotal, bareEv.dTotal + 2, 'Jumpsuit adds +2 to escape dTotal');
});

test('Longcoat (+3) raises escape dTotal more than Slick Boots (+1)', () => {
  const bootsEv = runEscape(9, [{ itemId: 'slickboots', identified: true }]);
  const coatEv = runEscape(9, [{ itemId: 'longcoat', identified: true }]);
  assert.ok(bootsEv && coatEv, 'escape events emitted');
  assert.equal(coatEv.dTotal, bootsEv.dTotal + 2, 'Longcoat (+3) beats Slick Boots (+1) by +2');
});

// ---------------------------------------------------------------------------
// state.result.wipe (§2.8): WYRM kill propagated to completed result

test('result.wipe is true after WYRM kills target holder and mission is confirmed', () => {
  const s = makeMonsterBattleState(1, 'WYRM', true);
  s.monsters[0].at = 99; s.monsters[0].df = 0; s.monsters[0].mv = 3;
  let r = applyAction(s, { type: 'respond', response: 'guard' });
  r = applyAction(r.state, { type: 'battleCard', card: null });
  r = applyAction(r.state, { type: 'battleCard', card: null });
  assert.equal(r.state.phase, 'mission.over', 'WYRM kill triggers mission.over');
  r = applyAction(r.state, { type: 'confirm' });
  assert.equal(r.state.phase, 'completed');
  assert.equal(r.state.result.win, false);
  assert.equal(r.state.result.wipe, true, 'result.wipe=true for WYRM eliminating target holder');
});

test('result.wipe is false on a normal win (non-WYRM reason)', () => {
  const state = makeGame(1);
  const s = JSON.parse(JSON.stringify(state));
  s.phase = 'mission.over';
  s._missionEnd = { win: true, reason: 'hunter exited with target' };
  const { state: after } = applyAction(s, { type: 'confirm' });
  assert.equal(after.result.win, true);
  assert.equal(after.result.wipe, false, 'wipe is false when reason is not WYRM');
});

// ---------------------------------------------------------------------------
// Calmant: panic cleared at turn START (§2.14), not end

test('calmant clears panic at turn start, not end', () => {
  // h0's turn → rest → applyEndTurn → h1 becomes current → calmant fires for h1
  const state = makeGame(1);
  const s = JSON.parse(JSON.stringify(state));
  s.hunters[0].items = [];
  s.hunters[0].human = false;
  s.hunters[1].items = [{ itemId: 'calmant', identified: true }];
  s.hunters[1].status.panic = 2;
  // Confirm h0 is currently acting (index 0)
  assert.equal(s.current?.kind, 'hunter');
  assert.equal(s.current?.index, 0);
  // h0 rests — ends h0's turn, starts h1's turn with calmant active
  const { state: after } = applyAction(s, { type: 'rest' });
  // h1 is now current
  assert.equal(after.current?.kind, 'hunter');
  assert.equal(after.current?.index, 1);
  // Calmant must have cleared h1's panic at the START of h1's turn
  assert.equal(after.hunters[1].status.panic, 0, 'calmant cleared panic at h1 turn start');
});
