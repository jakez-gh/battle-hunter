// Gameplay simulation tests: end-to-end game runs that verify correctness,
// human-player UX, event coverage, and per-mission-type invariants.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, legalActions, applyAction, isHumanTurn } from '../src/engine/game.js';
import { chooseAction } from '../src/engine/ai.js';
import { STORY_MISSIONS } from '../src/engine/missions.js';

// ---------------------------------------------------------------------------
// Helpers

function makeHunter(id, slot, opts = {}) {
  return {
    id, slot,
    name: opts.name ?? id,
    spriteId: 0, palette: 'cobalt',
    human: opts.human ?? false,
    archetype: opts.archetype ?? null,
    level: opts.level ?? 1,
    internal: opts.internal ?? { mv: 3, at: 4, df: 4, hp: 4 },
    maxHp: opts.maxHp ?? 19,
    items: opts.items ?? [],
  };
}

function fastHunter(id, slot, opts = {}) {
  return makeHunter(id, slot, {
    internal: { mv: 9, at: 3, df: 2, hp: 3 },
    maxHp: 16,
    ...opts,
  });
}

// Simulate a complete game to mission.over. Returns { state, steps, events }.
function runGame(config, maxSteps = 5000) {
  let state = createGame(config);
  let steps = 0;
  const events = [];
  while (state.phase !== 'mission.over' && steps < maxSteps) {
    const action = chooseAction({ ...state, legalActions: (s) => legalActions(s) });
    if (!action) break;
    const out = applyAction(state, action);
    if (out.state.events?.length) events.push(...out.state.events);
    state = out.state;
    steps++;
  }
  return { state, steps, events };
}

// Like runGame but also checks that every isHumanTurn state has legal actions.
function runGameCheckHuman(config, maxSteps = 5000) {
  let state = createGame(config);
  let steps = 0;
  let humanTurnsTotal = 0;
  let humanTurnsWithEmptyActions = 0;
  while (state.phase !== 'mission.over' && steps < maxSteps) {
    if (isHumanTurn(state)) {
      humanTurnsTotal++;
      if (legalActions(state).length === 0) humanTurnsWithEmptyActions++;
    }
    const action = chooseAction({ ...state, legalActions: (s) => legalActions(s) });
    if (!action) break;
    state = applyAction(state, action).state;
    steps++;
  }
  return { state, steps, humanTurnsTotal, humanTurnsWithEmptyActions };
}

const FOUR_HUNTERS = [
  makeHunter('h0', 0), makeHunter('h1', 1),
  makeHunter('h2', 2), makeHunter('h3', 3),
];

// ---------------------------------------------------------------------------
// 1. Game Termination

test('normal 2-hunter game terminates within 3000 steps', () => {
  const { state, steps } = runGame({
    seed: 42, mode: 'normal',
    hunters: [fastHunter('h0', 0), fastHunter('h1', 1)],
  }, 3000);
  assert.equal(state.phase, 'mission.over',
    `still in phase '${state.phase}' after ${steps} steps`);
});

test('normal 4-hunter game terminates within 5000 steps (seed 1)', () => {
  const { state, steps } = runGame({
    seed: 1, mode: 'normal',
    hunters: [
      fastHunter('h0', 0), fastHunter('h1', 1),
      fastHunter('h2', 2), fastHunter('h3', 3),
    ],
  });
  assert.equal(state.phase, 'mission.over',
    `still in phase '${state.phase}' after ${steps} steps`);
});

test('normal 4-hunter game terminates within 5000 steps (seed 100)', () => {
  const { state, steps } = runGame({
    seed: 100, mode: 'normal',
    hunters: [
      fastHunter('h0', 0), fastHunter('h1', 1),
      fastHunter('h2', 2), fastHunter('h3', 3),
    ],
  });
  assert.equal(state.phase, 'mission.over',
    `still in phase '${state.phase}' after ${steps} steps`);
});

test('completed game has _missionEnd with a boolean win field', () => {
  const { state } = runGame({
    seed: 42, mode: 'normal',
    hunters: [fastHunter('h0', 0), fastHunter('h1', 1)],
  }, 3000);
  assert.equal(state.phase, 'mission.over');
  assert.ok(state._missionEnd, '_missionEnd must be set on termination');
  assert.equal(typeof state._missionEnd.win, 'boolean', 'win must be a boolean');
});

test('game advances beyond round 1 before ending', () => {
  const { state } = runGame({
    seed: 5, mode: 'normal',
    hunters: [makeHunter('h0', 0), makeHunter('h1', 1)],
  });
  assert.ok(state.round > 1, `expected round > 1, got ${state.round}`);
});

// ---------------------------------------------------------------------------
// 2. Human Player UX

test('human player always has legal actions on their turn', () => {
  const { humanTurnsTotal, humanTurnsWithEmptyActions } = runGameCheckHuman({
    seed: 7, mode: 'normal',
    hunters: [
      fastHunter('h0', 0, { human: true }),
      fastHunter('h1', 1),
    ],
  });
  assert.ok(humanTurnsTotal > 0, 'human took at least one turn during the game');
  assert.equal(humanTurnsWithEmptyActions, 0,
    `human had empty legal actions on ${humanTurnsWithEmptyActions}/${humanTurnsTotal} turns`);
});

test('human player always sees rest action in turn.action phase', () => {
  let state = createGame({
    seed: 3, mode: 'normal',
    hunters: [fastHunter('h0', 0, { human: true }), fastHunter('h1', 1)],
  });
  let checked = 0;
  for (let i = 0; i < 500 && state.phase !== 'mission.over'; i++) {
    if (isHumanTurn(state) && state.phase === 'turn.action') {
      const acts = legalActions(state);
      assert.ok(
        acts.some((a) => a.type === 'rest'),
        `rest unavailable in turn.action at step ${i}: actions=${JSON.stringify(acts.map((a) => a.type))}`,
      );
      checked++;
    }
    const action = chooseAction({ ...state, legalActions: (s) => legalActions(s) });
    if (!action) break;
    state = applyAction(state, action).state;
  }
  assert.ok(checked > 0, 'verified at least one human turn.action state');
});

test('panicked human hunter is controlled by AI (isHumanTurn=false)', () => {
  const base = createGame({
    seed: 1, mode: 'normal',
    hunters: [makeHunter('h0', 0, { human: true }), makeHunter('h1', 1)],
  });
  const s = JSON.parse(JSON.stringify(base));
  s.hunters[0].status.panic = 2;
  assert.equal(isHumanTurn(s), false, 'panicked human is not a human turn');
  // AI can still choose an action for the panicked hunter.
  const action = chooseAction({ ...s, legalActions: (ss) => legalActions(ss) });
  assert.ok(action, 'AI must provide an action for a panicked human hunter');
});

// ---------------------------------------------------------------------------
// 3. Game Loop / Events

test('events are emitted during gameplay', () => {
  const { events } = runGame({
    seed: 42, mode: 'normal',
    hunters: [fastHunter('h0', 0), fastHunter('h1', 1)],
  }, 3000);
  assert.ok(events.length > 0, 'at least one event must be emitted during a full game');
});

test('stepped events are emitted (hunters actually move on the board)', () => {
  const { events } = runGame({
    seed: 42, mode: 'normal',
    hunters: [fastHunter('h0', 0), fastHunter('h1', 1)],
  }, 3000);
  assert.ok(
    events.some((e) => e.type === 'stepped'),
    'expected at least one stepped event; got types: ' +
    [...new Set(events.map((e) => e.type))].join(', '),
  );
});

test('turnStarted events are emitted for each turn', () => {
  const { events } = runGame({
    seed: 1, mode: 'normal',
    hunters: [makeHunter('h0', 0), makeHunter('h1', 1)],
  }, 1000);
  assert.ok(
    events.filter((e) => e.type === 'turnStarted').length > 0,
    'turnStarted events must be emitted',
  );
});

test('hunters move at least 5 tiles each over a full game', () => {
  const { state } = runGame({
    seed: 9, mode: 'normal',
    hunters: [fastHunter('h0', 0), fastHunter('h1', 1)],
  }, 3000);
  for (const h of state.hunters) {
    assert.ok(h.tally.moved >= 5,
      `hunter ${h.id} moved only ${h.tally.moved} tiles — expected ≥5`);
  }
});

test('battle events occur in multi-hunter aggressive-stat games', () => {
  const { events } = runGame({
    seed: 17, mode: 'normal',
    hunters: [
      makeHunter('h0', 0, { internal: { mv: 2, at: 7, df: 2, hp: 4 } }),
      makeHunter('h1', 1, { internal: { mv: 2, at: 7, df: 2, hp: 4 } }),
      makeHunter('h2', 2, { internal: { mv: 2, at: 7, df: 2, hp: 4 } }),
      makeHunter('h3', 3, { internal: { mv: 2, at: 7, df: 2, hp: 4 } }),
    ],
  });
  const battleEvents = events.filter((e) =>
    ['battleStarted', 'hunterDefeated', 'monsterKilled', 'responseChosen'].includes(e.type),
  );
  assert.ok(battleEvents.length > 0,
    `no battle events found; event types seen: ${[...new Set(events.map((e) => e.type))].join(', ')}`);
});

// ---------------------------------------------------------------------------
// 4. Story Mission Types

test('all 15 story missions createGame without throwing', () => {
  assert.equal(STORY_MISSIONS.length, 15, 'expected exactly 15 story missions');
  for (const mission of STORY_MISSIONS) {
    assert.doesNotThrow(
      () => createGame({ seed: 1, mode: 'story', mission, hunters: FOUR_HUNTERS }),
      `createGame threw for mission: "${mission.title}"`,
    );
  }
});

test('all story missions have hunters and a board after createGame', () => {
  for (const mission of STORY_MISSIONS) {
    const state = createGame({ seed: 2, mode: 'story', mission, hunters: FOUR_HUNTERS });
    assert.ok(state.hunters.length > 0, `mission "${mission.title}" has no hunters`);
    assert.ok(state.board, `mission "${mission.title}" has no board`);
    assert.equal(state.missionTitle, mission.title,
      `missionTitle not stored for "${mission.title}"`);
  }
});

test('fetch-type missions start with target unresolved and board has boxes', () => {
  const fetchMissions = STORY_MISSIONS.filter((m) => m.type === 'fetch');
  assert.ok(fetchMissions.length > 0, 'at least one fetch story mission must exist');
  for (const m of fetchMissions) {
    const state = createGame({ seed: 5, mode: 'story', mission: m, hunters: FOUR_HUNTERS });
    assert.equal(state.missionType, 'fetch', `"${m.title}" missionType is not fetch`);
    assert.ok(state.board.boxes.length > 0,
      `"${m.title}" board has no boxes for target to spawn in`);
  }
});

test('rescue missions start with board.rescue position and rescueHoldRounds=2', () => {
  const rescueMissions = STORY_MISSIONS.filter((m) => m.type === 'rescue');
  assert.ok(rescueMissions.length > 0, 'at least one rescue story mission must exist');
  for (const m of rescueMissions) {
    const state = createGame({ seed: 2, mode: 'story', mission: m, hunters: FOUR_HUNTERS });
    assert.equal(state.missionType, 'rescue', `"${m.title}" missionType is not rescue`);
    assert.equal(state.rescueHoldRounds, 2,
      `"${m.title}" rescueHoldRounds should be 2, got ${state.rescueHoldRounds}`);
    assert.ok(state.board.rescue, `"${m.title}" board.rescue position not set`);
    assert.equal(state.board.rescue.claimed, false, `"${m.title}" rescue starts unclaimed`);
  }
});

test('resteal missions start with targetFound=true and carrier holding target', () => {
  const restealMissions = STORY_MISSIONS.filter((m) => m.type === 'resteal');
  assert.ok(restealMissions.length > 0, 'at least one resteal story mission must exist');
  for (const m of restealMissions) {
    const state = createGame({ seed: 3, mode: 'story', mission: m, hunters: FOUR_HUNTERS });
    assert.equal(state.missionType, 'resteal', `"${m.title}" missionType is not resteal`);
    assert.equal(state.targetFound, true,
      `"${m.title}" targetFound should be true at game start`);
    const carrierIdx = m.carrierIndex + 1; // slot 0 is the player
    assert.equal(state.hunters[carrierIdx]?.hasTarget, true,
      `"${m.title}" carrier hunter[${carrierIdx}] should hold target`);
  }
});

// ---------------------------------------------------------------------------
// 5. Multi-seed Robustness

for (const seed of [1, 7, 13, 42, 100]) {
  test(`normal 4-hunter game terminates on seed ${seed}`, () => {
    const { state, steps } = runGame({
      seed, mode: 'normal',
      hunters: [
        fastHunter('h0', 0), fastHunter('h1', 1),
        fastHunter('h2', 2), fastHunter('h3', 3),
      ],
    });
    assert.equal(state.phase, 'mission.over',
      `seed ${seed}: still in '${state.phase}' after ${steps} steps`);
  });
}

// ---------------------------------------------------------------------------
// 6. Turn Fairness

test('every hunter gets at least 5 action turns before the game ends', () => {
  const config = {
    seed: 10, mode: 'normal',
    hunters: [
      fastHunter('h0', 0), fastHunter('h1', 1),
      fastHunter('h2', 2), fastHunter('h3', 3),
    ],
  };
  const turnCounts = new Map();
  let state = createGame(config);
  for (let i = 0; i < 5000 && state.phase !== 'mission.over'; i++) {
    if (state.current?.kind === 'hunter' && state.phase === 'turn.action') {
      const key = state.current.index;
      turnCounts.set(key, (turnCounts.get(key) ?? 0) + 1);
    }
    const action = chooseAction({ ...state, legalActions: (s) => legalActions(s) });
    if (!action) break;
    state = applyAction(state, action).state;
  }
  for (let i = 0; i < 4; i++) {
    const count = turnCounts.get(i) ?? 0;
    assert.ok(count >= 5, `hunter[${i}] got only ${count} turn.action entries — expected ≥5`);
  }
});

test('all hunters appear in the turn order within the first 100 steps', () => {
  let state = createGame({
    seed: 1, mode: 'normal',
    hunters: [makeHunter('h0', 0), makeHunter('h1', 1), makeHunter('h2', 2)],
  });
  const seenIndices = new Set();
  for (let i = 0; i < 100 && state.phase !== 'mission.over'; i++) {
    if (state.current?.kind === 'hunter') seenIndices.add(state.current.index);
    const action = chooseAction({ ...state, legalActions: (s) => legalActions(s) });
    if (!action) break;
    state = applyAction(state, action).state;
  }
  assert.ok(seenIndices.has(0) && seenIndices.has(1) && seenIndices.has(2),
    `not all hunters appeared in first 100 steps; seen indices: ${[...seenIndices].join(',')}`);
});

// ---------------------------------------------------------------------------
// 7. Card Economy

test('resting with an empty hand draws cards from the deck', () => {
  const state = createGame({
    seed: 1, mode: 'normal',
    hunters: [makeHunter('h0', 0), makeHunter('h1', 1)],
  });
  const s = JSON.parse(JSON.stringify(state));
  // Drain h0's hand; ensure deck still has cards to draw from.
  assert.ok(s.deck.length >= 5, 'deck must have ≥5 cards for this test to be meaningful');
  s.hunters[0].hand = [];
  const { state: after } = applyAction(s, { type: 'rest' });
  assert.ok(after.hunters[0].hand.length > 0,
    'resting with an empty hand should draw cards');
});

test('cardDrawn events appear when a hunter rests', () => {
  const state = createGame({
    seed: 1, mode: 'normal',
    hunters: [makeHunter('h0', 0), makeHunter('h1', 1)],
  });
  const s = JSON.parse(JSON.stringify(state));
  s.hunters[0].hand = [];
  const { state: after } = applyAction(s, { type: 'rest' });
  assert.ok(
    after.events.some((e) => e.type === 'cardDrawn'),
    'cardDrawn events should fire when rest draws cards',
  );
});

// ---------------------------------------------------------------------------
// 8. Win / Loss Conditions

test('at least one seed produces a winning game (_missionEnd.win=true)', () => {
  let found = false;
  for (const seed of [42, 1, 7, 13, 100]) {
    const { state } = runGame({
      seed, mode: 'normal',
      hunters: [fastHunter('h0', 0), fastHunter('h1', 1)],
    }, 3000);
    if (state._missionEnd?.win === true) { found = true; break; }
  }
  assert.ok(found, 'at least one seed among {42,1,7,13,100} must produce a win');
});

test('mission.over is terminal: legalActions returns only confirm', () => {
  const { state } = runGame({
    seed: 42, mode: 'normal',
    hunters: [fastHunter('h0', 0), fastHunter('h1', 1)],
  }, 3000);
  assert.equal(state.phase, 'mission.over');
  const acts = legalActions(state);
  assert.deepEqual(acts, [{ type: 'confirm' }],
    `expected [{type:'confirm'}], got ${JSON.stringify(acts)}`);
});

test('missionWon or missionLost event emitted on game end', () => {
  const { events } = runGame({
    seed: 42, mode: 'normal',
    hunters: [fastHunter('h0', 0), fastHunter('h1', 1)],
  }, 3000);
  assert.ok(
    events.some((e) => e.type === 'missionWon' || e.type === 'missionLost'),
    'expected a missionWon or missionLost event; got types: ' +
    [...new Set(events.map((e) => e.type))].join(', '),
  );
});

// ---------------------------------------------------------------------------
// 9. Event Completeness

test('dieRolled events fire during normal gameplay', () => {
  const { events } = runGame({
    seed: 42, mode: 'normal',
    hunters: [fastHunter('h0', 0), fastHunter('h1', 1)],
  }, 3000);
  assert.ok(
    events.some((e) => e.type === 'dieRolled'),
    'expected dieRolled events; seen types: ' + [...new Set(events.map((e) => e.type))].join(', '),
  );
});

test('boxOpened event fires in a complete game (target lives in a box)', () => {
  const { events } = runGame({
    seed: 42, mode: 'normal',
    hunters: [fastHunter('h0', 0), fastHunter('h1', 1)],
  }, 3000);
  assert.ok(
    events.some((e) => e.type === 'boxOpened'),
    'expected at least one boxOpened event in a full game',
  );
});

test('targetFound event fires before missionWon in winning games', () => {
  // seed 42 produces a win.
  const { events } = runGame({
    seed: 42, mode: 'normal',
    hunters: [fastHunter('h0', 0), fastHunter('h1', 1)],
  }, 3000);
  const targetFoundIdx = events.findIndex((e) => e.type === 'targetFound');
  const missionWonIdx = events.findIndex((e) => e.type === 'missionWon');
  assert.ok(targetFoundIdx >= 0, 'targetFound event not found in events list');
  assert.ok(missionWonIdx >= 0, 'missionWon event not found — game did not end as a win');
  assert.ok(
    targetFoundIdx < missionWonIdx,
    `targetFound (index ${targetFoundIdx}) must precede missionWon (index ${missionWonIdx})`,
  );
});

test('missionWon event carries a winner reference', () => {
  const { events } = runGame({
    seed: 42, mode: 'normal',
    hunters: [fastHunter('h0', 0), fastHunter('h1', 1)],
  }, 3000);
  const wonEv = events.find((e) => e.type === 'missionWon');
  assert.ok(wonEv, 'missionWon event not found');
  assert.ok(wonEv.winner, 'missionWon event should carry a winner field');
});

// ---------------------------------------------------------------------------
// 10. State Integrity

test('all hunters have hp > 0 at end of a won game (defeat heals, never removes)', () => {
  // seed 42 → win; defeatHunter heals in the same action cycle, so all hp > 0 at game end.
  const { state } = runGame({
    seed: 42, mode: 'normal',
    hunters: [fastHunter('h0', 0), fastHunter('h1', 1)],
  }, 3000);
  if (state._missionEnd?.win !== true) return; // WYRM loss can leave hp ≤ 0; skip
  for (const h of state.hunters) {
    assert.ok(h.hp > 0,
      `hunter ${h.id} has hp=${h.hp} at game end — defeat should always heal`);
  }
});

test('game length is reasonable: 10 – 3000 steps for fast hunters', () => {
  for (const seed of [42, 7, 13]) {
    const { steps } = runGame({
      seed, mode: 'normal',
      hunters: [fastHunter('h0', 0), fastHunter('h1', 1)],
    }, 3000);
    assert.ok(steps >= 10, `seed ${seed}: game ended suspiciously fast (${steps} steps)`);
    assert.ok(steps <= 3000, `seed ${seed}: game did not end within 3000 steps`);
  }
});

test('legalActions is never empty during active gameplay', () => {
  // Strong correctness invariant: every non-terminal state has at least one legal action.
  let state = createGame({
    seed: 33, mode: 'normal',
    hunters: [fastHunter('h0', 0), fastHunter('h1', 1)],
  });
  for (let i = 0; i < 3000 && state.phase !== 'mission.over'; i++) {
    const acts = legalActions(state);
    assert.ok(
      acts.length > 0,
      `empty legalActions in phase '${state.phase}' at step ${i}`,
    );
    const action = chooseAction({ ...state, legalActions: (s) => legalActions(s) });
    assert.ok(
      action,
      `chooseAction returned null in phase '${state.phase}' at step ${i} (${acts.length} legal actions available)`,
    );
    state = applyAction(state, action).state;
  }
});

// ---------------------------------------------------------------------------
// 11. Phase Invariants (battle / steer never leave the player stranded)

test('battle.response always has respond actions available', () => {
  // Combat-heavy config: slow + high AT forces many fights.
  let state = createGame({
    seed: 17, mode: 'normal',
    hunters: [
      makeHunter('h0', 0, { internal: { mv: 2, at: 7, df: 2, hp: 4 } }),
      makeHunter('h1', 1, { internal: { mv: 2, at: 7, df: 2, hp: 4 } }),
      makeHunter('h2', 2, { internal: { mv: 2, at: 7, df: 2, hp: 4 } }),
      makeHunter('h3', 3, { internal: { mv: 2, at: 7, df: 2, hp: 4 } }),
    ],
  });
  let battleResponseCount = 0;
  for (let i = 0; i < 5000 && state.phase !== 'mission.over'; i++) {
    if (state.phase === 'battle.response') {
      const acts = legalActions(state);
      assert.ok(acts.length > 0,
        `battle.response had empty actions at step ${i}`);
      assert.ok(
        acts.some((a) => a.type === 'respond'),
        `battle.response must offer respond actions at step ${i}`,
      );
      battleResponseCount++;
    }
    const action = chooseAction({ ...state, legalActions: (s) => legalActions(s) });
    if (!action) break;
    state = applyAction(state, action).state;
  }
  assert.ok(battleResponseCount > 0,
    'at least one battle.response phase must occur in a combat-heavy game');
});

test('turn.steer always has step or stop actions (movement is never deadlocked)', () => {
  let state = createGame({
    seed: 33, mode: 'normal',
    hunters: [fastHunter('h0', 0), fastHunter('h1', 1)],
  });
  let steerCount = 0;
  for (let i = 0; i < 3000 && state.phase !== 'mission.over'; i++) {
    if (state.phase === 'turn.steer') {
      const acts = legalActions(state);
      assert.ok(
        acts.some((a) => a.type === 'step' || a.type === 'stop'),
        `turn.steer had no step/stop at step ${i}: ${JSON.stringify(acts.map((a) => a.type))}`,
      );
      steerCount++;
    }
    const action = chooseAction({ ...state, legalActions: (s) => legalActions(s) });
    if (!action) break;
    state = applyAction(state, action).state;
  }
  assert.ok(steerCount > 0, 'at least one turn.steer phase must be encountered');
});

// ---------------------------------------------------------------------------
// 12. Item and Flag Economy

test('itemTaken events fire when hunters open non-target boxes', () => {
  // 4-hunter game: multiple hunters open multiple boxes during exploration.
  // At least one non-target box should yield an itemTaken event.
  const { events } = runGame({
    seed: 10, mode: 'normal',
    hunters: [
      fastHunter('h0', 0), fastHunter('h1', 1),
      fastHunter('h2', 2), fastHunter('h3', 3),
    ],
  }, 5000);
  assert.ok(
    events.some((e) => e.type === 'itemTaken'),
    'expected at least one itemTaken event in a 4-hunter game; ' +
    'event types seen: ' + [...new Set(events.map((e) => e.type))].join(', '),
  );
});

test('flagClaimed events fire when hunters traverse flag tiles', () => {
  // Balanced hunters that explore more slowly produce more flag interactions.
  const { events } = runGame({
    seed: 5, mode: 'normal',
    hunters: [
      makeHunter('h0', 0), makeHunter('h1', 1),
      makeHunter('h2', 2), makeHunter('h3', 3),
    ],
  }, 5000);
  assert.ok(
    events.some((e) => e.type === 'flagClaimed'),
    'expected at least one flagClaimed event; ' +
    'event types seen: ' + [...new Set(events.map((e) => e.type))].join(', '),
  );
});

// ---------------------------------------------------------------------------
// 13. Story Mode Simulation

test('story mission 1 (First Descent, fetch, level 1) runs to completion', () => {
  // The simplest story mission: fetch at level 1 with Normal opponents.
  // Running it with 4 fast all-AI hunters should terminate like a normal game.
  const mission = STORY_MISSIONS.find((m) => m.id === 1);
  assert.ok(mission, 'story mission id=1 must exist');
  const { state, steps } = runGame({
    seed: 42, mode: 'story', mission,
    hunters: [
      fastHunter('h0', 0), fastHunter('h1', 1),
      fastHunter('h2', 2), fastHunter('h3', 3),
    ],
  }, 5000);
  assert.equal(state.phase, 'mission.over',
    `story mission "${mission.title}" stuck in '${state.phase}' after ${steps} steps`);
  assert.ok(state._missionEnd, `_missionEnd not set after story mission completed`);
  assert.equal(typeof state._missionEnd.win, 'boolean',
    `_missionEnd.win should be boolean, got ${typeof state._missionEnd.win}`);
});

test('same seed produces identical final state (full-game determinism)', () => {
  const config = {
    seed: 88, mode: 'normal',
    hunters: [fastHunter('h0', 0), fastHunter('h1', 1)],
  };
  const r1 = runGame(config, 3000);
  const r2 = runGame(config, 3000);
  assert.equal(r1.steps, r2.steps,
    'same seed must take the same number of steps');
  assert.equal(r1.state.phase, r2.state.phase,
    'same seed must produce the same final phase');
  assert.deepEqual(r1.state._missionEnd, r2.state._missionEnd,
    'same seed must produce the same mission end result');
});
