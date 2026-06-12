# Battle Hunter clone — design spec

Two halves: **architecture** (stable) and **mechanics** (filled from research;
the implementation must follow it exactly).

Legal note: mechanics below are recreated from publicly documented rules of the
1999 PS1 game. All names, art, music, text, and code are original to this repo.

## 1. Architecture

Zero-dependency browser game: ES modules, Canvas 2D, WebAudio. No build step.
Engine is pure JS (no DOM) so it runs and tests under Node.

### 1.1 Engine = deterministic state machine

```
createGame(config) -> GameState            // config: { seed, mission, hunters[] }
legalActions(state) -> Action[]            // for state.activeHunter (or pending chooser)
applyAction(state, action) -> { state, events }  // pure: returns NEW state + event list
```

- All randomness from `makeRng(seed)` stored in state (`state.rngState` advanced
  by value, or rng calls counted) — same seed + same actions = same game.
- `events` is the render/audio contract: ordered, serializable facts like
  `{ type: 'dieRolled', hunter, value }`, `{ type: 'moved', hunter, path }`,
  `{ type: 'battleResolved', ... }`. The UI replays events as animations; the
  engine never waits for animation.
- `Action` is serializable: `{ type: 'rollDie' } | { type: 'playCard', card } |
  { type: 'move', to } | { type: 'battleCard', card } | ...` (exact set defined
  by mechanics §2).
- AI: `chooseAction(state, persona) -> Action` — consumes `legalActions`, pure,
  seeded from state rng so games replay identically.

### 1.2 Modules and file ownership

| File | Owns |
|---|---|
| `src/engine/rng.js` | seeded PRNG (done) |
| `src/engine/cards.js` | card catalog, deck composition, deck/hand ops |
| `src/engine/board.js` | dungeon generation, tile model, pathfinding/reachability |
| `src/engine/combat.js` | battle resolution (pure function of both sides' choices) |
| `src/engine/game.js` | GameState, createGame/legalActions/applyAction turn machine |
| `src/engine/ai.js` | CPU hunter decision-making |
| `src/engine/missions.js` | mission list, difficulty scaling, rewards, progression rules |
| `src/render/pixelart.js` | string-grid → offscreen-canvas sprite baking, palettes |
| `src/render/sprites.js` | ORIGINAL sprite data (hunters, monsters, tiles, cards, UI) |
| `src/render/renderer.js` | draws GameState + animates event queue on Canvas |
| `src/audio/synth.js` | WebAudio primitives: envelopes, noise, step sequencer |
| `src/audio/music.js` | ORIGINAL tunes (title, dungeon, battle, results) as note data |
| `src/audio/sfx.js` | sound effects (dice, cards, hits, pickup, win/lose) |
| `src/ui/screens.js` | screen flow: title → setup → mission select → game → results |
| `src/ui/input.js` | mouse/keyboard → Actions; menus |
| `src/main.js` | bootstraps everything, owns the requestAnimationFrame loop |
| `src/save.js` | localStorage persistence of hunter roster/progression |

Rule: engine files import nothing from render/audio/ui. UI imports engine.
Renderer/audio consume events only.

### 1.3 Game loop

`main.js` ticks: input → (player action or AI action when CPU's turn) →
`applyAction` → push events to renderer (animation queue) + audio. Engine
state advances instantly; the renderer's queue plays catch-up visually. While
the queue is non-empty, input is locked (skippable with a key).

### 1.4 Art & audio approach (all original)

- Pixel sprites authored as string grids in `sprites.js` with named palettes,
  baked to offscreen canvases at load. Anime-adjacent *feel* via bold outlines
  + big-head proportions, but original designs and palette.
- Board view: 2D top-down tiles with a slight faux-3D wall offset; portraits
  and card art are larger pixel illustrations.
- Music: small step-sequencer (square/triangle/noise voices) playing original
  compositions defined as note arrays. SFX synthesized (envelope'd oscillators
  and filtered noise).

## 2. Mechanics spec

**(to be filled from research — turn structure, movement, full 100-card deck,
battle formulas, stats/progression, monsters/traps/items, missions, UI flow)**
