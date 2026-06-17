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

## Operating model: initiative vs ad-hoc lanes

**Discipline scales with the work.** Use the lightest lane that does the job —
ceremony is a cost, not a virtue. Jake is the only human and his attention is the
scarcest resource: handle what you can autonomously, make reversible calls
yourself and report them, and spend his attention only on decisions genuinely
his (and then offer a recommendation he can approve in one word). When unsure
which lane fits, pick the lighter one and escalate only if the work proves bigger.

Work arrives in two shapes. Route it before starting.

**Ad-hoc lane** — a bug report or one focused task. Do NOT spin up planning
docs. Bootstrap, fix, verify, commit:
1. Read this file + `WORK.md`; check `git log --oneline -10`
2. Read only the files the task touches (see ownership tables above)
3. `node --test` green → make the change → tests green → commit with SHA
4. If the task reveals a bigger effort, stop and write it into the `WORK.md`
   backlog instead of scope-creeping the fix.

The `/bug` and `/feature` skills are the ad-hoc entry points; `/research` files a
research artifact. They assume a Context Forge layout (`project-documents/user/…`)
that this repo does not use — substitute: tracked-task escalations → the `WORK.md`
backlog; research artifacts → `docs/decisions/`.

**Initiative lane** — a change big enough to need design before code climbs a
breakdown ladder so no piece exceeds a fraction of one context:
concept → architecture → slices → tasks. Each level is a durable doc, and later
levels are re-derived as earlier ones change — the plan evolves alongside the
work, it is not write-once. This repo runs the ladder lightweight: `DESIGN.md`
(spec/architecture) + `WORK.md` (sprints → tasks). That is a deliberate choice —
Battle Hunter is in a polish phase of small, independent tasks, where heavier
tooling would be ceremony without payoff. Adopt Context Forge (`cf init`) only
when an initiative actually needs architecture + multiple slices (network play
or replay mode in the backlog are the likely first ones); the recipe is parked
in the "Harness & Project-Tracking Setup" sprint in `WORK.md`.

### Fresh-agent bootstrap (every new conversation/agent)

A new agent must orient and pick up the next unblocked task without re-reading
the whole repo:
1. Read this file (architecture + conventions)
2. `WORK.md` → top unclaimed `[ ]` item; mark `[~]` + commit to claim it
3. Recalled memory (auto-loaded) for durable *why* and gotchas
4. `git log --oneline -10`; `node --test` to confirm a green baseline

Pick the task that unblocks the most other work first, then the quickest.

## Research & decisions

Don't guess on load-bearing unknowns — research them, and record the outcome so
the next agent doesn't re-investigate:
- For a multi-source external question, use the `deep-research` skill or fan out
  Explore/Plan agents (cheap tier to gather, top tier to synthesize).
- Record any non-obvious decision as a short ADR in `docs/decisions/` (copy
  `docs/decisions/TEMPLATE.md`): question, options, finding, choice, why.
- An architecture or initiative step is not "done" while it still has an open
  research question that would change the design.

---

## Key design decisions (don't re-litigate)

- **No build step** — serves as static files; ES modules in the browser directly
- **Deterministic engine** — same seed + same actions always replays identically;
  all randomness goes through `makeRng(seed)` stored in state
- **All assets original** — no ripped art/music; sprites are hand-authored string
  grids; music is synthesized from note data; see `README.md`
- **DESIGN.md is the spec** — when engine behavior is unclear, DESIGN.md wins
