import * as G from '../src/engine/game.js';
import * as AI from '../src/engine/ai.js';

function makeHunters(n = 4) {
  return Array.from({ length: n }).map((_, i) => ({ id: `h${i}`, slot: i, name: `CPU-${i}`, spriteId: 0, palette: 'cobalt', human: false, level: 1, internal: {}, maxHp: 10, items: [] }));
}

async function runSimulation() {
  const config = { hunters: makeHunters(4), seed: 12345, mode: 'normal' };
  let state = G.createGame(config);
  console.log('Starting simulation seed=', state.seed, 'phase=', state.phase);
  let step = 0;
  while (step < 500 && state.phase !== 'mission.over' && !state.result) {
    step++;
    const acts = G.legalActions(state) || [];
    if (!acts.length) {
      console.log(step, 'no legal actions, breaking');
      break;
    }
    // AI gets a helper-bound state
    const chosen = AI.chooseAction({ ...state, legalActions: (s) => G.legalActions(s) });
    if (!chosen) { console.log(step, 'AI returned null, pass'); break; }
    const out = G.applyAction(state, chosen);
    state = out.state || out;
    if ((out.events || []).length) console.log(step, 'acted', chosen.type, 'events=', out.events.map(e=>e.type));
  }
  console.log('Finished after', step, 'steps, phase=', state.phase, 'result=', state.result || state._missionEnd || null);
}

runSimulation().catch((e)=>{ console.error(e); process.exit(1); });
