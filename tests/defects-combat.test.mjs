// Regression tests documenting already-diagnosed combat/odds defects.
// Each test asserts the CORRECT (spec/fixed) behavior. These are hard regression
// guards: the defects are fixed, so each test now passes; it will fail if the
// defect regresses. See DEFECTS.md D12, D13.

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveBattle } from '../src/engine/combat.js';
import { battleOdds } from '../src/engine/odds.js';

// Deterministic rng stub: d6/float pop from fixed queues and fail loudly if
// combat consumes more randomness than the test scripted (mirrors
// tests/combat.test.mjs).
function stubRng(d6 = [], floats = []) {
  const dq = [...d6], fq = [...floats];
  return {
    d6: () => { assert.ok(dq.length > 0, 'rng.d6 over-consumed'); return dq.shift(); },
    float: () => { assert.ok(fq.length > 0, 'rng.float over-consumed'); return fq.shift(); },
  };
}

const side = (over = {}) =>
  ({ kind: 'hunter', at: 1, df: 0, mv: 1, hp: 20, maxHp: 20, stunned: false, effects: {}, ...over });

const ctx = (over = {}) => ({
  attacker: side(), defender: side(), response: 'counter',
  atkCard: null, defCard: null, critNegateAttempt: {}, relicLevel: 1, ...over,
});

// ---------------------------------------------------------------------------
// D12 — Black Gem / Amulet die-cap applied BEFORE crit detection -> false crit.
//
// combat.js:45-48 clamps each raw d6 (Black Gem -> min(d,4)) and then tests
// `crit = sDice[0] === sDice[1]` on the CLAMPED dice. DESIGN.md §2.8 step 5
// defines Critical as "attacker's 2d6 doubles" — the dice the striker actually
// rolled, not the value-clamped totals. A raw non-double like (5,6) clamps to
// (4,4) and is wrongly reported as a crit.
//
// Behavioral test: striker raw rolls 5 then 6 (a genuine non-double). With a
// Black Gem the strike total uses min(d,4) = (4,4), but `crit` must reflect the
// real dice -> false. Today's code reports crit:true (and, being a "crit",
// rolls the hunter rider floats), so the assertion fails.
// ---------------------------------------------------------------------------
test('D12: Black Gem die-cap that collapses a raw non-double to a double is NOT a crit',
  () => {
    const r = resolveBattle(ctx({
      // striker raw 5,6 (clamps to 4,4); target 1,2. Floats supplied defensively:
      // the BUGGY path believes it crit and rolls leg/empty riders against the
      // hunter target, so without these the stub would throw an over-consume
      // error and mask the real defect. The FIXED path consumes no floats.
      rng: stubRng([5, 6, 1, 2], [0.9, 0.9]),
      attacker: side({ at: 1, effects: { blackgem: true } }),
      defender: side({ df: 0 }),
      response: 'guard', // single strike, no counter half
    }));
    const s = r.events[0];
    assert.equal(s.type, 'strikeRolled');
    // The dice actually rolled were (5,6) — a non-double — so this is no crit.
    assert.equal(s.crit, false,
      'raw (5,6) is not doubles; Black Gem clamping must not manufacture a crit');
    // And, being a non-crit hit, it must inflict no crit statuses.
    assert.deepEqual(r.statuses.defender, [],
      'a non-crit strike must not inflict panic/leg/empty');
  });

// ---------------------------------------------------------------------------
// D13 — odds.js ignores die-capping in the crit probability.
//
// battleOdds (odds.js:42-72) hardcodes `pCrit: 6/36` and does not accept a
// `blackgem` input, so it cannot mirror combat.js's (intended) crit math for a
// Black Gem holder. Black Gem maps both 5 and 6 onto 4, so over the 36 equally
// likely 2d6 outcomes the number of "doubles-after-cap" pairs rises from 6 to
// 12 (the pairs whose clamped faces are equal). The FIXED contract is that
// battleOdds({ ..., blackgem: true }).pCrit ~= 12/36.
//
// Today the `blackgem` argument is ignored and pCrit is the constant 6/36, so
// asserting ~12/36 fails.
// ---------------------------------------------------------------------------
test('D13: battleOdds models Black Gem die-cap in crit probability (~12/36)',
  () => {
    const plain = battleOdds({ at: 4, df: 3 });
    assert.equal(plain.pCrit, 6 / 36, 'sanity: a plain striker crits on 6/36');

    const bg = battleOdds({ at: 4, df: 3, blackgem: true });
    // 12 of the 36 raw 2d6 pairs become equal once each die is clamped to 4
    // (every pair where both faces are >= 4, plus the genuine doubles 1-1/2-2/3-3).
    assert.ok(Math.abs(bg.pCrit - 12 / 36) < 1e-9,
      `Black Gem holder should crit ~12/36; got pCrit=${bg.pCrit}`);
  });
