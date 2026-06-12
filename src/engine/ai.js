// AI chooses a valid action for the current chooser. The engine adapter
// may attach a `legalActions` helper function to the state for contract-aware
// action generation.

function getLegalActions(state) {
  if (!state) return [];
  if (typeof state.legalActions === 'function') {
    return state.legalActions(state) || [];
  }
  if (Array.isArray(state.legalActions)) return state.legalActions;
  if (typeof state.legal === 'function') return state.legal(state) || [];
  if (Array.isArray(state.legal)) return state.legal;
  return [];
}

function sortActions(actions) {
  return [...actions].sort((a, b) => {
    const order = {
      attack: 10,
      move: 20,
      rest: 30,
      respond: 5,
      battleCard: 15,
      pick: 40,
      stop: 50,
      pass: 60,
      timing: 70,
      confirm: 80,
    };
    return (order[a.type] ?? 100) - (order[b.type] ?? 100);
  });
}

export function chooseAction(state) {
  try {
    const actions = getLegalActions(state);
    if (!actions.length) return { type: 'pass' };
    if (state?.phase === 'react.dodge' || state?.phase === 'react.crit') {
      return { type: 'timing', hit: false };
    }
    const sorted = sortActions(actions);
    // prefer attack if available, else move, else rest, else first legal action
    const prefer = ['attack', 'move', 'rest', 'respond', 'battleCard', 'pick', 'stop', 'pass', 'confirm'];
    for (const type of prefer) {
      const candidate = sorted.find((a) => a.type === type);
      if (candidate) return candidate;
    }
    return sorted[0];
  } catch (e) {
    return { type: 'pass' };
  }
}
