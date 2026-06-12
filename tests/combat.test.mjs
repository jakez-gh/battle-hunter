import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveBattle } from '../src/engine/combat.js';

// Deterministic rng stub: d6/float pop from fixed queues and fail loudly if
// combat consumes more randomness than the test scripted.
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

test('DESIGN worked example: 6,5 +3 red +3 AT = 17 vs 4,4 +5 yellow +2 DF = 15 -> 2 dmg', () => {
  const r = resolveBattle(ctx({
    rng: stubRng([6, 5, 4, 4, /* counter: */ 1, 2, 1, 3]),
    attacker: side({ at: 3, df: 1 }),
    defender: side({ at: 2, df: 2 }),
    response: 'counter',
    atkCard: { color: 'red', value: 3 },
    defCard: { color: 'yellow', value: 5 },
  }));
  const s = r.events[0];
  assert.equal(s.type, 'strikeRolled');
  assert.equal(s.phase, 'strike');
  assert.deepEqual(s.dice, { atk: [6, 5], def: [4, 4] });
  assert.deepEqual(s.totals, { atk: 17, def: 15 });
  assert.equal(s.damage, 2);
  assert.equal(s.crit, false);
  // counter half: defender's yellow doesn't boost it, attacker's red doesn't defend it
  const c = r.events[1];
  assert.equal(c.phase, 'counter');
  assert.equal(c.striker, 'defender');
  assert.deepEqual(c.totals, { atk: 1 + 2 + 2, def: 1 + 3 + 1 });
  assert.equal(c.damage, 0);
  assert.equal(r.outcome.type, 'resolved');
  assert.equal(r.outcome.defenderHp, 18);
  assert.deepEqual(r.hpChanges, { attacker: 0, defender: -2 });
});

test('guard doubles DF: same dice -> 0 damage, no counter half', () => {
  const r = resolveBattle(ctx({
    rng: stubRng([6, 5, 4, 4]),
    attacker: side({ at: 3 }),
    defender: side({ df: 2 }),
    response: 'guard',
    atkCard: { color: 'red', value: 3 },
    defCard: { color: 'yellow', value: 5 },
  }));
  assert.equal(r.events.length, 1);
  assert.deepEqual(r.events[0].totals, { atk: 17, def: 8 + 4 + 5 });
  assert.equal(r.events[0].damage, 0);
  assert.deepEqual(r.hpChanges, { attacker: 0, defender: 0 });
});

test('escape tie -> caught, defender DF zeroed for the strike', () => {
  const r = resolveBattle(ctx({
    rng: stubRng([3, 4, 3, 4, /* strike: */ 2, 3, 1, 2]),
    attacker: side({ mv: 2, at: 2 }),
    defender: side({ mv: 2, df: 5 }),
    response: 'escape',
  }));
  const e = r.events[0];
  assert.equal(e.type, 'escapeRolled');
  assert.equal(e.aTotal, 9);
  assert.equal(e.dTotal, 9);
  assert.equal(e.escaped, false);
  assert.deepEqual(r.events[1].totals, { atk: 5 + 2, def: 3 + 0 }); // df 5 ignored
  assert.equal(r.outcome.defenderHp, 16);
});

test('escape succeeds on strictly higher; escapeBonus helps fleeing side only', () => {
  const r = resolveBattle(ctx({
    rng: stubRng([3, 4, 4, 5]),
    attacker: side({ mv: 3, effects: { escapeBonus: 5 } }), // pursuer bonus must NOT count
    defender: side({ mv: 1, effects: { escapeBonus: 2 } }),
    response: 'escape',
  }));
  assert.equal(r.events[0].aTotal, 7 + 3);
  assert.equal(r.events[0].dTotal, 9 + 1 + 2);
  assert.equal(r.events[0].escaped, true);
  assert.equal(r.events.length, 1);
  assert.equal(r.outcome.type, 'escaped');
  assert.deepEqual(r.hpChanges, { attacker: 0, defender: 0 });
});

test('voyager wins escape ties (unless pursuer has one too)', () => {
  const tie = (aFx, dFx) => resolveBattle(ctx({
    rng: stubRng([3, 4, 3, 4, 1, 2, 1, 3]),
    attacker: side({ mv: 2, effects: aFx }),
    defender: side({ mv: 2, effects: dFx }),
    response: 'escape',
  })).events[0].escaped;
  assert.equal(tie({}, { voyager: true }), true);
  assert.equal(tie({ voyager: true }, { voyager: true }), false);
});

test('defender E auto-escapes without rolling; pursuer E beats E and voyager', () => {
  const dE = resolveBattle(ctx({
    rng: stubRng([]), // would throw if any escape dice were rolled
    response: 'escape',
    defCard: { color: 'blue', value: 'E' },
  }));
  assert.deepEqual(dE.events, [{
    type: 'escapeRolled', aDice: null, dDice: null, aTotal: null, dTotal: null,
    escaped: true, forced: 'defenderE',
  }]);
  assert.equal(dE.outcome.type, 'escaped');

  const eVsE = resolveBattle(ctx({
    rng: stubRng([2, 3, 1, 2]), // strike dice only
    attacker: side({ at: 2 }),
    defender: side({ df: 4, effects: { voyager: true } }),
    response: 'escape',
    atkCard: { color: 'blue', value: 'E' },
    defCard: { color: 'blue', value: 'E' },
  }));
  assert.equal(eVsE.events[0].escaped, false);
  assert.equal(eVsE.events[0].forced, 'attackerE');
  assert.deepEqual(eVsE.events[1].totals, { atk: 5 + 2, def: 3 + 0 }); // E cards add nothing to the strike

  const eVsRun = resolveBattle(ctx({
    rng: stubRng([2, 3, 1, 2]),
    response: 'escape',
    atkCard: { color: 'blue', value: 'E' },
    defCard: { color: 'blue', value: 3 },
  }));
  assert.equal(eVsRun.events[0].escaped, false);
});

test('crit on attacker doubles: panic always, leg/empty at 25% each (hunter target)', () => {
  const r = resolveBattle(ctx({
    rng: stubRng([4, 4, 1, 2], [0.1, 0.9]), // leg hits, empty misses
    attacker: side({ at: 3 }),
    response: 'guard',
  }));
  assert.equal(r.events[0].crit, true);
  assert.equal(r.events[0].damage, 8 + 3 - 3); // no damage bonus from the crit itself
  assert.deepEqual(r.statuses.defender, ['panic', 'leg']);
  assert.deepEqual(
    r.events.slice(1),
    [{ type: 'statusInflicted', kind: 'panic', target: 'defender' },
     { type: 'statusInflicted', kind: 'leg', target: 'defender' }],
  );
});

test('crit negation removes all statuses, never the damage', () => {
  const r = resolveBattle(ctx({
    rng: stubRng([4, 4, 1, 2], []), // empty floats: negation must skip rider rolls
    attacker: side({ at: 3, effects: { actuator: true, generator: true } }),
    response: 'guard',
    critNegateAttempt: { defender: true },
  }));
  assert.equal(r.events[0].damage, 8);
  assert.deepEqual(r.events[1], { type: 'critNegated', target: 'defender' });
  assert.deepEqual(r.statuses.defender, []);
  assert.equal(r.hpChanges.defender, -8);
});

test('crit vs monster target inflicts no statuses and rolls no chances', () => {
  const r = resolveBattle(ctx({
    rng: stubRng([4, 4, 1, 2, /* counter: */ 1, 2, 1, 3], []),
    attacker: side({ at: 3 }),
    defender: { kind: 'monster', at: 2, df: 0, mv: 1, hp: 25, maxHp: 25, stunned: false, effects: {} },
    response: 'counter',
  }));
  assert.equal(r.events[0].crit, true);
  assert.deepEqual(r.statuses.defender, []);
});

test('S doubles own AT; C adds opponent AT', () => {
  const sCase = resolveBattle(ctx({
    rng: stubRng([2, 3, 1, 2]),
    attacker: side({ at: 4 }),
    response: 'guard',
    atkCard: { color: 'red', value: 'S' },
  }));
  assert.equal(sCase.events[0].totals.atk, 5 + 8);

  const cCase = resolveBattle(ctx({
    rng: stubRng([2, 3, 1, 2]),
    attacker: side({ at: 3 }),
    defender: side({ at: 5 }),
    response: 'guard',
    atkCard: { color: 'red', value: 'C' },
  }));
  assert.equal(cCase.events[0].totals.atk, 5 + 3 + 5);
});

test('D doubles DF; A zeroes damage even on a crit (so no statuses)', () => {
  const dCase = resolveBattle(ctx({
    rng: stubRng([2, 3, 1, 2, /* counter: */ 1, 2, 1, 3]),
    attacker: side({ at: 2 }),
    defender: side({ df: 3 }),
    response: 'counter',
    defCard: { color: 'yellow', value: 'D' },
  }));
  assert.equal(dCase.events[0].totals.def, 3 + 6);
  assert.equal(dCase.events[1].totals.atk, 3 + 1); // D is yellow: no counter boost

  const aCase = resolveBattle(ctx({
    rng: stubRng([5, 5, 1, 2], []), // crit dice, but A -> 0 damage -> no rider rolls
    attacker: side({ at: 9 }),
    response: 'guard',
    defCard: { color: 'yellow', value: 'A' },
  }));
  assert.equal(aCase.events[0].crit, true);
  assert.equal(aCase.events[0].damage, 0);
  assert.deepEqual(aCase.statuses.defender, []);
  assert.equal(aCase.hpChanges.defender, 0);
});

test('counter rolls fresh dice with roles swapped; cards cross over by color', () => {
  const r = resolveBattle(ctx({
    rng: stubRng([5, 3, 2, 4, /* counter: */ 6, 2, 1, 2]),
    attacker: side({ at: 2, df: 2 }),
    defender: side({ at: 3, df: 1 }),
    response: 'counter',
    atkCard: { color: 'yellow', value: 3 }, // defends the counter, useless on the strike
    defCard: { color: 'red', value: 4 },    // boosts the counter, useless on the strike
  }));
  assert.deepEqual(r.events[0].totals, { atk: 8 + 2, def: 6 + 1 });
  assert.equal(r.events[0].damage, 3);
  const c = r.events[1];
  assert.equal(c.phase, 'counter');
  assert.equal(c.striker, 'defender');
  assert.deepEqual(c.dice, { atk: [6, 2], def: [1, 2] });
  assert.deepEqual(c.totals, { atk: 8 + 3 + 4, def: 3 + 2 + 3 });
  assert.deepEqual(r.hpChanges, { attacker: -7, defender: -3 });
});

test('no counter when the strike defeats the defender', () => {
  const r = resolveBattle(ctx({
    rng: stubRng([6, 5, 1, 2]), // only strike dice scripted
    attacker: side({ at: 120 }), // also exercises the 99 display cap
    defender: side({ hp: 20 }),
    response: 'counter',
  }));
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].damage, 131 - 3);
  assert.equal(r.events[0].display, 99);   // display capped
  assert.equal(r.outcome.defenderHp, 20 - 128); // internal uncapped
  assert.equal(r.outcome.defenderDefeated, true);
});

test('surrender: marker outcome, no dice, no damage', () => {
  const r = resolveBattle(ctx({ rng: stubRng([]), response: 'surrender' }));
  assert.deepEqual(r.events, [{ type: 'surrendered', unit: 'defender' }]);
  assert.equal(r.outcome.type, 'surrender');
  assert.deepEqual(r.hpChanges, { attacker: 0, defender: 0 });
});

test('stunned defender: response and card ignored, DF 0, no counter', () => {
  const r = resolveBattle(ctx({
    rng: stubRng([2, 3, 1, 2]),
    attacker: side({ at: 2 }),
    defender: side({ df: 4, stunned: true }),
    response: 'counter',
    defCard: { color: 'yellow', value: 9 },
  }));
  assert.equal(r.events.length, 1);
  assert.deepEqual(r.events[0].totals, { atk: 5 + 2, def: 3 + 0 });
});

test('monster always counters (caller passes counter, no card)', () => {
  const r = resolveBattle(ctx({
    rng: stubRng([2, 3, 1, 2, /* counter: */ 4, 2, 1, 3]),
    attacker: side({ at: 5, df: 2 }),
    defender: { kind: 'monster', at: 5, df: 0, mv: 1, hp: 25, maxHp: 25, stunned: false, effects: {} },
    response: 'counter',
    atkCard: { color: 'red', value: 3 },
  }));
  assert.equal(r.events[0].damage, (5 + 5 + 3) - 3);
  assert.deepEqual(r.events[1].totals, { atk: 6 + 5, def: 4 + 2 });
  assert.equal(r.hpChanges.attacker, -5);
});

test('monster crit riders via actuator/generator flags, deduped with 25% rolls', () => {
  const wyrm = { kind: 'monster', at: 12, df: 3, mv: 3, hp: 19, maxHp: 19, stunned: false, effects: { generator: true } };
  const stun = resolveBattle(ctx({
    rng: stubRng([3, 3, 1, 2], [0.9, 0.9]),
    attacker: wyrm,
    response: 'guard',
  }));
  assert.deepEqual(stun.statuses.defender, ['panic', 'stun']);

  const fng = { kind: 'monster', at: 6, df: 3, mv: 1, hp: 13, maxHp: 13, stunned: false, effects: { actuator: true } };
  const empty = resolveBattle(ctx({
    rng: stubRng([3, 3, 1, 2], [0.9, 0.1]), // 25% empty hits AND rider adds empty: one entry
    attacker: fng,
    response: 'guard',
  }));
  assert.deepEqual(empty.statuses.defender, ['panic', 'empty']);
  assert.equal(empty.events.filter((e) => e.type === 'statusInflicted' && e.kind === 'empty').length, 1);
});

test('warbanner doubles damage on attack doubles; aegis zeroes on defense doubles', () => {
  const wb = resolveBattle(ctx({
    rng: stubRng([5, 5, 1, 2], [0.9, 0.9]),
    attacker: side({ at: 3, effects: { warbanner: true } }),
    response: 'guard',
  }));
  assert.equal(wb.events[0].damage, (10 + 3 - 3) * 2);
  assert.deepEqual(wb.statuses.defender, ['panic']);

  const ae = resolveBattle(ctx({
    rng: stubRng([6, 3, 2, 2]),
    attacker: side({ at: 9 }),
    defender: side({ effects: { aegis: true } }),
    response: 'guard',
  }));
  assert.equal(ae.events[0].damage, 0);
  assert.equal(ae.hpChanges.defender, 0);
});

test('counter can crit the attacker; attacker-side negation applies', () => {
  const base = {
    rng: null,
    attacker: side({ at: 2, df: 0 }),
    defender: side({ at: 4, df: 5 }),
    response: 'counter',
  };
  const hit = resolveBattle(ctx({
    ...base,
    rng: stubRng([2, 3, 1, 2, /* counter: */ 4, 4, 1, 3], [0.9, 0.9]),
  }));
  assert.equal(hit.events[1].crit, true);
  assert.deepEqual(hit.statuses.attacker, ['panic']);

  const negated = resolveBattle(ctx({
    ...base,
    rng: stubRng([2, 3, 1, 2, 4, 4, 1, 3], []),
    critNegateAttempt: { attacker: true, defender: false },
  }));
  assert.deepEqual(negated.statuses.attacker, []);
  assert.deepEqual(negated.events[2], { type: 'critNegated', target: 'attacker' });
});
