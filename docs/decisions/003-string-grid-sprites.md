# ADR-003: String-grid pixel art, no external assets

- **Status:** Accepted
- **Date:** 2026-06-11
- **Level:** architecture

## Question

How should sprite art be stored and rendered, given the IP constraint that all
assets must be original?

## Options considered

1. **PNG spritesheets** — standard approach. Requires external art tools; easy to
   accidentally include copyrighted assets; can't validate palette programmatically.

2. **String grids + palette maps** — each sprite is a JS array of strings where
   each character maps to a hex colour. Rasterised at startup via `bake()`.

3. **SVG or canvas-drawn procedural art** — flexible but complex; hard to author
   pixel-by-pixel.

## Decision

Option 2 — string grids + palette maps in `src/render/sprites.js`.

## Why

- **IP-safe by construction** — there are no binary art files to accidentally
  replace with ripped assets. Everything is hand-typed in source.
- **Testable** — `validateGrid(grid, palette)` catches palette key typos at
  test time (`tests/sprites.test.mjs`).
- **Version-controllable** — plain text diffs; easy to review sprite changes in PRs.
- **Palette reuse** — `recolor(palette, overrides)` generates flag/colour variants
  without duplicating grid data.
- **No toolchain** — no Aseprite, ImageMagick, or sprite-packer needed.

## Consequences

- Sprites are authored as 16×16 (or smaller) character grids. Larger art must
  be composed from multiple tiles.
- `buildAtlas(scale)` rasterises everything at startup — adds ~5 ms to first frame
  but all sprites are pre-baked for the session.
- Character grid approach limits per-sprite colour depth (one char per colour).
  This is intentional: palette discipline is part of the visual style.
- Adding a sprite: define grid + palette, add to the relevant export object in
  `sprites.js`, run `node --test`. The validation test catches errors.
