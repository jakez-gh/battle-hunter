// Mission list, rewards and roster progression per DESIGN.md §2.12-§2.15.
// Opponent strings are AI archetype names (§2.11), 'RAVEN' for syndicate
// agents (always behave Panicked), or rival ids 'keld'/'mira'. `level` is
// the mission's relic/opponent level (story missions unlock one per level).
// `carrierIndex` marks which opponent starts holding the Target (re-steal).

export const STORY_MISSIONS = [
  { id: 1, title: 'First Descent', type: 'fetch', level: 1,
    opponents: ['Normal', 'Normal', 'Normal'], targetItemId: null, carrierIndex: null },
  { id: 2, title: 'The Stranded Surveyor', type: 'rescue', level: 2,
    opponents: ['RAVEN', 'RAVEN', 'RAVEN'], targetItemId: null, carrierIndex: null },
  { id: 3, title: 'Carrier Pursuit', type: 'resteal', level: 3,
    opponents: ['RAVEN', 'Speedster', 'Bandit'], targetItemId: null, carrierIndex: 0 },
  { id: 4, title: 'Rival Salvage', type: 'fetch', level: 4,
    opponents: ['keld', 'mira', 'Battler'], targetItemId: null, carrierIndex: null },
  { id: 5, title: 'Deep Stacks', type: 'fetch', level: 5,
    opponents: ['Turtle', 'Bandit', 'Collector'], targetItemId: null, carrierIndex: null },
  { id: 6, title: 'Double Cross', type: 'resteal', level: 6,
    opponents: ['RAVEN', 'keld', 'mira'], targetItemId: null, carrierIndex: 0 },
  { id: 7, title: 'The Actuator Vault', type: 'fetch', level: 7,
    opponents: ['Elite', 'Runner', 'Defender'], targetItemId: 'actuator', carrierIndex: null },
  { id: 8, title: 'Syndicate Claim', type: 'fetch', level: 8,
    opponents: ['RAVEN', 'RAVEN', 'RAVEN'], targetItemId: null, carrierIndex: null },
  { id: 9, title: 'Blacksite Archive', type: 'fetch', level: 9,
    opponents: ['RAVEN', 'RAVEN', 'RAVEN'], targetItemId: null, carrierIndex: null },
  { id: 10, title: 'Flooded Datacore', type: 'fetch', level: 10,
    opponents: ['RAVEN', 'RAVEN', 'RAVEN'], targetItemId: null, carrierIndex: null },
  { id: 11, title: 'Signal in the Static', type: 'fetch', level: 11,
    opponents: ['RAVEN', 'RAVEN', 'RAVEN'], targetItemId: null, carrierIndex: null },
  { id: 12, title: 'The Long Gallery', type: 'fetch', level: 12,
    opponents: ['RAVEN', 'RAVEN', 'RAVEN'], targetItemId: null, carrierIndex: null },
  { id: 13, title: 'Quiet Partners', type: 'fetch', level: 13,
    opponents: ['Elite', 'Attack spec.', 'HP spec.'], targetItemId: null, carrierIndex: null },
  { id: 14, title: 'RAVEN Ascendant', type: 'fetch', level: 14,
    opponents: ['RAVEN', 'RAVEN', 'RAVEN'], targetItemId: null, carrierIndex: null },
  { id: 15, title: 'The Last Relic', type: 'fetch', level: 15,
    opponents: ['RAVEN', 'RAVEN', 'RAVEN'], targetItemId: null, carrierIndex: null },
];

// Rivals (§2.15): displayed lines Keld +1/7/1/16 (L1) -> +3/15/1/30 (L15),
// Mira +2/4/0/19 -> +5/8/0/36, both Clever. Stored as the internal-point
// lines that produce those displays under §2.1 (creation total 15 = 4 base
// + 11 points; +1 point per level, total 29 at L15).
export const RIVALS = {
  keld: {
    name: 'Keld', priority: 'Clever',
    internal1: { mv: 3, at: 7, df: 2, hp: 3 },
    internal15: { mv: 9, at: 15, df: 2, hp: 3 },
  },
  mira: {
    name: 'Mira', priority: 'Clever',
    internal1: { mv: 6, at: 4, df: 1, hp: 4 },
    internal15: { mv: 15, at: 8, df: 1, hp: 5 },
  },
};

const STAT_KEYS = ['mv', 'at', 'df', 'hp'];

// Internal-point interpolation (§2.11): walk levels 2..level adding one
// point per level to the stat furthest below its linear L1->L15 target.
// Monotone by construction and exact at both endpoints. Shared by rivals
// and AI archetypes.
export function interpolateInternal(l1, l15, level) {
  const cur = { ...l1 };
  for (let lvl = 2; lvl <= level; lvl++) {
    let best = STAT_KEYS[0];
    let bestDeficit = -Infinity;
    for (const k of STAT_KEYS) {
      const target = l1[k] + ((l15[k] - l1[k]) * (lvl - 1)) / 14;
      const deficit = target - cur[k];
      if (deficit > bestDeficit) { bestDeficit = deficit; best = k; }
    }
    cur[best]++;
  }
  return cur;
}

// Displayed stats from internal points (§2.1).
export function displayStats(internal, level) {
  return {
    mv: Math.floor(internal.mv / 3),
    at: internal.at,
    df: Math.floor(internal.df / 2),
    maxHp: 7 + 3 * internal.hp + (level - 1),
  };
}

export function rivalStats(id, level) {
  const r = RIVALS[id];
  if (!r) throw new Error(`unknown rival: ${id}`);
  const internal = interpolateInternal(r.internal1, r.internal15, level);
  return { internal, ...displayStats(internal, level) };
}

// Normal free-play mission: relic level = ceil(mean hunter level) (§2.2).
export function makeNormalMission(hunters) {
  if (!hunters.length) throw new Error('makeNormalMission needs hunters');
  const mean = hunters.reduce((s, h) => s + h.level, 0) / hunters.length;
  const level = Math.max(1, Math.min(15, Math.ceil(mean)));
  return { id: 'normal', title: 'Relic Dive', type: 'fetch', level,
           opponents: [], targetItemId: null, carrierIndex: null };
}

// Hospital level-up fees, L -> L+1 for L = 1..14 (§2.13).
export const LEVEL_UP_FEES = [
  1000, 1500, 2500, 4000, 6000, 8500, 11500,
  15000, 19000, 23500, 28500, 34000, 40000, 46500,
];

// Story clear pays 1/4 of the hunter's next level-up cost (§2.15); at the
// level cap the last fee is used.
export function storyClearReward(level) {
  return LEVEL_UP_FEES[Math.min(level - 1, LEVEL_UP_FEES.length - 1)] / 4;
}

// Post-mission roster update (§2.12; §2.8 defeat persistence; §2.15 story
// reward). result: { relicLevel, win, wipe?, storyCleared?, hunters: [{ id,
// score, items, maxHp, returnedTarget, targetPrice }] }. Returns a NEW
// roster; records without a matching result entry pass through unchanged.
// wipe = WYRM killed the Target holder in normal mode: items and ALL
// banked credits are lost (maxHP damage still persists).
export function applyResults(roster, result) {
  const byId = new Map(result.hunters.map((h) => [h.id, h]));
  return roster.map((rec) => {
    const h = byId.get(rec.id);
    if (!h) return rec;
    if (result.wipe) return { ...rec, credits: 0, items: [], maxHp: h.maxHp };
    // floor(score / 15 * relicLevel); product first keeps integer math exact
    let credits = (rec.credits || 0) + Math.floor((h.score * result.relicLevel) / 15);
    if (h.returnedTarget) credits += h.targetPrice || 0;
    if (result.storyCleared) credits += storyClearReward(rec.level);
    return { ...rec, credits, items: h.items.map((it) => ({ ...it })), maxHp: h.maxHp };
  });
}
