# Battle Hunter — Work Board

Active sprint, pending backlog, and completed milestones.
Agents: mark your task `IN_PROGRESS` in a commit before starting — prevents conflicts.

---

## How to pick up work

1. `git log --oneline -5` — see what just landed
2. `node --test` — confirm baseline green
3. Find the top `[ ]` item below, change it to `[~]`, commit "chore: claim NAME"
4. Do the work, tests green, commit with SHA, mark `[x]`

---

## Sprint: Project Scaffolding (enterprise-ready tracking)

Goal: give every agent — including agents months from now — enough context to
orient, pick up the right work, and make sound decisions without re-reading the
entire codebase. The ladder: `CLAUDE.md` (orientation) → `ARCHITECTURE.md` (why
it's shaped this way) → `WORK.md` (what to do right now) → `docs/decisions/`
(load-bearing choices). For multi-slice initiatives, promote items to `ROADMAP.md`.

### Done (2026-06-17)

- [x] **CLAUDE.md** — quick-start, file ownership tables, sprite system docs,
  operating model (ad-hoc vs initiative lanes), fresh-agent bootstrap order,
  research & ADR convention. `436b06e`

- [x] **WORK.md** — sprint board with claim-before-start convention, pending/done
  separation, backlog. `436b06e`

- [x] **.claude/settings.json** — PostToolUse hook: runs `node --test` after every
  file edit so regressions surface immediately. `436b06e`

- [x] **ARCHITECTURE.md** — module boundary rules, state model, screen stack, board
  generation, rendering pipeline, gotchas. Living doc.

- [x] **docs/decisions/TEMPLATE.md** — ADR template: question / options / research /
  decision / why / consequences.

- [x] **ADR-001** — no build step (why static ES modules, not Vite/esbuild).

- [x] **ADR-002** — deterministic engine + seeded RNG (why, what it enables, constraints).

- [x] **ADR-003** — string-grid sprites + IP constraint (why not PNGs, trade-offs).

### Pending

- [ ] **ROADMAP.md** — needed when the backlog grows beyond ~5 independent items.
  Currently unnecessary; promote this item if a multi-slice initiative (network
  play, replay mode) is greenlit. Format: epics with goal + acceptance criteria +
  phase breakdown.

- [x] **ADR-004: hunter record vs ref** — `docs/decisions/004-hunter-record-vs-ref.md`.
  `f606061`

---

## Sprint: Visual Polish

### In Progress

none — claim one from the next section

### Visual polish pending

none — claim one from the backlog

---

## Completed milestones

- [x] **Wall tile sprite** — stone-block face (mortar joints, staggered blocks)
  replaces blank wall cells. `tile.wall` in sprites.js, renderer updated.
  Commit: `6f14fba`

- [x] **Battle UI restyle** — red border, inner accent, "B A T T L E" title bar,
  ATTACKER/DEFENDER labels. `renderer.js drawBattle`.
  Commit: `6f14fba`

- [x] **Modern UI pass** — font swapped from Courier New → Consolas stack; box()
  redesigned with gradient fill + single top-edge highlight, no corner squares;
  HP bars use top-to-bottom gradient (bright→dim per health tier).
  Commit: (this session)

- [x] **Pit tile** — near-black void tile with mortar-joint hint. `sprites.js`. Already landed before audit.

- [x] **Title screen music** — `enter()` calls `app.music('title')`. Already landed before audit.

- [x] **HOW TO PLAY content audit** — fixed monster IDs (OOZ/VAC not BRO/RAD), counter item
  names (Patch/Repellent/Override/Tamer), Calmant/Releaser, Wardstone spawning note.
  Commit: `bd6c0c9`

- [x] **Item effect icons** — `itemName()` appends `+N` tier tag for weapon/armor/escape items;
  HUD INFO panel uses `itemName()` for consistency. Commit: `f606061`

- [x] **Title screen parade** — 8 hunters (was 4), diamond decorations on separator.
  `screens.js drawTitle`.
  Commit: (session 2026-06-17)

- [x] **Mission briefing screens** — all 15 missions have narrative + objective hint.
  `screens.js makeMissionBriefingScreen`.
  Commit: `728a493`

- [x] **9-page HOW TO PLAY manual** — paginated, dot-pager navigation.
  `screens.js makeManualScreen`.
  Commit: `728a493`

- [x] **AI speed slider** — default 8×, options 1–64, `[`/`]` in-game.
  Commits: multiple sessions

- [x] **Escape pause menu** — Resume / Return to Hub from in-game Escape.
  `screens.js GAME onKey`.

- [x] **HUD goal box** — shows actual item name for fetch, rescue hold countdown.
  `screens.js drawHud`.

- [x] **Engine faithfulness fixes** — blue E-warp, green trap, panicked AI takeover,
  WYRM mission-end, escape item bonus (Slick Boots/Jumpsuit/Longcoat), and more.
  Commits: `5124314`, `414e778`

- [x] **Engine bug fixes** — defeatHunter panic clear, applyEndTurn hunter kind guard.
  Commits: `043ada3`, `7f90e77`

- [x] **Performance/feel** — event durations −40%, AI async from render queue.
  Commits: `7417067`, `36d6f66`

---

## Sprint: Fun & sellability (from multi-agent design analysis, 2026-06-20)

Goal: make the game genuinely more fun and worth paying for. Direction from the
analysis: polish the existing turns to feel sharp/fair/watchable, then build a
seeded roguelike "Relic Dive" run + "Daily Hunt" (the deterministic engine makes
it cheap). Quick wins first — every one lifts the floor of *every* mode.

### Done (2026-06-20)

- [x] **Steering range + path overlay** — wire the renderer's already-built
  `showRange`/`showPath` (drawn but never fed) into `turn.steer` via
  `adapt.steerOverlay`. Turns blind steering into a readable tactical decision.
  Commit: `5c5083a`

- [x] **One-step soft-undo while steering** — Z / Backspace rewinds the last
  step (no die re-roll); snapshot-based, relies on engine purity (new game.test
  invariant). Antidote to "died to a hidden trap I couldn't see." Commit: `1ac3d2b`

- [x] **Crush AI dead-air** — renderer now compresses event playback during AI
  turns by `aiSpeed` (new pure `eventDuration(type, scale)`): trivial locomotion
  (steps/dice/draws/monster shuffles) flies by while decisive events (battles,
  steals, status, target/flag, boss spawns) compress at most 3× so the drama
  still reads. Human turns + results stay full-speed. Plus an always-visible
  `[ / ]` AI-speed hint (the keys were undiscoverable). `setTimeScale` on the
  renderer, threaded via `adapt.rendererDraw`. (this commit)

### Quick wins pending (days-to-weeks, low-regret — see analysis)

- [x] **Dice fairness without removing dice** — pre-attack advantage readout
  (stat delta) in battle overlay shows AT vs DF before dice roll. `b1c...`
- [x] **AI uses the dodge/crit-negate reflex** — deterministic archetype-scaled
  hit rate (clever 65%, balanced 30%, passive 15%) replaces hardcoded false. `b1c...`
- [x] **Combat juice micro-pass** — rolling damage counter, crit freeze-frame,
  magnitude-scaled audio pitch; dedicated WYRM-spawn cinematic (clip-worthy). `7ac704e`
- [x] **Rival voice** — 10–20 short lines for Keld/Mira/RAVEN on found-target /
  defeated / steal / WYRM. Cheap characterization; shows up in reviews. `8067829`
- [x] **Hotseat hidden-hand fix** — render the active player's hand + a
  pass-the-device handoff card (4-player Normal is currently unplayable). `961463d`

### Big bet (weeks-to-months): "Relic Dive" seeded run + Daily Hunt

Phase hard; prove each phase is fun before funding the next. Promote to
`ROADMAP.md` when greenlit.

- [x] **Phase 0 — Determinism cleanup (prerequisite).** `makeRng(seed)` now
  drives all pre-game setup in `buildMissionConfig`: opponent archetypes, AI
  names, sprite IDs; dungeon-music pick in `makeGameScreen.enter()` uses seed
  hash instead of `Math.random()`. Engine was already pure; this closes the
  call-site gap. New regression test: "engine replay: same seed+config produces
  identical event sequence." Renderer/audio `Math.random()` calls are
  cosmetic-only and intentionally left unseeded.
- [x] **Phase 1 — Depth-stack + Daily Hunt** (chained seeded dungeons of rising
  relicLevel; "Descend or Bank Out"; date-seeded daily + local best/streak +
  share string). Keep a "Classic Campaign" wrapper. **Shipped `38d7212`** —
  345/345 tests green. DIVE + DAILY HUNT on Hub; depth-transition + run-summary
  screens; share-string copy on run end. Design doc: `ROADMAP.md` Phase 1.
- [ ] **Phase 2 — Horizontal perks** (choose-1-of-3 between depths, same
  effect-string format `items.js` already parses; breadth not vertical power).
- [ ] **Phase 3 — Run modifiers + per-depth room objectives.**
- [ ] **Deferred** — cloud leaderboard + ghost races (needs a backend = new
  external resource; only after the offline daily proves return visits).

---

## Sprint: Phase 1 — Relic Dive depth-stack + Daily Hunt

From `ROADMAP.md` Phase 1. Two independent lanes: **engine** (`save.js`,
`main.js`) and **UI** (`screens.js`). Claim by lane to avoid conflicts.
Prerequisite: Phase 0 done at `319521e`.

### Engine lane

- [x] **1A — Run persistence (`save.js`)**
  Add `relicDive` to the roster save shape: personal-best (score, depths,
  shareStr) and daily slot (dateKey, score, depths, shareStr) plus streak
  counter. New helpers: `loadRelicDiveBest()`, `saveRelicDiveBest(result)`,
  `dateToSeed(YYYY-MM-DD)` (pure deterministic hash → uint32),
  `hashRunSeed(rootSeed, depth)` (per-depth seed derivation),
  `buildShareString(runResult)` (emoji-row + score line).
  Also a lightweight in-memory `runState` shape (not persisted; lives in
  screen glue code): `{ rootSeed, depth, startRelicLevel, daily, dateKey,
  depthResults: [] }`.
  Tests: add `tests/relic-dive.test.mjs` — `dateToSeed` is stable across
  calls; `hashRunSeed` differs per depth; `buildShareString` round-trips; no
  roster-version bump needed (new field backfilled on load).

- [x] **1B — Run config wiring (`main.js`)**
  `buildRelicDiveConfig(runState, roster)` → `createGame` config for the
  current depth: `seed = hashRunSeed(rootSeed, depth)`,
  `relicLevel = clamp(startRelicLevel + depth − 1, 1, 15)`, hunters carry
  HP/items from previous depth (pass-through from `applyResults` output).
  Depends on 1A for `hashRunSeed`. After-depth: caller updates `runState`
  with depth result and (if win) calls `applyResults` to update roster before
  continuing. Tests: 3-depth run replay produces identical event sequences
  (same rootSeed → same per-depth seeds → deterministic replays).

### UI lane

- [x] **1C — Hub + Relic Dive entry screen (`screens.js`)**
  Add a "RELIC DIVE" button to the Hub screen (alongside Story / Normal).
  New `makeRelicDiveScreen`: shows personal-best score + streak; shows
  whether today's Daily Hunt has been played and, if so, the score; two
  buttons — **DIVE** (random run seed) and **DAILY HUNT** (date-seeded,
  disabled after first play today). Hunter selection flows same as Normal.
  Depends on 1A for `loadRelicDiveBest()` / `dateToSeed`.

- [x] **1D — Depth-transition + run-summary screens (`screens.js`)**
  After each won depth, show `makeDepthClearedScreen`: depth score, run
  total, "DESCEND" (→ next depth config via 1B) / "BANK OUT" (→ run
  summary). On loss: run ends; show `makeRunSummaryScreen` with all depths
  reached, total score, "DAILY" stamp if daily. "SHARE" button writes
  `buildShareString(runResult)` to clipboard (try `navigator.clipboard`,
  fallback to hidden textarea + `execCommand('copy')`). Save best via
  `saveRelicDiveBest`. Depends on 1A + 1B + 1C.

---

## Sprint: Phase 2 — Horizontal perks

From `ROADMAP.md` Phase 2. Two independent lanes: **engine** (`items.js`,
new `perks.js`) and **UI** (`screens.js`). Coordinate on `screens.js` with
whoever holds the visual-polish claim first. Prerequisite: Phase 1 done at
`38d7212`.

### Engine lane

- [x] **2A — Perk catalog + roll logic (`perks.js`)** — 16 perks (4 stat, 12
  utility), `rollPerkChoices(rng, owned, count=3)` rarity-weighted without
  replacement, `perkStatBonuses` / `perkHasEffect` / `describePerk`. **Shipped
  `9df339d`** by `opus-coord-3ba000`.

### UI lane

- [x] **2B — Perk-pick screen (`screens.js`)** — `makePerkPickScreen` shown
  after each won depth, before DESCEND/BANK OUT. Three cards with name, desc,
  rarity badge; ←/→ navigate, Enter/click select; perks accumulate in
  `rs.perks[]`; deterministic seed so seeded/daily runs see identical offers.
  **Shipped `9b661ae`** by `study-sonnet-1cd904`. Also done in same session:
  distinct status SFX (`statusInflicted` → panic/stun/leg/empty dispatch) +
  counter-item SFX on `battleStarted` — `0d611e6`.

---

## Backlog (future sprints)

- Network play (WebRTC or WebSocket) for remote multiplayer
- Replay/spectate mode (engine is deterministic; save action log + seed)
- Additional board sections (now 20; six added 2026-06-24 — d82d1f2)
- [x] **Sound effects per item use type** — distinct SFX for each item kind + counter-item activation. `4ac3571` + `0d611e6`
- [x] **High-score leaderboard** — `addLeaderboardEntry` / `getLeaderboard` / `clearLeaderboard`, top-10 per mode, `LEADERBOARD_KEY v1`. `61055ac`
- Accessibility: keyboard nav on all menus, colour-blind palette option
