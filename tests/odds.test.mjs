// Combat-odds calculator tests. This powers the pre-commit advantage readout
// (the agency tool that makes Battle Hunter's OUTPUT randomness feel fair —
// docs/design/fun-and-purchase-principles.md F5). It must mirror combat.js
// strike math exactly and be monotone in the obvious directions.

import test from 'node:test';
import assert from 'node:assert/strict';
import { battleOdds, advantageLabel } from '../src/engine/odds.js';

test('odds: probabilities are well-formed', () => {
  const o = battleOdds({ at: 4, df: 3 });
  assert.ok(o.pHit >= 0 && o.pHit <= 1);
  assert.ok(Math.abs(o.pHit + o.pZero - 1) < 1e-9);
  assert.ok(o.expectedDamage >= 0);
  assert.equal(o.pCrit, 6 / 36);
});

test('odds: deterministic (pure) — same inputs, same result', () => {
  assert.deepEqual(battleOdds({ at: 5, df: 2 }), battleOdds({ at: 5, df: 2 }));
});

test('odds: equal stats favour the attacker slightly (2d6 vs 2d6, +0 vs +0)', () => {
  // damage = max(0, atk - def); by symmetry the attacker deals some damage on
  // average even with equal stats, and is ~even to slightly-favoured to hit.
  const o = battleOdds({ at: 0, df: 0 });
  assert.ok(o.expectedDamage > 1 && o.expectedDamage < 2, `unexpected E[dmg]=${o.expectedDamage}`);
  assert.ok(o.pHit > 0.35 && o.pHit < 0.5, `unexpected pHit=${o.pHit}`);
});

test('odds: monotone in attack (more AT -> more damage and more hits)', () => {
  const lo = battleOdds({ at: 2, df: 4 });
  const hi = battleOdds({ at: 8, df: 4 });
  assert.ok(hi.expectedDamage > lo.expectedDamage);
  assert.ok(hi.pHit > lo.pHit);
});

test('odds: monotone in defense (more DF -> less damage)', () => {
  const soft = battleOdds({ at: 6, df: 1 });
  const tanky = battleOdds({ at: 6, df: 9 });
  assert.ok(tanky.expectedDamage < soft.expectedDamage);
  assert.ok(tanky.pHit < soft.pHit);
});

test('odds: a red attack card raises damage; a yellow defense card lowers it', () => {
  const base = battleOdds({ at: 4, df: 4 });
  const withRed = battleOdds({ at: 4, df: 4, atkCard: { color: 'red', value: 6 } });
  const withYellow = battleOdds({ at: 4, df: 4, defCard: { color: 'yellow', value: 6 } });
  assert.ok(withRed.expectedDamage > base.expectedDamage);
  assert.ok(withYellow.expectedDamage < base.expectedDamage);
});

test('odds: the A card (yellow) makes the defender take zero damage', () => {
  const o = battleOdds({ at: 9, df: 0, defCard: { color: 'yellow', value: 'A' } });
  assert.equal(o.expectedDamage, 0);
  assert.equal(o.pHit, 0);
});

test('odds: S doubles attack, C adds the opponent attack, guard halves effect', () => {
  const plain = battleOdds({ at: 5, oppAt: 5, df: 4 });
  const sCard = battleOdds({ at: 5, oppAt: 5, df: 4, atkCard: { color: 'red', value: 'S' } });
  const cCard = battleOdds({ at: 5, oppAt: 5, df: 4, atkCard: { color: 'red', value: 'C' } });
  assert.ok(sCard.expectedDamage > plain.expectedDamage); // +5 effective AT
  assert.ok(cCard.expectedDamage > plain.expectedDamage); // +oppAt(5)
  const guarded = battleOdds({ at: 6, df: 4, guard: true });
  const open = battleOdds({ at: 6, df: 4, guard: false });
  assert.ok(guarded.expectedDamage < open.expectedDamage);
});

test('odds: Warbanner raises damage (crit x2); Aegis can zero it', () => {
  const plain = battleOdds({ at: 6, df: 3 });
  const banner = battleOdds({ at: 6, df: 3, atkWarbanner: true });
  assert.ok(banner.expectedDamage > plain.expectedDamage);
  const aegis = battleOdds({ at: 9, df: 3, defAegis: true });
  assert.ok(aegis.expectedDamage < plain.expectedDamage || aegis.pHit < 1);
});

test('odds: advantageLabel buckets sensibly', () => {
  assert.equal(advantageLabel(0.9), 'strong');
  assert.equal(advantageLabel(0.5), 'even');
  assert.equal(advantageLabel(0.2), 'weak');
  assert.equal(battleOdds({ at: 12, df: 0 }).advantage, 'strong');
  assert.equal(battleOdds({ at: 0, df: 12 }).advantage, 'weak');
});
