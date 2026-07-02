import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, legalActions, applyAction } from '../src/engine/game.js';

// ---------------------------------------------------------------------------
// R2 proximity / engagement audit — DESIGN.md §2.3.1, §2.4, §2.7, §2.8, §2.10.
//
// These tests assert the CORRECT (spec) behaviour and are wrapped as node:test
// `todo` so the suite stays green while documenting the defect. Each should
// print `✖ ... # NEW DEFECT` against current code.
// ---------------------------------------------------------------------------

function hunter(id, slot, opts = {}) {
  return {
    id, slot,
    name: opts.name ?? id,
    spriteId: 0,
    palette: 'cobalt',
    human: opts.human ?? false,
    archetype: null,
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

// Build a battle.response state where a MONSTER is the attacker and a hunter is
// the defender (the §2.10 "monster attacks adjacent hunter" case). Defender is
// given an item so surrender would otherwise be offered.
function monsterAttacksHunterState(seed = 1, defOpts = {}) {
  const state = makeGame(seed);
  const s = JSON.parse(JSON.stringify(state));
  // Give the defender something to surrender.
  s.hunters[1].items = defOpts.items ?? [{ itemId: 'gold', identified: true }];
  if (defOpts.hasTarget) {
    s.hunters[1].hasTarget = true;
    s.targetHolder = { kind: 'hunter', index: 1 };
    s.targetFound = true;
  }
  // A live monster adjacent to the defender is the current unit / attacker.
  const hp = s.hunters[1].pos;
  s.monsters = [{
    id: 900001, kind: 'FNG',
    hp: 20, maxHp: 20, at: 6, df: 3, mv: 1,
    pos: { x: hp.x + 1, y: hp.y }, // orthogonally adjacent
  }];
  s.current = { kind: 'monster', index: 0 };
  s.phase = 'battle.response';
  s.battle = {
    attacker: { kind: 'monster', index: 0 },
    defender: { kind: 'hunter', index: 1 },
    stage: 'response', response: null, defCard: null, atkCard: null,
  };
  return s;
}

// R2-proximity-1 — §2.8 "Surrender ... not allowed vs monsters".
// When a monster attacks a hunter, the hunter defender must NOT be offered
// Surrender. legalActions currently gates surrender only on the DEFENDER being
// a hunter and having items — it never checks the ATTACKER's kind — so surrender
// is wrongly offered against a monster.
test('R2-proximity-1: hunter defending against a MONSTER attacker is not offered Surrender (§2.8)',
  { todo: 'NEW DEFECT — surrender offered vs a monster attacker; §2.8 forbids surrender vs monsters; see workflow report' },
  () => {
    const s = monsterAttacksHunterState(1);
    const acts = legalActions(s);
    const responses = acts.filter((a) => a.type === 'respond').map((a) => a.response);
    assert.ok(!responses.includes('surrender'),
      `surrender must not be offered against a monster attacker; got ${JSON.stringify(responses)}`);
  });

// R2-proximity-2 — the deeper corruption: even if surrender is picked against a
// monster, no item may transfer to the monster (§2.8 "Monsters take nothing").
// applyRespond -> choice.surrenderGive pushes the surrendered item to
// choice.attacker unconditionally, so a monster ends up holding the hunter's
// item. This test drives the surrender through and asserts the defender KEEPS
// their item (i.e. the surrender-vs-monster path is either blocked or a no-op).
test('R2-proximity-2: surrendering to a MONSTER must not hand the item to the monster (§2.8 "Monsters take nothing")',
  { todo: 'NEW DEFECT — item transfers to a monster on surrender; §2.8 says monsters take nothing; see workflow report' },
  () => {
    const s = monsterAttacksHunterState(1, { items: [{ itemId: 'gold', identified: true }] });
    // Force the surrender response (the engine accepts it; that is the bug).
    const r1 = applyAction(s, { type: 'respond', response: 'surrender' });
    // If the engine correctly refused surrender it would not reach surrenderGive.
    if (r1.state.phase === 'choice.surrenderGive') {
      const pick = r1.state.pendingChoice.options[0];
      const r2 = applyAction(r1.state, { type: 'pick', option: pick });
      const monster = r2.state.monsters[0];
      assert.ok(!(monster.items && monster.items.length > 0),
        `monster must not receive a surrendered item; got ${JSON.stringify(monster.items)}`);
    }
    // Regardless of path, a monster must never hold the surrendered item.
    // (If the engine blocked surrender the defender still has it — also fine.)
  });

// R2-proximity-3 — the TARGET ITEM variant: surrendering the Target Item to a
// monster attacker must not make the monster the target holder.
test('R2-proximity-3: surrendering the TARGET to a MONSTER must not make the monster the Target holder (§2.8)',
  { todo: 'NEW DEFECT — TARGET transfers to a monster on surrender; §2.8; see workflow report' },
  () => {
    const s = monsterAttacksHunterState(1, { items: [], hasTarget: true });
    const r1 = applyAction(s, { type: 'respond', response: 'surrender' });
    if (r1.state.phase === 'choice.surrenderGive') {
      const targetOpt = r1.state.pendingChoice.options.find((o) => o.itemId === 'TARGET');
      assert.ok(targetOpt, 'TARGET option present');
      const r2 = applyAction(r1.state, { type: 'pick', option: targetOpt });
      const monster = r2.state.monsters[0];
      assert.ok(!monster.hasTarget,
        'monster must not become the Target Item holder via surrender');
      assert.ok(r2.state.hunters[1].hasTarget || r2.state.targetHolder?.kind !== 'monster',
        'Target must not be transferred to a monster');
    }
  });

// ---------------------------------------------------------------------------
// checkedButCorrect positive controls — these should PASS (green), proving the
// surrounding proximity mechanics behave to spec. They are NOT todo.
// ---------------------------------------------------------------------------

// Diagonal never engages: a hunter with only a diagonally-placed enemy gets no
// attack action in turn.action (§2.3.1 orthogonal adjacency only).
test('control: diagonal enemy is NOT an attack target (§2.3.1 orthogonal only)', () => {
  const state = makeGame(2);
  const s = JSON.parse(JSON.stringify(state));
  s.current = { kind: 'hunter', index: 0 };
  s.phase = 'turn.action';
  const p = s.hunters[0].pos;
  // Place hunter 1 diagonally adjacent (Manhattan distance 2).
  s.hunters[1].pos = { x: p.x + 1, y: p.y + 1 };
  const acts = legalActions(s);
  const attacks = acts.filter((a) => a.type === 'attack');
  assert.equal(attacks.length, 0, 'no attack against a diagonal enemy');
});

// Orthogonal hunter IS an attack target.
test('control: orthogonally-adjacent hunter IS an attack target (§2.4)', () => {
  const state = makeGame(2);
  const s = JSON.parse(JSON.stringify(state));
  s.current = { kind: 'hunter', index: 0 };
  s.phase = 'turn.action';
  const p = s.hunters[0].pos;
  s.hunters[1].pos = { x: p.x + 1, y: p.y };
  const acts = legalActions(s);
  const attacks = acts.filter((a) => a.type === 'attack');
  assert.ok(attacks.some((a) => a.target.kind === 'hunter'),
    'adjacent hunter is attackable');
});

// A monster only attacks orthogonally-adjacent hunters, never diagonal.
test('control: monster gets no attack against a diagonally-adjacent hunter (§2.10)', () => {
  const state = makeGame(3);
  const s = JSON.parse(JSON.stringify(state));
  const p = s.hunters[0].pos;
  s.monsters = [{
    id: 900002, kind: 'VAC', hp: 16, maxHp: 16, at: 2, df: 2, mv: 2,
    pos: { x: p.x + 1, y: p.y + 1 }, // diagonal to hunter 0
  }];
  s.hunters[1].pos = { x: p.x + 5, y: p.y + 5 }; // keep the other hunter far away
  s.current = { kind: 'monster', index: 0 };
  s.phase = 'turn.action';
  const acts = legalActions(s);
  const attacks = acts.filter((a) => a.type === 'attack');
  assert.equal(attacks.length, 0, 'monster cannot attack a diagonal hunter');
});

// A hunter attacker still gets Surrender offered to the defender (proves the
// surrender option exists for the hunter-vs-hunter case, isolating the defect
// above to the monster-attacker case only).
test('control: hunter-vs-hunter defender WITH items is offered Surrender (§2.8)', () => {
  const state = makeGame(1);
  const s = JSON.parse(JSON.stringify(state));
  s.hunters[1].items = [{ itemId: 'gold', identified: true }];
  s.current = { kind: 'hunter', index: 0 };
  s.phase = 'battle.response';
  s.battle = {
    attacker: { kind: 'hunter', index: 0 },
    defender: { kind: 'hunter', index: 1 },
    stage: 'response', response: null, defCard: null, atkCard: null,
  };
  const responses = legalActions(s).filter((a) => a.type === 'respond').map((a) => a.response);
  assert.ok(responses.includes('surrender'),
    'hunter-vs-hunter surrender is offered (control)');
});

// Move-then-attack is reachable: after a real move that ends adjacent to an
// enemy, the engine routes to turn.postMove and offers the attack (§2.4).
test('control: finishing a move adjacent to an enemy routes to turn.postMove attack (§2.4)', () => {
  const state = makeGame(4);
  const s = JSON.parse(JSON.stringify(state));
  s.current = { kind: 'hunter', index: 0 };
  s.phase = 'turn.steer';
  const p = s.hunters[0].pos;
  // Find a walkable orthogonal neighbour of hunter 0 to step into.
  const dirs = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];
  let step = null;
  for (const d of dirs) {
    const nx = p.x + d.x, ny = p.y + d.y;
    if (nx < 0 || ny < 0 || nx >= s.board.w || ny >= s.board.h) continue;
    if (!s.board.floor[ny][nx]) continue;
    // No unit already there.
    if (s.hunters.some((h) => h.pos && h.pos.x === nx && h.pos.y === ny)) continue;
    // Make sure there are no flags/traps/boxes on this destination that would
    // divert the flow, and no exit.
    if (s.board.exit.x === nx && s.board.exit.y === ny) continue;
    if (s.board.flags.some((f) => f.x === nx && f.y === ny)) continue;
    if (s.board.traps.some((t) => t.x === nx && t.y === ny)) continue;
    if (s.board.boxes.some((b) => b.x === nx && b.y === ny)) continue;
    step = { d, nx, ny };
    break;
  }
  assert.ok(step, 'found a clean walkable neighbour to step into');
  // Place hunter 1 orthogonally adjacent to the destination tile so an attack
  // is available after the step.
  const adj = dirs.find((d) => {
    const ax = step.nx + d.x, ay = step.ny + d.y;
    if (ax === p.x && ay === p.y) return false; // don't stand where we came from
    if (ax < 0 || ay < 0 || ax >= s.board.w || ay >= s.board.h) return false;
    return s.board.floor[ay][ax];
  });
  assert.ok(adj, 'found a tile adjacent to the destination for the enemy');
  s.hunters[1].pos = { x: step.nx + adj.x, y: step.ny + adj.y };
  // Set up a 1-step move with 1 remaining.
  s.move = { path: [], remaining: 1, cardPlayed: null };
  const dirChar = step.d.x === 1 ? 'E' : step.d.x === -1 ? 'W' : step.d.y === 1 ? 'S' : 'N';
  const r = applyAction(s, { type: 'step', dir: dirChar });
  assert.equal(r.state.phase, 'turn.postMove', 'ends move adjacent to enemy => turn.postMove');
  const postActs = legalActions(r.state);
  assert.ok(postActs.some((a) => a.type === 'attack' && a.target.kind === 'hunter'),
    'move-then-attack on the adjacent hunter is offered');
});
