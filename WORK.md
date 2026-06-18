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

## Backlog (future sprints)

- Network play (WebRTC or WebSocket) for remote multiplayer
- Replay/spectate mode (engine is deterministic; save action log + seed)
- Additional board sections (currently 12; more variety = less repetition)
- Sound effect for each item use type
- High-score leaderboard (localStorage, top-10 per mode)
- Accessibility: keyboard nav on all menus, colour-blind palette option
