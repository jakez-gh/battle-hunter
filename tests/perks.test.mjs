// Phase 2 perks module tests. The perk catalog + selection is the pure half of
// the "choose 1 of 3 between depths" feature (the UI wires it). Guarantees:
// catalog integrity, deterministic seeded selection, owned-exclusion, and
// correct stat/effect aggregation for the run controller.

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../src/engine/rng.js';
import {
  PERKS, rollPerkChoices, perkStatBonuses, perkHasEffect, describePerk, allPerks,
} from '../src/engine/perks.js';

test('perks: catalog is well-formed (keys match ids, fields present)', () => {
  for (const [key, p] of Object.entries(PERKS)) {
    assert.equal(p.id, key, `id must match catalog key for ${key}`);
    for (const f of ['name', 'desc', 'effect', 'rarity']) {
      assert.ok(p[f], `${key} missing ${f}`);
    }
    assert.ok(['common', 'uncommon', 'rare'].includes(p.rarity), `${key} bad rarity`);
  }
  assert.ok(Object.keys(PERKS).length >= 12, 'expect a meaningful catalog');
});

test('perks: rollPerkChoices returns `count` distinct ids', () => {
  const picks = rollPerkChoices(makeRng(1), [], 3);
  assert.equal(picks.length, 3);
  assert.equal(new Set(picks).size, 3, 'choices must be distinct');
  for (const id of picks) assert.ok(PERKS[id], `unknown perk ${id}`);
});

test('perks: selection is deterministic for the same seed (seeded/daily fairness)', () => {
  assert.deepEqual(rollPerkChoices(makeRng(42), [], 3), rollPerkChoices(makeRng(42), [], 3));
  // Different seeds should (at least sometimes) differ.
  const a = rollPerkChoices(makeRng(1), [], 3).join(',');
  const b = rollPerkChoices(makeRng(2), [], 3).join(',');
  const c = rollPerkChoices(makeRng(3), [], 3).join(',');
  assert.ok(!(a === b && b === c), 'different seeds must not always match');
});

test('perks: non-stackable owned perks are never re-offered; stackable can repeat', () => {
  // Own every unique (non-stackable) perk → only stackable ones remain offerable.
  const nonStackable = Object.values(PERKS).filter((p) => !p.stackable).map((p) => p.id);
  for (let seed = 0; seed < 20; seed++) {
    const picks = rollPerkChoices(makeRng(seed), nonStackable, 3);
    for (const id of picks) {
      assert.ok(PERKS[id].stackable, `re-offered non-stackable ${id} though owned`);
    }
  }
  // A stackable perk already owned may still be offered.
  const onlyStack = Object.values(PERKS).filter((p) => p.stackable).map((p) => p.id);
  const offered = new Set();
  for (let seed = 0; seed < 40; seed++) rollPerkChoices(makeRng(seed), onlyStack, 3).forEach((id) => offered.add(id));
  assert.ok([...offered].some((id) => PERKS[id].stackable), 'stackable perks should remain offerable');
});

test('perks: never offers more than the available pool', () => {
  const picks = rollPerkChoices(makeRng(7), [], 99);
  assert.equal(picks.length, Object.keys(PERKS).length);
  assert.equal(new Set(picks).size, picks.length);
});

test('perks: perkStatBonuses aggregates flat stats (stackable adds up)', () => {
  assert.deepEqual(perkStatBonuses(['sharp', 'sharp', 'hardened', 'fleet']),
    { at: 2, df: 1, mv: 1, maxhp: 0 });
  assert.deepEqual(perkStatBonuses(['vigor', 'vigor']), { at: 0, df: 0, mv: 0, maxhp: 6 });
  // Keyword (non-stat) perks contribute nothing to stat bonuses.
  assert.deepEqual(perkStatBonuses(['surefoot', 'ward']), { at: 0, df: 0, mv: 0, maxhp: 0 });
  assert.deepEqual(perkStatBonuses([]), { at: 0, df: 0, mv: 0, maxhp: 0 });
});

test('perks: perkHasEffect gates keyword behaviours', () => {
  assert.equal(perkHasEffect(['surefoot', 'ward'], 'wardstone'), true);
  assert.equal(perkHasEffect(['surefoot'], 'wardstone'), false);
  assert.equal(perkHasEffect([], 'legProof'), false);
});

test('perks: describePerk / allPerks expose UI-safe shape (no effect leak)', () => {
  const d = describePerk('lucky');
  assert.deepEqual(Object.keys(d).sort(), ['desc', 'id', 'name', 'rarity']);
  assert.equal(describePerk('nope'), null);
  assert.equal(allPerks().length, Object.keys(PERKS).length);
});
