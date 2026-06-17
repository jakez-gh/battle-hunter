# Battle Hunter — Agent Guide

This file is for Claude agents: onboarding, architecture, conventions, and where
to find the active work plan. Read it first, then check `WORK.md` for current tasks.

---

## Quick start

```bash
# Run all tests (233 as of 2026-06-17 — all green before committing)
node --test

# Serve the game locally
node tools/serve.mjs     # → http://localhost:8377
```

No build step. Pure ES modules + Canvas 2D + WebAudio.

---

## Repository layout

```
index.html / style.css / src/main.js   entry point + rAF loop
src/engine/                            pure game logic — no DOM, testable in Node
src/render/                            Canvas renderer + pixel-art sprite data
src/audio/                             WebAudio-synthesized music + SFX
src/ui/                                screen flow + input handling
tests/                                 Node test suite (node --test)
tools/                                 dev helpers: static server, smoke tests
DESIGN.md                              mechanics spec (source of truth for rules)
WORK.md                                active task board — pick up work here
```

### Engine file ownership

| File | Responsibility |
|---|---|
| `src/engine/rng.js` | Seeded PRNG; all randomness flows through this |
| `src/engine/cards.js` | 100-card deck, card catalog, hand ops |
| `src/engine/board.js` | Dungeon generation, tile model, BFS pathfinding |
| `src/engine/combat.js` | Battle resolution (pure, no side effects) |
| `src/engine/game.js` | GameState machine: `createGame / legalActions / applyAction` |
| `src/engine/ai.js` | CPU decision-making; 16 archetypes + RAVEN panic cycle |
| `src/engine/missions.js` | 15 story missions, Normal mode, rewards, progression |

### Render/UI file ownership

| File | Responsibility |
|---|---|
| `src/render/pixelart.js` | `bake(grid, palette, scale)` → offscreen canvas |
| `src/render/sprites.js` | **All pixel-art data** (string grids + palettes). No DOM. |
| `src/render/renderer.js` | Draws GameState; animates event queue; pure presentation |
| `src/ui/screens.js` | All game screens (Title → Hub → Game → Results) |
| `src/ui/input.js` | Key/mouse → semantic actions |
| `src/save.js` | localStorage persistence |
| `src/audio/synth.js` | WebAudio primitives |
| `src/audio/music.js` | Original tunes as note data |
| `src/audio/sfx.js` | Sound effects |

**Hard rule:** Engine files (`src/engine/`) never import from render/audio/ui.

---

## Sprite system

Sprites are defined in `src/render/sprites.js` as string grids + palette maps:

```js
// Each character in the grid maps to a hex color; '.' = transparent
const MY_TILE = [
  'GGGGGGGGGGGGGGGG',   // row 0
  'GgGGGGGGGGGGGGgG',  // row 1 — 'g' is a darker shade
  // ... 16 rows total for a 16×16 tile
];
const MY_PALETTE = { G: '#5a5f6e', g: '#4c5160' };

// Register it:
export const TILES = { ..., myTile: { grid: MY_TILE, palette: MY_PALETTE } };
```

`allSpriteEntries()` in `sprites.js` auto-generates the full atlas list. Adding
an entry to `TILES` (or the other exports) is enough for it to appear in the atlas.

### Tile palette keys (TILE_PALETTE)

| Key | Hex | Use |
|---|---|---|
| `G` | #5a5f6e | Main floor grey |
| `g` | #4c5160 | Darker floor grey |
| `d` | #3e4350 | Darkest floor (accent) |
| `X` | #191b24 | Near-black (wall mortar, void) |
| `O` | #101018 | Outline black |
| `E` | #7ee8a0 | Exit green (bright) |
| `e` | #2e6e48 | Exit green (dark) |
| `B` | #8a6a3a | Box brown (light) |
| `b` | #5e4828 | Box brown (dark) |
| `F` | #cc3333 | Flag (recolored per variant) |
| `Y` | #e8d87e | Gold highlight |
| `W` | #f0f4ff | Near-white |

### Adding a new tile: checklist

1. Define the grid constant (all rows must be the same length)
2. Validate with `validateGrid(grid, palette)` from `pixelart.js` — it returns errors
3. Add entry to `TILES` in `sprites.js`
4. Use it in `renderer.js` via `blitTile('tile.myTile', x, y)`
5. Run `node --test` — the sprite validation test will catch any bad palette keys

---

## Game loop architecture

```
createGame(config)
  → GameState (immutable-style, pure data)

legalActions(state)
  → Action[]  (what the current unit can do)

applyAction(state, action)
  → { state: GameState, events: Event[] }
    events = ordered render/audio facts (dieRolled, stepped, battleStarted, ...)
    engine never waits for animation — renderer replays events visually
```

The renderer (`createRenderer`) receives the new state via `setState()` and events
via `pushEvents()`. It animates the event queue against `EVENT_DURATIONS` in
`renderer.js`. Call `skip()` to fast-forward all pending animation.

---

## Testing conventions

- `node --test` runs all `.test.mjs` files in `tests/`
- Tests are pure: no DOM, no file I/O, only engine + sprite data
- The sprites test (`tests/sprites.test.mjs`) validates every grid/palette pair —
  it will catch typos in new tile data
- All tests must pass before committing — 233 is the current baseline

---

## Commit conventions

- Small, focused commits (one logical change)
- Reference the relevant DESIGN.md section in the message when fixing mechanics
- After landing a feature, update `WORK.md` to mark it done

---

## Multi-session collaboration

If you are a new agent picking up work:
1. Read `WORK.md` → find the top `IN_PROGRESS` or `PENDING` item
2. Read this file (you're doing that now) for architecture context
3. Check `git log --oneline -10` for recent activity
4. Run `node --test` to confirm baseline is green before touching code

If multiple agent sessions may be running simultaneously:
- Prefer working on **different files** to avoid merge conflicts
- The engine (`src/engine/`) and render (`src/render/`) directories are independent
  work surfaces — engine changes don't touch render, and vice versa
- Mark your task `IN_PROGRESS` in `WORK.md` immediately (commit the change) so
  other agents know it's claimed

---

## Key design decisions (don't re-litigate)

- **No build step** — serves as static files; ES modules in the browser directly
- **Deterministic engine** — same seed + same actions always replays identically;
  all randomness goes through `makeRng(seed)` stored in state
- **All assets original** — no ripped art/music; sprites are hand-authored string
  grids; music is synthesized from note data; see `README.md`
- **DESIGN.md is the spec** — when engine behavior is unclear, DESIGN.md wins
