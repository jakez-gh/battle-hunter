import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../src/engine/rng.js';
import { CARDS, buildDeck, cardColor, cardValue, isSpecial, describeCard } from '../src/engine/cards.js';

// Hardcoded from DESIGN.md §2.7 (deliberately not derived from CARDS, so a
// catalog typo can't satisfy its own test).
const EXPECTED = {
  R3: 3, R4: 3, R5: 3, R6: 3, R7: 2, R8: 2, R9: 2, RC: 1, RS: 1,
  Y3: 7, Y4: 6, Y5: 5, Y6: 4, Y7: 3, Y8: 2, Y9: 1, YD: 1, YA: 1,
  B1: 16, B2: 8, B3: 4, BE: 2,
  GD: 5, GS: 5, GL: 5, GE: 5,
};
const COLOR_TOTALS = { red: 20, yellow: 30, blue: 30, green: 20 };

test('catalog matches DESIGN §2.7 composition exactly', () => {
  const ids = Object.keys(CARDS);
  assert.deepEqual(ids.sort(), Object.keys(EXPECTED).sort());
  for (const id of ids) assert.equal(CARDS[id].count, EXPECTED[id], id);
  const byColor = { red: 0, yellow: 0, blue: 0, green: 0 };
  let total = 0;
  for (const c of Object.values(CARDS)) { byColor[c.color] += c.count; total += c.count; }
  assert.deepEqual(byColor, COLOR_TOTALS);
  assert.equal(total, 100);
});

test('buildDeck produces exactly the 100-card composition', () => {
  const deck = buildDeck(makeRng(1));
  assert.equal(deck.length, 100);
  const counts = {};
  for (const id of deck) counts[id] = (counts[id] || 0) + 1;
  assert.deepEqual(counts, EXPECTED);
});

test('E cards only sit in the bottom 49 (drawn only when deck < 50), many seeds', () => {
  const positions = new Set();
  for (let seed = 0; seed < 500; seed++) {
    const deck = buildDeck(makeRng(seed));
    const idx = deck.flatMap((id, i) => (id === 'BE' ? [i] : []));
    assert.equal(idx.length, 2, `seed ${seed}`);
    for (const i of idx) {
      // index 0 = next draw; card at index i is drawn with 100 - i remaining
      assert.ok(i >= 51, `seed ${seed}: E at index ${i} would appear with ${100 - i} left`);
      positions.add(i);
    }
  }
  // E placement is genuinely shuffled across the 49-slot window
  assert.ok(positions.size > 20, `only ${positions.size} distinct E positions`);
  assert.ok(Math.min(...positions) <= 55 && Math.max(...positions) >= 95);
});

test('buildDeck is deterministic per seed and varies across seeds', () => {
  assert.deepEqual(buildDeck(makeRng(42)), buildDeck(makeRng(42)));
  assert.notDeepEqual(buildDeck(makeRng(42)), buildDeck(makeRng(43)));
});

test('cardColor / cardValue', () => {
  assert.equal(cardColor('R5'), 'red');
  assert.equal(cardColor('Y9'), 'yellow');
  assert.equal(cardColor('B1'), 'blue');
  assert.equal(cardColor('GE'), 'green');
  assert.equal(cardValue('R9'), 9);
  assert.equal(cardValue('Y3'), 3);
  assert.equal(cardValue('B2'), 2);
  // specials and green trap cards carry no numeric bonus
  for (const id of ['RC', 'RS', 'YD', 'YA', 'BE', 'GD']) assert.equal(cardValue(id), 0, id);
});

test('isSpecial flags exactly the lettered specials', () => {
  for (const id of ['RC', 'RS', 'YD', 'YA', 'BE']) assert.equal(isSpecial(id), true, id);
  for (const id of ['R3', 'Y9', 'B1', 'GD', 'GS', 'GL', 'GE']) assert.equal(isSpecial(id), false, id);
  assert.deepEqual(
    ['RC', 'RS', 'YD', 'YA', 'BE'].map((id) => CARDS[id].special),
    ['C', 'S', 'D', 'A', 'E']
  );
});

test('green cards carry board trap kinds', () => {
  assert.equal(CARDS.GD.trap, 'damage');
  assert.equal(CARDS.GS.trap, 'stun');
  assert.equal(CARDS.GL.trap, 'leg');
  assert.equal(CARDS.GE.trap, 'empty');
});

test('describeCard gives short labels; unknown ids throw', () => {
  assert.equal(describeCard('R5'), 'ATK +5');
  assert.equal(describeCard('Y7'), 'DEF +7');
  assert.equal(describeCard('B3'), 'MOVE +3');
  assert.match(describeCard('BE'), /Exit/);
  assert.match(describeCard('GD'), /Damage trap/);
  assert.throws(() => cardColor('ZZ'));
  assert.throws(() => describeCard('R2'));
});
