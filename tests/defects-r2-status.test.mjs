// Round-2 defect audit — status lifecycle / items / cards / spawn rules.
// Scope: DESIGN.md §2.5, §2.7, §2.9, §2.10, §2.14 + items.js helpers.
//
// Each test asserts the CORRECT (spec) behaviour and is wrapped as a node:test
// `todo`, so it documents a NEW defect while keeping the suite green. A todo that
// reports `✖ ... # NEW DEFECT` (a failing todo) confirms the defect is live.
//
// Pure engine tests: state built via the real createGame / applyAction exports;
// RNG is seeded for determinism. No DOM / audio / render.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyAction } from '../src/engine/game.js';

function hunter(id, slot, opts = {}) {
  return {
    id, slot,
    name: opts.name ?? id,
    spriteId: 0,
    palette: 'cobalt',
    human: opts.human ?? false,
    archetype: opts.archetype ?? null,
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
// R2-status-1: Empty status must block ALL card draws for the round — Rest included.
//
// §2.9: "Empty: discard entire hand; can't draw for 1 round". This is the
// general rule for the Empty status (inflicted by an Empty trap, an FNG crit
// rider, or a green-Empty card). The end-of-turn auto-draw is correctly gated
// on `status.empty` (game.js applyEndTurn), but Rest (applyRest → drawDeckCards)
// performs its 2/3-card draw with NO empty check, so an Empty hunter who Rests
// draws a fresh hand — directly contradicting "can't draw for 1 round".
//
// Realistic path: an FNG crit inflicts Empty on the defender; on the defender's
// very next turn the Empty is still active (it decrements only at the end of
// that turn), so a Rest on that turn illegally refills the hand.
// ---------------------------------------------------------------------------
test('R2-status-1: Empty hunter Rest draws no cards (§2.9 "can\'t draw for 1 round")',
  { todo: 'NEW DEFECT — Rest bypasses Empty status and draws a full hand; see workflow report' },
  () => {
    const s = makeGame(5, { humanSlot: 0 });
    // Simulate a hunter who was just hit by an Empty crit / trap: hand discarded,
    // Empty status active and still in effect on this (their) turn.
    s.hunters[0].hand = [];
    s.hunters[0].status.empty = 1;
    const deckBefore = s.deck.length;
    assert.ok(deckBefore >= 3, 'deck has cards to (illegally) draw');

    const { state: after } = applyAction(s, { type: 'rest' });
    const drawn = deckBefore - after.deck.length;

    // Spec: an Empty hunter cannot draw. Rest may still heal, but must draw 0.
    assert.equal(drawn, 0, `Empty hunter drew ${drawn} card(s) on Rest — spec forbids drawing`);
    assert.equal(after.hunters[0].hand.length, 0, 'Empty hunter\'s hand must stay empty after Rest');
  });
