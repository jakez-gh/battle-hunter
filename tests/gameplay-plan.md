# Gameplay Test Plan

## Goals

Simulate complete game runs (all-AI and human+AI) to verify:
- Correctness: games always terminate, mechanics fire properly, win/loss conditions trigger
- Fun/playability: human player always has legal choices, events give feedback, turns are fair

These are integration-level tests — they run the full state machine via `applyAction`/`chooseAction`
rather than testing individual mechanics in isolation (those already live in game.test.mjs etc.).

## Helpers

- `makeHunter(id, slot, opts)` — same pattern as game.test.mjs
- `fastHunter(id, slot, opts)` — mv=9 hunters so games end quickly
- `runGame(config, maxSteps)` — simulate to `mission.over`, return `{ state, steps, events[] }`
- `runGameCheckHuman(config, maxSteps)` — same but count human-turn legal-action violations

## Test Sections

### [x] 1. Game Termination
- [x] Normal 2-hunter game terminates (seed 42, 3000 steps)
- [x] Normal 4-hunter game terminates (seed 1, 5000 steps)
- [x] Normal 4-hunter game terminates (seed 100, 5000 steps)
- [x] Completed game has `_missionEnd` with boolean `win`
- [x] Game advances beyond round 1

### [x] 2. Human Player UX
- [x] Human player always has legal actions on their turn (isHumanTurn → legalActions non-empty)
- [x] Human player can always rest in `turn.action` phase
- [x] Panicked human hunter is controlled by AI (`isHumanTurn=false`)

### [x] 3. Game Loop / Events
- [x] Events are emitted during gameplay (total events > 0)
- [x] `stepped` events are emitted (hunters actually move)
- [x] Hunters move at least 5 tiles each (tally.moved)
- [x] Battle events occur in combat-heavy configs

### [x] 4. Story Mission Types
- [x] All 15 story missions create without crash
- [x] `fetch` missions: board has boxes
- [x] `rescue` missions: `board.rescue` set, `rescueHoldRounds=2`
- [x] `resteal` missions: carrier holds target at start

### [x] 5. Multi-seed Robustness
- [x] Seeds 1, 7, 13, 42, 100 all produce terminated 4-hunter games

### [x] 6. Turn Fairness
- [x] Every hunter gets ≥5 turns before game ends
- [x] All hunters appear in turn order within first 100 steps

### [x] 7. Card Economy
- [x] Resting with empty hand draws cards (deck non-empty)
- [x] Battle events appear when hunters have aggressive stats

### [x] 8. Win/Loss Conditions
- [x] At least one of seeds {42,1,7,13,100} produces a win
- [x] `mission.over` is terminal: legalActions = [{type:'confirm'}]

### [x] 16. All 15 Story Missions — Parametric Simulation
- [x] Every STORY_MISSIONS entry runs to mission.over within 5000 steps
- [x] `_missionEnd.win` is always a boolean (covers win and loss outcomes)

### [x] 17. Monster Lifecycle
- [x] `monsterSpawned` events fire in a long 4-hunter game (20% per moved-turn)
- [x] `wyrmSpawned` fires when a hunter moves with an empty deck (deck.length === 0)

### [x] 18. Combat Consequences
- [x] `hunterDefeated` fires when Aggressive hunters fight each other
- [x] Repeated defeats reduce `hunter.maxHp` (defeatHunter halves it)
- [x] `healed` events fire when Aggressive hunters rest after taking damage
