import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chooseAction } from '../src/engine/ai.js';

// Regression tests documenting diagnosed AI defects (see DEFECTS.md: D03, D08, D14).
// Each test asserts the CORRECT (spec) behavior, so it FAILS against today's buggy
// code. Wrapped as `todo` so the suite stays green; remove the todo when fixed.

// Minimal hunter (mirrors tests/ai.test.mjs mkHunter conventions).
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

// Minimal state — AI's getLegalActions accepts legalActions as an array.
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
    deck: opts.deck ?? Array(20).fill('R1'),
    events: opts.events ?? [],
  };
}

// ---------------------------------------------------------------------------
// D03 — AI burns the EXIT-warp (BE) card on an ordinary move.
//
// chooseMoveAction filters blue moves with a.card.startsWith('B') — which also
// matches 'BE' — then returns blueMoves[length-1]. legalActions appends the BE
// move LAST, so a non-holder AI selects { type:'move', card:'BE' } for a routine
// move, warping itself and ending the turn for no gain. A non-holder must NOT
// burn the warp card on a routine move (§2.11 — BE is the flee/chase escape card).

test('D03: non-holder AI must not burn the BE warp card on a routine move',
  { todo: 'DEFECT D03 — chooseMoveAction matches BE via startsWith("B") and picks it; remove todo when fixed (see DEFECTS.md)' },
  () => {
    // BE appended last, mirroring legalActions push order (game.js:837-839).
    const acts = [
      { type: 'move', card: 'B1' },
      { type: 'move', card: 'B3' },
      { type: 'move' },
      { type: 'move', card: 'BE' },
      { type: 'rest' },
    ];
    const state = mkState('turn.action', acts, {
      hunters: [mkHunter({
        archetype: 'Normal', hp: 10, maxHp: 10, hasTarget: false,
        hand: ['B1', 'B3', 'BE', 'R1', 'R2'],
      })],
      deck: Array(20).fill('R1'),
    });
    const chosen = chooseAction(state);
    assert.notDeepEqual(chosen, { type: 'move', card: 'BE' },
      'non-holder AI must not select the BE warp card for a routine move');
    // Defensive: even if shape differs, the card must not be BE.
    assert.notEqual(chosen?.card, 'BE',
      'non-holder AI move must not consume the BE warp card');
  });

test('D03: among numbered blue moves the AI picks the highest-value one (B3 over B1)',
  { todo: 'DEFECT D03 — chooseMoveAction returns last-in-hand-order, not highest value; remove todo when fixed (see DEFECTS.md)' },
  () => {
    // B1 listed AFTER B3 so the buggy "last blue card" heuristic picks B1.
    const acts = [
      { type: 'move', card: 'B3' },
      { type: 'move', card: 'B1' },
      { type: 'move' },
      { type: 'rest' },
    ];
    const state = mkState('turn.action', acts, {
      hunters: [mkHunter({
        archetype: 'Normal', hp: 10, maxHp: 10, hasTarget: false,
        hand: ['B3', 'B1', 'R1', 'R2', 'R3'],
      })],
      deck: Array(20).fill('R1'),
    });
    const chosen = chooseAction(state);
    assert.equal(chosen?.type, 'move', 'AI takes a move action');
    assert.equal(chosen?.card, 'B3',
      'AI should play the highest-value blue move (B3), not the last one in hand order (B1)');
  });

// ---------------------------------------------------------------------------
// D08 — AI ranks lettered special cards (RS/RC/YD/YA) as value 0.
//
// chooseBattleCard scores cards as parseInt(card.replace(/\D/g,''),10) || 0;
// specials have no digits → NaN → 0, sorting them BELOW every numbered card.
// Per §2.11 the AI always plays the highest-value legal card in role, and the
// specials are strictly strongest in role (YD = guaranteed evade, RS = double AT).

test('D08: guarding AI plays YD (guaranteed evade) over the highest numbered yellow (Y9)',
  { todo: 'DEFECT D08 — special YD scored as value 0, ranked below Y9; remove todo when fixed (see DEFECTS.md)' },
  () => {
    const acts = [
      { type: 'battleCard', card: null },
      { type: 'battleCard', card: 'Y3' },
      { type: 'battleCard', card: 'Y9' },
      { type: 'battleCard', card: 'YD' },
    ];
    const state = mkState('battle.defCard', acts, {
      hunters: [mkHunter({ archetype: 'Normal', hp: 10, maxHp: 10, hand: [] })],
    });
    const chosen = chooseAction(state);
    assert.equal(chosen?.type, 'battleCard');
    assert.equal(chosen?.card, 'YD',
      'guarding AI should prefer the strongest defensive special (YD) over Y9');
  });

test('D08: attacking AI plays RS (double AT) over the highest numbered red (R9)',
  { todo: 'DEFECT D08 — special RS scored as value 0, ranked below R9; remove todo when fixed (see DEFECTS.md)' },
  () => {
    const acts = [
      { type: 'battleCard', card: null },
      { type: 'battleCard', card: 'R3' },
      { type: 'battleCard', card: 'R9' },
      { type: 'battleCard', card: 'RS' },
    ];
    const state = mkState('battle.atkCard', acts, {
      hunters: [mkHunter({ archetype: 'Normal', hp: 10, maxHp: 10, hand: [] })],
    });
    const chosen = chooseAction(state);
    assert.equal(chosen?.type, 'battleCard');
    assert.equal(chosen?.card, 'RS',
      'attacking AI should prefer the strongest offensive special (RS) over R9');
  });

// ---------------------------------------------------------------------------
// D14 — dead `panicked: 25` react-rate entry (source introspection).
//
// getBehavior maps every panicked/RAVEN unit onto a concrete cycled priority
// (aggressive/clever/balanced/passive) and never returns the literal 'panicked',
// so the `panicked: 25` entry in the react-rate table is unreachable dead code.
// The fix removes the dead literal (or wires up a reachable panicked rate path).

test('D14: ai.js must not contain the unreachable `panicked: 25` react-rate entry',
  { todo: 'DEFECT D14 — dead panicked:25 react-rate entry; remove todo when fixed (see DEFECTS.md)' },
  () => {
    const src = readFileSync(new URL('../src/engine/ai.js', import.meta.url), 'utf8');
    assert.doesNotMatch(src, /panicked:\s*25/,
      'the unreachable `panicked: 25` react-rate entry should be removed (getBehavior never yields priority "panicked")');
  });
