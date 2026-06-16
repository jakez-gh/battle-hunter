import * as G from '../src/engine/game.js';
import * as AI from '../src/engine/ai.js';

// Use realistic Normal-archetype L1 internal stats so movement and combat resolve
// at the same pace as a real game. Empty internal was used before the d6 movement
// change; now MV=0 is no longer the default, so hunters need proper stats.
const NORMAL_L1 = { mv: 3, at: 4, df: 5, hp: 3 };
function makeHunters(n = 4) {
  return Array.from({ length: n }).map((_, i) => ({
    id: `h${i}`, slot: i, name: `CPU-${i}`, spriteId: 0, palette: 'cobalt',
    human: false, level: 1, internal: { ...NORMAL_L1 }, items: [],
  }));
}

let pass = 0, fail = 0;
for (let seed = 1; seed <= 20; seed++) {
  const config = { hunters: makeHunters(4), seed, mode: 'normal' };
  let state = G.createGame(config);
  let step = 0;
  while (step < 10000 && state.phase !== 'mission.over' && !state._missionEnd) {
    step++;
    const acts = G.legalActions(state) || [];
    if (!acts.length) break;
    const chosen = AI.chooseAction({ ...state, legalActions: (s) => G.legalActions(s) });
    if (!chosen) break;
    const out = G.applyAction(state, chosen);
    state = out.state || out;
  }
  const ok = state.phase === 'mission.over' || !!state._missionEnd;
  const marker = ok ? 'ok' : 'TIMEOUT';
  console.log(`seed=${seed} steps=${step} ${marker} reason=${state._missionEnd?.reason ?? state.phase}`);
  if (ok) pass++; else fail++;
}
console.log(`\n${pass}/20 terminated, ${fail} timed out`);
process.exit(fail > 0 ? 1 : 0);
