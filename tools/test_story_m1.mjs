// Simulate story mission 1 as the game would run it, checking all story-mode paths.
import * as G from '../src/engine/game.js';
import * as AI from '../src/engine/ai.js';
import { STORY_MISSIONS, interpolateInternal } from '../src/engine/missions.js';

const ARCHETYPES = {
  'Normal': { l1: { mv: 3, at: 4, df: 5, hp: 3 }, l15: { mv: 9, at: 7, df: 6, hp: 7 } },
};
const PALETTES = ['cobalt', 'ember', 'citrine', 'moss'];

function aiConfig(archetype, slot, level) {
  const a = ARCHETYPES[archetype] ?? ARCHETYPES['Normal'];
  const internal = interpolateInternal(a.l1, a.l15, level);
  return {
    id: `ai-${slot}`, slot, name: `CPU${slot}`, spriteId: 0,
    palette: PALETTES[slot], human: false, archetype, level, internal,
    maxHp: 7 + 3 * internal.hp + (level - 1), items: [],
  };
}

const M1 = STORY_MISSIONS[0];
console.log('Mission:', M1.title, '| type:', M1.type, '| level:', M1.level);
console.log('Opponents:', M1.opponents);

let humanWins = 0, aiWins = 0, losses = 0, errors = 0;

for (let seed = 1; seed <= 20; seed++) {
  const humanInternal = { mv: 4, at: 4, df: 4, hp: 3 }; // typical L1 player
  const config = {
    seed,
    mode: 'story',
    mission: M1,
    hunters: [
      {
        id: 'player', slot: 0, name: 'PLAYER', spriteId: 0, palette: 'cobalt',
        human: true, archetype: null, level: 1,
        internal: { ...humanInternal },
        maxHp: 7 + 3 * humanInternal.hp, items: [],
      },
      ...M1.opponents.map((o, i) => aiConfig(o, i + 1, M1.level)),
    ],
  };

  let state;
  try {
    state = G.createGame(config);
  } catch (e) {
    console.error(`seed=${seed} createGame threw:`, e.message);
    errors++;
    continue;
  }

  let step = 0;
  let lastOutcomeWon = null, lastWinner = null, lastReason = null;
  while (step < 3000 && state.phase !== 'mission.over' && !state._missionEnd) {
    step++;
    const acts = G.legalActions(state) || [];
    if (!acts.length) { console.log(`seed=${seed} no legal actions at step ${step}`); break; }
    const chosen = AI.chooseAction({ ...state, legalActions: (s) => G.legalActions(s) });
    if (!chosen) { console.log(`seed=${seed} AI returned null`); break; }
    const out = G.applyAction(state, chosen);
    state = out.state || out;
    // Track outcome events
    for (const ev of (out.events || [])) {
      if (ev.type === 'missionWon') { lastOutcomeWon = true; lastWinner = ev.winner; }
      if (ev.type === 'missionLost') { lastOutcomeWon = false; lastReason = ev.reason; }
    }
  }

  const mEnd = state._missionEnd;
  if (!mEnd && state.phase !== 'mission.over') {
    console.log(`seed=${seed} TIMEOUT at step ${step}`);
    errors++;
    continue;
  }

  // Determine who won
  const win = mEnd ? mEnd.win : false;
  const reason = mEnd?.reason ?? 'unknown';
  const humanHolder = state.hunters.find(h => h.human && h.hasTarget);
  const humanWon = win && !!humanHolder;

  // Simulate what storyProgress would be
  const storyCleared = humanWon;
  const newProgress = storyCleared ? Math.max(0, M1.id) : 0;

  if (humanWon) humanWins++;
  else if (win) aiWins++;
  else losses++;

  console.log(`seed=${seed} steps=${step} win=${win} humanWon=${humanWon} reason=${reason} storyProgress→${newProgress}`);
}

console.log(`\nSummary: humanWins=${humanWins} aiWins=${aiWins} losses=${losses} errors=${errors}`);
if (errors) process.exit(1);
