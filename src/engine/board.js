// Dungeon generation, tile model, pathfinding/reachability (DESIGN 2.2, 2.3, 3.4).
//
// Boards are 2x2 arrangements of hand-authored 10x10 sections (DESIGN 2.3.1).
// Section invariants (enforced by tests): solid perimeter except four seam
// openings at FIXED offsets (x=4 on N/S edges, y=4 on W/E edges); each opening
// is a leaf (its only in-section floor neighbor is the tile just inside); all
// floor tiles form a single connected component. Therefore ANY 2x2 pick
// stitches into one fully-connected 20x20 board — interior seam openings line
// up pairwise and exterior-facing openings seal safely. A flood-fill +
// corridor-carve pass still guards global connectivity as a backstop.

const SEC = 10;
const DIRS = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];
const TRAP_KINDS = ['damage', 'stun', 'leg', 'empty'];
const FLAG_COLORS = ['red', 'blue', 'green', 'yellow'];

const key = (x, y) => `${x},${y}`;

// '#' = wall/pit (impassable), '.' = floor. Rows are y=0..9, chars x=0..9.
export const SECTIONS = [
  [ // crossway — corridor cross with four pillared quadrants
    '####.#####',
    '#....#...#',
    '#.#..#.#.#',
    '#.#..#.#.#',
    '..........',
    '#.#..#.#.#',
    '#.#..#.#.#',
    '#....#...#',
    '#..#...#.#',
    '####.#####',
  ],
  [ // ring — perimeter corridor around an inner chamber with two doors
    '####.#####',
    '#........#',
    '#.##.###.#',
    '#.#....#.#',
    '..#....#..',
    '#.#....#.#',
    '#.#....#.#',
    '#.###.##.#',
    '#........#',
    '####.#####',
  ],
  [ // vault — broad hall with pillar rows and narrowed approaches
    '####.#####',
    '###....###',
    '#........#',
    '##.#..#.##',
    '..........',
    '##......##',
    '##.#..#.##',
    '#........#',
    '###....###',
    '####.#####',
  ],
  [ // comb — stacked corridors linked by offset spines
    '####.#####',
    '#........#',
    '###.####.#',
    '#........#',
    '..........',
    '#.####.###',
    '#........#',
    '##.#####.#',
    '#........#',
    '####.#####',
  ],
  [ // quads — four cell rooms with door chokepoints onto a cross
    '####.#####',
    '#..#.#...#',
    '#..#.#...#',
    '#.##.##..#',
    '..........',
    '#.##.##..#',
    '#..#.#...#',
    '#..#.#...#',
    '#..#.#...#',
    '####.#####',
  ],
  [ // serpent — S-curve corridors with side pockets
    '####.#####',
    '#........#',
    '#.######.#',
    '#......#.#',
    '..#.##.#..',
    '#.#......#',
    '#.######.#',
    '#........#',
    '#..#.#...#',
    '####.#####',
  ],
  [ // arena — large open chamber with scattered pillars
    '####.#####',
    '#........#',
    '#.#.#..#.#',
    '#........#',
    '....#.....',
    '#........#',
    '#.#.#.#..#',
    '#........#',
    '#........#',
    '####.#####',
  ],
  [ // split — two halls divided by a wall with a single door
    '####.#####',
    '#....#...#',
    '#.#..#.#.#',
    '#....#...#',
    '.....#....',
    '#....#...#',
    '#..#...#.#',
    '#....#...#',
    '#....#...#',
    '####.#####',
  ],
  [ // spiral — corridor winding inward to a small core
    '####.#####',
    '#........#',
    '#..#####.#',
    '#......#.#',
    '..####.#..',
    '#.###..#.#',
    '#.#....#.#',
    '#.##..##.#',
    '#........#',
    '####.#####',
  ],
  [ // warrens — twisty 1-tile passages and dead-end nooks
    '####.#####',
    '#..#.#...#',
    '#..#.#.#.#',
    '#.#...#..#',
    '....#.#...',
    '#.#..#.#.#',
    '#.#......#',
    '#.....#..#',
    '##.#...#.#',
    '####.#####',
  ],
  [ // gallery — vertical corridors flanking two chambers
    '####.#####',
    '##...#...#',
    '##.#.#.#.#',
    '##.#.#...#',
    '..........',
    '##.#.#...#',
    '##.#.#...#',
    '##.#.#...#',
    '##.#...#.#',
    '####.#####',
  ],
  [ // crossroads — central room, ring routes, corner pockets
    '####.#####',
    '#..#.#...#',
    '#.##.##.##',
    '#.#.....##',
    '..........',
    '#.#....#.#',
    '#.#.....##',
    '#.##.##.##',
    '#..#.#...#',
    '####.#####',
  ],
  [ // cloister — outer ring corridor with archway walls framing a central courtyard
    '####.#####',
    '#........#',
    '#.##.###.#',
    '#.#....#.#',
    '..#....#..',
    '#.#....#.#',
    '#.##.###.#',
    '#........#',
    '#........#',
    '####.#####',
  ],
  [ // ambush — two flanking rooms joined only through a narrow central lane
    '####.#####',
    '##.#.#.###',
    '#..#.#..##',
    '#..#.#..##',
    '..........',
    '#..#.#..##',
    '#..#.#..##',
    '##.#.#.###',
    '#.......##',
    '####.#####',
  ],
];

function inBounds(floor, x, y) {
  return y >= 0 && y < floor.length && x >= 0 && x < floor[0].length;
}

function components(floor) {
  const seen = new Set();
  const comps = [];
  for (let y = 0; y < floor.length; y++) for (let x = 0; x < floor[0].length; x++) {
    if (!floor[y][x] || seen.has(key(x, y))) continue;
    const comp = [];
    const stack = [{ x, y }];
    seen.add(key(x, y));
    while (stack.length) {
      const p = stack.pop();
      comp.push(p);
      for (const d of DIRS) {
        const nx = p.x + d.x, ny = p.y + d.y;
        if (!inBounds(floor, nx, ny) || !floor[ny][nx] || seen.has(key(nx, ny))) continue;
        seen.add(key(nx, ny));
        stack.push({ x: nx, y: ny });
      }
    }
    comps.push(comp);
  }
  return comps;
}

// Backstop: if floor is somehow split, carve L-shaped corridors between the
// closest tiles of the two largest components until one component remains.
function connectComponents(floor) {
  let comps = components(floor);
  while (comps.length > 1) {
    comps.sort((a, b) => b.length - a.length);
    let best = null;
    for (const a of comps[0]) for (const b of comps[1]) {
      const d = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      if (!best || d < best.d) best = { a, b, d };
    }
    let { x, y } = best.a;
    while (x !== best.b.x) { x += Math.sign(best.b.x - x); floor[y][x] = true; }
    while (y !== best.b.y) { y += Math.sign(best.b.y - y); floor[y][x] = true; }
    comps = components(floor);
  }
}

// Assemble a 20x20 floor grid from 4 section indices (TL, TR, BL, BR).
export function assembleFloor(sectionIdx) {
  const w = SEC * 2, h = SEC * 2;
  const floor = Array.from({ length: h }, () => Array(w).fill(false));
  sectionIdx.forEach((si, i) => {
    const sec = SECTIONS[si];
    const ox = (i % 2) * SEC, oy = (i >> 1) * SEC;
    for (let y = 0; y < SEC; y++) for (let x = 0; x < SEC; x++) {
      floor[oy + y][ox + x] = sec[y][x] === '.';
    }
  });
  // Seal seam openings facing the board exterior (authored as leaf tiles).
  for (let x = 0; x < w; x++) { floor[0][x] = false; floor[h - 1][x] = false; }
  for (let y = 0; y < h; y++) { floor[y][0] = false; floor[y][w - 1] = false; }
  connectComponents(floor);
  return floor;
}

// Build a mission board (DESIGN 3.1 board object): random exit, 8 item boxes
// (exactly one TARGET), 4 flags, floor(relicLevel*1.5) pre-seeded traps — all
// on distinct floor tiles, none on the exit. If rollItem(rng, relicLevel) is
// supplied, non-target boxes are filled; otherwise contents stay null for the
// game layer to assign.
export function generateBoard(rng, relicLevel, rollItem = null) {
  const idx = Array.from({ length: 4 }, () => rng.int(SECTIONS.length));
  const floor = assembleFloor(idx);
  const w = SEC * 2, h = SEC * 2;
  const tiles = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (floor[y][x]) tiles.push({ x, y });
  }
  rng.shuffle(tiles); // head of the shuffle = distinct placement tiles
  const exit = { x: tiles[0].x, y: tiles[0].y };
  const targetIdx = rng.int(8);
  const boxes = tiles.slice(1, 9).map((t, i) => ({
    x: t.x, y: t.y, opened: false,
    contents: i === targetIdx ? 'TARGET' : rollItem ? rollItem(rng, relicLevel) : null,
  }));
  const flags = tiles.slice(9, 13).map((t, i) => ({
    x: t.x, y: t.y, color: FLAG_COLORS[i], taken: false,
  }));
  const traps = tiles.slice(13, 13 + Math.floor(relicLevel * 1.5)).map((t) => ({
    x: t.x, y: t.y, kind: rng.pick(TRAP_KINDS), byHunter: null,
  }));
  return { w, h, floor, exit, boxes, flags, traps };
}

// Orthogonally adjacent floor tiles (DESIGN 2.3.1: orthogonal-only movement).
export function neighbors(board, pos) {
  const out = [];
  for (const d of DIRS) {
    const x = pos.x + d.x, y = pos.y + d.y;
    if (x >= 0 && y >= 0 && x < board.w && y < board.h && board.floor[y][x]) out.push({ x, y });
  }
  return out;
}

// Set of "x,y" keys for every positioned unit (one unit per tile, DESIGN 2.3.2).
export function occupiedSet(state) {
  const occ = new Set();
  for (const u of [...(state.hunters || []), ...(state.monsters || [])]) {
    if (u.pos) occ.add(key(u.pos.x, u.pos.y));
  }
  return occ;
}

// Accept either a prebuilt Set of "x,y" keys or a GameState (DESIGN 3.4 form).
function asOccupied(occ) {
  if (occ instanceof Set) return occ;
  if (occ && (occ.hunters || occ.monsters)) return occupiedSet(occ);
  return new Set();
}

// BFS step count from `from` to `to`; occupied tiles block (no pass-through),
// but `from` and `to` themselves are exempt so distances to/from units work.
// Returns Infinity when unreachable.
export function pathDistance(board, occupied, from, to) {
  const occ = asOccupied(occupied);
  const goal = key(to.x, to.y);
  if (key(from.x, from.y) === goal) return 0;
  const seen = new Set([key(from.x, from.y)]);
  let frontier = [from];
  for (let dist = 1; frontier.length; dist++) {
    const next = [];
    for (const p of frontier) for (const n of neighbors(board, p)) {
      const k = key(n.x, n.y);
      if (seen.has(k)) continue;
      if (k === goal) return dist;
      if (occ.has(k)) continue;
      seen.add(k);
      next.push(n);
    }
    frontier = next;
  }
  return Infinity;
}

// Tiles a unit at `from` could end a move of `range` steps on (movement range
// display). Occupied tiles block. Includes `from` itself when an out-and-back
// exists (DESIGN 2.5: backtracking allowed, minimum 1 step). Returns a Set of
// "x,y" keys.
export function reachableTiles(board, occupied, from, range) {
  const occ = asOccupied(occupied);
  const out = new Set();
  const seen = new Set([key(from.x, from.y)]);
  let frontier = [from];
  for (let d = 1; d <= range && frontier.length; d++) {
    const next = [];
    for (const p of frontier) for (const n of neighbors(board, p)) {
      const k = key(n.x, n.y);
      if (seen.has(k) || occ.has(k)) continue;
      seen.add(k);
      out.add(k);
      next.push(n);
    }
    frontier = next;
  }
  if (range >= 2 && neighbors(board, from).some((n) => !occ.has(key(n.x, n.y)))) {
    out.add(key(from.x, from.y));
  }
  return out;
}

// Uniform random unoccupied floor tile, excluding the EXIT (warp destinations
// and monster spawns must never land there — monsters can't enter it at all).
export function randomFreeTile(state, rng) {
  const { board } = state;
  const occ = occupiedSet(state);
  const free = [];
  for (let y = 0; y < board.h; y++) for (let x = 0; x < board.w; x++) {
    if (!board.floor[y][x]) continue;
    if (x === board.exit.x && y === board.exit.y) continue;
    if (occ.has(key(x, y))) continue;
    free.push({ x, y });
  }
  return rng.pick(free);
}
