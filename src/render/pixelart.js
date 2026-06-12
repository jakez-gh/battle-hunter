// Bakes string-grid sprite definitions into offscreen canvases.
//
// A sprite is defined as an array of equal-length strings; each character
// indexes into a palette map. '.' (or space) is transparent. Example:
//   bake(['.RR.', 'RRRR', '.RR.'], { R: '#d04030' })
//
// Grids + palettes are plain data (testable in Node); only bake() touches
// canvas, so keep everything else importable engine-side.

export function gridSize(grid) {
  return { w: grid[0].length, h: grid.length };
}

export function validateGrid(grid, palette) {
  const w = grid[0].length;
  const bad = [];
  for (let y = 0; y < grid.length; y++) {
    if (grid[y].length !== w) bad.push(`row ${y} length ${grid[y].length} != ${w}`);
    for (const ch of grid[y]) {
      if (ch !== '.' && ch !== ' ' && !(ch in palette)) bad.push(`unknown palette key '${ch}' in row ${y}`);
    }
  }
  return bad;
}

export function bake(grid, palette, scale = 1) {
  const { w, h } = gridSize(grid);
  const canvas = document.createElement('canvas');
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext('2d');
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = grid[y][x];
      if (ch === '.' || ch === ' ') continue;
      ctx.fillStyle = palette[ch];
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }
  return canvas;
}

// Horizontal mirror, for facing-direction variants without authoring twice.
export function flipGrid(grid) {
  return grid.map((row) => [...row].reverse().join(''));
}

// Recolor: returns a new palette with substitutions applied (e.g. team colors).
export function recolor(palette, subs) {
  return { ...palette, ...subs };
}

// Bake a set: { name: { grid, palette } } -> { name: canvas }
export function bakeAll(defs, scale = 1) {
  const out = {};
  for (const [name, def] of Object.entries(defs)) {
    out[name] = bake(def.grid, def.palette, scale);
  }
  return out;
}
