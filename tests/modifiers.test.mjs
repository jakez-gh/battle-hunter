// Phase 3 run-modifier tests. The mutators are the pure half of "why run #10"
// (research F7). Guarantees: catalog integrity, the challenge-for-reward
// convention (score ≥ 1), correct config merging + score stacking, and
// deterministic daily rotation.

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../src/engine/rng.js';
import {
  MODIFIERS, modifierConfig, scoreMultiplier, rollDailyModifier,
  describeModifier, allModifiers,
} from '../src/engine/modifiers.js';

test('modifiers: catalog is well-formed and every mutator is a challenge (score >= 1)', () => {
  for (const [key, m] of Object.entries(MODIFIERS)) {
    assert.equal(m.id, key);
    for (const f of ['name', 'desc', 'config', 'score']) assert.ok(m[f] !== undefined, `${key} missing ${f}`);
    assert.ok(m.score >= 1, `${key} must be a challenge (score >= 1), got ${m.score}`);
    assert.equal(typeof m.config, 'object');
  }
  assert.ok(Object.keys(MODIFIERS).length >= 4);
});

test('modifiers: modifierConfig merges the chosen overrides', () => {
  assert.deepEqual(modifierConfig(['minefield', 'sprint']), { trapMultiplier: 2, deckSize: 25 });
  assert.deepEqual(modifierConfig([]), {});
  assert.deepEqual(modifierConfig(['norest']), { restDisabled: true });
});

test('modifiers: scoreMultiplier stacks (compounds), empty = 1', () => {
  assert.equal(scoreMultiplier([]), 1);
  assert.equal(scoreMultiplier(['sprint']), 1.5);
  assert.ok(Math.abs(scoreMultiplier(['minefield', 'sprint']) - 1.25 * 1.5) < 1e-9);
  assert.equal(scoreMultiplier(['unknown']), 1); // unknown ids are inert
});

test('modifiers: rollDailyModifier is deterministic per seed and valid', () => {
  const a = rollDailyModifier(makeRng(99));
  const b = rollDailyModifier(makeRng(99));
  assert.equal(a, b, 'same seed -> same daily modifier');
  assert.ok(MODIFIERS[a], `picked a real modifier (${a})`);
  // Different seeds should not all collapse to one.
  const picks = new Set([7, 8, 9, 10, 11].map((s) => rollDailyModifier(makeRng(s))));
  assert.ok(picks.size > 1, 'daily modifier should vary by seed');
});

test('modifiers: rollDailyModifier(count) returns distinct ids', () => {
  const two = rollDailyModifier(makeRng(3), 2);
  assert.equal(two.length, 2);
  assert.notEqual(two[0], two[1]);
});

test('modifiers: describeModifier / allModifiers expose a UI-safe shape', () => {
  const d = describeModifier('sprint');
  assert.deepEqual(Object.keys(d).sort(), ['desc', 'id', 'name', 'score']);
  assert.equal(describeModifier('nope'), null);
  assert.equal(allModifiers().length, Object.keys(MODIFIERS).length);
});
