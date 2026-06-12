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

function chooseBattleCard(actions) {
  const cards = actions.filter((a) => a.type === 'battleCard');
  const playable = cards.find((a) => a.card);
  return playable || cards[0];
}

export function chooseAction(state) {
  try {
    const actions = getLegalActions(state);
    if (!actions.length) return { type: 'pass' };
    if (state?.phase === 'react.dodge' || state?.phase === 'react.crit') {
      return { type: 'timing', hit: false };
    }
    if (state?.phase === 'turn.steer') {
      const step = actions.find((a) => a.type === 'step');
      if (step) return step;
      const stop = actions.find((a) => a.type === 'stop');
      if (stop) return stop;
      return actions[0];
    }
    if (state?.phase === 'turn.postMove') {
      const attack = actions.find((a) => a.type === 'attack');
      if (attack) return attack;
      return actions.find((a) => a.type === 'pass') || actions[0];
    }
    if (state?.phase === 'battle.defCard' || state?.phase === 'battle.atkCard') {
      return chooseBattleCard(actions);
    }
    if (state?.phase === 'battle.response') {
      const prefer = ['counter', 'guard', 'escape', 'surrender', 'none'];
      for (const response of prefer) {
        const candidate = actions.find((a) => a.type === 'respond' && a.response === response);
        if (candidate) return candidate;
      }
      return actions[0];
    }
    if (state?.pendingChoice) {
      return actions[0];
    }
    const prefer = ['attack', 'move', 'rest', 'respond', 'battleCard', 'pick', 'stop', 'pass', 'confirm'];
    for (const type of prefer) {
      const candidate = actions.find((a) => a.type === type);
      if (candidate) return candidate;
    }
    return actions[0];
  } catch (e) {
    return { type: 'pass' };
  }
}
