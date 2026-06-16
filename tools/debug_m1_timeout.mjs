// Debug story M1 timeout seeds
import * as G from '../src/engine/game.js';
import * as AI from '../src/engine/ai.js';
import { STORY_MISSIONS, interpolateInternal } from '../src/engine/missions.js';

const ARCHETYPES = {
  'Normal': { l1: { mv: 3, at: 4, df: 5, hp: 3 }, l15: { mv: 9, at: 7, df: 6, hp: 7 } },
};

function aiConfig(archetype, slot, level) {
  const a = ARCHETYPES[archetype] ?? ARCHETYPES['Normal'];
  const internal = interpolateInternal(a.l1, a.l15, level);
  return {
    id: `ai-${slot}`, slot, name: `CPU${slot}`, spriteId: 0, palette: 'cobalt',
    human: false, archetype, level, internal,
    maxHp: 7 + 3 * internal.hp + (level - 1), items: [],
  };
}

const M1 = STORY_MISSIONS[0];
const humanInternal = { mv: 4, at: 4, df: 4, hp: 3 };

for (const seed of [1, 5, 6, 12, 13]) {
  const config = {
    seed, mode: 'story', mission: M1,
    hunters: [
      { id: 'player', slot: 0, name: 'PLAYER', spriteId: 0, palette: 'cobalt',
        human: true, archetype: null, level: 1, internal: { ...humanInternal },
        maxHp: 7 + 3 * humanInternal.hp, items: [] },
      ...M1.opponents.map((o, i) => aiConfig(o, i + 1, M1.level)),
    ],
  };

  let state = G.createGame(config);
  let step = 0;
  while (step < 5000 && state.phase !== 'mission.over' && !state._missionEnd) {
    step++;
    const acts = G.legalActions(state) || [];
    if (!acts.length) break;
    const chosen = AI.chooseAction({ ...state, legalActions: (s) => G.legalActions(s) });
    if (!chosen) break;
    const out = G.applyAction(state, chosen);
    state = out.state || out;
  }

  const done = state.phase === 'mission.over' || !!state._missionEnd;
  if (done) {
    console.log(`seed=${seed} resolved at step ${step}: ${state._missionEnd?.reason ?? 'win'}`);
    continue;
  }

  // Diagnose the stall
  console.log(`\n=== seed=${seed} TIMEOUT at step=${step} phase=${state.phase} ===`);
  console.log('targetFound:', state.targetFound, 'deck:', state.deck?.length);
  const holder = state.targetHolder ? (state.targetHolder.kind === 'hunter' ? state.hunters?.[state.targetHolder.index] : null) : null;
  if (holder) console.log('targetHolder:', holder.name, 'pos:', holder.pos, 'hp:', `${holder.hp}/${holder.maxHp}`, 'hand:', holder.hand?.length, 'status:', JSON.stringify(holder.status));
  if (state.board?.exit) console.log('exit:', state.board.exit);
  for (const h of state.hunters || []) {
    console.log(`  ${h.name} arch=${h.archetype ?? 'null'} pos=${h.pos?.x},${h.pos?.y} hp=${h.hp}/${h.maxHp} hand=${h.hand?.length} status=${JSON.stringify(h.status)} moves=${h.tally?.moved}`);
  }
  // Show what actions the current unit has
  const acts = G.legalActions(state) || [];
  console.log('current unit:', JSON.stringify(state.current), 'legal actions:', acts.map(a => a.type));
}
