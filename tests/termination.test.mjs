// Regression guard: every Normal 4-AI game must reach mission.over.
//
// A monster killed WHILE ATTACKING (defeated by a hunter's counter) was not
// removed from the board — the attacker-defeated path only handled hunters, so a
// slain monster-attacker stayed as a positioned hp<=0 corpse, clogging tiles
// until the Target holder could no longer path to the EXIT and the deck never
// drained. Seeds 3, 7, 8 hung past 10,000 steps. This promotes the tools/
// smoke check into the suite so the hang can't silently come back.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, legalActions, applyAction } from '../src/engine/game.js';
import { chooseAction } from '../src/engine/ai.js';

const NORMAL_L1 = { mv: 3, at: 4, df: 5, hp: 3 };
const hunters = (n = 4) => Array.from({ length: n }, (_, i) => ({
  id: `h${i}`, slot: i, name: `CPU-${i}`, spriteId: 0, palette: 'cobalt',
  human: false, level: 1, internal: { ...NORMAL_L1 }, items: [],
}));

function run(seed, cap = 8000) {
  let s = createGame({ hunters: hunters(4), seed, mode: 'normal' });
  let step = 0;
  while (step < cap && s.phase !== 'mission.over' && !s._missionEnd) {
    const acts = legalActions(s) || [];
    if (!acts.length) break;
    const chosen = chooseAction({ ...s, legalActions: (x) => legalActions(x) });
    if (!chosen) break;
    s = applyAction(s, chosen).state;
    step++;
  }
  return { terminated: s.phase === 'mission.over' || !!s._missionEnd, step, phase: s.phase };
}

for (let seed = 1; seed <= 20; seed++) {
  test(`termination: Normal 4-AI game seed ${seed} reaches mission.over`, () => {
    const r = run(seed);
    assert.ok(r.terminated, `seed ${seed} did not terminate (stuck in ${r.phase} after ${r.step} steps)`);
  });
}

test('termination: a monster slain while ATTACKING leaves the board (pos cleared)', () => {
  // Drive games until a monster-attacker is defeated by a counter, then assert
  // no positioned monster lingers at hp<=0 (the corpse-clog invariant).
  for (let seed = 1; seed <= 20; seed++) {
    let s = createGame({ hunters: hunters(4), seed, mode: 'normal' });
    for (let step = 0; step < 8000 && s.phase !== 'mission.over' && !s._missionEnd; step++) {
      const acts = legalActions(s) || [];
      if (!acts.length) break;
      const chosen = chooseAction({ ...s, legalActions: (x) => legalActions(x) });
      if (!chosen) break;
      s = applyAction(s, chosen).state;
      const zombie = (s.monsters || []).find((m) => m.pos && m.hp <= 0);
      assert.ok(!zombie, `seed ${seed}: a defeated monster still occupies ${JSON.stringify(zombie?.pos)}`);
    }
  }
});
