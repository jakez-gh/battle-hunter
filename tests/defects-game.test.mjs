// Regression tests documenting diagnosed engine (GameState) defects.
// Each test asserts the CORRECT / spec behavior. These are hard regression guards:
// the defects are fixed, so each test now passes; it will fail if the defect
// regresses. See DEFECTS.md.
//
// Pure: no DOM / canvas / audio / timers / network. RNG is seeded or the rng
// seed is set explicitly so every documented failure is reproducible.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGame, legalActions, applyAction } from '../src/engine/game.js';

const GAME_SRC = readFileSync(new URL('../src/engine/game.js', import.meta.url), 'utf8');

// --- shared helpers ---------------------------------------------------------

function hunter(id, slot, opts = {}) {
  return {
    id, slot,
    name: opts.name ?? id,
    spriteId: 0,
    palette: 'cobalt',
    human: opts.human ?? false,
    archetype: opts.archetype ?? null,
    level: opts.level ?? 1,
    internal: opts.internal ?? { mv: 3, at: 4, df: 4, hp: 4 },
    maxHp: opts.maxHp ?? 19,
    items: opts.items ?? [],
  };
}

function makeGame(seed = 1, overrides = {}) {
  return createGame({
    seed,
    mode: 'normal',
    hunters: [
      hunter('h0', 0, { human: overrides.humanSlot === 0 }),
      hunter('h1', 1, { human: overrides.humanSlot === 1 }),
    ],
    ...overrides,
  });
}

const clone = (x) => JSON.parse(JSON.stringify(x));

// Find an empty floor tile (no unit, no flag, no trap, no box, not the exit)
// adjacent to `pos` in cardinal direction `dir`. Returns the target pos or null.
const DIR_DELTA = { N: { x: 0, y: -1 }, S: { x: 0, y: 1 }, W: { x: -1, y: 0 }, E: { x: 1, y: 0 } };
function freeAdjacent(s, pos) {
  for (const [dir, d] of Object.entries(DIR_DELTA)) {
    const t = { x: pos.x + d.x, y: pos.y + d.y };
    if (t.y < 0 || t.y >= s.board.h || t.x < 0 || t.x >= s.board.w) continue;
    if (!s.board.floor[t.y]?.[t.x]) continue;
    if (s.board.exit && s.board.exit.x === t.x && s.board.exit.y === t.y) continue;
    if (s.board.flags.some((f) => f.x === t.x && f.y === t.y)) continue;
    if (s.board.traps.some((tr) => tr.x === t.x && tr.y === t.y)) continue;
    if (s.board.boxes?.some((b) => b.x === t.x && b.y === t.y)) continue;
    const occupied = [...s.hunters, ...(s.monsters || [])].some((u) => u.pos && u.pos.x === t.x && u.pos.y === t.y);
    if (occupied) continue;
    return { dir, pos: t };
  }
  return null;
}

// ---------------------------------------------------------------------------
// D01 — Deck-out WYRM spawned with no AT/DF/MV → NaN combat corrupts hunter HP
// ---------------------------------------------------------------------------

test('D01: engine-spawned deck-out WYRM has finite at/df/mv and resolves combat without NaN HP',
  () => {
    // Build a turn.steer state for an AI hunter with one step remaining, an
    // EMPTY deck and NO monsters, so finishing the move drives endMovement →
    // applyEndTurn → maybeSpawnMonster (deck-out branch) → spawn a WYRM with NO
    // manually-injected stats. (Do NOT replicate the test-masking trick of
    // setting s.monsters[0].at by hand — that masking is the bug being documented.)
    const s = clone(makeGame(3));
    s.deck = [];
    s.monsters = [];
    s.turn = { moved: true, rested: false, actAgain: false };
    const cur = s.hunters[s.current.index];
    const step = freeAdjacent(s, cur.pos);
    assert.ok(step, 'found a free adjacent tile to step onto');
    s.phase = 'turn.steer';
    s.move = { remaining: 1, path: [], cardPlayed: null, trap: null };

    const { state: after } = applyAction(s, { type: 'step', dir: step.dir });

    const wyrm = (after.monsters || []).find((m) => m.kind === 'WYRM');
    assert.ok(wyrm, 'a WYRM spawned from the exhausted deck');
    assert.ok(Number.isFinite(wyrm.at), `WYRM.at must be finite, got ${wyrm.at}`);
    assert.ok(Number.isFinite(wyrm.df), `WYRM.df must be finite, got ${wyrm.df}`);
    assert.ok(Number.isFinite(wyrm.mv), `WYRM.mv must be finite, got ${wyrm.mv}`);

    // Now resolve a WYRM-vs-hunter battle using the engine-spawned WYRM as-is.
    const b = clone(after);
    const wIdx = b.monsters.findIndex((m) => m.kind === 'WYRM');
    b.hunters[0].hp = 1;
    b.hunters[0].maxHp = 10;
    b.hunters[0].human = false; // AI defender → no react.crit minigame
    b.phase = 'battle.response';
    b.battle = {
      attacker: { kind: 'monster', index: wIdx },
      defender: { kind: 'hunter', index: 0 },
      stage: 'response', response: null, defCard: null, atkCard: null,
    };
    let r = applyAction(b, { type: 'respond', response: 'guard' });
    r = applyAction(r.state, { type: 'battleCard', card: null });
    r = applyAction(r.state, { type: 'battleCard', card: null });
    const victim = r.state.hunters[0];
    assert.ok(Number.isFinite(victim.hp), `hunter HP must be finite after WYRM combat, got ${victim.hp}`);
    // The WYRM (at~12) vs a 1-HP, DF-low hunter should be lethal → defeated and
    // re-spawned at hp 1 (defeatHunter), never left at NaN/unkillable.
    assert.ok(victim.hp >= 0, 'hunter HP is non-negative');
    assert.equal(victim.tally.defeats, 1, 'lethal WYRM damage marks the hunter defeated');
  });

// ---------------------------------------------------------------------------
// D02 — Escape response skips battle.defCard (defender's blue/E card never played)
// ---------------------------------------------------------------------------

test('D02: escaping HUNTER defender reaches battle.defCard to play their blue/escape card',
  () => {
    const s = clone(makeGame(1));
    s.hunters[1].hand = ['B2']; // blue card → escape response is offered
    s.phase = 'battle.response';
    s.battle = {
      attacker: { kind: 'hunter', index: 0 },
      defender: { kind: 'hunter', index: 1 },
      stage: 'response', response: null, defCard: null, atkCard: null,
    };
    // Sanity: escape is a legal response when the defender holds a blue card.
    assert.ok(legalActions(s).some((a) => a.type === 'respond' && a.response === 'escape'),
      'escape response is offered to a blue-card-holding hunter defender');

    const { state: after } = applyAction(s, { type: 'respond', response: 'escape' });
    // Per §2.8 an escaping defender plays a blue card whose value feeds the flee
    // roll (E = guaranteed escape). The engine must therefore route to defCard.
    assert.equal(after.phase, 'battle.defCard',
      'escaping hunter defender must get battle.defCard, not jump to battle.atkCard');
  });

// ---------------------------------------------------------------------------
// D06 — Act-again (blue flag roll 6) never resets state.turn
// ---------------------------------------------------------------------------

test('D06: act-again resets state.turn (moved/cardPlayed) before the bonus action',
  () => {
    // Arrange the current hunter with a "just claimed a blue flag, rolled 6"
    // turn record: moved=true, a yellow card played, actAgain pending. Drive a
    // turn-ending action (rest) which runs applyEndTurn → the actAgain branch.
    const s = clone(makeGame(1));
    s.deck = s.deck.length ? s.deck : ['R1', 'R2', 'R3']; // keep deck non-empty
    s.turn = { moved: true, rested: false, actAgain: true, cardPlayed: 'Y3' };
    const idx = s.current.index;

    const { state: after } = applyAction(s, { type: 'rest' });

    // Same hunter re-enters turn.action for the bonus action.
    assert.equal(after.phase, 'turn.action', 're-enters turn.action for the bonus action');
    assert.equal(after.current.index, idx, 'bonus action belongs to the same hunter');
    // The turn record must be clean so the bonus action gets an honest spawn
    // check / spawn-chance (not the stale moved/cardPlayed from the prior action).
    assert.equal(after.turn.moved, false, 'turn.moved reset for the bonus action');
    assert.ok(after.turn.cardPlayed == null, 'turn.cardPlayed reset for the bonus action');
  });

// ---------------------------------------------------------------------------
// D07 — Round counter never advances while no monster is alive
// ---------------------------------------------------------------------------

test('D07: round advances after a full all-hunter cycle even with no monster alive',
  () => {
    // 2-hunter game, no monsters. Rest never sets turn.moved, so
    // maybeSpawnMonster never fires → the cycle stays all-hunter and is fully
    // deterministic. Per §2.4 a round is one full hunter cycle regardless of monsters.
    let state = makeGame(1);
    assert.equal(state.monsters.length, 0, 'no monsters at start');
    assert.equal(state.round, 1, 'round starts at 1');
    // Three full 2-hunter cycles worth of rests (>1 cycle).
    for (let i = 0; i < 6; i++) {
      state = applyAction(state, { type: 'rest' }).state;
      assert.equal(state.monsters.length, 0, 'still no monster spawned (rest never moves)');
    }
    assert.ok(state.round > 1, `round must advance past 1 over multiple hunter cycles, got ${state.round}`);
  });

// ---------------------------------------------------------------------------
// D10 — Flag roll-1 self-trap springs with no dodge minigame / passive evasion
// ---------------------------------------------------------------------------

test('D10: human stepping onto a flag and rolling 1 enters the dodge flow (react.dodge)',
  () => {
    // Construct a turn.steer state for a HUMAN hunter about to step onto an
    // unclaimed flag tile (no pre-existing trap there). Seed the rng so the
    // first d6 (the flag roll) returns 1: seed 7 → makeRng(7).d6()===1.
    const s = clone(makeGame(1, { humanSlot: 0 }));
    s.current = { kind: 'hunter', index: 0 };
    const cur = s.hunters[0];
    cur.human = true;
    cur.items = []; // no sensor items → passiveEvasion(0)
    const step = freeAdjacent(s, cur.pos);
    assert.ok(step, 'found a free adjacent tile to place the flag on');
    // Place an unclaimed flag on the target tile (and make sure no trap is there).
    s.board.flags = [{ x: step.pos.x, y: step.pos.y, color: 'red', taken: false }];
    s.board.traps = s.board.traps.filter((t) => !(t.x === step.pos.x && t.y === step.pos.y));
    s.phase = 'turn.steer';
    s.turn = { moved: true, rested: false, actAgain: false };
    s.move = { remaining: 2, path: [], cardPlayed: null, trap: null };
    s.rng = { s: 7 >>> 0 }; // first d6() == 1

    const { state: after } = applyAction(s, { type: 'step', dir: step.dir });

    // §2.6: the roll-1 flag trap "springs on the spot (dodgeable)". A human must
    // get the dodge minigame (react.dodge with move.trap set), exactly like the
    // normal trap path — current code calls triggerTrap directly and skips it.
    assert.equal(after.phase, 'react.dodge', 'human flag roll-1 self-trap is dodgeable (react.dodge)');
    assert.ok(after.move?.trap, 'the springing trap is recorded on state.move.trap for the dodge');
  });

// ---------------------------------------------------------------------------
// D11 — Dead claimFlag() function (no-op stub) should be deleted
// ---------------------------------------------------------------------------

test('D11: dead claimFlag() helper is removed from src/engine/game.js',
  () => {
    // Source-introspection: claimFlag is dead code (live logic is inline in
    // applyStep). The fix is to delete the function entirely.
    assert.doesNotMatch(GAME_SRC, /function\s+claimFlag\s*\(/,
      'game.js must not define a claimFlag() function (dead code per DEFECTS.md D11)');
  });

// ---------------------------------------------------------------------------
// D18 — Date.now() seed fallback inside the deterministic engine (ADR-002)
// ---------------------------------------------------------------------------

test('D18: engine has no Date.now() non-deterministic global read',
  () => {
    // Source-introspection: src/engine/ must contain NO non-deterministic global
    // reads. Date.now( is currently the only one (game.js seed fallback).
    assert.doesNotMatch(GAME_SRC, /Date\.now\s*\(/,
      'src/engine/game.js must not read Date.now() (engine purity, ADR-002, DEFECTS.md D18)');
  });
