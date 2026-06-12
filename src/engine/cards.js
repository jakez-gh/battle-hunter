// Card catalog and deck construction (DESIGN.md §2.7, §3.4).
// Ids are <color letter><value or special letter>: R5 = red +5, BE = blue E.
// Specials keep the design-doc letters: C (add foe's AT), S (double own AT),
// D (double DF / 100% evasion), A (take 0 damage / 100% evasion),
// E (warp to EXIT / guaranteed escape). Green cards carry a `trap` kind
// instead of a value (they only set traps during a Move).

/** Catalog by id: { id, color, count, value, special, trap, label }. */
export const CARDS = {};
function def(id, color, count, { value = 0, special = null, trap = null, label }) {
  CARDS[id] = { id, color, count, value, special, trap, label };
}

// Red — attack, battle only (20)
for (const [v, n] of [[3, 3], [4, 3], [5, 3], [6, 3], [7, 2], [8, 2], [9, 2]])
  def(`R${v}`, 'red', n, { value: v, label: `ATK +${v}` });
def('RC', 'red', 1, { special: 'C', label: "ATK + foe's AT" });
def('RS', 'red', 1, { special: 'S', label: 'ATK: double own AT' });

// Yellow — defense / trap evasion (30)
for (const [v, n] of [[3, 7], [4, 6], [5, 5], [6, 4], [7, 3], [8, 2], [9, 1]])
  def(`Y${v}`, 'yellow', n, { value: v, label: `DEF +${v}` });
def('YD', 'yellow', 1, { special: 'D', label: 'DEF: double DF / evade 100%' });
def('YA', 'yellow', 1, { special: 'A', label: 'Take 0 damage / evade 100%' });

// Blue — movement / escape (30)
for (const [v, n] of [[1, 16], [2, 8], [3, 4]])
  def(`B${v}`, 'blue', n, { value: v, label: `MOVE +${v}` });
def('BE', 'blue', 2, { special: 'E', label: 'Warp to Exit / sure escape' });

// Green — set a trap on Move (20); trap kinds match board trap model (§3.1)
def('GD', 'green', 5, { trap: 'damage', label: 'Set Damage trap' });
def('GS', 'green', 5, { trap: 'stun', label: 'Set Stun trap' });
def('GL', 'green', 5, { trap: 'leg', label: 'Set Leg trap' });
def('GE', 'green', 5, { trap: 'empty', label: 'Set Empty trap' });

function card(id) {
  const c = CARDS[id];
  if (!c) throw new Error(`unknown card: ${id}`);
  return c;
}

/** Card color: 'red'|'yellow'|'blue'|'green'. */
export const cardColor = (id) => card(id).color;
/** Numeric bonus; 0 for lettered specials and green cards (check isSpecial / color). */
export const cardValue = (id) => card(id).value;
/** True for the lettered specials C/S/D/A/E. */
export const isSpecial = (id) => card(id).special !== null;
/** Short human label, e.g. "ATK +5", "Warp to Exit / sure escape". */
export const describeCard = (id) => card(id).label;

// Full 100-card deck; index 0 = next draw (§3.1) — dealing the opening 20 and
// every later draw shift() from the front. E-card rule (§2.2, §2.16 #12): both
// blue E cards are shuffled into the bottom 49 positions (indices 51..99), so
// when an E becomes the next draw at most 49 cards remain — it can never show
// up while the deck count is still 50+.
export function buildDeck(rng) {
  const rest = [];
  const es = [];
  for (const c of Object.values(CARDS))
    for (let i = 0; i < c.count; i++) (c.special === 'E' ? es : rest).push(c.id);
  rng.shuffle(rest); // 98 non-E cards
  const bottom = rng.shuffle(rest.splice(51).concat(es)); // bottom 47 + 2 E = 49
  return rest.concat(bottom);
}
