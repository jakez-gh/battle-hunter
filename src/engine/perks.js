// Phase 2 "horizontal perks" for Relic Dive runs (see ROADMAP.md, ADR-0005).
//
// Pure data + selection logic — no DOM, no engine mutation. The run controller
// (UI layer, per ADR-0005) drives it:
//   - rollPerkChoices(rng, owned)  -> 3 perk ids to offer between depths
//   - perkStatBonuses(owned)       -> {at,df,mv,maxhp} to fold into the next depth
//   - perkHasEffect(owned, key)    -> gate a behaviour at the right branch point
//   - describePerk(id) / allPerks()-> for the choose-1-of-3 screen
//
// Effects reuse the items.js string convention (`at+1`, plus keyword effects).
// Design rule (ROADMAP): unlock BREADTH, not vertical power — stat perks are
// few and small; most perks are utility. Selection is rng-driven so seeded /
// daily runs offer deterministic choices.

const C = 'common', U = 'uncommon', R = 'rare';

// id -> { id, name, desc, effect, rarity, stackable }
export const PERKS = {
  // Small stat bumps — intentionally uncommon and capped-by-scarcity.
  sharp:    { id: 'sharp',    name: 'Sharpened', desc: '+1 Attack',              effect: 'at+1',    rarity: U, stackable: true },
  hardened: { id: 'hardened', name: 'Hardened',  desc: '+1 Defense',             effect: 'df+1',    rarity: U, stackable: true },
  fleet:    { id: 'fleet',    name: 'Fleet',     desc: '+1 Movement',            effect: 'mv+1',    rarity: U, stackable: true },
  vigor:    { id: 'vigor',    name: 'Vigor',     desc: '+3 max HP each depth',   effect: 'maxhp+3', rarity: U, stackable: true },

  // Utility / breadth — the heart of the system (each unique).
  restless: { id: 'restless', name: 'Restless',  desc: 'Rest draws +1 card',          effect: 'restDraw+1', rarity: C },
  hoard:    { id: 'hoard',    name: 'Hoarder',   desc: 'Hand cap +1',                 effect: 'handCap+1',  rarity: U },
  surefoot: { id: 'surefoot', name: 'Surefoot',  desc: 'Your own traps never spring on you', effect: 'noSelfTrap', rarity: C },
  ironleg:  { id: 'ironleg',  name: 'Iron Legs', desc: 'Immune to Leg Damage',        effect: 'legProof',   rarity: U },
  calm:     { id: 'calm',     name: 'Composed',  desc: 'Panic cured at your turn start', effect: 'panicCalm', rarity: U },
  scout:    { id: 'scout',    name: 'Scout',     desc: 'Reveal nearby traps',         effect: 'revealTraps', rarity: C },
  ward:     { id: 'ward',     name: 'Warded',    desc: 'No monster spawns beside you', effect: 'wardstone',  rarity: R },
  lucky:    { id: 'lucky',    name: 'Lucky',     desc: '+1 reroll token each depth',  effect: 'reroll+1',   rarity: U },
  prepared: { id: 'prepared', name: 'Prepared',  desc: 'First box each depth is pre-appraised', effect: 'firstBoxId', rarity: C },
  merchant: { id: 'merchant', name: 'Merchant',  desc: '+25% credits earned',         effect: 'credits+25', rarity: U },
  survivor: { id: 'survivor', name: 'Survivor',  desc: 'Heal to full when you descend', effect: 'descendHeal', rarity: R },
  gambler:  { id: 'gambler',  name: 'Gambler',   desc: '+50% score on descend, start next depth at half HP', effect: 'descendBonus', rarity: R },
};

const RARITY_WEIGHT = { common: 6, uncommon: 3, rare: 1 };
const weightOf = (p) => RARITY_WEIGHT[p.rarity] ?? 1;

// Offer `count` distinct perks, rarity-weighted, excluding non-stackable perks
// already owned. Pure + deterministic for a given rng — same seed offers the
// same choices, which is what makes seeded/daily runs fair. rng: makeRng()-style
// object exposing float() in [0,1).
export function rollPerkChoices(rng, owned = [], count = 3) {
  const ownedSet = new Set(owned);
  const avail = Object.values(PERKS).filter((p) => p.stackable || !ownedSet.has(p.id));
  const picks = [];
  while (picks.length < count && avail.length) {
    const total = avail.reduce((s, p) => s + weightOf(p), 0);
    let r = rng.float() * total;
    let idx = 0;
    while (idx < avail.length - 1) {
      r -= weightOf(avail[idx]);
      if (r < 0) break;
      idx++;
    }
    picks.push(avail[idx].id);
    avail.splice(idx, 1);
  }
  return picks;
}

// Aggregate the flat stat perks into deltas the controller folds into each
// depth's hunter (mirrors items.js effectiveStats, but for owned perks).
export function perkStatBonuses(owned = []) {
  const out = { at: 0, df: 0, mv: 0, maxhp: 0 };
  for (const id of owned) {
    const m = /^(at|df|mv|maxhp)\+(\d+)$/.exec(PERKS[id]?.effect || '');
    if (m) out[m[1]] += Number(m[2]);
  }
  return out;
}

// Does the run own a perk granting this keyword effect? (gate behaviours like
// 'noSelfTrap', 'legProof', 'wardstone', ... at their branch points.)
export function perkHasEffect(owned = [], key) {
  return owned.some((id) => PERKS[id]?.effect === key);
}

export const describePerk = (id) => {
  const p = PERKS[id];
  return p ? { id: p.id, name: p.name, desc: p.desc, rarity: p.rarity } : null;
};

export const allPerks = () => Object.values(PERKS).map((p) => describePerk(p.id));
