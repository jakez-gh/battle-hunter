# Battle Hunter — Work Board

Active sprint, pending backlog, and completed milestones.
Agents: mark your task `IN_PROGRESS` in a commit before starting — prevents conflicts.

---

## How to pick up work

1. `git log --oneline -5` — see what just landed
2. `node --test` — confirm baseline green
3. Find the top `[ ]` item below, change it to `[~]`, commit "chore: claim <task>"
4. Do the work, tests green, commit with SHA, mark `[x]`

---

## Sprint: Harness & Project-Tracking Setup

Goal: make the workflow scale from one-off bug fixes to enterprise-scale efforts
without losing the big or small picture. Sequenced by unblock-value, then speed.
Durable *why* is in the `harness-operating-model` memory.

### Done (2026-06-17)

- [x] **Two-lane operating model + fresh-agent bootstrap + research convention** —
  initiative vs ad-hoc routing, bootstrap order, ADR/research gate. Added to
  `CLAUDE.md` (## Operating model, ## Research & decisions) and
  `docs/decisions/TEMPLATE.md`.

### Decided 2026-06-17 — stay on the lightweight manual ladder

Battle Hunter is in a polish phase of small, independent tasks. Adopting Context
Forge now would add a second tracking system to keep in sync for no payoff, so the
manual `WORK.md` + `DESIGN.md` ladder stays. **Nothing here needs Jake's input.**
**Trigger to revisit:** a backlog item that genuinely needs architecture +
multiple slices — network play or replay/spectate mode are the likely first ones.
When one lands, run the parked recipe below; until then it stays parked.

#### Parked recipe — adopt Context Forge (only when a multi-slice initiative lands)

1. `cf init battle-hunter` in repo root
2. Point cf artifacts at existing docs: `cf set concept README.md`,
   `cf set arch DESIGN.md` (or author a dedicated arch doc)
3. Migrate the relevant WORK.md items → a cf slice plan (`fileSlicePlan`) + tasks
   (`fileTasks`); keep WORK.md as the human-readable mirror
4. Verify `cf next` / `cf build` return scoped context
5. Optional enforcement hooks in `~/.claude/settings.json` (verify schema via
   claude-code-guide first): SessionStart → `cf next`, Stop → `cf check`

Note: the `/bug`, `/feature`, `/research` skills assume a cf layout
(`project-documents/user/…`). Until cf is adopted, they map here as: tracked-task
escalations → this WORK.md backlog; research artifacts → `docs/decisions/`.

---

## Sprint: Visual Polish

### In Progress

*(none — claim one below)*

### Pending

- [ ] **Floor tile variety** — FLOOR_B and FLOOR_C are nearly identical to FLOOR_A
  (same grey hues, barely distinguishable). Design 3 visually distinct variants:
  FLOOR_A (current baseline — keep), FLOOR_B redesign (subtle crack pattern),
  FLOOR_C redesign (worn groove / stone joint), FLOOR_D new (mossy/stained corner dot).
  Change tile selection formula from `% 3` to `% 4` in `renderer.js drawBoard()`.
  Files: `src/render/sprites.js`, `src/render/renderer.js`

- [ ] **Pit tile** — `tile.pit` currently falls through to a missing-sprite blank.
  Design a 16×16 void/abyss tile (near-black with faint depth gradient suggestion).
  Files: `src/render/sprites.js`, `src/render/renderer.js`

- [ ] **HOW TO PLAY content audit** — manual pages exist (9 pages) but some are
  placeholder-thin. Review against DESIGN.md and flesh out sparse pages.
  Files: `src/ui/screens.js makeManualScreen`

- [ ] **Item effect icons** — items in the INFO panel show names but no visual cue
  for effect tier. A 1–3 dot or star rating next to ATK/DEF/ESC items would help.
  Files: `src/ui/screens.js drawHud`

- [ ] **Title screen music** — title screen has a `drawTitle` function but music
  only starts once the hub screen loads. Hook `audio.playMusic('title')` into
  the title-screen `enter()` callback.
  Files: `src/ui/screens.js`, `src/audio/music.js`

---

## Completed milestones

- [x] **Wall tile sprite** — stone-block face (mortar joints, staggered blocks)
  replaces blank wall cells. `tile.wall` in sprites.js, renderer updated.
  Commit: `6f14fba`

- [x] **Battle UI restyle** — red border, inner accent, "B A T T L E" title bar,
  ATTACKER/DEFENDER labels. `renderer.js drawBattle`.
  Commit: `6f14fba`

- [x] **UI box() polish** — inner highlight, corner accent squares, consistent
  border color. `screens.js box()`.
  Commit: (session 2026-06-17)

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
