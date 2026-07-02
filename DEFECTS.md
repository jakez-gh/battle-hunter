# Battle Hunter — Defect Register

Findings from a full-codebase defect audit (2026-06-30). Each item was located by
a per-module finder and then **adversarially verified against the live code** (the
claim was actively refuted unless the exact wrong-behavior path could be traced).
The four findings that did not survive verification are listed at the bottom.

- **Baseline at audit time:** `node --test` → 431 pass, 0 fail. Every defect below
  is therefore on an **uncovered or test-masked** path — a green suite does not
  contradict them. Several are actively *masked* by tests that assert the buggy
  behavior (see [Cross-cutting notes](#cross-cutting-notes)).
- **Status: D01–D25 FIXED (2026-06-30).** Each has a hard regression test in
  `tests/defects-*.test.mjs`. One further engine defect ([D25](#d25)) was found and
  fixed during the fix pass. Locations are `path:line` against the tree at audit
  time. Spec refs → `DESIGN.md`.
- **Round 2 (2026-07-01) — 2 new defects, OPEN (documented, not yet fixed):**
  [D26](#d26), [D27](#d27). Each has a failing (todo-wrapped) test in
  `tests/defects-r2-*.test.mjs` documenting it. See the **Round 2** section below.
- Severity = player-facing blast radius × likelihood of hitting the path in real play.

| # | Severity | Area | Defect |
|---|---|---|---|
| [D01](#d01) | **Critical** | engine | Deck-out WYRM spawned with no AT/DF/MV → NaN combat corrupts HP |
| [D02](#d02) | High | engine | Escape response skips `battle.defCard` — blue/E escape card never played |
| [D03](#d03) | High | ai | AI burns the EXIT-warp (`BE`) card on an ordinary move |
| [D04](#d04) | High | ui | Stale `session.coopIds` leaks co-op hunters into solo story / Quick Start |
| [D05](#d05) | High | render | `unitKey` mis-prefixes numeric monster ids (`h…` not `m…`) — monsters teleport |
| [D06](#d06) | Medium | engine | Act-again (blue flag 6) never resets `state.turn`; extra spawn check |
| [D07](#d07) | Medium | engine | Round counter never advances while no monster is alive |
| [D08](#d08) | Medium | ai | AI ranks lettered specials (RS/RC/YD/YA) as value 0 — never prefers its best cards |
| [D09](#d09) | Medium | render | WYRM death detonation + monster-kill FX are unreachable |
| [D10](#d10) | Low | engine | Flag roll-1 self-trap springs with no dodge/evasion |
| [D11](#d11) | Low | engine | Dead `claimFlag()` function with a no-op stub |
| [D12](#d12) | Low | engine | Black Gem / Amulet die-cap applied before crit test → 2× crit rate |
| [D13](#d13) | Low | engine | `odds.js` readout ignores die-cap + Warbanner/Aegis → mis-states damage |
| [D14](#d14) | Low | ai | Dead `panicked: 25` react-rate entry — never reachable |
| [D15](#d15) | Low | persistence | `encodeRunResult`/`decodeRunResult` disagree on legal `date` (codec asymmetry) |
| [D16](#d16) | Low | persistence | `decodeRunResult` accepts a version-less tag as `version:0` |
| [D17](#d17) | Low | persistence | Leaderboard sort corrupts (NaN comparator) on a tampered stored score |
| [D18](#d18) | Low | engine | `Date.now()` seed fallback inside the deterministic engine |
| [D19](#d19) | Low | render | `unitFlash` tint freezes on a unit during fast (AI) playback |
| [D20](#d20) | Low | ui | RESULTS `[H]` Daily-Hunt shortcut pops to Client (not Hub) in story mode |
| [D21](#d21) | Low | ui | Esc during steering opens the pause menu instead of committing the move |
| [D22](#d22) | Low | ui | Held arrow key during steering auto-walks/overshoots (no `e.repeat` guard) |
| [D23](#d23) | Low | ui | Held Enter falls through the YOUR-TURN menu into the Move/Attack submenu |
| [D24](#d24) | Low | audio | `setVolumes()` assigns `gain.value` directly → click/pop on slider scrub |
| [D25](#d25) | High | engine | Boxed-in monster (no move, no adjacent target) deadlocks the turn loop |

---

## Critical

### D01 — Deck-out WYRM is spawned without AT/DF/MV, producing NaN combat that corrupts hunter HP {#d01}

- **Location:** `src/engine/game.js:325-331` (spawn + respawn). NaN surfaces via
  `buildBattleSide` `src/engine/game.js:168-170`, `src/engine/combat.js:29/51/97`,
  and is written back at `src/engine/game.js:591`.
- **Defect:** `maybeSpawnMonster`'s deck-exhaustion branch creates the WYRM boss
  with only `hp/maxHp/pos`. Every *regular* monster is pushed with full stats at
  `game.js:364` (`at: stats.at, df: stats.df, mv: stats.mv`); the WYRM path drops
  them even though `monsterStats('WYRM', …)` is already called (it reads only `.hp`).
  `buildBattleSide` copies `side.at = unit.at` etc. directly off the monster, so for
  the WYRM all three are `undefined`. In `combat.js`, `2d6 + undefined = NaN`,
  `damage = max(0, NaN) = NaN`, and `defender.hp = max(0, hp + NaN) = NaN`. Because
  `NaN <= 0` is `false`, the victim is **never marked defeated** and their HP stays
  `NaN` permanently.
- **Impact:** The WYRM is the deck-out soft-timer boss that "relentlessly chases the
  Target holder" (§2.10). In any game long enough to exhaust the 100-card deck, the
  first WYRM combat — in **either direction** (its `df=undefined` also breaks a
  hunter attacking it; its `mv=undefined` corrupts escape rolls) — turns the
  hunter's HP into `NaN`, breaks the HP bar/odds readout, and prevents the intended
  WYRM-kills-target-holder loss clause (`game.js:665`) from ever firing. The boss
  fight is non-functional.
- **Fix:** Capture the stat block once and set all four fields on both paths:
  ```js
  const ws = monsterStats('WYRM', state.relicLevel);
  // respawn:
  existing.hp = ws.hp; existing.maxHp = ws.hp;
  existing.at = ws.at; existing.df = ws.df; existing.mv = ws.mv; existing.pos = free;
  // first spawn:
  state.monsters.push({ id: rng.int(1000000), kind: 'WYRM',
    hp: ws.hp, maxHp: ws.hp, at: ws.at, df: ws.df, mv: ws.mv, pos: free });
  ```
- **Test note:** The WYRM tests pass only because they manually inject
  `s.monsters[0].at/df/mv` (`tests/game.test.mjs:894`). Add a regression test that
  drives an **engine-spawned** WYRM into combat (via an empty deck) so this masking
  can't recur. *(This root cause was independently surfaced by two separate finders.)*

---

## High

### D02 — Escape response skips `battle.defCard`, so the defender's blue/E escape card is never played {#d02}

- **Location:** `src/engine/game.js:1150` (escape fast-path); dead filter at
  `game.js:903`; consumed-but-never-set at `combat.js:112` (`isE(defCard)`) and
  `combat.js:117` (`blueBonus(defCard)`).
- **Defect:** Per §2.8, an escaping defender plays a blue card (value feeds the
  escape roll; `E` = guaranteed escape). `legalActions` even offers Escape only when
  the defender holds a blue card, and the `battle.defCard` filter is written to
  select blue cards for escape (`game.js:903`). But `applyRespond` routes escape
  straight to `battle.atkCard`: `if (… kind === 'monster' || action.response ===
  'escape') { state.phase = 'battle.atkCard'; return; }`. `battle.defCard` stays
  `null`, so `combat.js` always uses `blueBonus(null)=0` and `isE(null)=false`.
- **Impact:** Escaping defenders never get their `+1/+2/+3` to the flee total and a
  held `E` never auto-escapes — escape is far weaker than the documented rules, and
  a player banking on an `E`/blue card to flee a lethal hit is caught unexpectedly.
- **Fix:** Narrow the fast-path to monsters only
  (`if (resolveUnit(state, state.battle.defender)?.kind === 'monster')`) so escape
  falls through to `battle.defCard`. This activates the already-correct filter at
  `game.js:903`. **Update** `tests/game.test.mjs:412` and the `runEscape` helper —
  they currently assert the buggy "escape skips defCard" flow.

### D03 — AI plays the EXIT-warp (`BE`) card during ordinary movement, wasting it and the turn {#d03}

- **Location:** `src/engine/ai.js:205-206`; enabled by `legalActions` push order at
  `game.js:837-839`.
- **Defect:** `chooseMoveAction` filters blue moves with `a.card.startsWith('B')` —
  which also matches `BE` (color blue, id starts `B`) — then returns
  `blueMoves[blueMoves.length - 1]`. `legalActions` appends the `BE` move **last**,
  so any AI holding `BE` selects it for a normal move; `applyMove` then warps a
  non-holder to the EXIT, re-teleports to a random tile, and ends the turn for no
  gain. Secondary bug: `blueMoves[length-1]` is the **last card in hand order**, not
  the highest value, so the "most range bonus" comment is false (B1 can beat B3).
- **Impact:** An AI that draws the escape/exit card squanders it on a routine move
  and never plays its best blue card — visible as AI units randomly teleporting and
  ending their turn.
- **Fix:** Exclude specials and pick by value:
  `moves.filter(a => a.card && cardColor(a.card)==='blue' && !isSpecial(a.card))`
  then sort by `cardValue` desc. **Keep** a deliberate `BE` branch: for a
  target-holder, warping to the EXIT *ends the mission as a win* (`game.js:940-945`),
  so emit `BE` when `unit.hasTarget` (head to exit) or as a low-HP escape. Requires
  importing `cardColor/isSpecial/cardValue` into `ai.js`.

### D04 — Stale `session.coopIds` leaks co-op hunters into solo story / Quick Start missions {#d04}

- **Location:** `src/ui/screens.js:1612` (sole assignment), read at
  `src/main.js:407/432/455`; missing reset in `quickStart` (`screens.js:567-573`)
  and on story entry.
- **Defect:** `session.coopIds` (the normal-mode co-op party) is initialized `[]`
  (`main.js:387`), assigned only in the normal party-setup start handler
  (`screens.js:1612`), and **never cleared**. `startMission`/`pushMission`/
  `startRelicDiveDepth` all rebuild the party as `[primary, ...coopRecs]` from this
  list, ignoring the mission's own roster. So after one normal co-op game: **Quick
  Start** (intends 1 human + 3 AI) launches with the stale party; **Story** sets
  `aiCount = 4 - recs.length`, so with 3 stale members only 1 of 3 scripted
  opponents spawns and the 2 stale hunters become extra **human** players (forcing
  the hotseat "pass the device" handoff in a solo story). The story briefing party
  list at `screens.js:1579` also reads `coopIds`, confirming the leak reaches story.
- **Impact:** Mission balance and the solo story experience are corrupted after any
  normal co-op game in the same session.
- **Fix:** Gate co-op on mode — only apply `coopRecs` when `session.mode ===
  'normal'` (and relic-dive if co-op dives are intended) in `startMission`/
  `pushMission`. Also set `session.coopIds = []` in `quickStart()` for
  defense-in-depth.

### D05 — `unitKey` mis-prefixes numeric monster ids as hunter keys → monsters teleport instead of sliding {#d05}

- **Location:** `src/render/renderer.js:180-182`; manifests in the `stepped` case at
  `renderer.js:353-356`. Monster ids are numbers (`game.js:331/364`,
  `rng.int(1000000)`), emitted raw in events (e.g. `stepped` `game.js:977`).
- **Defect:** `unitKey` stringifies a non-object ref and prefixes `'h'` unless it
  already starts with `h`/`m`: `s[0]==='h'||s[0]==='m' ? s : 'h'+s`. A numeric
  monster id `742891` → `'742891'` → first char `'7'` → returns `'h742891'`, but
  monsters render and look up under `'m'+id`. The keys never match, and the
  `stepped` particle branch is gated on `k[0]==='h'` — true for the mis-keyed
  monster — so a moving monster runs the *hunter* sparkle branch with a null lookup.
- **Impact:** Every monster move **teleports** (the slide is stored under `h…`, never
  read) and moving-monster particles use hunter styling / default colors. Purely
  presentational — engine state is correct. (The battle-overlay and `monsterKilled`
  impacts are mitigated elsewhere by `canonicalKey()`/ghost fallback.)
- **Fix:** Resolve the id against the actual pool instead of guessing by leading
  char — apply the existing `canonicalKey()` pattern (already used for
  `battleStarted` at `renderer.js:686`) to `evKey`/the `stepped` path, or pass an
  explicit kind hint. Also delete or wire up the dead `monsterMoved` case
  (`renderer.js:393`; the engine never emits it).

---

## Medium

### D06 — Act-again (blue flag roll 6) does not reset `state.turn`, leaking `moved`/`cardPlayed` into the bonus action {#d06}

- **Location:** `src/engine/game.js:286-294` (actAgain branch); interacts with the
  spawn gate at `game.js:282` and the yellow-card spawn-halving at `game.js:343`.
- **Defect:** The actAgain branch clears only `state.turn.actAgain` and returns to
  `turn.action` for the same unit — it never resets `moved`/`rested`/`cardPlayed`
  (contrast the normal path at `game.js:308`). Act-again is only reachable via a Move
  (you must step onto a blue flag), so `turn.moved` is always `true` going in. On the
  bonus action: a Rest/Attack still leaves `moved===true`, so the next `applyEndTurn`
  runs an **undeserved second monster-spawn check** for a non-move turn; a card-less
  bonus Move keeps the stale `cardPlayed`, which can wrongly halve the spawn chance.
- **Impact:** Violates the §2.10 "spawn check only if the hunter moved" rule and
  breaks same-seed determinism by consuming extra RNG. Niche trigger (blue flag +
  roll 6).
- **Fix:** In the actAgain branch, replace `state.turn.actAgain = false;` with
  `state.turn = { moved: false, rested: false, actAgain: false };` (mirroring
  `game.js:308`). The per-action end-of-turn card draw is intentional — leave it.

### D07 — Round counter never advances while no monster is alive {#d07}

- **Location:** `src/engine/game.js:300-302`; coupled to `getNextCurrent`
  (`game.js:98-122`).
- **Defect:** `state.round` increments only on a monster→hunter-0 transition:
  `if (previous?.kind === 'monster' && next.kind === 'hunter' && next.index === 0)`.
  `getNextCurrent` skips dead/absent monsters, so with no live monster (the common
  early game — monsters spawn ~20% per moved turn) the cycle is all-hunter,
  `previous.kind` is never `'monster'`, and `round` stays `1`. Per §2.4 a round is a
  full hunter cycle regardless of monsters. (Secondary: if hunter 0 is stunned and
  skipped, `next.index !== 0` and a legitimate increment is also dropped.)
- **Impact:** HUD shows `R1` until a monster first acts; round-keyed logic
  (AI panic / RAVEN cycle at `ai.js:34/39/225`) is frozen during early all-hunter
  turns. (Rescue hold-back is only slightly delayed, not frozen — looting AI still
  move and eventually spawn a monster.)
- **Fix:** Decouple the bump from monsters — increment when the turn order wraps back
  to the lowest-index *live* hunter (track an "order wrapped" flag in
  `getNextCurrent`). Preserve the `round` starting value of 1.

### D08 — AI ranks lettered special cards (RS/RC/YD/YA) as value 0, so it never prefers its strongest battle cards {#d08}

- **Location:** `src/engine/ai.js:194-198` (`chooseBattleCard` sort).
- **Defect:** Battle-card value is `parseInt(card.replace(/\D/g,''),10) || 0`. The
  specials have no digits → `''` → `parseInt('')` is `NaN` → `0`, sorting them below
  every numbered card. So the AI plays `Y9` instead of `YD` (100% evade) when
  guarding, `R9` instead of `RS` (double AT) when attacking, etc. — contradicting
  §2.11 ("always play the highest-value legal card"). Specials are only ever played
  as a last resort.
- **Impact:** AI opponents systematically fail to use guaranteed-evade / AT-doubling
  / foe-AT-stealing cards, making battles easier than the spec dictates.
- **Fix:** Assign explicit high weights to specials (via `isSpecial`/
  `cardEffectInfo`) — treat `YD/YA` above any numbered yellow and `RS/RC` above any
  numbered red. Keep `BE` out of the ranking except when escaping. Add a regression
  test (AI picks `YD` over `Y9` guarding; `RS` over `R9` attacking).

### D09 — WYRM death detonation and monster-kill FX are unreachable {#d09}

- **Location:** `src/render/renderer.js:258-263` (ghost creation, never fires) and
  `932-981` (`monsterKilled` handler); root cause `src/engine/game.js:637-639`.
- **Defect:** Monster "ghosts" (used to animate a dying monster and detect its kind)
  are created only when a monster present in `prev.monsters` is absent from
  `next.monsters`. But the engine never removes a dead monster — on kill it sets
  `defender.hp = 0; defender.pos = null` and filters by `hp > 0` (and reuses the dead
  WYRM object on respawn). So no ghost is ever created: `killKind` is `undefined`
  (WYRM detonation branch dead), and `kpos` resolves to the now-null position,
  suppressing the **entire** kill burst/ring/DROP float.
- **Impact:** Players never see the WYRM void-detonation, and ordinary monster kills
  frequently show no FX at all — the monster just vanishes. Cosmetic only.
- **Fix:** Create the ghost from the kill itself — have `diffOverrides` make a ghost
  when a monster transitions `hp>0 → hp<=0` (capturing `pos`/kind then), or include
  `pos` in the `monsterKilled` event and synthesize a ghost in the handler.

---

## Low

### D10 — Flag roll-1 self-trap springs with no dodge minigame or passive evasion {#d10}

- **Location:** `src/engine/game.js:1009-1012`.
- **Defect:** §2.6 says the roll-1 flag trap "springs on the spot (dodgeable)". The
  normal trap path (`game.js:988-1001`) gives humans the `react.dodge` minigame and
  applies passive evasion (yellow card / sensors); the flag-roll-1 path calls
  `triggerTrap(...)` directly for everyone, bypassing both. (The `noSelfTrap` perk
  still applies, so it's perk-gated mitigation only.)
- **Impact:** A human who claims a flag and rolls 1 always eats the trap, contrary to
  the documented dodgeable behavior. 1/6 of claims; minor effects.
- **Fix:** Mirror `game.js:990-1001` for the flag self-trap — run `passiveEvasion`
  first, and for humans set `state.move.trap` + `phase = 'react.dodge'` instead of
  calling `triggerTrap` directly. AI can keep the direct call.

### D11 — Dead `claimFlag()` function with a no-op stub {#d11}

- **Location:** `src/engine/game.js:409-413`.
- **Defect:** `claimFlag(state, hunter, flag)` has no callers (the live logic is
  inline in `applyStep`, `game.js:1003-1013`) and contains a degenerate line
  `const roll = state.rng ? null : null;`. Latent risk: a future edit wiring it up
  would claim a flag without awarding points or applying effects.
- **Fix:** Delete `claimFlag()`.

### D12 — Black Gem / Amulet die-cap is applied before crit detection, doubling the crit rate {#d12}

- **Location:** `src/engine/combat.js:45-48`.
- **Defect:** `capDie` clamps each raw d6 (Black Gem `min(d,4)`, Amulet `max(d,3)`)
  and the **clamped** dice feed the doubles test (`crit = sDice[0] === sDice[1]`).
  Clamping collapses distinct faces onto the cap, so raw non-doubles like (5,6),(6,4)
  register as doubles: enumerating all 36 outcomes, crit rises from **6/36 → 12/36**
  for both items. DESIGN.md describes these items only as a value clamp and defines
  Critical separately as "attacker's 2d6 doubles" — it does not say the doubles test
  runs on clamped values, so this is a spec-interpretation defect ("likely").
- **Impact:** A Black Gem / Amulet holder crits (and procs crit statuses + Warbanner/
  Actuator/Generator/Aegis) ~2× as often as the readout implies. Rare high-cost
  items, so limited blast radius.
- **Fix:** Decide intent in DESIGN.md and make `combat.js` and `odds.js` agree (see
  [D13](#d13)). If "crit = the dice you rolled" is intended, compute `crit` from the
  **raw** dice before clamping; clamp only the totals.

### D13 — `odds.js` readout ignores die-cap and Warbanner/Aegis, mis-stating damage for item holders {#d13}

- **Location:** `src/engine/odds.js:69` (constant `pCrit: 6/36`); callers
  `src/ui/screens.js:2320/2408` pass no item flags.
- **Defect:** `battleOdds` hardcodes `pCrit = 6/36` and models neither die-capping
  (see [D12](#d12)) nor — as wired — Warbanner/Aegis (the callers omit
  `atkWarbanner/defAegis`). The module's contract is that it "mirrors combat.js
  strike math so the readout never lies" (`odds.js:8-9`). The player-visible gap is
  in **`expectedDamage`/`pHit`** (which the UI shows), not `pCrit` (which no UI reads).
- **Impact:** For a holder of Black Gem / Amulet / Warbanner / Aegis the pre-commit
  odds readout is inaccurate, undermining the "never lies" agency-tool guarantee.
- **Fix:** Add `blackgem/amulet/atkWarbanner/defAegis` inputs to `battleOdds`, apply
  `capDie` inside the 36×36 enumeration, derive `pCrit` from the enumerated capped
  doubles, and have `screens.js` pass the holder's actual effect flags. Update
  `tests/odds.test.mjs:15`.

### D14 — Dead `panicked: 25` react-rate entry — never reachable {#d14}

- **Location:** `src/engine/ai.js:222`; root cause `getBehavior` `ai.js:31-40`.
- **Defect:** `getBehavior` maps a panicked/RAVEN unit onto a concrete cycled
  priority (aggressive/clever/balanced/passive) and never returns the literal
  `'panicked'`, so the `panicked: 25` entry in the react-rate table is unreachable.
  RAVEN/panic timing uses the cycled priority's rate, not the intended 25. No
  functional bug — dead code that misencodes intent.
- **Fix:** Remove the `panicked: 25` entry, or detect panicked units before the cycle
  resolves and apply rate 25 explicitly.

### D15 — `encodeRunResult` and `decodeRunResult` disagree on the legal `date` set {#d15}

- **Location:** `src/share.js:38` (encode, no date validation) vs `src/share.js:57`
  (decode, strict `YYYY-MM-DD`).
- **Defect:** Encode writes `String(r.date ?? '')` and appends a valid checksum;
  decode rejects any date not matching `/^\d{4}-\d{2}-\d{2}$/`. So a well-formed,
  checksum-valid string with a missing/malformed date fails its own decode,
  contradicting the header contract ("decode returns null only for malformed or
  tampered strings"). **Currently dead code** — `share.js` is imported only by its
  test; the live share path is `save.js` `buildShareString`.
- **Fix:** Make encode validate/normalize `date` the same way decode does (or let
  decode accept an empty/sentinel date for non-daily runs). Also reconcile the two
  divergent share implementations (`share.js` vs `save.js:202`) and update the stale
  ADR-005.

### D16 — `decodeRunResult` accepts a version-less tag as `version:0` {#d16}

- **Location:** `src/share.js:53` and `:59-63`.
- **Defect:** `tag.startsWith(PREFIX)` passes for a bare `'BHD'`; `version =
  Number(tag.slice(3))` = `Number('')` = `0`, which is finite and passes the guard.
  There is no `version <= VERSION` / integer check, so a bare or future-version tag
  is accepted with v1 semantics. Latent (decode has no production callers yet).
- **Fix:** `const version = Number(tag.slice(PREFIX.length)); if (!Number.isInteger(version) || version < 1 || version > VERSION) return null;`

### D17 — Leaderboard sort corrupts (NaN comparator) on a non-numeric stored score {#d17}

- **Location:** `src/save.js:253` (comparator); root cause `loadAllLeaderboards`
  `save.js:227-234` (no per-entry validation).
- **Defect:** `board.sort((a,b) => b.score - a.score || a.ts - b.ts)` yields `NaN`
  for any entry whose `score` is non-numeric, producing an inconsistent comparator,
  a mis-ordered board, and a wrong returned rank. Reachable only via tampered/foreign
  localStorage (in-app writes are always numeric), hence low.
- **Fix:** Sanitize on load in `loadAllLeaderboards` — drop or coerce entries whose
  `score` is not finite so the comparator only ever sees numbers.

### D18 — `Date.now()` seed fallback inside the deterministic engine {#d18}

- **Location:** `src/engine/game.js:702`.
- **Defect:** `const seed = config.seed ?? Date.now();` reads the wall clock inside
  `src/engine/`, violating the ADR-002 engine-purity rule (no non-deterministic
  global reads; the only such read in the whole engine dir). A seedless game is
  unreplayable because the auto-seed is never surfaced. Dead in shipped flows
  (`main.js`/relic-dive always pass a seed), reachable for any other caller.
- **Fix:** Keep wall-clock seeding in the caller. Make `seed` required (throw if
  omitted) or default to a deterministic constant — **not** `config.seed >>> 0`,
  since `undefined >>> 0` silently becomes seed 0.

### D19 — `unitFlash` tint freezes on a unit during fast (AI) playback {#d19}

- **Location:** `src/render/renderer.js:735-736` (set with `dur = 360`), advanced at
  `:1081` against the compressed `anim.dur`, never cleared for `strikeRolled`.
- **Defect:** `strikeRolled` sets `unitFlash.dur = 360` but `anim.t` maxes at the
  *effective* (time-scaled) duration, e.g. 120 at `timeScale ≥ 3`. So `ft = 120/360
  = 0.33` → alpha ~0.8 at anim end, and nothing (endEvent/update/idleSync) decays it.
  Only `timeScale > 1` (AI turns) is affected.
- **Impact:** A colored impact tint stays stuck over the struck unit between turns
  until the next strike/defeat/warp or a human keypress clears it. Cosmetic,
  self-healing.
- **Fix:** Set `unitFlash.dur = eventDuration('strikeRolled', timeScale)` at the set
  site (so `ft` reaches 1/alpha 0), or time-decay `unitFlash` in `update()` like
  `shake`/`turnFlash`, or clear it for `strikeRolled` in `endEvent`.

### D20 — RESULTS `[H]` Daily-Hunt shortcut pops to Client (not Hub) in story mode {#d20}

- **Location:** `src/ui/screens.js:3466-3471`; downstream `RunSummary` pop at
  `screens.js:3991`.
- **Defect:** The `[H]` handler does `stack.pop()` (comment: "go to hub first") then
  pushes the relic-dive screen. The assumption "below RESULTS is the Hub" holds for
  Quick Start (`[Title, Hub, RESULTS]`) but **not story**: a story briefing replaces
  itself with GAME, leaving `[Title, Hub, Client, RESULTS]`, so `pop()` lands on
  Client. After the dive, `RunSummary`'s pop returns to Client too. *(Normal mode is
  not affected — its party menu is an internal host, so Client is replaced.)*
- **Impact:** Launching a Daily Hunt from a story win lands you on the Client desk
  (in the old mode) instead of the Guild Hub. Navigation only.
- **Fix:** Don't assume the screen below is the Hub — pop down to the tagged Hub
  screen (or replace RESULTS routing through the Hub) and unwind `RunSummary` to Hub.

### D21 — Esc during steering opens the pause menu instead of committing the move {#d21}

- **Location:** `src/ui/screens.js:2524` shadows the steering cancel arm at
  `screens.js:2544-2546`.
- **Defect:** The global `if (k === 'cancel' && !host.top()) { openPauseMenu();
  return; }` runs before the steer branch. During `turn.steer` no menu is pushed, so
  `host.top()` is null and Esc always opens pause — the steer branch's
  `confirm || cancel → stop` handler is unreachable for `cancel`. Author intent
  (pairing `confirm || cancel`) is defeated; `confirm` (Enter/Space/own-tile click)
  still commits, so it's a UX quirk.
- **Fix:** Gate the pause shortcut with `&& !steering`, or drop `|| k === 'cancel'`
  at `2544` if Esc-means-pause is the intended UX (prefer the former).

### D22 — Held arrow key during steering auto-walks/overshoots (no `e.repeat` guard) {#d22}

- **Location:** `src/ui/screens.js:2541` (step handler); compare the guarded timing
  minigame at `screens.js:2530`.
- **Defect:** The step handler applies a step on every direction keydown with no
  `e.repeat` guard. Held keys past the OS repeat delay auto-walk tiles (throttled to
  ~1 tile per renderer animation cycle by the `rendererBusy` skip gate, so not
  unthrottled, but still able to overshoot the intended tile). "likely".
- **Fix:** `if (DIR_BY_KEY[k] && !e?.repeat) { … }`, mirroring `screens.js:2530`.

### D23 — Held Enter falls through the YOUR-TURN menu into the Move/Attack submenu {#d23}

- **Location:** `src/ui/screens.js:2525` (menu dispatch drops the raw event);
  vulnerable flow `screens.js:2363/2374/2380` (Move/Attack push a submenu
  synchronously without `act()`).
- **Defect:** Open-menu keys route to `host.key(k)` with no `e.repeat` filter. Where
  `onPick` synchronously pushes a follow-up menu (YOUR TURN → Move/Attack submenu),
  a held Enter fires `pick` on each auto-repeat, advancing into the submenu and
  committing its default-highlighted option. *(Battle-response/steal chains are
  **not** vulnerable — they go through `act()`, which clears the host and defers the
  next menu to a `rendererBusy`-gated tick.)* Requires physically holding Enter.
- **Fix:** Guard the menu branch like the timing branch:
  `if (host.top()) { if (!(k === 'confirm' && e?.repeat)) host.key(k); return; }`.

### D24 — `setVolumes()` assigns `gain.value` directly, causing a click/pop on slider scrub {#d24}

- **Location:** `src/audio/synth.js:35-37`; caller `src/ui/screens.js:1925`.
- **Defect:** `setVolumes` sets `master/music/sfxGain.gain.value` by direct
  assignment while audio plays, creating a sample-level discontinuity (a click/tick).
  Called on every volume-slider keystroke. The file's own `note()`/`noise()` use
  scheduled ramps, making this the outlier. Audio-quality only; click magnitude
  scales with instantaneous amplitude, so often faint.
- **Fix:** Ramp instead of step, e.g.
  `gain.setTargetAtTime(value, ctx.currentTime, 0.01)` or
  `gain.linearRampToValueAtTime(value, ctx.currentTime + 0.02)`.

---

## Found during the fix pass

### D25 — A boxed-in monster with no legal action deadlocks the turn loop {#d25}

- **Location:** `src/engine/game.js` `legalActions` (the `turn.action` branch).
- **Defect:** In `turn.action`, `rest` is offered only to hunters, and `move`/
  `attack` require a reachable adjacent tile / an adjacent enemy. A monster that is
  boxed in (every neighbour a wall or another unit) with no adjacent hunter therefore
  gets an **empty** action list. The turn loop (and the real game loop) has no way to
  advance past a unit with zero legal actions, so the game livelocks in `turn.action`.
  Surfaced as a hang in `termination` seed 17 once the D03/D07 behaviour changes
  steered two FNG monsters into adjacent tiles, one boxing the other in. Latent before
  (no seed happened to reach the state), but a genuine deadlock.
- **Impact:** The game can hang indefinitely (no progress, no terminal state) whenever
  a monster ends up unable to move with no hunter adjacent.
- **Fix:** When a `turn.action` unit has no other legal action, offer `{ type: 'pass' }`
  (routes through the existing `applyPass → applyEndTurn`, skipping the unit's turn).
  Only fires when the list is otherwise empty, so it never changes behaviour for a unit
  that can act — and cannot affect determinism for any previously-passing seed.
- **Guard:** `tests/termination.test.mjs` (all 20 seeds reach `mission.over`).

---

## Round 2 — newly found (open) {#round-2--newly-found-open}

Found by a second audit pass (2026-07-01) focused on proximity/engagement and
under-covered mechanics. **Documented with failing (todo) tests, not yet fixed.**
The pass also re-verified board generation/connectivity (1000 seeds), pathfinding,
mission setup, scoring math, and the *core* proximity rules (orthogonal-only
adjacency, move-then-attack reachable, monster defenders only counter) as correct.

### D26 — A hunter can Surrender to a monster attacker, handing it an item (or the Target) {#d26}

- **Severity:** High. **Spec:** §2.8 ("Surrender … not allowed vs monsters";
  "Monsters take nothing").
- **Location:** `src/engine/game.js:897` (the `battle.response` surrender gate checks
  only `defender.kind === 'hunter'` — never the *attacker's* kind); transfer at
  `applyRespond` (~`game.js:1164-1175`) and `applyPick` surrenderGive (~`game.js:1263-1288`).
- **Defect:** Monsters routinely attack adjacent hunters (§2.10). When one does, the
  defending hunter is wrongly offered **Surrender**; choosing it pushes the surrendered
  item into the *monster's* `items` — or, for the Target Item, sets `monster.hasTarget`
  and makes the monster the `targetHolder`, corrupting the target-chase/win logic.
- **Fix:** require the **attacker** to be a hunter before offering/allowing surrender
  (escape/guard remain legal vs monsters; monster *defenders* are already correctly
  limited to Counter).
- **Tests:** `tests/defects-r2-proximity.test.mjs` (R2-proximity-1/2/3).

### D27 — Rest lets an Empty-statused hunter draw cards {#d27}

- **Severity:** Medium. **Spec:** §2.9 ("Empty: … can't draw for 1 round"); §2.16.8.
- **Location:** `src/engine/game.js` `applyRest` (~`1145-1158`) → `drawDeckCards`
  (~`478-491`), which has no Empty gate.
- **Defect:** The end-of-turn auto-draw (`game.js:258`) and the green-flag-6 refill
  (`game.js:466`) both correctly skip drawing while `status.empty` is active, but
  **Rest** does not — an Empty hunter (e.g. hit by an FNG crit rider last turn) can
  Rest and refill a full hand, contradicting "can't draw for 1 round".
- **Fix:** gate Rest's draw on `status.empty` like the other two draw paths.
- **Test:** `tests/defects-r2-status.test.mjs` (R2-status-1).

---

## Round 3 — UI text defects found by automated screen study {#round-3--ui-text}

Found by Playwright A15-emulator automation + screenshot review (2026-07-01).
**Documented with failing tests, not yet fixed.**

### D28 — Options screen renders the SFX volume row label as "Sfx" instead of "SFX" {#d28}

- **Severity:** Low (presentation only).
- **Location:** `src/ui/screens.js` (~line 2056, options draw loop).
- **Defect:** The options draw loop uses `cap(row)` to label each row. `cap` uppercases
  only the first character, so the 'sfx' row renders as **"Sfx"** — an unreadable
  half-acronym. The correct label is **"SFX"** (industry-standard all-caps abbreviation).
- **Fix:** Add a special case: `row === 'sfx' ? 'SFX' : cap(row)`.
- **Test:** `tests/defects-ui.test.mjs` (D28 — currently failing).

### D29 — Options screen uses British spelling "Colour Blind" instead of "Color Blind" {#d29}

- **Severity:** Low (presentation only).
- **Location:** `src/ui/screens.js` (~line 2044, options draw loop, colorblind row).
- **Defect:** The colorblind accessibility row hardcodes the label `'Colour Blind'`
  (British English). The rest of the game and codebase uses American English spellings.
- **Fix:** Change the literal: `'Colour Blind'` → `'Color Blind'`.
- **Test:** `tests/defects-ui.test.mjs` (D29 — currently failing).

### D30 — Monster spawn banner always says "A [KIND] appears!" — wrong article for OOZ {#d30}

- **Severity:** Low (grammar).
- **Location:** `src/ui/screens.js` (~line 2218, `monsterSpawned` event handler).
- **Defect:** The spawn announcement uses the hardcoded indefinite article "A":
  `` say(`A ${ev.kind} appears!`, 2.2, '#cc4a3a') ``
  OOZ (Slime) begins with a vowel, producing the grammatically incorrect
  **"A OOZ appears!"**. The correct form is **"An OOZ appears!"**.
- **Fix:** Use an article-aware expression:
  `` `${/^[AEIOU]/.test(ev.kind) ? 'An' : 'A'} ${ev.kind} appears!` ``
- **Test:** `tests/defects-ui.test.mjs` (D30 — currently failing).

---

## Cross-cutting notes

- **Tests that assert buggy behavior (test-masking).** Some defects survive a green
  suite because tests pin the wrong behavior or sidestep the broken path. Fixing
  these requires *updating the guarding test*, not just the code:
  - [D01](#d01): `tests/game.test.mjs:894` injects WYRM `at/df/mv` manually, hiding
    the missing-stats spawn.
  - [D02](#d02): `tests/game.test.mjs:412` + the `runEscape` helper assert "escape
    skips defCard" — they validate the implementation against itself, not §2.8.
- **Determinism.** The engine is otherwise clean — `Date.now()` at `game.js:702`
  ([D18](#d18)) is the **only** non-deterministic global read in `src/engine/`; no
  `Math.random()` anywhere in the engine. RNG threading through `rng.s` is correct.
- **Dead / divergent code worth pruning:** `claimFlag` ([D11](#d11)), the `panicked`
  rate entry ([D14](#d14)), the unreachable `monsterMoved` render case ([D05](#d05)),
  and the two divergent share implementations (`share.js` vs `save.js`, [D15](#d15)).

## Investigated — not defects

These were raised by finders but **refuted** on verification:

- **Hub `D`/`H`/`L` hotkeys fire in story mode with no buttons** — mostly false:
  `D` maps to the `right` cursor move (the raw-`KeyD` branch is dead code) and `L`
  is advertised + mode-agnostic. Only `H` (Daily Hunt) is a genuinely undocumented
  but low-impact, reversible leak.
- **`noise()` never calls `src.stop()` → audio bleed** — false: a finite,
  non-looping `BufferSource` self-terminates at `t0+dur`; `stop()` is optional and
  notes bleed identically over the same lookahead window.
- **`validateGrid`/`gridSize` crash on empty-array input** — true mechanically but
  unreachable: every grid flows from static, non-empty hand-authored sprite data.
- **`bake()` throws `ReferenceError` outside a browser** — unreachable: the only
  caller, `buildAtlas`, is already DOM-guarded; tests import only `validateGrid`/
  `gridSize`.

---

*Generated by a multi-agent defect audit (16 module/cross-cutting finders →
per-finding adversarial verification against live code), then spot-verified by hand
for all Critical/High items. 29 findings raised, 25 confirmed, 4 refuted.*
