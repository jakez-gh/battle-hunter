// Regression guard for click-to-move (tap an "available" square -> walk the whole
// way there). Before the fix, the game screen's onClick took a SINGLE step in the
// dominant axis toward a tapped tile; now board.movePath returns the full shortest
// legal path (list of step dirs) within the move range, which the UI walks one step
// per tick. These tests pin the pure pathing helper that the fix relies on.

import test from 'node:test';
import assert from 'node:assert/strict';
import { movePath } from '../src/engine/board.js';

const openBoard = (w, h) => ({ w, h, floor: Array.from({ length: h }, () => Array.from({ length: w }, () => true)) });
const DELTA = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
function walk(from, path) { let { x, y } = from; for (const d of path) { x += DELTA[d][0]; y += DELTA[d][1]; } return { x, y }; }

test('movePath walks the FULL way to a reachable tile (not just one step)', () => {
  const path = movePath(openBoard(6, 6), new Set(), { x: 0, y: 0 }, { x: 3, y: 0 }, 5);
  assert.ok(Array.isArray(path), 'returns a path array');
  assert.equal(path.length, 3, 'three steps to reach a tile 3 away — the old code moved only 1');
  assert.deepEqual(path, ['E', 'E', 'E']);
});

test('movePath length equals Manhattan distance on open ground', () => {
  const path = movePath(openBoard(8, 8), new Set(), { x: 1, y: 1 }, { x: 4, y: 3 }, 10);
  assert.equal(path.length, 5);
  assert.deepEqual(walk({ x: 1, y: 1 }, path), { x: 4, y: 3 });
});

test('movePath returns null when the tile is outside the move range', () => {
  assert.equal(movePath(openBoard(6, 6), new Set(), { x: 0, y: 0 }, { x: 5, y: 0 }, 3), null);
});

test('movePath returns [] for the unit\'s own tile', () => {
  assert.deepEqual(movePath(openBoard(4, 4), new Set(), { x: 2, y: 2 }, { x: 2, y: 2 }, 5), []);
});

test('movePath never ends on / passes through an occupied tile', () => {
  // single row with an occupant between: no detour exists -> unreachable
  assert.equal(movePath(openBoard(5, 1), new Set(['2,0']), { x: 0, y: 0 }, { x: 4, y: 0 }, 10), null);
});

test('movePath routes around an obstacle when a detour fits in range', () => {
  const occ = new Set(['1,0']); // blocks the direct east step
  const path = movePath(openBoard(3, 3), occ, { x: 0, y: 0 }, { x: 2, y: 0 }, 6);
  assert.ok(path, 'a detour path exists');
  assert.equal(path.length, 4, 'down, across, up — 4 steps');
  let { x, y } = { x: 0, y: 0 };
  for (const d of path) { x += DELTA[d][0]; y += DELTA[d][1]; assert.ok(!occ.has(`${x},${y}`), 'never enters the occupant'); }
  assert.deepEqual({ x, y }, { x: 2, y: 0 }, 'ends on the target');
});

test('movePath rejects a target that is not floor', () => {
  const b = openBoard(4, 4);
  b.floor[0][2] = false; // pit
  assert.equal(movePath(b, new Set(), { x: 0, y: 0 }, { x: 2, y: 0 }, 8), null);
});
