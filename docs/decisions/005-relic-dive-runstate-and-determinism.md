# ADR 0005: Relic Dive run-state lives outside the pure engine

- **Status:** accepted
- **Date:** 2026-06-24
- **Level:** architecture

## Question

The "Relic Dive" epic (see `ROADMAP.md`) chains many seeded dungeons into one
**run** with carried HP/items, a push-your-luck "descend or bank" choice, and a
**Daily Hunt** (one global date-seed everyone races, with a shareable result).
Where does the run/meta state live — inside the engine, or outside it — and how
do we keep seeded runs and the daily share honest? The load-bearing constraint:
the engine's bit-for-bit determinism (ADR-002) is the entire reason this feature
is cheap. Anything that risks it is disqualifying.

## Options considered

1. **Run state inside the engine `GameState`** (chain depths in-engine; one
   long-lived state spans the whole run). Pros: single source of truth. Cons:
   conflates per-mission state with run-meta and bloats `GameState`; every depth
   transition mutates the same object, multiplying replay surface and the risk
   of a non-deterministic leak; would force the 333-test determinism suite to
   reason about multi-depth state. Breaks the "engine is a pure per-mission state
   machine" boundary (ARCHITECTURE.md).

2. **Run state in a thin controller OUTSIDE the pure engine** (UI layer). Each
   depth is a *fresh* `createGame` seeded by `hashRun(rootSeed, depth)`; HP/items
   are carried forward by the controller; run/daily persistence lives in
   `save.js`. Pros: the engine stays pure and per-mission — the seeded-replay
   gate keeps holding unchanged; run-meta is isolated and easy to reason about;
   Daily Hunt is just `rootSeed = hash(UTC date)`. Cons: the controller must copy
   HP/items across depths by hand (a small, explicit cost).

## Research / findings

- Determinism is already proven and now **rigorously gated**: a same-seed game
  replays bit-identically across actions, event payloads, every per-step state,
  and terminal state — `tests/determinism.test.mjs` (`44f784b`), on top of the
  basic event-type check in `gameplay.test`. Different seeds provably diverge, so
  the gate is not vacuous.
- Phase 0 closed the pre-game entropy leaks (`Math.random()` for
  archetypes/names/sprites/seed) by routing them through the seeded RNG
  (`319521e`) — required before any seed is shareable.
- Phase 1A/1B landed Option 2 in practice (`1f325c5`): `relicDive` persistence
  helpers in `save.js`, `buildRelicDiveConfig` + `startRelicDiveDepth` in
  `main.js`, with the runState controller in the UI layer (`screens.js`).

## Decision

**Option 2.** Relic-Dive run/meta state lives in a controller in the **UI layer**
(`screens.js`), never in `GameState`. Each depth is a fresh `createGame` seeded
by `hashRun(rootSeed, depth)`; the controller carries HP/items forward; run and
daily-streak persistence live in `save.js`. The engine stays pure and
per-mission. The seeded-replay determinism gate is the guarantee that makes daily
seeds and shareable results trustworthy.

## Why

The engine's purity + determinism is the asset the whole epic monetises (cheap
"one more run" + a Wordle-style daily). Putting run state in-engine trades that
asset for convenience and would force the determinism suite to grow with every
run feature. Keeping the controller outside preserves the boundary that
ARCHITECTURE.md and ADR-002 establish, at the cost of a few explicit
carry-forward copies. We would revisit only if the controller's manual state
threading became error-prone enough to justify a dedicated (still-pure) run
engine module — not the case at Phase 1 scope.

## Consequences

- Phase 1 is built on this: `save.js` persistence (1A), `main.js` config wiring
  (1B), and the `screens.js` entry/transition/summary UI (1C/1D).
- The **Daily Hunt share string must be reproducible and verifiable**. It is
  implemented as a **pure, tested codec** (`src/share.js`:
  `encodeRunResult`/`decodeRunResult` with a checksum), separate from the
  `screens.js` UI that calls it — so the share format is unit-testable and not
  entangled with rendering. (Keeps a third editor out of `screens.js`.)
- A local daily board is framed honestly as **personal best / streak**, never a
  global "leaderboard": a client-authoritative score is unverifiable. A real
  cloud leaderboard stays deferred (`ROADMAP.md`) because it requires
  **server-side re-simulation** of the seed+action log for anti-cheat — which the
  determinism gate makes possible but which is a new external resource.
- Affects ROADMAP Phases 1–3; supersedes nothing.
