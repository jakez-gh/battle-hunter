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

Recreated from the official US manual, four GameFAQs guides (antseezee,
Ayalla, MrL1193's AI guide, hi_ro_una_voce's JP-data FAQ), and the fan wiki.
Where sources conflict the better-evidenced value was chosen; where nothing is
documented, a default was chosen and logged in §2.15. All names below
(monsters, items, characters) are ORIGINAL replacements, mapped 1:1 onto the
documented mechanics.

### 2.1 Hunters and stats

Four stats: MV (movement), AT (attack), DF (defense), HP. Internally each stat
is a hidden integer point count (the "internal" value); displayed values
derive from it:

- `MV = floor(iMV / 3)` — added to the d6 movement roll and escape rolls
- `AT = iAT` — added to attack rolls
- `DF = floor(iDF / 2)` — added to defense rolls
- `maxHP = 7 + 3*iHP + (level - 1)`

Creation: each internal stat starts at 1 (displayed MV +0, AT 1, DF 0, HP 10);
the player allocates exactly **11 points** into internal stats, with live
display. Name ≤ 7 chars; pick one of 8 sprite designs (4 m / 4 f) × 8 palettes.
Level-up (bought at hospital): +1 maxHP automatic, +1 internal point to
allocate. Level cap **15**.

Inventory: max **6 items**. The Target Item is tracked separately (does not
use a slot). Items are found unidentified; effects are inactive until
appraised at the broker — EXCEPT cursed items (marked ☠), which work while
unidentified. Same-category equipment doesn't stack; strongest applies. AI
hunters' items are always auto-identified.

### 2.2 Mission setup

- Always exactly **4 hunters** (humans + AI fill). Slot colors: P1 blue,
  P2 red, P3 yellow, P4 green.
- **Relic (dungeon) level** = `ceil(mean of hunter levels)`, range 1–15.
  Scales monster stats, trap counts/damage, box item pools, sell multipliers.
- Board (see §2.3.1) gets random placement of: 4 hunter starts, 1 EXIT,
  **8 item boxes** (exactly one holds the Target Item), **4 flags** (one each
  red/blue/green/yellow), and `floor(relicLevel * 1.5)` hidden pre-seeded
  traps of random type (default; undocumented).
- Deck: **100 cards**; 5 dealt to each hunter (hands public), **80** left in
  the shared draw deck (counter on HUD). The 2 blue E cards never appear until
  the deck is below 50 (shuffle E cards into the bottom 49).

### 2.3 Board

**2.3.1 Generation (assumption — see §2.15):** boards are assembled from a
pool of ≥8 hand-authored 10×10 sections placed in a 2×2 arrangement (20×20
bounding grid, ~50–60% walkable), with guaranteed corridor connections at
section seams. Maze-like: 1-tile corridors, chokepoints, some open rooms.
Tiles are floor or pit (impassable). Movement/adjacency is **orthogonal only**.

**2.3.2 Occupancy:** one unit per tile; occupied tiles are impassable (no
pass-through). Monsters additionally can never enter the EXIT tile.

### 2.4 Turn structure

Rounds: hunters act in slot order (fixed for the mission), then all monsters
act (spawn order), then next round. No hard turn limit — deck exhaustion is
the soft timer (spawns WYRM, §2.10).

On their turn a hunter picks ONE action:

- **Move** — see §2.5. After completing a move the hunter MAY attack one
  adjacent enemy (move-then-attack).
- **Attack** — battle with an adjacent hunter/monster (§2.7), without moving.
- **Rest** — heal `ceil(maxHP/4)`; draw 2 cards (3 if hand was empty),
  subject to hand cap and deck.

End of turn: draw 1 card if hand < 5 and deck > 0 (skipped if Rest already
drew). Then monster-spawn check (§2.10). Statuses tick per §2.9.

### 2.5 Movement

1. Optionally play exactly ONE card with the Move (blue = +1/+2/+3 range or
   E = warp to EXIT; yellow = trap evasion value×10% for this move, D/A =
   100%, also halves monster-spawn chance this turn; green = set that trap
   type on the tile being vacated, then move).
2. Roll d6 (does not consume the deck). Range = `d6 + MV + blue bonus`.
   Leg Damage: MV contributes 0 (1 with identified Crutch).
3. Steer step-by-step up to range, orthogonally; may stop early; backtracking
   allowed; minimum 1 step (if no legal first step, Move is unavailable).
4. Entering a tile resolves it immediately:
   - **Trap**: timed-dodge minigame (human; AI never dodges) + passive evasion
     (yellow card / sensors — best single source, no stacking). Triggered →
     effect applies, trap consumed, movement ends. Dodged → trap stays armed,
     movement continues. Max 3 traps/tile resolve one at a time.
   - **Item box**: opens only if the hunter ENDS movement on it (assumption).
     Target Item → announced to all, can't be discarded. Ordinary item → if
     inventory full, choose discard (AI: drops lowest value).
   - **Flag**: claim + roll d6 (§2.6). Tile becomes plain floor.
   - **EXIT**: with Target Item → mission ends, win. Without → warp to a
     random floor tile (also cures Leg Damage).

### 2.6 Flags

Claiming rolls d6. All results award score. 1: 250 pts + a trap typed by flag
color (red→Damage, blue→Leg, green→Empty, yellow→Stun) springs on the spot
(dodgeable). 2: 250 pts. 3: 500. 4: 1000. Color 5/6:
red 5 = 250 + heal (Rest amount); red 6 = 250 + full heal + restore half of
lost maxHP (round up); blue 5 = 250 + cure Leg; blue 6 = 250 + cure Leg + act
again; green 5 = 250 + draw 2 (needs deck ≥ 2); green 6 = 250 + refill hand
to 5 (needs deck ≥ 5; blocked by Empty); yellow 5 = 1500 pts; yellow 6 = 2000.

### 2.7 The 100-card deck

| Color | Count | Values |
|---|---|---|
| Red (attack, battle only) | 20 | +3×3 +4×3 +5×3 +6×3 +7×2 +8×2 +9×2, C×1 (add opponent's AT), S×1 (double own AT) |
| Yellow (defense / trap evasion) | 30 | +3×7 +4×6 +5×5 +6×4 +7×3 +8×2 +9×1, D×1 (double DF / 100% evasion), A×1 (take 0 damage / 100% evasion) |
| Blue (movement / escape) | 30 | +1×16 +2×8 +3×4, E×2 (warp to EXIT / guaranteed escape) |
| Green (traps, on Move only) | 20 | Damage×5, Stun×5, Leg×5, Empty×5 |

One card max per action (one per side per battle). Deck never reshuffles;
at 0 the boss spawns and no one draws again.

### 2.8 Battle

One exchange per battle. Sequence:

1. Attacker declares battle on an adjacent target.
2. **Defender responds first** (stunned defenders can't respond: DF = 0,
   no card): choose **Counter** (card: red or yellow), **Guard** (DF doubled,
   no counter; card: yellow), **Escape** (card: blue), or **Surrender**
   (no card; hand over 1 item of the DEFENDER's choice, take no damage, warp
   to random tile, cures Leg Damage; not allowed vs monsters). Defender picks
   their card, THEN attacker picks theirs (red/yellow/blue legal).
3. **Escape resolution** (if chosen): each side rolls 2d6 + MV + blue card
   value (+ escape items, fleeing side). Defender escapes on STRICTLY higher
   total (ties → caught). E = auto-escape, but attacker's E beats it. Failure:
   defender DF = 0 for the strike.
4. **Strike**: attack total = 2d6 + AT + red card (S doubles own AT first,
   C adds opponent's AT). Defense total = 2d6 + DF(×2 if Guard) + yellow card.
   A = damage becomes 0. Damage = max(0, atk − def), display cap 99.
5. **Critical**: attacker's 2d6 doubles = charged strike (no damage bonus).
   If damage ≥ 1: Panic inflicted; vs hunters also 25% Leg Damage and 25%
   Empty (independent; defaults). Human defender can negate ALL crit statuses
   (not damage) with a timed press. Item riders: see catalog.
6. **Counter** (if chosen and defender alive): fresh 2d6 both sides, roles
   swapped; the single chosen cards apply where their color fits (defender's
   red boosts the counter; attacker's yellow defends it). Counters can crit.
7. **Defeat at 0 HP**: not eliminated. Victim warps to a random tile, maxHP
   halves (stacking ×0.5; repairable only at hospital), heals to new max on
   their next turn (that turn is consumed). A victorious HUNTER picks 1 item
   to take (including the Target Item — the steal mechanic). Monsters take
   nothing. **Exception:** WYRM defeating the Target Item holder ends the
   mission as a loss for everyone (story: game over; normal: all human
   hunters lose all items and credits).

Monsters never play cards, always counter when attacked, never escape or
surrender. Counter-item rule: attacking a monster FIRST while holding its
identified counter item makes it act stunned (no counter, DF 0).

### 2.9 Statuses

- **Stun**: skip next turn; DF treated 0; can't respond in battle. (1 turn)
- **Leg Damage**: MV contributes 0 until cured (EXIT, E card, defeat warp,
  surrender, blue flag 5/6). Crutch item → contributes 1.
- **Panic**: AI controls the hunter's next turn (random archetype routine).
- **Empty**: discard entire hand; can't draw for 1 round (default duration).

### 2.10 Monsters (original names; stats = documented tables)

Max 2 regular monsters at once (+1 WYRM). Spawn check at end of a hunter's
turn: only if that hunter moved; never adjacent-spawn onto hunters, flags or
trap tiles; blocked by holder's identified Wardstone; base chance 20%
(default; undocumented), halved if a yellow card was played that move.
Monster AI: attack adjacent hunter, else chase Target-Item holder (once
found), else nearest hunter, else map center. Ignore traps. Never enter EXIT.
Killed monsters may drop their counter item (50% default) into the killer's
inventory if there's room.

Stats (MV/AT/DF/HP by relic level 1–15):

- **VAC** (cleaner bot, kill +500, drops Override): L1 +2/2/2/16, L2 +2/2/2/17,
  L3 +2/2/2/18, L4 +3/2/2/19, L5 +3/3/2/20, L6 +3/3/2/21, L7 +3/3/2/22,
  L8 +3/3/2/23, L9 +4/3/2/24, L10 +4/4/2/25, L11 +4/4/3/26, L12 +4/4/3/27,
  L13 +4/4/3/28, L14 +5/4/3/29, L15 +5/5/3/30. Crit rider: none.
- **OOZ** (slime, kill +500, drops Repellent): L1 +1/5/0/25, L2 +1/5/0/29,
  L3 +1/6/0/30, L4 +1/6/0/34, L5 +1/7/0/35, L6 +1/7/0/39, L7 +1/8/0/40,
  L8 +1/8/0/44, L9 +1/9/0/45, L10 +1/9/0/49, L11 +1/10/0/50, L12 +1/10/0/54,
  L13 +1/11/0/55, L14 +1/11/0/59, L15 +1/12/0/60. Crit rider: none.
- **FNG** (hunter-killer mech, kill +750, drops Patch): L1 +1/6/3/13,
  L2 +1/6/3/14, L3 +1/7/3/15, L4 +1/7/4/16, L5 +1/7/4/17, L6 +2/7/4/18,
  L7 +2/7/4/19, L8 +2/8/4/20, L9 +2/8/5/21, L10 +2/8/5/22, L11 +3/8/5/23,
  L12 +3/8/5/24, L13 +3/9/5/25, L14 +3/9/6/26, L15 +3/10/6/27. Crit: +Empty.
- **WYRM** (deck-out boss, kill +500, drops Tamer): L1 +3/12/3/19,
  L2 +3/12/3/20, L3 +3/13/3/21, L4 +3/13/3/22, L5 +4/13/3/23, L6 +4/14/3/24,
  L7 +4/14/3/25, L8 +4/14/4/26, L9 +4/14/4/27, L10 +4/14/4/31, L11 +4/14/4/32,
  L12 +4/15/4/33, L13 +5/15/4/34, L14 +5/15/4/35, L15 +5/15/5/36. Crit: +Stun.
  Spawns at a random tile the moment the deck hits 0; relentlessly chases the
  Target-Item holder; respawns (full HP, random tile) after the round if
  killed; cannot be permanently removed.

### 2.11 AI hunters

16 archetypes share the documented stat lines (displayed stats at L1 → L15,
interpolated per level via the internal-point model):

| Archetype | L1 | L15 | Priority | Rest at |
|---|---|---|---|---|
| Normal | +1/4/2/16 | +3/7/3/42 | Balanced | 50% |
| Turtle | +0/2/3/25 | +2/2/7/42 | Passive | 75% |
| Bandit | +1/6/1/19 | +3/12/1/39 | Aggressive | 25% |
| Speedster | +2/3/1/19 | +4/6/3/36 | Clever | 50% |
| Defender | +1/2/3/19 | +2/5/5/45 | Passive | 75% |
| Guardian | +1/5/2/16 | +1/9/5/42 | Balanced | 50% |
| Bully | +0/5/3/16 | +1/10/6/33 | Aggressive | 25% |
| Elite | +1/6/2/13 | +3/9/4/30 | Clever | 50% |
| Battler | +1/4/2/19 | +2/8/4/42 | Aggressive | 50% |
| Survivor | +1/3/1/28 | +2/7/2/57 | Balanced | 100% |
| Collector | +3/1/2/10 | +5/1/5/30 | Passive | 75% |
| Runner | +3/1/1/16 | +6/1/1/45 | Clever | 25% |
| Sprint spec. | +4/1/0/10 | +8/1/1/27 | Clever | 0% |
| Attack spec. | +1/9/0/13 | +2/20/0/27 | Aggressive | 0% |
| Defense spec. | +1/1/4/16 | +1/1/10/36 | Passive | 100% |
| HP spec. | +1/1/1/34 | +3/1/1/72 | Balanced | 100% |

Priorities — Balanced: loot boxes, then chase Target holder. Aggressive:
ignore loot, pick fights, chase holder once Target found. Passive: boxes then
flags; fight only if cornered. Clever: loot until Target found, then chase.
Rest when HP below the listed fraction. Battle cards: always play the
highest-value legal card (yellow when guarding, red when opponent guards,
blue when fleeing/chasing); never dodge-time, never play yellow on moves;
trap priority when placing green cards: Damage > Stun > Empty > Leg, favoring
chokepoints near the EXIT once the Target is found. AI starting items by
level: L1–5 none, L6–8 one, L9–11 two, L12–15 three (random identified items).

### 2.12 Scoring & rewards

Score (cap 50,000): 15/tile moved; 25/HP damage dealt; flag rolls (§2.6);
kill bonuses (§2.10); handicap = max(0, (relicLevel − charLevel) × 250);
items held at end: 250 each (default), Target Item 1250 (default).
Placement 1st–4th by total. Credits paid to every hunter =
`floor(score / 15 × relicLevel)`; the hunter who returned the Target Item
additionally gets its listed price.

### 2.13 Hub (between missions)

Icon-driven hub screen, no walkable town:

- **Office**: register (create) hunter, view status, erase; save/load
  (localStorage).
- **Client**: mission select (story or normal free-play); sell items
  (haggle option: +10% on success at 30% odds, failure forces sale at 50% —
  defaults); appraise unidentified items (fee = 50 × character level).
- **Hospital**: repair lost maxHP at 50 cr × level per point; buy level-ups.
  Level-up fees L1→L15: 1000, 1500, 2500, 4000, 6000, 8500, 11500, 15000,
  19000, 23500, 28500, 34000, 40000, 46500 (cumulative 241,500).
- **Options**: volumes, wallpaper (unlocked by Disc items).

### 2.14 Items (original names; ~70 entries)

Format: name — base price [excavation level] effect. ×L = sells at price ×
relic level. ☠ = cursed, active unidentified.

Effects: Wardstone — 250 [1] no monster spawns beside holder. Warbanner —
6000 [10] own attack doubles → damage ×2. Aegis — 6000 [10] own defense
doubles → take 0. Voyager — 6000 [10] MV +1, wins escape/pursuit ties (loses
to E). Black Gem ☠ — 6666 [—] own rolls never 5–6. Amulet — 20000 [12] own
rolls never 1–2. Angel Feather — 8000 [10] heal d6 after each own action.
Medkit — 1000 [3] Rest heal ×1.5. Crutch — 500 [1] MV 1 while leg-damaged.
Calmant — 750 [2] Panic auto-cured at own turn start. Fear Stone ☠ — 6666 [—]
20% self-Panic at end of action. Dark Gem ☠ — 6666 [—] 20% self-Empty at end
of action. Old Doll — 25 [1] holder can't recover HP; attackers who damage
holder suffer a random status. Actuator — 10000 [12] own damaging doubles
inflict Empty. Generator — 10000 [12] own damaging doubles inflict Stun.
Prototype — 15000 [14] no effect (trophy). Cursed Gem ☠ — 6666 [—] trap
evasion −90%.

Equipment (same-category non-stacking): escape Slick Boots/Jumpsuit/Longcoat
+1/+2/+3 — 100/650/2500 [1/4/7]. Armor: Cap/Vest DF+1 — 750 [2]; Helm/Plate
DF+2 — 3000 [6]. Weapons: 5 families (Pistol, Rifle, Scatter, Claw, Blade) ×
AT +1/+2/+3 — 500/1000/2000 [3/6/8]. Sensors I–V: trap evasion
+5/10/15/20/25% — 200/400/800/1600/3200 [1/2/4/6/8].

Counter items (drop-only): Override (vs VAC) 250×L; Repellent (vs OOZ)
250×L; Patch (vs FNG) 500×L; Tamer (vs WYRM) 750×L.

Treasure: Scrap 50 [1]; Silver 750 [1]; Gold 1500 [5]; Platinum 3000 [7];
12 gems 200×L [1–5]; Silver Ring 150×L [2]; Gold Ring 250×L [5]; books/
bottles/curios 25–1250 [1–6]; Discs 1–15 — 100–950 [1–15], each unlocks a
wallpaper.

### 2.15 Modes & story

- **Normal**: free-play; 1–4 human hunters + AI fill; relic level =
  ceil(avg level).
- **Story**: solo only; 15 missions, one unlocked per level. Original
  scenario (ours): the hunter works for the Meridian Salvage Guild,
  recovering data relics from the ruins of the old world; a rival outfit,
  the RAVEN Syndicate, races them; its agents always behave Panicked
  (random archetype each turn). Mission types: fetch (default), rescue
  (M2: reach a stationary person before any rival; rival reaching them
  first = game over; rivals hold back for the first rounds), re-steal
  (M3, M6: a RAVEN carrier starts with the Target Item). Lineups: M1 3
  normal AI; M2 3 RAVEN; M3 RAVEN carrier + 2 AI; M4 rivals Keld + Mira +
  1 AI; M5 3 AI; M6 carrier + Keld + Mira; M7 3 AI (Target = Actuator);
  M8–12 3 RAVEN; M13 3 AI; M14–15 3 RAVEN. Rivals: Keld +1/7/1/16 (L1)
  → +3/15/1/30 (L15); Mira +2/4/0/19 → +5/8/0/36; both Clever.
  Story clear reward: ¼ of next level-up cost. Game over in story if a rival
  exits with the Target or WYRM kills the holder.

### 2.16 Assumptions log (chosen defaults where undocumented)

1. Turn order = fixed slot order (P1→P4), monsters after. 2. Orthogonal
movement/adjacency. 3. Board = 2×2 of authored 10×10 sections (~20×20).
4. Boxes open on END of movement only. 5. Move minimum 1 step; free steering
with backtracking; traps end movement on trigger. 6. Monster spawn chance
20%/moved turn. 7. Crit riders vs hunters 25%/25%. 8. Empty duration 1 round.
9. Item points 250 / Target 1250 at scoring. 10. Identify fee 50×level;
haggle 30% (+10%) / fail = half. 11. Pre-seeded traps = floor(level×1.5).
12. E-cards shuffled into bottom 49 of deck. 13. Monster drop chance 50%
(counter item). 14. Rest = 2 cards (3 from empty hand). 15. Flag points
accrue at roll time (JP table) rather than flat 500 at results.

## 3. Engine interface contract

Everything below is binding for implementation.

### 3.1 GameState (plain serializable object)

```js
{
  seed, rng: {s},               // mulberry32 state, advanced in place via makeRng-like wrapper
  mode: 'normal'|'story', missionId, relicLevel,
  board: { w, h, floor: bool[][],
           exit: {x,y},
           boxes: [{x,y, opened, contents: itemId|'TARGET'}],
           flags: [{x,y, color: 'red'|'blue'|'green'|'yellow', taken}],
           traps: [{x,y, kind: 'damage'|'stun'|'leg'|'empty', byHunter|null}] },
  deck: cardId[],               // index 0 = next draw
  targetItemId,                 // catalog id of this mission's Target Item
  targetFound: bool, targetHolder: unitRef|null,
  hunters: [{ id, slot, name, spriteId, palette, human, archetype|null,
              level, internal: {mv,at,df,hp}, maxHp, hp, baseMaxHp,
              hand: cardId[], items: [{itemId, identified}],
              pos: {x,y}, hasTarget: bool,
              status: {stun,leg,panic,empty},   // ints, turns remaining (leg = bool)
              tally: {moved, damage, flagPts, killPts, defeats} }],
  monsters: [{ id, kind: 'VAC'|'OOZ'|'FNG'|'WYRM', hp, maxHp, pos }],
  round, current: {kind:'hunter'|'monster', index},
  phase,                        // see 3.2
  move: null | {remaining, path: [{x,y}], cardPlayed},
  battle: null | {attacker, defender, stage, response, defCard, atkCard,
                  escaped, dice: {...}, pendingSteal|...},
  pendingChoice: null | {kind: 'steal'|'surrenderGive'|'discardOverflow', chooser, options},
  result: null | {placements, scores, credits, win},
  events: []                    // drained by caller after each applyAction
}
```

### 3.2 Phases and legal actions

`legalActions(state)` returns the full list for the unit/chooser to act.

| phase | actions |
|---|---|
| `turn.action` | `{type:'move', card?}`, `{type:'attack', target}`, `{type:'rest'}` |
| `turn.steer` | `{type:'step', dir:'N'|'S'|'E'|'W'}`, `{type:'stop'}` (≥1 step taken) |
| `turn.postMove` | `{type:'attack', target}`, `{type:'pass'}` |
| `battle.response` | `{type:'respond', response}` (defender) |
| `battle.defCard` / `battle.atkCard` | `{type:'battleCard', card: cardId|null}` |
| `react.dodge` / `react.crit` | `{type:'timing', hit: bool}` (human only; engine auto-submits hit:false for AI) |
| `choice.*` | `{type:'pick', option}` |
| `mission.over` | `{type:'confirm'}` |

applyAction validates, mutates a CLONE of state, appends events, returns it.
Dodge/crit timing minigame: UI measures the press and reports hit true/false;
passive evasion percentages are engine-side rolls.

### 3.3 Events (renderer/audio contract)

`turnStarted, dieRolled{value}, cardPlayed, cardDrawn, deckCount, stepped,
trapTriggered{kind}, trapDodged, trapSet, boxOpened{contents}, targetFound,
flagClaimed{color, roll, effect}, exitWarpedAway, drewBlank,
battleStarted, responseChosen, escapeRolled{aTotal,dTotal,escaped},
strikeRolled{dice, totals, damage, crit}, statusInflicted{kind},
critNegated, hunterDefeated, itemTaken{itemId}, surrendered,
monsterSpawned{kind}, monsterMoved, monsterKilled{drop},
wyrmSpawned, wyrmRespawned, healed{amount}, actAgain,
missionWon{winner}, missionLost{reason}, scoreTallied{rows}`

Each event carries `unit` refs where relevant. Renderer animates them in
order; audio maps each type to an sfx.

### 3.4 Module exports (signatures binding)

- `cards.js`: `CARDS` (catalog by id), `buildDeck(rng) -> cardId[]` (E-card
  rule applied), `cardColor(id)`, `cardValue(id)`.
- `items.js`: `ITEMS` catalog `{id, name, price, excavation, multiplied,
  cursed, category, effect}`, `rollBoxItem(rng, relicLevel) -> itemId`,
  `effectiveStats(hunter) -> {mv,at,df}` (equipment bonuses applied),
  `hunterHasEffect(hunter, effectKey) -> bool`.
- `monsters.js`: `MONSTERS` (stat tables), `monsterStats(kind, level)`.
- `board.js`: `generateBoard(rng, relicLevel) -> board`, `neighbors(board,
  pos)`, `pathDistance(board, state, from, to)` (BFS honoring occupancy),
  `randomFreeTile(state, rng)`.
- `combat.js`: `resolveBattle(ctx) -> {events, hpChanges, statuses, ...}` —
  pure resolver given both sides' choices + rng.
- `game.js`: `createGame(config)`, `legalActions(state)`,
  `applyAction(state, action) -> state` (events inside state.events),
  `isHumanTurn(state)`, `currentChooser(state)`.
- `ai.js`: `chooseAction(state) -> Action` for the current AI chooser
  (hunter archetypes, panic routines, monster moves all here).
- `missions.js`: `STORY_MISSIONS`, `makeNormalMission(hunters)`,
  `applyResults(roster, result)` (credits, item carryover).
- `save.js`: `loadRoster()`, `saveRoster(r)` (localStorage, versioned key).
