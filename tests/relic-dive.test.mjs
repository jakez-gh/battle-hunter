import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dateToSeed, hashRunSeed, buildShareString,
  freshRelicDiveBest, loadRelicDiveBest, saveRelicDiveBest, todayDateKey,
  storageArea,
} from '../src/save.js';

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
