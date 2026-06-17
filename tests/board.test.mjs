import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../src/engine/rng.js';
import {
  SECTIONS, assembleFloor, generateBoard, neighbors,
  pathDistance, reachableTiles, randomFreeTile, occupiedSet,
} from '../src/engine/board.js';

const key = (x, y) => `${x},${y}`;

function floodCount(floor, start) {
  const seen = new Set([key(start.x, start.y)]);
  const stack = [start];
  while (stack.length) {
    const { x, y } = stack.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (ny < 0 || ny >= floor.length || nx < 0 || nx >= floor[0].length) continue;
      if (!floor[ny][nx] || seen.has(key(nx, ny))) continue;
      seen.add(key(nx, ny));
      stack.push({ x: nx, y: ny });
    }
  }
  return seen.size;
}

function floorTiles(floor) {
  const out = [];
  for (let y = 0; y < floor.length; y++) for (let x = 0; x < floor[0].length; x++) {
    if (floor[y][x]) out.push({ x, y });
  }
  return out;
}

test('sections: rectangular 10x10, only # and ., seam openings at fixed offsets', () => {
  for (const [i, sec] of SECTIONS.entries()) {
    assert.equal(sec.length, 10, `section ${i} height`);
    for (const row of sec) {
      assert.equal(row.length, 10, `section ${i} row width`);
      assert.match(row, /^[#.]+$/, `section ${i} characters`);
    }
    assert.equal(sec[0][4], '.', `section ${i} N seam at x=4`);
    assert.equal(sec[9][4], '.', `section ${i} S seam at x=4`);
    assert.equal(sec[4][0], '.', `section ${i} W seam at y=4`);
    assert.equal(sec[4][9], '.', `section ${i} E seam at y=4`);
  }
});

test('sections: each is a single connected component', () => {
  for (const [i, sec] of SECTIONS.entries()) {
    const floor = sec.map((row) => [...row].map((c) => c === '.'));
    const tiles = floorTiles(floor);
    assert.ok(tiles.length > 20, `section ${i} has substance`);
    assert.equal(floodCount(floor, tiles[0]), tiles.length, `section ${i} connected`);
  }
});

test('assembleFloor: every 2x2 combination of sections is fully connected', () => {
  const n = SECTIONS.length;
  // All same-section fills plus a deterministic spread of mixed picks.
  const combos = [];
  for (let i = 0; i < n; i++) combos.push([i, i, i, i]);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    combos.push([i, j, (i + j) % n, (i * 3 + j * 7) % n]);
  }
  for (const idx of combos) {
    const floor = assembleFloor(idx);
    const tiles = floorTiles(floor);
    assert.equal(floodCount(floor, tiles[0]), tiles.length, `combo ${idx} connected`);
    // Sealed border
    for (let x = 0; x < 20; x++) assert.ok(!floor[0][x] && !floor[19][x]);
    for (let y = 0; y < 20; y++) assert.ok(!floor[y][0] && !floor[y][19]);
  }
});

test('generateBoard: placement counts, disjointness, exit kept clear', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const relicLevel = ((seed - 1) % 15) + 1;
    const board = generateBoard(makeRng(seed), relicLevel, () => 'scrap');
    assert.equal(board.w, 20);
    assert.equal(board.h, 20);
    assert.equal(board.boxes.length, 8);
    assert.equal(board.boxes.filter((b) => b.contents === 'TARGET').length, 1);
    assert.equal(board.flags.length, 4);
    assert.deepEqual([...board.flags.map((f) => f.color)].sort(),
      ['blue', 'green', 'red', 'yellow']);
    assert.equal(board.traps.length, Math.floor(relicLevel * 1.5));
    const spots = [board.exit, ...board.boxes, ...board.flags, ...board.traps];
    const keys = spots.map((p) => key(p.x, p.y));
    assert.equal(new Set(keys).size, keys.length, 'all placements distinct');
    for (const p of spots) assert.ok(board.floor[p.y][p.x], 'placements on floor');
  }
});

test('generateBoard: deterministic per seed', () => {
  const a = generateBoard(makeRng(42), 7, () => 'scrap');
  const b = generateBoard(makeRng(42), 7, () => 'scrap');
  assert.deepEqual(a, b);
});

test('generateBoard: null contents without rollItem', () => {
  const board = generateBoard(makeRng(5), 3);
  const ordinary = board.boxes.filter((b) => b.contents !== 'TARGET');
  assert.ok(ordinary.every((b) => b.contents === null));
});

// 5x5 fixture: corridor ring with a wall; '.' floor, '#' wall.
const FIX = [
  '.....',
  '.###.',
  '.#...',
  '.#.#.',
  '.....',
].map((row) => [...row].map((c) => c === '.'));
const fixBoard = { w: 5, h: 5, floor: FIX };

test('neighbors: orthogonal floor only', () => {
  assert.deepEqual(neighbors(fixBoard, { x: 0, y: 0 }),
    [{ x: 1, y: 0 }, { x: 0, y: 1 }]);
});

test('pathDistance: BFS over floor honoring occupancy', () => {
  assert.equal(pathDistance(fixBoard, new Set(), { x: 0, y: 0 }, { x: 4, y: 0 }), 4);
  // Around the wall to the pocket at (2,2): 0,0 -> 0,4 -> 2,4 -> 2,2 = 8 steps
  assert.equal(pathDistance(fixBoard, new Set(), { x: 0, y: 0 }, { x: 2, y: 2 }), 8);
  // Blocking the only approach makes it unreachable (corner 4,0 reachable two ways)
  const occ = new Set([key(1, 0), key(0, 1)]);
  assert.equal(pathDistance(fixBoard, occ, { x: 0, y: 0 }, { x: 4, y: 4 }), Infinity);
  // Destination itself may be occupied (distance to a unit)
  const occDest = new Set([key(4, 0)]);
  assert.equal(pathDistance(fixBoard, occDest, { x: 0, y: 0 }, { x: 4, y: 0 }), 4);
  assert.equal(pathDistance(fixBoard, new Set(), { x: 2, y: 2 }, { x: 2, y: 2 }), 0);
});

test('reachableTiles: range-limited, blocked by occupants, out-and-back home tile', () => {
  const r1 = reachableTiles(fixBoard, new Set(), { x: 0, y: 0 }, 1);
  assert.deepEqual([...r1].sort(), [key(0, 1), key(1, 0)].sort());
  assert.ok(!r1.has(key(0, 0)), 'range 1 cannot return home');
  const r2 = reachableTiles(fixBoard, new Set(), { x: 0, y: 0 }, 2);
  assert.ok(r2.has(key(0, 0)), 'range 2 allows out-and-back');
  assert.ok(r2.has(key(2, 0)) && r2.has(key(0, 2)));
  const blocked = reachableTiles(fixBoard, new Set([key(1, 0)]), { x: 0, y: 0 }, 2);
  assert.ok(!blocked.has(key(2, 0)), 'occupant blocks the path through');
  const penned = reachableTiles(fixBoard,
    new Set([key(1, 0), key(0, 1)]), { x: 0, y: 0 }, 3);
  assert.equal(penned.size, 0, 'fully penned in: no legal move');
});

test('randomFreeTile: on floor, never exit, never occupied', () => {
  const board = generateBoard(makeRng(9), 5, () => 'scrap');
  const state = {
    board,
    hunters: [{ pos: { x: board.boxes[0].x, y: board.boxes[0].y } }],
    monsters: [],
  };
  const rng = makeRng(123);
  for (let i = 0; i < 200; i++) {
    const t = randomFreeTile(state, rng);
    assert.ok(board.floor[t.y][t.x]);
    assert.ok(!(t.x === board.exit.x && t.y === board.exit.y));
    assert.ok(!(t.x === state.hunters[0].pos.x && t.y === state.hunters[0].pos.y));
  }
});

test('occupiedSet includes all units with a pos, excludes units without a pos', () => {
  // board.js occupiedSet is a navigation blocker: includes ALL positioned units
  // (dead or alive) so pathfinding treats them as impassable. The ai.js copy
  // separately excludes dead units — this function does not.
  const state = {
    hunters: [
      { pos: { x: 1, y: 1 }, hp: 10 },  // alive with pos → included
      { pos: { x: 2, y: 2 }, hp: 0 },   // dead with pos → included (blocks nav)
      { pos: null, hp: 5 },              // no pos → excluded
    ],
    monsters: [
      { pos: { x: 3, y: 3 }, hp: 5 },   // alive → included
      { pos: { x: 4, y: 4 }, hp: 0 },   // dead with pos → included
    ],
  };
  const s = occupiedSet(state);
  assert.ok(s.has('1,1'), 'alive hunter included');
  assert.ok(s.has('2,2'), 'dead hunter still blocks navigation');
  assert.ok(!s.has('null,null'), 'no-pos unit excluded');
  assert.ok(s.has('3,3'), 'alive monster included');
  assert.ok(s.has('4,4'), 'dead monster still blocks navigation');
  assert.equal(s.size, 4);
});
