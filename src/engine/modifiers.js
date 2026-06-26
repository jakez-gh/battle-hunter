// Phase 3 "run modifiers" for Relic Dive (ROADMAP.md). Pure data + logic — the
// opt-in challenge mutators that answer "why run #10" by changing the rules of a
// run (research F7: run variety is the replayability long-tail —
// docs/design/fun-and-purchase-principles.md).
//
// Convention (roguelike "ascension/heat"): a modifier makes a run HARDER in
// exchange for a score multiplier ≥ 1 — opting in is an interesting decision
// (more risk, more reward), never a free win. The run controller:
//   - modifierConfig(ids)   -> config overrides to fold into each depth's game
//   - scoreMultiplier(ids)  -> multiply the run's score by this
//   - rollDailyModifier(rng)-> the deterministic daily/weekly mutator
//   - describeModifier/allModifiers -> for the toggle UI
//
// The config-override KEYS below are a contract for the engine/config builder to
// honor (trapMultiplier, deckSize, targetVisible, restDisabled, maxMonsters,
// fortune); wiring each is a separate engine task, like perk effects.

// id -> { id, name, desc, config, score }
export const MODIFIERS = {
  minefield: {
    id: 'minefield', name: 'Minefield',
    desc: 'Twice the hidden traps each depth.',
    config: { trapMultiplier: 2 }, score: 1.25,
  },
  sprint: {
    id: 'sprint', name: 'Sprint',
    desc: 'The deck starts at 25 — the WYRM comes fast.',
    config: { deckSize: 25 }, score: 1.5,
  },
  norest: {
    id: 'norest', name: 'No Rest',
    desc: 'Resting is disabled — heal only via flags and items.',
    config: { restDisabled: true }, score: 1.3,
  },
  swarm: {
    id: 'swarm', name: 'Swarm',
    desc: 'Up to three monsters prowl at once.',
    config: { maxMonsters: 3 }, score: 1.2,
  },
  ironhunter: {
    id: 'ironhunter', name: 'Iron Hunter',
    desc: 'No Fortune reroll — live with your rolls.',
    config: { fortune: 0 }, score: 1.15,
  },
  exposed: {
    id: 'exposed', name: 'Exposed',
    desc: 'The Target Item box is revealed to everyone from the start — a pure race.',
    config: { targetVisible: true }, score: 1.1,
  },
};

// Merge the config overrides of the chosen modifiers. Later ids win on a key
// clash (kept simple; the launch set has disjoint keys).
export function modifierConfig(ids = []) {
  const out = {};
  for (const id of ids) Object.assign(out, MODIFIERS[id]?.config);
  return out;
}

// Stacked challenges compound the reward. Empty -> 1 (no modifiers, no bonus).
export function scoreMultiplier(ids = []) {
  return ids.reduce((m, id) => m * (MODIFIERS[id]?.score ?? 1), 1);
}

// Deterministic daily/weekly mutator from a seeded rng (so everyone racing the
// same day gets the same modifier). count > 1 picks distinct modifiers.
export function rollDailyModifier(rng, count = 1) {
  const pool = Object.keys(MODIFIERS);
  const picks = [];
  while (picks.length < count && pool.length) {
    const i = Math.floor(rng.float() * pool.length);
    picks.push(pool.splice(i, 1)[0]);
  }
  return count === 1 ? picks[0] : picks;
}

export const describeModifier = (id) => {
  const m = MODIFIERS[id];
  return m ? { id: m.id, name: m.name, desc: m.desc, score: m.score } : null;
};

export const allModifiers = () => Object.values(MODIFIERS).map((m) => describeModifier(m.id));
