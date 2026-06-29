// Mission list, rewards and roster progression per DESIGN.md §2.12-§2.15.
import { perkHasEffect } from './perks.js';
// Opponent strings are AI archetype names (§2.11), 'RAVEN' for syndicate
// agents (always behave Panicked), or rival ids 'keld'/'mira'. `level` is
// the mission's relic/opponent level (story missions unlock one per level).
// `carrierIndex` marks which opponent starts holding the Target (re-steal).

export const STORY_MISSIONS = [
  { id: 1, title: 'First Descent', type: 'fetch', level: 1,
    opponents: ['Normal', 'Normal', 'Normal'], targetItemId: null, carrierIndex: null,
    briefing: 'Your first contract from the Meridian Salvage Guild. The Coordinator assigned three other field agents to the same ruins — bring back the relic fragment first and you\'ll have proved your worth.' },
  { id: 2, title: 'The Stranded Surveyor', type: 'rescue', level: 2,
    opponents: ['RAVEN', 'RAVEN', 'RAVEN'], targetItemId: null, carrierIndex: null,
    briefing: 'A Guild surveyor went into the Relics on a mapping run and never checked back in. Find him before the RAVEN Syndicate does — three of their agents are already inside.' },
  { id: 3, title: 'Carrier Pursuit', type: 'resteal', level: 3,
    opponents: ['RAVEN', 'Speedster', 'Bandit'], targetItemId: null, carrierIndex: 0,
    briefing: 'A RAVEN agent lifted a data-core from the last recovery site. They\'ve gone to ground in the Relics below. The target is already in enemy hands — track them down and take it back.' },
  { id: 4, title: 'Rival Salvage', type: 'fetch', level: 4,
    opponents: ['keld', 'mira', 'Battler'], targetItemId: null, carrierIndex: null,
    briefing: 'A private collector is paying well for a specific data-core. Word got out — Keld and Mira are already heading into the same ruins. First hunter out with the relic takes the contract.' },
  { id: 5, title: 'Deep Stacks', type: 'fetch', level: 5,
    opponents: ['Turtle', 'Bandit', 'Collector'], targetItemId: null, carrierIndex: null,
    briefing: 'The surveyor you pulled out last mission has a lead: a buried archive he spotted during his mapping run. He\'s splitting the finder\'s fee if you recover what he marked.' },
  { id: 6, title: 'Double Cross', type: 'resteal', level: 6,
    opponents: ['RAVEN', 'keld', 'mira'], targetItemId: null, carrierIndex: 0,
    briefing: 'Someone hit the Guild office overnight and walked off with a relic you\'d already delivered. A RAVEN carrier was seen near the building afterward — and Keld and Mira are circling the same Relics.' },
  { id: 7, title: 'The Actuator Vault', type: 'fetch', level: 7,
    opponents: ['Elite', 'Runner', 'Defender'], targetItemId: 'actuator', carrierIndex: null,
    briefing: 'Mira has put in a Guild contract — she needs a specific pre-collapse actuator unit recovered from a vault that doesn\'t appear on standard maps. Odd request, but the pay is good.' },
  { id: 8, title: 'Syndicate Claim', type: 'fetch', level: 8,
    opponents: ['RAVEN', 'RAVEN', 'RAVEN'], targetItemId: null, carrierIndex: null,
    briefing: 'RAVEN has started flagging salvage sites as Syndicate territory. The Guild\'s lawyers say the claim won\'t hold — but three RAVEN teams are already inside. Prove the point with boots on the ground.' },
  { id: 9, title: 'Blacksite Archive', type: 'fetch', level: 9,
    opponents: ['RAVEN', 'RAVEN', 'RAVEN'], targetItemId: null, carrierIndex: null,
    briefing: 'This facility was scrubbed from every public map after the Ruin. RAVEN found a reference to it in the data-cores you\'ve been recovering, and they\'ve sent three teams in. So have we.' },
  { id: 10, title: 'Flooded Datacore', type: 'fetch', level: 10,
    opponents: ['RAVEN', 'RAVEN', 'RAVEN'], targetItemId: null, carrierIndex: null,
    briefing: 'A storm cracked open a sealed sub-level and flooded access. The window before the passage closes again is narrow, and RAVEN has three teams already descending. Move fast.' },
  { id: 11, title: 'Signal in the Static', type: 'fetch', level: 11,
    opponents: ['RAVEN', 'RAVEN', 'RAVEN'], targetItemId: null, carrierIndex: null,
    briefing: 'A distress beacon is transmitting from deep inside a Relic cluster — old-world hardware, not modern. RAVEN is jamming outbound signals in the sector. Whatever is broadcasting in there, they don\'t want the Guild finding it first.' },
  { id: 12, title: 'The Long Gallery', type: 'fetch', level: 12,
    opponents: ['RAVEN', 'RAVEN', 'RAVEN'], targetItemId: null, carrierIndex: null,
    briefing: 'The pre-collapse research network had a central indexing archive — a single cache that could map the location of every other data vault. RAVEN has been working toward it for months. You\'re going in today.' },
  { id: 13, title: 'Quiet Partners', type: 'fetch', level: 13,
    opponents: ['Elite', 'Attack spec.', 'HP spec.'], targetItemId: null, carrierIndex: null,
    briefing: 'The contract came through a name the Guild doesn\'t recognize, with terms that are a little too clean. Three well-equipped hunters are already inside. Bring back the relic — ask questions after.' },
  { id: 14, title: 'RAVEN Ascendant', type: 'fetch', level: 14,
    opponents: ['RAVEN', 'RAVEN', 'RAVEN'], targetItemId: null, carrierIndex: null,
    briefing: 'RAVEN has stopped pretending. They\'ve locked down the upper Relic tiers and are fielding their best teams. The Guild is counter-filing, but paperwork won\'t stop an armed crew. You will.' },
  { id: 15, title: 'The Last Relic', type: 'fetch', level: 15,
    opponents: ['RAVEN', 'RAVEN', 'RAVEN'], targetItemId: null, carrierIndex: null,
    briefing: 'Every data-core you\'ve recovered has pointed to the same location: a sealed vault at the base of the deepest Relic. RAVEN knows it too. Whatever is locked inside, the Guild intends to open it first — and so do you.' },
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
  return Math.floor(LEVEL_UP_FEES[Math.min(level - 1, LEVEL_UP_FEES.length - 1)] / 4);
}

// Post-mission roster update (§2.12; §2.8 defeat persistence; §2.15 story
// reward). result: { relicLevel, win, wipe?, storyCleared?, hunters: [{ id,
// score, items, maxHp, returnedTarget, targetPrice }] }. Returns a NEW
// roster; records without a matching result entry pass through unchanged.
// wipe = WYRM killed the Target holder in normal mode: items and ALL
// banked credits are lost (maxHP damage still persists).
export function applyResults(roster, result, ownedPerks = []) {
  const byId = new Map(result.hunters.map((h) => [h.id, h]));
  const merchantBonus = perkHasEffect(ownedPerks, 'credits+25');
  return roster.map((rec) => {
    const h = byId.get(rec.id);
    if (!h) return rec;
    if (result.wipe) return { ...rec, credits: 0, items: [], maxHp: h.maxHp };
    // floor(score / 15 * relicLevel); product first keeps integer math exact
    let earned = Math.floor((h.score * result.relicLevel) / 15);
    if (merchantBonus) earned = Math.floor(earned * 1.25);
    let credits = (rec.credits || 0) + earned;
    if (h.returnedTarget) credits += h.targetPrice || 0;
    if (result.storyCleared) credits += storyClearReward(rec.level);
    return { ...rec, credits, items: h.items.map((it) => ({ ...it })), maxHp: h.maxHp };
  });
}
