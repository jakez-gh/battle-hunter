# ADR-002: Deterministic engine with seeded RNG

- **Status:** Accepted
- **Date:** 2026-06-11
- **Level:** architecture

## Question

How should randomness be handled so that gameplay is reproducible, testable, and
eventually replayable?

## Options considered

1. **Math.random() ad-hoc** — simple. Non-deterministic; breaks replay and makes
   tests flaky (must mock or seed globally).

2. **Seeded RNG threaded through state** — deterministic: given the same seed and
   the same action sequence, `applyAction` always produces identical state + events.
   Slightly more verbose (pass `rng` everywhere it's needed).

3. **Redux-style action log** — store every action; replay by re-running from
   `createGame`. Orthogonal to RNG choice; heavier machinery.

## Decision

Option 2 — seeded PRNG (`src/engine/rng.js`) threaded through `GameState`.

## Why

Determinism unlocks:
- **Reproducible tests** — `createGame({ seed })` + fixed actions → same result
  every run, no mocking required.
- **Replay** — save the seed + action log; play it back exactly.
- **Multiplayer** — all clients can advance state independently if they receive
  the same actions in the same order (future work).

Seeding Math.random globally is fragile (leaks across test files). Carrying `rng`
in state is explicit and composable.

## Consequences

- All randomness in engine code must flow through `nextRng(state)` / `makeRng(seed)`.
- `Math.random()` is forbidden in `src/engine/` — the sprite validation test checks
  that no engine file imports from non-engine modules, but this is a convention
  the team must enforce manually.
- `state.rng` advances with every random draw; the entire history is implicit in
  the seed + action sequence.
- Tests can use `createGame({ seed: 42, ... })` and make deterministic assertions.
