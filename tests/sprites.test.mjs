import test from 'node:test';
import assert from 'node:assert/strict';
import { validateGrid, gridSize } from '../src/render/pixelart.js';
import {
  PALETTES, PALETTE_NAMES, HUNTERS, HUNTER_GRIDS, MONSTERS, TILES, UI,
  allSpriteEntries, stepFrame, faceIcon, chipGrid,
} from '../src/render/sprites.js';

test('eight palettes, each defining the full semantic key set', () => {
  assert.equal(PALETTE_NAMES.length, 8);
  for (const name of PALETTE_NAMES) {
    for (const k of ['O', 'S', 'H', 'P', 'Q', 'B', 'W', 'D']) {
      assert.match(PALETTES[name][k], /^#[0-9a-f]{6}$/i, `${name}.${k}`);
    }
  }
});

test('eight hunter designs, 16x16, two frames + 12x12 icon each', () => {
  assert.equal(HUNTERS.length, 8);
  for (const h of HUNTERS) {
    assert.deepEqual(gridSize(h.grids.idle), { w: 16, h: 16 });
    assert.deepEqual(gridSize(h.grids.step), { w: 16, h: 16 });
    assert.deepEqual(gridSize(h.icon), { w: 12, h: 12 });
    assert.notDeepEqual(h.grids.step, h.grids.idle, `hunter ${h.id} step differs`);
  }
  // Designs are genuinely distinct from each other
  for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) {
    assert.notDeepEqual(HUNTER_GRIDS[i], HUNTER_GRIDS[j]);
  }
});

test('four monsters with two frames; WYRM is 24x24', () => {
  assert.deepEqual(Object.keys(MONSTERS).sort(), ['FNG', 'OOZ', 'VAC', 'WYRM']);
  for (const [kind, m] of Object.entries(MONSTERS)) {
    const expected = kind === 'WYRM' ? 24 : 16;
    assert.deepEqual(gridSize(m.grids.idle), { w: expected, h: expected }, kind);
    assert.notDeepEqual(m.grids.step, m.grids.idle, `${kind} animates`);
  }
});

test('tile set complete: floors, pit, exit, boxes, 4 flags, overlays', () => {
  const names = Object.keys(TILES);
  for (const required of ['floorA', 'floorB', 'floorC', 'pit', 'exit',
    'boxClosed', 'boxOpen', 'flagRed', 'flagBlue', 'flagGreen', 'flagYellow',
    'cursor', 'rangeDot']) {
    assert.ok(names.includes(required), required);
    assert.deepEqual(gridSize(TILES[required].grid), { w: 16, h: 16 }, required);
  }
  // Flag variants share the grid but differ in palette
  assert.equal(TILES.flagRed.grid, TILES.flagBlue.grid);
  assert.notEqual(TILES.flagRed.palette.F, TILES.flagBlue.palette.F);
});

test('UI set: 4 card frames, 5 icons, chips 1-6, 4 statuses, marks', () => {
  assert.deepEqual(Object.keys(UI.cardFrames).sort(), ['blue', 'green', 'red', 'yellow']);
  for (const f of Object.values(UI.cardFrames)) {
    assert.deepEqual(gridSize(f.grid), { w: 14, h: 20 });
  }
  assert.deepEqual(Object.keys(UI.icons).sort(), ['attack', 'bag', 'flag', 'move', 'rest']);
  for (const i of Object.values(UI.icons)) assert.deepEqual(gridSize(i.grid), { w: 12, h: 12 });
  assert.deepEqual(Object.keys(UI.chips).map(Number).sort(), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(Object.keys(UI.status).sort(), ['empty', 'leg', 'panic', 'stun']);
});

test('chip pips match their number', () => {
  for (let n = 1; n <= 6; n++) {
    const pips = chipGrid(n).join('').split('').filter((c) => c === 'X').length;
    assert.equal(pips, n);
  }
});

test('every sprite/palette combination validates cleanly', () => {
  const entries = allSpriteEntries();
  assert.ok(entries.length >= 8 * 8 * 3 + 8 + 13 + 4 + 5 + 6 + 4 + 2, 'atlas coverage');
  const seen = new Set();
  for (const [name, grid, palette] of entries) {
    assert.ok(!seen.has(name), `duplicate atlas key ${name}`);
    seen.add(name);
    const errors = validateGrid(grid, palette);
    assert.deepEqual(errors, [], `${name}: ${errors[0] ?? ''}`);
  }
});

test('derived frames: stepFrame mirrors legs, faceIcon crops head', () => {
  const grid = HUNTER_GRIDS[0];
  const step = stepFrame(grid);
  assert.deepEqual(step.slice(0, 12), grid.slice(0, 12), 'torso unchanged');
  const icon = faceIcon(grid);
  assert.equal(icon[4], grid[4].slice(2, 14), 'icon row matches head crop');
});
