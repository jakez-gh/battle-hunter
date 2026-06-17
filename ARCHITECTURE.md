# Battle Hunter — Architecture

Living document. Update when design decisions change. See `docs/decisions/` for
the reasoning behind key choices.

---

## System overview

Pure browser stack: HTML5 Canvas 2D + WebAudio + ES modules. No build step, no
framework, no dependencies. Serves directly from the filesystem or any static host.

```
index.html          entry; sizes #game canvas to largest 4:3 rect that fits viewport
src/main.js         rAF loop: reads input → applyAction → pushEvents → renderFrame
src/engine/         pure game logic (no DOM); fully testable in Node
src/render/         canvas drawing + pixel-art sprite data
src/audio/          WebAudio synthesis (music + SFX); no sampled audio files
src/ui/             screen flow + input routing
src/save.js         localStorage read/write (single JSON blob per slot)
tests/              Node test suite (node --test); no DOM, no I/O
tools/              dev helpers (static server, smoke suites)
```

---

## Hard boundary: engine ↔ render/ui

```
src/engine/   ──→   (no imports from render/audio/ui)
src/render/   ──→   src/engine/  (reads exported constants, not game state directly)
src/ui/       ──→   src/engine/ + src/render/
src/audio/    ──→   (no engine imports; driven by event strings from ui layer)
```

Engine files export pure functions and plain-data types. They never touch `document`,
`window`, `canvas`, or `AudioContext`. This is the invariant that makes `node --test`
work without a DOM shim.

---

## Game loop (DESIGN §1.3)

```
createGame(config) → GameState          pure, deterministic, seeded

legalActions(state) → Action[]          what the current unit may do

applyAction(state, action)
  → { state: GameState, events: Event[] }
```

`events` is a flat ordered array of render/audio facts: `dieRolled`, `stepped`,
`battleStarted`, etc. The engine never waits for animation — it advances state
instantly. The renderer replays events as timed steps against `EVENT_DURATIONS`
(renderer.js). `skip()` fast-forwards the entire queue.

**Key invariant:** same seed + same action sequence always produces identical state
and event streams. Engine tests exploit this: no mocking needed.

---

## Sprite system (DESIGN §1.4)

Sprites are defined as **string grids + palette maps** in `src/render/sprites.js`:

```js
const GRID = ['GGGGGGGG', 'GgGGGGgG', ...];   // 16 chars × 16 rows
const PAL  = { G: '#5a5f6e', g: '#4c5160' };  // char → hex
```

`bake(grid, pal, scale)` in `pixelart.js` rasterises a grid into an offscreen
`<canvas>`. `buildAtlas(scale)` calls `bake` for every registered sprite and
returns a named map `{ 'tile.wall': <canvas>, 'hunter0.cobalt.idle': <canvas>, ... }`.

Adding a sprite: define the grid constant, add it to the relevant export object
(`TILES`, `HUNTERS`, `MONSTERS`, etc.), run `node --test`. The sprite validation
test (`tests/sprites.test.mjs`) will catch palette key typos.

---

## State model

`GameState` is a plain JS object — no classes, no hidden mutation. Functions that
"modify" state always return a new object (`{ ...state, field: newValue }`).

Key sub-objects:

| Field | Type | Notes |
|---|---|---|
| `board` | `Board` | `floor[y][x]` truthy = walkable; `boxes[]`, `flags[]`, `traps[]` |
| `hunters[]` | `Hunter[]` | Indexed by slot (0-3). No `.kind` field — only refs have kind |
| `monsters[]` | `Monster[]` | Added/removed during play |
| `current` | `{kind, index}` | Ref to the active unit's slot in its array |
| `rng` | `RngState` | Seeded state; advance via `nextRng(state)` |
| `deck` | `Card[]` | Shared draw pile |
| `phase` | string | `'move'` \| `'battle'` \| `'results'` etc. |
| `battle` | `BattleState \| null` | Set during combat phase |

**Gotcha:** `state.hunters[i]` objects have no `.kind` field. Only `state.current`,
`battle.attacker`, `battle.defender` refs have `{kind: 'hunter', index}`. Code that
checks `unit.kind === 'hunter'` must use the ref, not the resolved record (ADR-003).

---

## Screen stack (src/ui/screens.js)

`createScreenStack()` manages a stack of screen objects. Each screen has:

```js
{ enter(), exit(), update(dt), draw(ctx), onKey(e), onPointer(e) }
```

`stack.push(screen)` — navigate forward  
`stack.pop()` — go back  
`stack.replace(screen)` — replace top without keeping it in history

**Gotcha:** `startMission()` calls `stack.replace()` internally. Never call
`stack.pop()` before it — that drops the Client screen permanently (see memory).

---

## Board generation

Board is 20×20 assembled from 2×2 of hand-authored 10×10 sections (12 sections
in the catalog, chosen semi-randomly). `board.js` exports `generateBoard(rng, config)`.

Floor tile rendering cycles through 4 variants (`% 4`) keyed by `(x*7 + y*13) % 4`.
The multipliers ensure no two adjacent tiles share a variant (H-delta=3, V-delta=1,
both non-zero mod 4).

---

## Test baseline

`node --test` — all `.test.mjs` files in `tests/`. Engine + sprite only; no DOM.

Current baseline: **263 tests / 263 pass** (updated 2026-06-17).

Tests are the authoritative check before every commit. A failing test blocks the
commit — investigate root cause, never skip.

---

## Rendering pipeline

```
main.js rAF
  → renderer.update(dt)      advance animations, drain event queue
  → renderer.draw()          board → units → overlays → floats → battle overlay
  → drawHud(ctx, state)      right-side HUD strip (screens.js)
  → drawMenu(ctx, menu, ...)  active menu if present (screens.js)
```

`renderer.js` draws to a shared `<canvas>` at native resolution. `index.html` CSS
scales the canvas element to fill the viewport while preserving 4:3 ratio and
pixel-art crispness (`image-rendering: pixelated`).

---

## Audio

All audio is procedurally synthesised via WebAudio. No sampled files. `synth.js`
provides oscillator primitives; `music.js` sequences note data; `sfx.js` triggers
one-shot effects. Audio is driven by event strings from the UI layer — the engine
emits events, the UI maps them to sounds.

---

## Scaling this document

When a new subsystem is added:
1. Add a row to the relevant table above
2. Document the boundary rule (what it imports / what imports it)
3. Note any gotchas that would surprise a new agent
4. Write an ADR in `docs/decisions/` for any non-obvious design choice

Do NOT use this document to track tasks (that's `WORK.md`) or detailed mechanics
(that's `DESIGN.md`). ARCHITECTURE.md answers "why is it shaped this way" and "what
are the rules new code must follow."
