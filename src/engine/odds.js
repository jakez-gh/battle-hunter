// Pure combat-odds calculator — the engine half of the "advantage readout".
//
// Operationalizes finding F5 in docs/design/fun-and-purchase-principles.md:
// Battle Hunter leans on OUTPUT randomness (you roll 2d6 AFTER committing to a
// battle), which players tolerate far less than input randomness. Showing the
// odds before the player commits restores agency and makes a dice loss feel
// fair, not arbitrary. We enumerate all 36×36 equally-likely 2d6 pairings — this
// is the EXACT distribution (no sampling), and it mirrors combat.js strike math
// so the readout never lies.
//
// Cards: { color:'red'|'yellow'|'blue'|'green', value:number|'S'|'C'|'D'|'A' }.
// Only red helps the striker, only yellow helps the target (combat.js §strike).

function atkTotal(d1, d2, at, oppAt, card) {
  let stat = at, bonus = 0;
  if (card && card.color === 'red') {
    if (card.value === 'S') stat *= 2;              // double own AT
    else if (card.value === 'C') bonus = oppAt;     // add opponent's AT
    else if (typeof card.value === 'number') bonus = card.value;
  }
  return d1 + d2 + stat + bonus;
}

function defTotal(d1, d2, df, guard, card) {
  let stat = guard ? df * 2 : df, bonus = 0, immune = false;
  if (card && card.color === 'yellow') {
    if (card.value === 'D') stat *= 2;              // double DF (stacks with guard)
    else if (card.value === 'A') immune = true;     // take 0 damage
    else if (typeof card.value === 'number') bonus = card.value;
  }
  return { total: d1 + d2 + stat + bonus, immune };
}

// Exact odds of one strike. Inputs are the KNOWN/considered values the UI has
// (stats are public; hands are public, so a chosen card is known input info).
//   at, oppAt, df : displayed combat stats
//   guard         : defender is guarding (DF doubled)
//   atkCard/defCard: the card each side would play (or null)
//   atkWarbanner  : striker's crit deals ×2 (Warbanner item)
//   defAegis      : defender's own doubles → take 0 (Aegis item)
// Returns { expectedDamage, pHit, pZero, pCrit, advantage }.
export function battleOdds({
  at = 0, oppAt = 0, df = 0, guard = false,
  atkCard = null, defCard = null, atkWarbanner = false, defAegis = false,
} = {}) {
  let sumDmg = 0, hits = 0, n = 0;
  for (let a1 = 1; a1 <= 6; a1++) {
    for (let a2 = 1; a2 <= 6; a2++) {
      const crit = a1 === a2;
      const atk = atkTotal(a1, a2, at, oppAt, atkCard);
      for (let b1 = 1; b1 <= 6; b1++) {
        for (let b2 = 1; b2 <= 6; b2++) {
          const d = defTotal(b1, b2, df, guard, defCard);
          let dmg = d.immune ? 0 : Math.max(0, atk - d.total);
          if (b1 === b2 && defAegis) dmg = 0;       // defender doubles + Aegis
          else if (crit && atkWarbanner) dmg *= 2;  // striker doubles + Warbanner
          sumDmg += dmg;
          if (dmg >= 1) hits++;
          n++;
        }
      }
    }
  }
  const pHit = hits / n;
  return {
    expectedDamage: sumDmg / n,
    pHit,
    pZero: 1 - pHit,
    pCrit: 6 / 36,                  // striker rolls doubles (crit chance is stat-independent)
    advantage: advantageLabel(pHit),
  };
}

// Coarse, honest bucket for the readout ("Strong / Even / Disadvantage").
export function advantageLabel(pHit) {
  if (pHit >= 0.7) return 'strong';
  if (pHit >= 0.4) return 'even';
  return 'weak';
}

// One-line PRE-commit readout for the battle UI (F5 agency tool). Feed it the
// result of battleOdds(): e.g. "Strong · ~5.2 dmg · 81% hit".
export function describeOdds(o) {
  const label = { strong: 'Strong', even: 'Even', weak: 'Disadvantage' }[o.advantage] ?? 'Even';
  return `${label} · ~${o.expectedDamage.toFixed(1)} dmg · ${Math.round(o.pHit * 100)}% hit`;
}

// POST-battle math summary (F5): make the outcome legible so a loss reads as
// "the math", not "the dice screwed me". e.g.
//   explainStrike({attacker:'You', defender:'Keld', atkTotal:12, defTotal:9, damage:3})
//   -> "You 12 vs Keld 9 — hit for 3"
export function explainStrike({
  attacker = 'Attacker', defender = 'Defender',
  atkTotal = 0, defTotal = 0, damage = 0, crit = false,
} = {}) {
  const head = `${attacker} ${atkTotal} vs ${defender} ${defTotal}`;
  const body = damage > 0 ? `hit for ${damage}` : 'no damage';
  return crit ? `${head} — CRIT! ${body}` : `${head} — ${body}`;
}
