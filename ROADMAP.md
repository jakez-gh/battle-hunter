# Battle Hunter — Roadmap

Multi-slice initiatives too big for a single `WORK.md` sprint. Each epic carries
a **goal**, **acceptance criteria**, and a **phase breakdown**; phases feed
slices down into `WORK.md`. Plain markdown on purpose (see `CLAUDE.md` operating
model). Source of the direction: the 2026-06-20 multi-agent design analysis
(fun + sellability) recorded in `WORK.md`.

---

## Epic: "Relic Dive" — seeded roguelike run + Daily Hunt

**Goal.** Give the game a reason to exist past the 15-mission campaign by turning
the deterministic engine into a run-based roguelike (chained seeded dungeons of
rising relic level, push-your-luck banking, horizontal perks) plus a Wordle-shaped
**Daily Hunt** (one global date-seed everyone races, shareable result). This is
the headline "why pay / why come back" feature; it reuses the engine, the
event-driven juice, and the entire 70-item / 100-card economy intact.

**Why this and not a content treadmill or netcode.** The engine is already
deterministic — a seeded depth-stack + daily share string is near-zero content
cost and the genre-proven "one more run" + viral loop. It avoids the two solo-dev
money pits (authored-content-at-scale and online netcode). Keep a **"Classic
Campaign"** wrapper so the faithful 15-mission game is never lost — the run mode
is additive.

**Top-level acceptance.** A player can start a Relic Dive from the hub, complete a
15–25 min run across escalating depths with a real "descend or bank" decision and
a perk choice between depths, and a Daily Hunt produces the same board for two
machines on the same date plus a copy-pasteable result string.

**Keep the engine pure.** Run/meta state lives in a thin controller *outside* the
pure engine (`createGame/applyAction` stay pure or the test suite + replay break).
This is the load-bearing constraint for every phase below.

### Phase 0 — Determinism cleanup ✅ DONE (`319521e`)
Route every gameplay-affecting entropy source through the seeded RNG (was leaking
via `Math.random()` in `main.js` for archetypes/names/sprites/seed and the
dungeon-music pick). **Acceptance (met):** pre-game setup is seeded; same seed →
same game. *Follow-up owned separately: a full seed→action-log→replay equality
test in `tests/` (the belt-and-suspenders acceptance check).*

### Phase 1 — Depth-stack + Daily Hunt (the core loop) ✅ DONE (`38d7212`, 345/345 tests)
The minimum that makes "a run" exist and be shareable.
- Chain N seeded dungeons of rising `relicLevel` from one root seed
  (`hashRun(rootSeed, depth) → config.seed`); `relicLevel` already drives
  monster/trap/loot scaling.
- A **"Descend or Bank Out"** push-your-luck choice between depths.
- Carry hunter HP/items across depths in a thin `runState` controller **outside**
  the pure engine.
- **Daily Hunt:** date-derived seed, one scored run per UTC day, localStorage
  personal-best/streak, copy-to-clipboard result string (reuse the existing
  export path).
- **Acceptance:** a run completes in 15–25 min; "Descend or Bank" is a real felt
  decision; the daily share string round-trips and two machines on the same date
  get the identical board; Classic Campaign still launches the same engine.
- **File surfaces (for disjoint claims):** engine/new `runState` controller +
  `save.js` (run/daily persistence) = engine lane; hub/run/daily screens in
  `screens.js` = UI lane (coordinate with whoever owns screens.js).

### Phase 2 — Horizontal perks (the build)
- Replace the +1HP/+1pt hospital purchase with a **"choose 1 of 3"** perk pick
  between depths, implemented in the *same* effect-string format `items.js`
  already parses (`at+1`, plus new keys like `noSelfTrap`, `restDraw+1`,
  `firstBoxIdentified`), read alongside `effectiveStats` at the existing branch
  points (self-trap spring, draw-on-rest, dodge/crit reflex).
- **Unlock breadth, not vertical power** — stat inflation kills replayability.
  Keep the launch perk list small and conservatively valued.
- **Acceptance:** two L15-equivalent hunters built from different perk paths play
  measurably differently; no single perk is an auto-pick.
- **File surfaces:** `items.js` / engine effect application = engine lane;
  perk-pick screen = UI lane.

### Phase 3 — Run modifiers + room objectives (variety long-tail)
- Promote the already-coded fetch/rescue/resteal verbs into per-depth room
  objectives; add 4–6 opt-in mutators (double-traps, deck-25 sprint,
  target-visible, no-rest) as pure config flags.
- **Acceptance:** a modifier meaningfully changes a run; this is what answers
  "why run #10."

### Deferred (conditional — do NOT build before the offline daily proves itself)
- Cloud leaderboard + daily ghost races. Needs a backend = a **new external
  resource** (cost, ops, server-side anti-cheat re-sim) — out of scope until the
  *local* daily demonstrably brings players back. Frame the localStorage board
  honestly as a **personal best / streak**, never a global "leaderboard", until a
  real backend exists.

---

## Notes for collaborating agents

- This epic is being executed in parallel by multiple agents. **Claim file
  surfaces via `.agents/`** (see `.agents/README.md`) before editing — engine,
  render, UI, and audio are independent lanes per the `CLAUDE.md` ownership
  tables. The phase "file surfaces" lines above name the natural seams.
- When a phase is greenlit, break it into `WORK.md` sprint tasks; keep this file
  the durable goal/acceptance record and let `WORK.md` hold the live task state.
- Quick-win polish items (steering overlay, soft-undo, AI dead-air, dice
  fairness, AI reflex, combat juice, rival voice, hotseat hand) are tracked in
  `WORK.md` under the Fun & sellability sprint — most are already done.
