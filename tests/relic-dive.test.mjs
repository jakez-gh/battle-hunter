import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dateToSeed, hashRunSeed, buildShareString,
  freshRelicDiveBest, loadRelicDiveBest, saveRelicDiveBest, todayDateKey,
  storageArea,
} from '../src/save.js';
import { createGame, legalActions, applyAction } from '../src/engine/game.js';
import { chooseAction } from '../src/engine/ai.js';

// Simulate a full game (all-AI) up to mission.over or maxSteps.
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

// A fast AI hunter suitable for engine simulation
function fastHunter(id, slot) {
  return { id, slot, name: id, spriteId: 0, palette: 'cobalt', human: false, archetype: null,
    level: 1, internal: { mv: 9, at: 3, df: 2, hp: 3 }, maxHp: 16, items: [] };
}

// dateToSeed -----------------------------------------------------------------

test('dateToSeed: same date → same seed', () => {
  assert.equal(dateToSeed('2026-06-24'), dateToSeed('2026-06-24'));
});

test('dateToSeed: different dates → different seeds', () => {
  assert.notEqual(dateToSeed('2026-06-24'), dateToSeed('2026-06-25'));
  assert.notEqual(dateToSeed('2026-01-01'), dateToSeed('2026-12-31'));
});

test('dateToSeed: returns nonzero uint32', () => {
  const s = dateToSeed('2026-06-24');
  assert.ok(s > 0 && s <= 0xffffffff, `seed ${s} out of uint32 range`);
  assert.equal(s, s >>> 0, 'must be an integer (uint32)');
});

// hashRunSeed ----------------------------------------------------------------

test('hashRunSeed: same rootSeed + depth → same result', () => {
  assert.equal(hashRunSeed(12345, 1), hashRunSeed(12345, 1));
});

test('hashRunSeed: different depths → different seeds', () => {
  const root = 99999;
  assert.notEqual(hashRunSeed(root, 1), hashRunSeed(root, 2));
  assert.notEqual(hashRunSeed(root, 2), hashRunSeed(root, 3));
  assert.notEqual(hashRunSeed(root, 1), hashRunSeed(root, 10));
});

test('hashRunSeed: different rootSeeds → different results (same depth)', () => {
  assert.notEqual(hashRunSeed(1, 1), hashRunSeed(2, 1));
});

test('hashRunSeed: returns nonzero uint32', () => {
  for (const [root, depth] of [[0, 1], [1, 0], [0xffffffff, 15], [42, 7]]) {
    const s = hashRunSeed(root, depth);
    assert.ok(s > 0 && s <= 0xffffffff, `seed ${s} out of range for root=${root} depth=${depth}`);
  }
});

// buildShareString -----------------------------------------------------------

test('buildShareString: daily hunt format', () => {
  const result = buildShareString({
    daily: true,
    dateKey: '2026-06-24',
    startLevel: 5,
    depthResults: [{ won: true, score: 120 }, { won: true, score: 95 }, { won: false, score: 30 }],
  });
  assert.ok(result.includes('Daily Hunt 2026-06-24'), 'header missing');
  assert.ok(result.includes('🟩🟩🟥'), 'depth row missing');
  assert.ok(result.includes('Depth 3'), 'depth count missing');
  assert.ok(result.includes('Score 245'), 'total score missing');
  assert.ok(result.includes('L5'), 'start level missing');
});

test('buildShareString: normal dive format', () => {
  const result = buildShareString({
    daily: false,
    startLevel: 1,
    depthResults: [{ won: true, score: 80 }, { won: false, score: 10 }],
  });
  assert.ok(result.includes('Relic Dive'), 'header missing');
  assert.ok(result.includes('🟩🟥'), 'depth row missing');
  assert.ok(result.includes('Score 90'), 'total score wrong');
});

test('buildShareString: banked out all green', () => {
  const result = buildShareString({
    daily: false,
    startLevel: 3,
    depthResults: [
      { won: true, score: 100 },
      { won: true, score: 110 },
      { won: true, score: 120 },
    ],
  });
  assert.ok(result.includes('🟩🟩🟩'));
  assert.ok(result.includes('Score 330'));
});

test('buildShareString: finalScore overrides raw total (modifier run)', () => {
  const result = buildShareString({
    daily: false,
    startLevel: 3,
    depthResults: [{ won: true, score: 100 }, { won: true, score: 100 }],
    finalScore: 300, // 2× modifier applied externally
  });
  assert.ok(result.includes('Score 300'), `expected Score 300 in: ${result}`);
  assert.ok(!result.includes('Score 200'), 'should not show raw score when finalScore provided');
});

// Persistence ----------------------------------------------------------------

test('freshRelicDiveBest: returns default shape', () => {
  const r = freshRelicDiveBest();
  assert.equal(r.best, null);
  assert.equal(r.daily, null);
  assert.equal(r.streak, 0);
});

test('loadRelicDiveBest: returns fresh if nothing saved', () => {
  // Clear whatever might be in the in-memory store for this key
  storageArea().removeItem('battle-hunter-relic-dive-v1');
  const r = loadRelicDiveBest();
  assert.deepEqual(r, freshRelicDiveBest());
});

test('saveRelicDiveBest + loadRelicDiveBest: round-trips', () => {
  storageArea().removeItem('battle-hunter-relic-dive-v1');
  const record = {
    best: { score: 500, depths: 5, shareStr: '🟩🟩🟩🟩🟩\nScore 500' },
    daily: { dateKey: '2026-06-24', score: 300, depths: 3, shareStr: '🟩🟩🟩\nScore 300' },
    streak: 3,
  };
  saveRelicDiveBest(record);
  const loaded = loadRelicDiveBest();
  assert.deepEqual(loaded, record);
});

test('loadRelicDiveBest: tolerates corrupt JSON', () => {
  storageArea().setItem('battle-hunter-relic-dive-v1', '{bad json}');
  const r = loadRelicDiveBest();
  assert.deepEqual(r, freshRelicDiveBest());
});

// todayDateKey ---------------------------------------------------------------

test('todayDateKey: returns YYYY-MM-DD format', () => {
  const key = todayDateKey();
  assert.match(key, /^\d{4}-\d{2}-\d{2}$/);
});

test('todayDateKey: produces a valid seed via dateToSeed', () => {
  const seed = dateToSeed(todayDateKey());
  assert.ok(seed > 0);
});

// ---------------------------------------------------------------------------
// Depth-chain (1B) — engine integration
// ---------------------------------------------------------------------------

test('depth-chain: 5 sequential depths from same rootSeed all get unique seeds', () => {
  const rootSeed = dateToSeed('2026-06-24');
  const seeds = [1, 2, 3, 4, 5].map((d) => hashRunSeed(rootSeed, d));
  assert.equal(new Set(seeds).size, seeds.length, 'each depth must produce a unique seed');
});

test('depth-chain: depth seeds differ from rootSeed', () => {
  const rootSeed = 0xdeadbeef;
  assert.notEqual(hashRunSeed(rootSeed, 1), rootSeed);
  assert.notEqual(hashRunSeed(rootSeed, 2), rootSeed);
});

test('depth-chain replay: same rootSeed + depth → identical event sequence', () => {
  const rootSeed = 99;
  const makeConfig = (depth) => ({
    seed: hashRunSeed(rootSeed, depth),
    mode: 'relic-dive',
    mission: { id: `d${depth}`, title: `D${depth}`, type: 'fetch', level: depth,
               targetItemId: null, carrierIndex: null, opponents: [] },
    hunters: [fastHunter('h0', 0), fastHunter('h1', 1)],
  });

  const r1a = runGame(makeConfig(1), 4000);
  const r1b = runGame(makeConfig(1), 4000);
  assert.equal(r1a.steps, r1b.steps, 'depth 1 step count must match');
  assert.deepEqual(r1a.events.map((e) => e.type), r1b.events.map((e) => e.type),
    'depth 1 event types must match');

  const r2a = runGame(makeConfig(2), 4000);
  const r2b = runGame(makeConfig(2), 4000);
  assert.equal(r2a.steps, r2b.steps, 'depth 2 step count must match');
  assert.deepEqual(r2a.events.map((e) => e.type), r2b.events.map((e) => e.type),
    'depth 2 event types must match');
});

test('depth-chain: depth 1 and depth 2 produce different event sequences', () => {
  const rootSeed = 99;
  const r1 = runGame({
    seed: hashRunSeed(rootSeed, 1), mode: 'relic-dive',
    mission: { id: 'd1', type: 'fetch', level: 1, targetItemId: null, carrierIndex: null, opponents: [] },
    hunters: [fastHunter('h0', 0), fastHunter('h1', 1)],
  }, 4000);
  const r2 = runGame({
    seed: hashRunSeed(rootSeed, 2), mode: 'relic-dive',
    mission: { id: 'd2', type: 'fetch', level: 2, targetItemId: null, carrierIndex: null, opponents: [] },
    hunters: [fastHunter('h0', 0), fastHunter('h1', 1)],
  }, 4000);
  // Different seeds → different event sequences (both terminate; verify they differ)
  const eq = r1.events.length === r2.events.length &&
    r1.events.every((e, i) => e.type === r2.events[i].type);
  assert.ok(!eq, 'depth 1 and depth 2 must produce different event sequences');
});
