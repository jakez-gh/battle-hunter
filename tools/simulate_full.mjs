import * as G from '../src/engine/game.js';
import * as AI from '../src/engine/ai.js';

function makeHunters(n = 4) {
  return Array.from({ length: n }).map((_, i) => ({ id: `h${i}`, slot: i, name: `CPU-${i}`, spriteId: 0, palette: 'cobalt', human: false, level: 1, internal: {}, maxHp: 10, items: [] }));
}

async function runFullSimulation(maxSteps = 5000, seed = 12345) {
  const config = { hunters: makeHunters(4), seed, mode: 'normal' };
  let state = G.createGame(config);
  console.log('Start seed=', state.seed, 'relicLevel=', state.relicLevel);
  let step = 0;
  while (step < maxSteps && state.phase !== 'mission.over' && !state._missionEnd) {
    step++;
    const acts = G.legalActions(state) || [];
    if (!acts.length) { console.log('No legal actions at step', step); break; }
    const chosen = AI.chooseAction({ ...state, legalActions: (s) => G.legalActions(s) });
    if (!chosen) { console.log('AI returned empty at step', step); break; }
    const out = G.applyAction(state, chosen);
    state = out.state || out;
    if ((out.events || []).length) {
      // compact event log
      const types = out.events.map((e) => e.type).slice(0, 6);
      console.log('step', step, 'act', chosen.type, 'events=', types.length ? types : []);
    }
  }
  console.log('Finished at step', step, 'phase=', state.phase, 'missionEnd=', !!state._missionEnd);
  if (state._missionEnd) console.log('Mission end:', state._missionEnd);
  // output hunters summary
  for (let i = 0; i < (state.hunters||[]).length; i++) {
    const h = state.hunters[i];
    console.log(`hunter ${i}: id=${h.id} hp=${h.hp}/${h.maxHp} pos=${h.pos?`${h.pos.x},${h.pos.y}`:'null'} items=${(h.items||[]).map(it=>it.itemId).join(',')}`);
  }
}

runFullSimulation().catch((e)=>{ console.error(e); process.exit(1); });
