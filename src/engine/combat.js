// Battle resolver — pure function of both sides' choices plus the rng.
// DESIGN.md §2.8/§2.9/§3.4. Sides arrive as plain stat blocks (the game layer
// has already applied effectiveStats/hunterHasEffect/monster tables) and cards
// as {color, value}|null, so this module imports nothing.
//
// side = { kind:'hunter'|'monster', at, df, mv, hp, maxHp, stunned,
//          effects: {warbanner, aegis, voyager, actuator, generator, escapeBonus} }
// Monster crit riders reuse the item-rider flags: FNG → actuator (Empty),
// WYRM → generator (Stun). Monsters always counter: caller passes
// response:'counter'. Counter-item stun: caller passes defender.stunned=true.
//
// rng call order (tests rely on it): escape rolls attacker 2d6 then defender
// 2d6 (skipped when an E card forces the result); each strike rolls the
// striker's 2d6 then the target's; crit riders roll leg then empty, and only
// against hunter targets (monsters carry no status fields, §3.1).

const fx = (side) => side.effects || {};
const isE = (card) => !!card && card.color === 'blue' && card.value === 'E';
const blueBonus = (card) =>
  card && card.color === 'blue' && typeof card.value === 'number' ? card.value : 0;

function attackTotal(dice, at, oppAt, card) {
  let stat = at, bonus = 0;
  if (card && card.color === 'red') {
    if (card.value === 'S') stat *= 2;          // S doubles own AT (no add)
    else if (card.value === 'C') bonus = oppAt; // C adds opponent's AT
    else bonus = card.value;
  }
  return dice[0] + dice[1] + stat + bonus;
}

function defenseTotal(dice, df, guard, card) {
  let stat = guard ? df * 2 : df, bonus = 0;
  if (card && card.color === 'yellow') {
    if (card.value === 'D') stat *= 2;          // D doubles DF (stacks with guard)
    else if (card.value !== 'A') bonus = card.value; // A handled at damage step
  }
  return dice[0] + dice[1] + stat + bonus;
}

// One exchange half (strike or counter). Only red helps the striker, only
// yellow helps the target; off-color cards are inert here by design.
function strike(phase, rng, events, striker, strikerCard, target, targetCard, opts) {
  const { guard = false, dfZero = false, negateAttempt = false, targetLabel } = opts;
  const capDie = (d, eff) => eff.blackgem ? Math.min(d, 4) : eff.amulet ? Math.max(d, 3) : d;
  const sDice = [rng.d6(), rng.d6()].map((d) => capDie(d, fx(striker)));
  const tDice = [rng.d6(), rng.d6()].map((d) => capDie(d, fx(target)));
  const crit = sDice[0] === sDice[1];
  const atk = attackTotal(sDice, striker.at, target.at, strikerCard);
  const def = defenseTotal(tDice, dfZero ? 0 : target.df, guard, targetCard);
  let damage = Math.max(0, atk - def);
  if (targetCard && targetCard.color === 'yellow' && targetCard.value === 'A') damage = 0;
  if (tDice[0] === tDice[1] && fx(target).aegis) damage = 0; // own defense doubles → take 0
  if (crit && fx(striker).warbanner) damage *= 2;            // own attack doubles → ×2
  events.push({
    type: 'strikeRolled', phase,
    striker: targetLabel === 'defender' ? 'attacker' : 'defender',
    dice: { atk: sDice, def: tDice }, totals: { atk, def },
    damage, display: Math.min(99, damage), crit, // hp takes the uncapped value
  });
  const statuses = [];
  if (crit && damage >= 1 && target.kind === 'hunter') {
    if (negateAttempt) {
      events.push({ type: 'critNegated', target: targetLabel }); // statuses only, never damage
    } else {
      const inflicted = new Set(['panic']);
      if (rng.float() < 0.25) inflicted.add('leg');
      if (rng.float() < 0.25) inflicted.add('empty');
      if (fx(striker).actuator) inflicted.add('empty');
      if (fx(striker).generator) inflicted.add('stun');
      for (const kind of inflicted) {
        statuses.push(kind);
        events.push({ type: 'statusInflicted', kind, target: targetLabel });
      }
    }
  }
  return { damage, statuses };
}

// ctx = { rng, attacker, defender, response:'counter'|'guard'|'escape'|'surrender',
//         atkCard, defCard, critNegateAttempt:{attacker,defender}, relicLevel }
export function resolveBattle(ctx) {
  const { rng, attacker, defender, atkCard = null } = ctx;
  const negate = ctx.critNegateAttempt || {};
  const events = [];
  const statuses = { attacker: [], defender: [] };
  let aHp = attacker.hp, dHp = defender.hp;
  // Stunned defenders can't respond at all: no card, DF 0, no counter (§2.9).
  const stunned = !!defender.stunned;
  const response = stunned ? 'none' : ctx.response;
  const defCard = stunned ? null : ctx.defCard ?? null;

  const finish = (type) => ({
    events,
    outcome: {
      type, attackerHp: aHp, defenderHp: dHp,
      attackerDefeated: aHp <= 0, defenderDefeated: dHp <= 0,
    },
    hpChanges: { attacker: aHp - attacker.hp, defender: dHp - defender.hp },
    statuses,
  });

  if (response === 'surrender') { // item handover/warp/leg-cure are game-layer
    events.push({ type: 'surrendered', unit: 'defender' });
    return finish('surrender');
  }

  let dfZero = stunned;
  if (response === 'escape') {
    let escaped, forced = null, aDice = null, dDice = null, aTotal = null, dTotal = null;
    if (isE(atkCard)) { escaped = false; forced = 'attackerE'; } // pursuer's E beats all, incl. defender E/Voyager
    else if (isE(defCard)) { escaped = true; forced = 'defenderE'; }
    else {
      aDice = [rng.d6(), rng.d6()];
      dDice = [rng.d6(), rng.d6()];
      aTotal = aDice[0] + aDice[1] + attacker.mv + blueBonus(atkCard);
      dTotal = dDice[0] + dDice[1] + defender.mv + blueBonus(defCard)
        + (fx(defender).escapeBonus || 0); // escape items help the fleeing side only
      // strictly higher flees; Voyager steals ties unless the pursuer has it too
      escaped = dTotal > aTotal ||
        (dTotal === aTotal && !!fx(defender).voyager && !fx(attacker).voyager);
    }
    events.push({ type: 'escapeRolled', aDice, dDice, aTotal, dTotal, escaped, forced });
    if (escaped) return finish('escaped');
    dfZero = true; // failed escape: defenseless for the strike
  }

  const s = strike('strike', rng, events, attacker, atkCard, defender, defCard, {
    guard: response === 'guard', dfZero,
    negateAttempt: !!negate.defender, targetLabel: 'defender',
  });
  dHp -= s.damage;
  statuses.defender.push(...s.statuses);

  // Counter: fresh dice, roles swapped; the single chosen cards apply where
  // their color fits (defender's red boosts the counter, attacker's yellow
  // defends it). No guard, no DF-zeroing on the counter half.
  if (response === 'counter' && dHp > 0) {
    const c = strike('counter', rng, events, defender, defCard, attacker, atkCard, {
      negateAttempt: !!negate.attacker, targetLabel: 'attacker',
    });
    aHp -= c.damage;
    statuses.attacker.push(...c.statuses);
  }

  return finish('resolved');
}
