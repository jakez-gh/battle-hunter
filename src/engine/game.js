import { buildDeck, cardColor, cardValue, isSpecial } from './cards.js';
import { generateBoard, neighbors, occupiedSet, pathDistance, reachableTiles, randomFreeTile } from './board.js';
import { rollBoxItem, effectiveStats, hunterHasEffect, hunterHasCounter } from './items.js';
import { monsterStats, MONSTERS, SPAWN_CHANCE, DROP_CHANCE, MAX_REGULAR_MONSTERS } from './monsters.js';
import { resolveBattle } from './combat.js';

const DIRS = {
  N: { x: 0, y: -1 }, S: { x: 0, y: 1 }, W: { x: -1, y: 0 }, E: { x: 1, y: 0 },
};
const FLAG_COLORS = ['red', 'blue', 'green', 'yellow'];
const MONSTER_KINDS = ['VAC', 'OOZ', 'FNG'];

function makeRng(seed) {
  let s = (seed >>> 0) || 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    get s() { return s; },
    set s(v) { s = v >>> 0; },
    float: next,
    int: (n) => Math.floor(next() * n),
    range: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    d6: () => 1 + Math.floor(next() * 6),
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    },
    pick(arr) {
      return arr[Math.floor(next() * arr.length)];
    },
  };
}

function clone(state) {
  return JSON.parse(JSON.stringify(state));
}

function resolveUnit(state, ref) {
  if (!state || ref == null) return null;
  if (typeof ref === 'object') {
    if (ref.kind === 'hunter' && typeof ref.index === 'number') return state.hunters?.[ref.index] ?? null;
    if (ref.kind === 'monster' && typeof ref.index === 'number') return state.monsters?.[ref.index] ?? null;
    if (ref.id !== undefined) {
      return state.hunters?.find((h) => h.id === ref.id) || state.monsters?.find((m) => m.id === ref.id) || null;
    }
    if (ref.pos || ref.hp !== undefined || ref.name) return ref;
  }
  if (typeof ref === 'number') return state.hunters?.[ref] ?? state.monsters?.[ref] ?? null;
  return state.hunters?.find((h) => h.id === String(ref)) || state.monsters?.find((m) => m.id === String(ref)) || null;
}

function unitRef(state, unit) {
  if (!unit) return null;
  const hunterIndex = state.hunters?.findIndex((h) => h.id === unit.id);
  if (hunterIndex >= 0) return { kind: 'hunter', index: hunterIndex };
  const monsterIndex = state.monsters?.findIndex((m) => m.id === unit.id);
  if (monsterIndex >= 0) return { kind: 'monster', index: monsterIndex };
  return null;
}

function currentChooser(state) {
  if (!state) return null;
  if (state.current?.kind === 'hunter') return state.hunters?.[state.current.index] ?? null;
  if (state.current?.kind === 'monster') return state.monsters?.[state.current.index] ?? null;
  return state.hunters?.[0] ?? null;
}

function isHumanTurn(state) {
  const chooser = currentChooser(state);
  return !!(chooser && chooser.human && !(chooser.status?.panic > 0) && state.current?.kind === 'hunter');
}

function key(pos) {
  return `${pos.x},${pos.y}`;
}

function samePos(a, b) {
  return a && b && a.x === b.x && a.y === b.y;
}

function unitAt(state, pos) {
  return [...(state.hunters || []), ...(state.monsters || [])].find((u) => u.pos && samePos(u.pos, pos)) || null;
}

function pathToTarget(state, from, to) {
  return pathDistance(state.board, occupiedSet(state), from, to);
}

function getNextCurrent(current, state) {
  const order = [];
  for (let i = 0; i < (state.hunters?.length || 0); i++) order.push({ kind: 'hunter', index: i });
  for (let i = 0; i < (state.monsters?.length || 0); i++) order.push({ kind: 'monster', index: i });
  if (!order.length) return null;
  let start = 0;
  if (current) {
    const idx = order.findIndex((u) => u.kind === current.kind && u.index === current.index);
    start = idx >= 0 ? (idx + 1) % order.length : 0;
  }

  for (let i = 0; i < order.length; i++) {
    const candidate = order[(start + i) % order.length];
    const unit = resolveUnit(state, candidate);
    if (!unit || unit.hp <= 0 || !unit.pos) continue;
    if (unit.kind === 'hunter' && unit.status?.stun > 0) {
      unit.status.stun = Math.max(0, unit.status.stun - 1);
      continue;
    }
    return candidate;
  }
  return null;
}

function addEvent(state, event) {
  state.events = state.events || [];
  state.events.push(event);
}

function makeHunterRecord(h) {
  return {
    id: h.id,
    slot: h.slot,
    name: h.name,
    spriteId: h.spriteId,
    palette: h.palette,
    human: !!h.human,
    archetype: h.archetype ?? null,
    level: h.level,
    internal: { ...h.internal },
    maxHp: h.maxHp,
    baseMaxHp: h.baseMaxHp,
    hp: h.hp,
    hand: [...(h.hand || [])],
    items: (h.items || []).map((it) => ({ ...it })),
    pos: { ...h.pos },
    hasTarget: !!h.hasTarget,
    status: { ...(h.status || {}) },
    tally: { ...(h.tally || {}) },
  };
}

function combatStat(hunter) {
  const stats = {
    mv: Math.floor((hunter.internal?.mv || 1) / 3),
    at: hunter.internal?.at || 1,
    df: Math.floor((hunter.internal?.df || 1) / 2),
  };
  if (hunter.status?.leg) stats.mv = hunterHasEffect(hunter, 'crutch') ? 1 : 0;
  const extra = effectiveStats(hunter);
  stats.mv += extra.mv || 0;
  return stats;
}

function buildBattleSide(state, unit, kind) {
  const side = { kind, at: 0, df: 0, mv: 0, hp: unit.hp, maxHp: unit.maxHp, stunned: !!unit.status?.stun, effects: {} };
  if (kind === 'monster') {
    side.at = unit.at;
    side.df = unit.df;
    side.mv = unit.mv;
    // FNG crit rider: inflict Empty (§2.8 / combat.js actuator flag).
    // WYRM crit rider: inflict Stun (§2.8 / combat.js generator flag).
    if (unit.kind === 'FNG') side.effects.actuator = true;
    if (unit.kind === 'WYRM') side.effects.generator = true;
  } else {
    const stats = combatStat(unit);
    side.at = stats.at + (effectiveStats(unit).at || 0);
    side.df = stats.df + (effectiveStats(unit).df || 0);
    side.mv = stats.mv;
    const effects = side.effects;
    if (hunterHasEffect(unit, 'warbanner')) effects.warbanner = true;
    if (hunterHasEffect(unit, 'aegis')) effects.aegis = true;
    if (hunterHasEffect(unit, 'voyager')) effects.voyager = true;
    if (hunterHasEffect(unit, 'actuator')) effects.actuator = true;
    if (hunterHasEffect(unit, 'generator')) effects.generator = true;
    if (hunterHasEffect(unit, 'blackgem')) effects.blackgem = true;
    if (hunterHasEffect(unit, 'amulet')) effects.amulet = true;
    if (hunterHasEffect(unit, 'voyager')) effects.escapeBonus = 0;
    const escapeItem = ['slickboots', 'jumpsuit', 'longcoat'].find((id) => hunterHasEffect(unit, id));
    if (escapeItem) {
      effects.escapeBonus = Math.max(effects.escapeBonus || 0, effectiveStats(unit).escape || 0);
    }
  }
  return side;
}

function isAdjacent(a, b) {
  return !!a && !!b && Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
}

function canUseMoveCard(cardId) {
  if (!cardId) return true;
  const color = cardColor(cardId);
  return color === 'blue' || color === 'yellow' || color === 'green';
}

function cardEffectInfo(cardId) {
  if (!cardId) return {};
  return {
    color: cardColor(cardId),
    value: cardValue(cardId),
    special: isSpecial(cardId) ? cardId.slice(1) : null,
  };
}

// Stat portion only (no d6). d6 is rolled in applyMove and added at that point.
// legalActions uses this with range=1 to check adjacency; actual range = d6 + this.
function moveStatBonus(unit, card) {
  const baseMv = hunterHasEffect(unit, 'crutch') && unit.status?.leg ? 1 : Math.floor((unit.internal?.mv || 1) / 3);
  let mv = unit.status?.leg ? (hunterHasEffect(unit, 'crutch') ? 1 : 0) : baseMv + (effectiveStats(unit).mv || 0);
  const cardInfo = cardEffectInfo(card);
  if (cardInfo.color === 'blue' && typeof cardInfo.value === 'number') mv += cardInfo.value;
  return mv;
}

function passiveEvasion(unit, card) {
  let chance = 0;
  const cardInfo = cardEffectInfo(card);
  if (cardInfo.color === 'yellow') {
    if (cardInfo.special === 'D' || cardInfo.special === 'A') chance = 1;
    else if (typeof cardInfo.value === 'number') chance = cardInfo.value / 10;
  }
  const sensor = effectiveStats(unit).sensor || 0;
  if (sensor > 0) chance = Math.max(chance, sensor / 100);
  if (hunterHasEffect(unit, 'cursedgem')) chance = Math.max(0, chance - 0.9);
  return Math.min(1, chance);
}

function hasActiveTarget(holder) {
  return !!holder?.hasTarget;
}

function setMissionOver(state, win, reason = null) {
  state.phase = 'mission.over';
  state._missionEnd = { win: !!win, reason };
  if (win) addEvent(state, { type: 'missionWon', winner: state.current });
  else addEvent(state, { type: 'missionLost', reason });
}

function applyEndTurn(state, rng) {
  const current = resolveUnit(state, state.current);
  if (current?.kind === 'hunter') {
    if (!state.turn?.rested && current.hand.length < 5) {
      if (state.deck.length > 0) {
        const card = state.deck.shift();
        current.hand.push(card);
        addEvent(state, { type: 'cardDrawn', unit: state.current, card });
        addEvent(state, { type: 'deckCount', count: state.deck.length });
      } else {
        addEvent(state, { type: 'drewBlank', unit: state.current });
      }
    }
    if (current.status?.empty > 0) current.status.empty = Math.max(0, current.status.empty - 1);
    // Calmant: auto-cure panic at turn end.
    if (hunterHasEffect(current, 'calmant')) current.status.panic = 0;
    else if (current.status?.panic > 0) current.status.panic = Math.max(0, current.status.panic - 1);
    // Angel Feather: heal 1d6 HP after each own turn.
    if (hunterHasEffect(current, 'angelfeather')) {
      const heal = rng.d6();
      current.hp = Math.min(current.maxHp, current.hp + heal);
      addEvent(state, { type: 'healed', unit: current.id, amount: heal });
    }
    // Fear Stone (cursed): 20% chance of self-panic.
    if (hunterHasEffect(current, 'fearstone') && rng.float() < 0.2) {
      current.status.panic = (current.status.panic || 0) + 1;
      addEvent(state, { type: 'statusInflicted', kind: 'panic', target: current.id });
    }
    // Dark Gem (cursed): 20% chance of self-empty (discard hand).
    if (hunterHasEffect(current, 'darkgem') && rng.float() < 0.2) {
      current.hand = [];
      current.status.empty = 1;
      addEvent(state, { type: 'statusInflicted', kind: 'empty', target: current.id });
    }
  }
  if (state.turn?.moved) {
    maybeSpawnMonster(state, rng);
  }
  const previous = state.current;
  if (state.turn?.actAgain) {
    state.turn.actAgain = false;
    state.phase = 'turn.action';
    state.move = null;
    state.battle = null;
    state.pendingChoice = null;
    addEvent(state, { type: 'turnStarted', unit: state.current });
    return;
  }
  const next = getNextCurrent(previous, state);
  if (!next) {
    setMissionOver(state, false, 'no units remain');
    return;
  }
  if (previous?.kind === 'monster' && next.kind === 'hunter' && next.index === 0) {
    state.round = (state.round || 1) + 1;
  }
  state.current = next;
  state.phase = 'turn.action';
  state.move = null;
  state.battle = null;
  state.pendingChoice = null;
  state.turn = { moved: false, rested: false, actAgain: false };
  addEvent(state, { type: 'turnStarted', unit: state.current });
}

function maybeSpawnMonster(state, rng) {
  if (state.deck.length === 0) {
    const wyrm = state.monsters?.find((m) => m.kind === 'WYRM' && m.hp > 0);
    if (!wyrm) {
      const free = randomFreeTile(state, rng);
      if (!free) return;
      const existing = state.monsters?.find((m) => m.kind === 'WYRM');
      if (existing) {
        existing.hp = monsterStats('WYRM', state.relicLevel).hp;
        existing.maxHp = monsterStats('WYRM', state.relicLevel).hp;
        existing.pos = free;
        existing.kind = 'WYRM';
        addEvent(state, { type: 'wyrmRespawned', kind: 'WYRM', pos: free });
      } else {
        state.monsters.push({ id: Date.now() + Math.floor(Math.random() * 1000), kind: 'WYRM', hp: monsterStats('WYRM', state.relicLevel).hp, maxHp: monsterStats('WYRM', state.relicLevel).hp, pos: free });
        addEvent(state, { type: 'wyrmSpawned', kind: 'WYRM', pos: free });
      }
      return;
    }
    return;
  }

  const regular = (state.monsters || []).filter((m) => m.kind !== 'WYRM' && m.hp > 0);
  if (regular.length >= MAX_REGULAR_MONSTERS) return;
  const chance = state.turn?.cardPlayed && cardColor(state.turn.cardPlayed) === 'yellow' ? SPAWN_CHANCE / 2 : SPAWN_CHANCE;
  if (rng.float() >= chance) return;
  const freeTiles = [];
  for (let y = 0; y < state.board.h; y++) {
    for (let x = 0; x < state.board.w; x++) {
      const pos = { x, y };
      if (!state.board.floor[y][x]) continue;
      if (state.board.exit && samePos(pos, state.board.exit)) continue;
      if (state.board.flags.some((f) => samePos(f, pos))) continue;
      if (state.board.traps.some((t) => samePos(t, pos))) continue;
      if (unitAt(state, pos)) continue;
      const adjacentHunter = state.hunters.some((h) => h.pos && isAdjacent(h.pos, pos));
      if (adjacentHunter) continue;
      freeTiles.push(pos);
    }
  }
  if (!freeTiles.length) return;
  const tile = rng.pick(freeTiles);
  const kind = rng.pick(MONSTER_KINDS);
  const stats = monsterStats(kind, state.relicLevel);
  const id = Date.now() + Math.floor(Math.random() * 1000);
  state.monsters.push({ id, kind, hp: stats.hp, maxHp: stats.hp, pos: tile, at: stats.at, df: stats.df, mv: stats.mv });
  addEvent(state, { type: 'monsterSpawned', kind, id, pos: tile });
}

function drawBox(state, hunter) {
  const box = state.board.boxes.find((b) => samePos(b, hunter.pos) && !b.opened);
  if (!box) return;
  box.opened = true;
  const contents = box.contents;
  if (contents === 'TARGET') {
    hunter.hasTarget = true;
    state.targetFound = true;
    state.targetHolder = unitRef(state, hunter);
    addEvent(state, { type: 'boxOpened', pos: { ...box }, contents: 'TARGET' });
    addEvent(state, { type: 'targetFound', hunter: hunter.id });
    return;
  }
  if (!contents) {
    addEvent(state, { type: 'boxOpened', pos: { ...box }, contents: null });
    return;
  }
  hunter.items = hunter.items || [];
  if (hunter.items.length < 6) {
    hunter.items.push({ itemId: contents, identified: true });
    addEvent(state, { type: 'boxOpened', pos: { ...box }, contents });
    addEvent(state, { type: 'itemTaken', unit: hunter.id, itemId: contents });
    return;
  }
  state.pendingChoice = {
    kind: 'discardOverflow',
    chooser: unitRef(state, hunter),
    incoming: { itemId: contents, identified: true, label: 'New item' },
    options: hunter.items.map((item) => ({ ...item })),
  };
  addEvent(state, { type: 'boxOpened', pos: { ...box }, contents });
}

function claimFlag(state, hunter, flag) {
  if (!flag || flag.taken) return;
  flag.taken = true;
  const roll = state.rng ? null : null; // handled by rng in applyAction
}

function flagEffect(state, hunter, flag, roll, rng) {
  // Base points per DESIGN §2.6 (JP table). Roll 5/6 non-yellow all award 250.
  const pts =
    roll === 1 ? 250
    : roll === 2 ? 250
    : roll === 3 ? 500
    : roll === 4 ? 1000
    : roll === 5 && flag.color === 'yellow' ? 1500
    : roll === 6 && flag.color === 'yellow' ? 2000
    : 250; // rolls 5/6 non-yellow = 250

  let effect = null;

  if (roll === 1) {
    const trapKind = flag.color === 'red' ? 'damage' : flag.color === 'blue' ? 'leg' : flag.color === 'green' ? 'empty' : 'stun';
    state.board.traps.push({ x: flag.x, y: flag.y, kind: trapKind, byHunter: hunter.id });
    effect = trapKind;
  } else if (roll === 5) {
    if (flag.color === 'red') {
      const heal = Math.ceil(hunter.maxHp / 4);
      hunter.hp = Math.min(hunter.maxHp, hunter.hp + heal);
      addEvent(state, { type: 'healed', unit: hunter.id, amount: heal });
    } else if (flag.color === 'blue') {
      hunter.status.leg = false;
    } else if (flag.color === 'green') {
      drawDeckCards(state, hunter, rng, 2);
    }
    // yellow 5: pts only (handled above)
  } else if (roll === 6) {
    if (flag.color === 'red') {
      hunter.hp = hunter.maxHp;
      // restore half of lost maxHP (round up) — red 6 partial maxHP repair
      const lost = hunter.baseMaxHp - hunter.maxHp;
      if (lost > 0) hunter.maxHp = Math.min(hunter.baseMaxHp, hunter.maxHp + Math.ceil(lost / 2));
    } else if (flag.color === 'blue') {
      hunter.status.leg = false;
      state.turn.actAgain = true;
      addEvent(state, { type: 'actAgain', unit: hunter.id });
    } else if (flag.color === 'green') {
      if (!(hunter.status?.empty > 0)) {
        const needed = 5 - hunter.hand.length;
        drawDeckCards(state, hunter, rng, needed);
      }
    }
    // yellow 6: pts only (handled above)
  }

  hunter.tally.flagPts = (hunter.tally.flagPts || 0) + pts;
  addEvent(state, { type: 'flagClaimed', unit: hunter.id, color: flag.color, roll, effect });
}

function drawDeckCards(state, hunter, rng, count) {
  for (let i = 0; i < count; i++) {
    if (hunter.hand.length >= 5) break;
    if (state.deck.length <= 0) {
      addEvent(state, { type: 'drewBlank', unit: hunter.id });
      break;
    }
    const card = state.deck.shift();
    hunter.hand.push(card);
    addEvent(state, { type: 'cardDrawn', unit: hunter.id, card });
    addEvent(state, { type: 'deckCount', count: state.deck.length });
  }
}

function getAdjacentEnemies(state, unit) {
  const enemies = [];
  const pos = unit?.pos;
  if (!pos) return enemies;
  const all = unit.kind === 'monster' ? state.hunters : state.monsters;
  const kind = unit.kind === 'monster' ? 'hunter' : 'monster';
  for (let index = 0; index < (all?.length || 0); index++) {
    const other = all[index];
    if (!other?.pos || other.hp <= 0) continue;
    if (Math.abs(other.pos.x - pos.x) + Math.abs(other.pos.y - pos.y) === 1) {
      enemies.push({ kind, index, unit: other });
    }
  }
  return enemies;
}

function moveUnitTo(state, unit, pos) {
  if (!unit) return;
  unit.pos = { x: pos.x, y: pos.y };
}

function openBoxIfNeeded(state, rng, unit) {
  const box = state.board.boxes.find((b) => samePos(b, unit.pos) && !b.opened);
  if (!box) return;
  drawBox(state, unit);
}

function endMovement(state, rng) {
  const unit = resolveUnit(state, state.current);
  if (!unit) return;
  const enemies = getAdjacentEnemies(state, unit);
  if (enemies.length > 0) {
    state.phase = 'turn.postMove';
    return;
  }
  applyEndTurn(state, rng);
}

function defeatHunter(state, victim, rng) {
  victim.maxHp = Math.max(1, Math.floor(victim.maxHp / 2));
  victim.hp = victim.maxHp;
  victim.pos = randomFreeTile(state, rng);
  if (victim.status) victim.status.stun = (victim.status.stun || 0) + 1;
  if (victim.tally) victim.tally.defeats = (victim.tally.defeats || 0) + 1;
  addEvent(state, { type: 'hunterDefeated', unit: victim.id });
}

function resolveBattleOutcome(state, rng) {
  const battle = state.battle;
  if (!battle) return;
  const attacker = resolveUnit(state, battle.attacker);
  const defender = resolveUnit(state, battle.defender);
  if (!attacker || !defender) {
    applyEndTurn(state, rng);
    return;
  }
  const atkKind = battle.attacker.kind;  // 'hunter' or 'monster' (from ref)
  const defKind = battle.defender.kind;
  const atkSide = buildBattleSide(state, attacker, atkKind);
  const defSide = buildBattleSide(state, defender, defKind);
  // Counter items: hunter holding matching counter vs monster → monster fights stunned.
  if (atkKind === 'hunter' && defKind === 'monster' && hunterHasCounter(attacker, defender.kind)) {
    defSide.stunned = true;
  }
  const ctx = {
    rng,
    attacker: atkSide,
    defender: defSide,
    response: battle.response,
    atkCard: battle.atkCard || null,
    defCard: battle.defCard || null,
    critNegateAttempt: battle.critNegateAttempt || {},
    relicLevel: state.relicLevel,
  };
  const result = resolveBattle(ctx);
  for (const ev of result.events || []) addEvent(state, ev);

  // Apply HP changes from combat (resolveBattle is pure and does not mutate units).
  if (result.hpChanges) {
    attacker.hp = Math.max(0, attacker.hp + result.hpChanges.attacker);
    defender.hp = Math.max(0, defender.hp + result.hpChanges.defender);
    // Track damage dealt (positive = damage done to the enemy) in hunter tallies.
    const atkDmgDealt = Math.max(0, -result.hpChanges.defender);
    const defDmgDealt = Math.max(0, -result.hpChanges.attacker);
    if (atkKind === 'hunter' && attacker.tally && atkDmgDealt > 0)
      attacker.tally.damage = (attacker.tally.damage || 0) + atkDmgDealt;
    if (defKind === 'hunter' && defender.tally && defDmgDealt > 0)
      defender.tally.damage = (defender.tally.damage || 0) + defDmgDealt;
  }

  // Apply status effects from crits.
  if (result.statuses) {
    for (const kind of result.statuses.attacker || []) {
      if (atkKind === 'hunter' && attacker.status) attacker.status[kind] = (attacker.status[kind] || 0) + 1;
    }
    for (const kind of result.statuses.defender || []) {
      if (defKind === 'hunter' && defender.status) defender.status[kind] = (defender.status[kind] || 0) + 1;
    }
  }

  if (result.outcome.defenderDefeated) {
    if (defKind === 'monster') {
      const killBonus = MONSTERS[defender.kind]?.killBonus || 0;
      if (atkKind === 'hunter' && attacker.tally) {
        attacker.tally.killPts = (attacker.tally.killPts || 0) + killBonus;
      }
      let drop = null;
      if (atkKind === 'hunter' && defender.kind !== 'WYRM' && rng.float() < DROP_CHANCE) {
        const itemId = MONSTERS[defender.kind]?.dropItemId;
        if (itemId) {
          attacker.items = attacker.items || [];
          if (attacker.items.length < 6) {
            attacker.items.push({ itemId, identified: true });
            drop = itemId;
            addEvent(state, { type: 'itemTaken', unit: attacker.id, itemId });
          }
        }
      }
      addEvent(state, { type: 'monsterKilled', unit: defender.id, drop });
      defender.hp = 0;
      defender.pos = null;
    } else {
      // Hunter defender defeated.
      const hadTarget = !!defender.hasTarget;
      defeatHunter(state, defender, rng);
      if (atkKind === 'hunter') {
        if (attacker.tally) attacker.tally.killPts = (attacker.tally.killPts || 0) + 500;
        const stealOptions = [];
        if (hadTarget) stealOptions.push({ itemId: 'TARGET', label: 'TARGET ITEM' });
        for (const item of defender.items || []) stealOptions.push({ itemId: item.itemId, identified: item.identified });
        if (stealOptions.length > 0) {
          state.pendingChoice = {
            kind: 'steal',
            chooser: battle.attacker,
            defender: battle.defender,
            options: stealOptions,
          };
          state.phase = 'choice.steal';
          return;
        }
        if (hadTarget) {
          defender.hasTarget = false;
          attacker.hasTarget = true;
          state.targetHolder = unitRef(state, attacker);
          addEvent(state, { type: 'itemTaken', unit: attacker.id, itemId: 'TARGET' });
        }
      } else if (atkKind === 'monster' && hadTarget) {
        return setMissionOver(state, false, `${attacker.kind ?? 'monster'} eliminated target holder`);
      }
    }
  }

  if (result.outcome.attackerDefeated && atkKind === 'hunter') {
    defeatHunter(state, attacker, rng);
  }

  applyEndTurn(state, rng);
}

export function createGame(config) {
  const seed = config.seed ?? Date.now();
  const rng = makeRng(seed);
  const players = (config.hunters || []).map((h) => ({ ...h }));
  const levels = players.map((h) => Math.max(1, Math.min(15, h.level ?? 1)));
  const relicLevel = config.mode === 'story' ? Math.max(1, Math.min(15, config.mission?.level || 1)) : Math.max(1, Math.min(15, Math.ceil(levels.reduce((a, b) => a + b, 0) / Math.max(1, levels.length))));
  const board = generateBoard(rng, relicLevel, rollBoxItem);
  const deck = buildDeck(rng);
  const tiles = [];
  for (let y = 0; y < board.h; y++) {
    for (let x = 0; x < board.w; x++) {
      if (!board.floor[y][x]) continue;
      if (samePos({ x, y }, board.exit)) continue;
      if (board.flags.some((f) => f.x === x && f.y === y)) continue;
      if (board.boxes.some((b) => b.x === x && b.y === y)) continue;
      if (board.traps.some((t) => t.x === x && t.y === y)) continue;
      tiles.push({ x, y });
    }
  }
  rng.shuffle(tiles);
  const hunters = players.map((hRec, i) => {
    const start = tiles[i] || { x: 0, y: 0 };
    const internal = { ...hRec.internal };
    const baseMaxHp = 7 + 3 * (internal.hp || 1) + (hRec.level - 1);
    return {
      id: hRec.id || `h${i}`,
      slot: hRec.slot ?? i,
      name: hRec.name || `CPU-${i}`,
      spriteId: hRec.spriteId ?? 0,
      palette: hRec.palette ?? 'cobalt',
      human: !!hRec.human,
      archetype: hRec.archetype || null,
      level: hRec.level || 1,
      internal,
      maxHp: hRec.maxHp ?? baseMaxHp,
      baseMaxHp,
      hp: hRec.maxHp ?? baseMaxHp,
      hand: deck.splice(0, 5),
      items: (hRec.items || []).map((it) => ({ ...it })),
      pos: { ...start },
      hasTarget: false,
      status: { stun: 0, leg: false, panic: 0, empty: 0 },
      tally: { moved: 0, damage: 0, flagPts: 0, killPts: 0, defeats: 0 },
    };
  });
  // AI starting items by level (§2.11): L1-5 none, L6-8 one, L9-11 two, L12-15 three.
  for (const h of hunters) {
    if (h.human) continue;
    const n = h.level >= 12 ? 3 : h.level >= 9 ? 2 : h.level >= 6 ? 1 : 0;
    for (let i = 0; i < n && h.items.length < 6; i++) {
      h.items.push({ itemId: rollBoxItem(rng, h.level), identified: true });
    }
  }

  if (config.mission?.carrierIndex != null && config.mission.carrierIndex >= 0 && config.mission.carrierIndex < 3) {
    const index = config.mission.carrierIndex + 1;
    if (hunters[index]) {
      hunters[index].hasTarget = true;
    }
    board.boxes.forEach((b) => { if (b.contents === 'TARGET') b.contents = rollBoxItem(rng, relicLevel); });
  }
  const state = {
    seed,
    rng: { s: rng.s },
    mode: config.mode || 'normal',
    missionId: config.mission?.id ?? null,
    relicLevel,
    board,
    deck,
    targetItemId: config.mission?.targetItemId || null,
    targetFound: hunters.some((h) => h.hasTarget),
    targetHolder: hunters.find((h) => h.hasTarget) ? { kind: 'hunter', index: hunters.findIndex((h) => h.hasTarget) } : null,
    hunters,
    monsters: [],
    round: 1,
    current: { kind: 'hunter', index: 0 },
    phase: 'turn.action',
    move: null,
    battle: null,
    pendingChoice: null,
    result: null,
    events: [],
    turn: { moved: false, rested: false, actAgain: false },
  };
  addEvent(state, { type: 'turnStarted', unit: state.current });
  return state;
}

function legalActions(state) {
  if (!state) return [];
  if (state.phase === 'mission.over') return [{ type: 'confirm' }];
  if (state.pendingChoice) {
    return (state.pendingChoice.options || []).map((option) => ({ type: 'pick', option }));
  }

  const chooser = currentChooser(state);
  if (!chooser || chooser.hp <= 0 || !chooser.pos) return [];
  const actions = [];
  const isHunter = state.current?.kind === 'hunter';

  if (state.phase === 'turn.action') {
    const occupied = occupiedSet(state);
    const moveCardIds = (chooser.hand || []).filter((card) => {
      const color = cardColor(card);
      return color === 'blue' || color === 'yellow' || color === 'green';
    });
    // d6 always gives ≥1, so Move is available whenever any adjacent tile is walkable (range=1 check).
    const canMove = reachableTiles(state.board, occupied, chooser.pos, 1).size > 0;
    if (canMove) actions.push({ type: 'move' });
    if (canMove) {
      for (const card of moveCardIds) actions.push({ type: 'move', card });
    }
    if (state.current?.kind === 'hunter') {
      actions.push({ type: 'rest' });
    }
    const enemies = getAdjacentEnemies(state, { kind: state.current.kind, pos: chooser.pos });
    for (const enemy of enemies) {
      actions.push({ type: 'attack', target: { kind: enemy.kind, index: enemy.index } });
    }
    return actions;
  }

  if (state.phase === 'turn.steer') {
    for (const [dir, delta] of Object.entries(DIRS)) {
      const pos = { x: chooser.pos.x + delta.x, y: chooser.pos.y + delta.y };
      if (pos.x < 0 || pos.y < 0 || pos.x >= state.board.w || pos.y >= state.board.h) continue;
      if (!state.board.floor[pos.y][pos.x]) continue;
      if (unitAt(state, pos)) continue;
      actions.push({ type: 'step', dir });
    }
    if ((state.move?.path?.length || 0) > 0) {
      actions.push({ type: 'stop' });
    }
    return actions;
  }

  if (state.phase === 'turn.postMove') {
    const enemies = getAdjacentEnemies(state, chooser);
    for (const enemy of enemies) {
      actions.push({ type: 'attack', target: { kind: enemy.kind, index: enemy.index } });
    }
    actions.push({ type: 'pass' });
    return actions;
  }

  if (state.phase === 'battle.response') {
    const defender = resolveUnit(state, state.battle?.defender);
    if (defender && state.battle) {
      if (state.battle.defender.kind === 'hunter' && defender.status?.stun) {
        return [{ type: 'respond', response: 'none' }];
      }
      const base = [{ type: 'respond', response: 'counter' }];
      if (state.battle.defender.kind === 'hunter') {
        base.push({ type: 'respond', response: 'guard' });
        if (defender.hand.some((card) => cardColor(card) === 'blue')) {
          base.push({ type: 'respond', response: 'escape' });
        }
        if ((defender.items || []).length > 0 || defender.hasTarget) {
          base.push({ type: 'respond', response: 'surrender' });
        }
      }
      return base;
    }
  }

  if (state.phase === 'battle.defCard' || state.phase === 'battle.atkCard') {
    const side = state.phase === 'battle.defCard' ? resolveUnit(state, state.battle?.defender) : resolveUnit(state, state.battle?.attacker);
    const cards = (side?.hand || []).filter((card) => {
      const color = cardColor(card);
      if (state.phase === 'battle.defCard') {
        if (state.battle?.response === 'counter') return color === 'red' || color === 'yellow';
        if (state.battle?.response === 'guard') return color === 'yellow';
        if (state.battle?.response === 'escape') return color === 'blue';
      }
      if (state.phase === 'battle.atkCard') {
        return color === 'red' || color === 'yellow' || color === 'blue';
      }
      return false;
    });
    actions.push({ type: 'battleCard', card: null });
    for (const card of cards) actions.push({ type: 'battleCard', card });
    return actions;
  }

  if (state.phase === 'react.dodge' || state.phase === 'react.crit') {
    return [{ type: 'timing', hit: false }, { type: 'timing', hit: true }];
  }

  return [];
}

export { legalActions, isHumanTurn, currentChooser };

function applyMove(state, action, rng) {
  const current = resolveUnit(state, state.current);
  if (!current) return;
  if (action.card) {
    const idx = current.hand.indexOf(action.card);
    if (idx < 0) throw new Error(`card not found: ${action.card}`);
    current.hand.splice(idx, 1);
    addEvent(state, { type: 'cardPlayed', unit: current.id, card: action.card });
    state.turn.cardPlayed = action.card;
  }
  const die = rng.d6();
  addEvent(state, { type: 'dieRolled', unit: current.id, value: die });
  const range = Math.max(1, die + moveStatBonus(current, action.card));
  state.move = { remaining: range, path: [], cardPlayed: action.card || null, trap: null };
  state.phase = 'turn.steer';
  state.turn.moved = true;
}

function applyStep(state, action, rng) {
  const current = resolveUnit(state, state.current);
  if (!current || !state.move) return;
  const isHunterUnit = state.current?.kind === 'hunter';
  const delta = DIRS[action.dir];
  if (!delta) throw new Error('invalid step direction');
  const nextPos = { x: current.pos.x + delta.x, y: current.pos.y + delta.y };
  if (unitAt(state, nextPos)) throw new Error('target occupied');
  addEvent(state, { type: 'stepped', unit: current.id, from: { ...current.pos }, to: { ...nextPos } });
  current.pos = nextPos;
  if (isHunterUnit && current.tally) current.tally.moved = (current.tally.moved || 0) + 1;
  state.move.path.push({ ...nextPos });
  state.move.remaining = Math.max(0, state.move.remaining - 1);
  if (isHunterUnit) {
    const trap = state.board.traps.find((t) => samePos(t, nextPos));
    if (trap) {
      const chance = passiveEvasion(current, state.move.cardPlayed);
      if (rng.float() < chance) {
        addEvent(state, { type: 'trapDodged', unit: current.id, pos: { ...nextPos } });
        if (state.move.remaining > 0) return;
      } else if (current.human) {
        state.phase = 'react.dodge';
        state.move.trap = trap;
        return;
      } else {
        triggerTrap(state, current, trap, rng, true);
        return;
      }
    }
    const flag = state.board.flags.find((f) => samePos(f, nextPos) && !f.taken);
    if (flag) {
      flag.taken = true;
      const roll = rng.d6();
      flagEffect(state, current, flag, roll, rng);
    }
  }
  if (state.move.remaining === 0) {
    if (isHunterUnit && samePos(current.pos, state.board.exit)) {
      if (current.hasTarget) {
        setMissionOver(state, true);
      } else {
        current.pos = randomFreeTile(state, rng);
        if (current.status) current.status.leg = false;
        addEvent(state, { type: 'exitWarpedAway', unit: current.id, pos: { ...current.pos } });
        applyEndTurn(state, rng);
      }
      return;
    }
    if (isHunterUnit) openBoxIfNeeded(state, rng, current);
    endMovement(state, rng);
  }
}

function triggerTrap(state, unit, trap, rng, isHunterUnit) {
  if (!trap) return;
  state.board.traps = state.board.traps.filter((t) => t !== trap);
  addEvent(state, { type: 'trapTriggered', unit: unit.id, kind: trap.kind, pos: { x: trap.x, y: trap.y } });
  if (!isHunterUnit) { applyEndTurn(state, rng); return; }
  if (trap.kind === 'damage') {
    const damage = 2;
    unit.hp = Math.max(0, unit.hp - damage);
  } else if (trap.kind === 'stun') {
    if (unit.status) unit.status.stun = (unit.status.stun || 0) + 1;
  } else if (trap.kind === 'leg') {
    if (unit.status) unit.status.leg = true;
  } else if (trap.kind === 'empty') {
    if (unit.status) unit.status.empty = 1;
    unit.hand = [];
  }
  if (unit.hp <= 0) {
    defeatHunter(state, unit, rng);
  }
  applyEndTurn(state, rng);
}

function applyStop(state, rng) {
  const current = resolveUnit(state, state.current);
  if (!current || !state.move) return;
  const isHunterUnit = state.current?.kind === 'hunter';
  if (isHunterUnit) openBoxIfNeeded(state, rng, current);
  if (isHunterUnit && samePos(current.pos, state.board.exit)) {
    if (current.hasTarget) {
      setMissionOver(state, true);
      return;
    }
    current.pos = randomFreeTile(state, rng);
    if (current.status) current.status.leg = false;
    addEvent(state, { type: 'exitWarpedAway', unit: current.id, pos: { ...current.pos } });
    applyEndTurn(state, rng);
    return;
  }
  endMovement(state, rng);
}

function applyPass(state, rng) {
  applyEndTurn(state, rng);
}

function applyAttack(state, action, rng) {
  const current = resolveUnit(state, state.current);
  if (!current) return;
  const target = resolveUnit(state, action.target);
  if (!target) throw new Error('invalid target');
  state.battle = {
    attacker: state.current,
    defender: action.target,
    stage: 'response',
    response: null,
    defCard: null,
    atkCard: null,
  };
  state.phase = 'battle.response';
  addEvent(state, { type: 'battleStarted', attacker: current.id, defender: target.id });
}

function applyRest(state, rng) {
  const current = resolveUnit(state, state.current);
  if (!current) return;
  const base = Math.ceil(current.maxHp / 4);
  const amount = hunterHasEffect(current, 'medkit') ? Math.ceil(base * 1.5) : base;
  current.hp = Math.min(current.maxHp, current.hp + amount);
  addEvent(state, { type: 'healed', unit: current.id, amount });
  drawDeckCards(state, current, rng, current.hand.length === 0 ? 3 : 2);
  state.turn.rested = true;
  applyEndTurn(state, rng);
}

function applyRespond(state, action, rng) {
  if (!state.battle) return;
  state.battle.response = action.response;
  addEvent(state, { type: 'responseChosen', response: action.response });
  if (action.response === 'surrender') {
    const defender = resolveUnit(state, state.battle.defender);
    const attacker = resolveUnit(state, state.battle.attacker);
    if (!defender) return;
    const options = [];
    if (defender.hasTarget) options.push({ itemId: 'TARGET', label: 'TARGET ITEM' });
    for (const item of defender.items || []) {
      options.push({ itemId: item.itemId, identified: item.identified });
    }
    state.pendingChoice = { kind: 'surrenderGive', chooser: state.battle.defender, options, attacker: state.battle.attacker };
    state.phase = 'choice.surrenderGive';
    return;
  }
  if (state.battle.response === 'none') {
    state.battle.stage = 'battle.atkCard';
    state.phase = 'battle.atkCard';
    return;
  }
  if (resolveUnit(state, state.battle.defender)?.kind === 'monster' || action.response === 'escape') {
    state.battle.stage = 'battle.atkCard';
    state.phase = 'battle.atkCard';
    return;
  }
  state.battle.stage = 'battle.defCard';
  state.phase = 'battle.defCard';
}

function consumeCard(unit, card) {
  if (!card) return;
  const idx = (unit.hand || []).indexOf(card);
  if (idx >= 0) unit.hand.splice(idx, 1);
}

function applyBattleCard(state, action, rng) {
  const battle = state.battle;
  if (!battle) return;
  if (state.phase === 'battle.defCard') {
    battle.defCard = action.card || null;
    const defender = resolveUnit(state, battle.defender);
    if (defender && action.card) consumeCard(defender, action.card);
    addEvent(state, { type: 'cardPlayed', unit: defender?.id, card: action.card || null });
    battle.stage = 'battle.atkCard';
    state.phase = 'battle.atkCard';
    return;
  }
  if (state.phase === 'battle.atkCard') {
    battle.atkCard = action.card || null;
    const attacker = resolveUnit(state, battle.attacker);
    if (attacker && action.card) consumeCard(attacker, action.card);
    addEvent(state, { type: 'cardPlayed', unit: attacker?.id, card: action.card || null });
    const defender = resolveUnit(state, battle.defender);
    if (defender?.kind === 'hunter' && defender.human && !defender.status?.stun) {
      state.phase = 'react.crit';
      return;
    }
    resolveBattleOutcome(state, rng);
    return;
  }
}

function applyPick(state, action, rng) {
  const choice = state.pendingChoice;
  if (!choice) return;
  const chooser = resolveUnit(state, choice.chooser);
  if (!chooser) return;
  if (choice.kind === 'discardOverflow') {
    const keep = action.option;
    if (!keep || !keep.itemId) return;
    const incoming = choice.incoming;
    const removeIndex = chooser.items.findIndex((item) => item.itemId === keep.itemId && item.identified === keep.identified);
    if (removeIndex >= 0) chooser.items.splice(removeIndex, 1);
    chooser.items.push({ itemId: incoming.itemId, identified: incoming.identified });
    addEvent(state, { type: 'itemTaken', unit: chooser.id, itemId: incoming.itemId });
    state.pendingChoice = null;
    state.phase = 'turn.postMove';
    return;
  }
  if (choice.kind === 'steal') {
    const defender = resolveUnit(state, choice.defender);
    const attacker = resolveUnit(state, choice.chooser);
    if (!defender || !attacker) return;
    if (action.option.itemId === 'TARGET') {
      defender.hasTarget = false;
      attacker.hasTarget = true;
      state.targetHolder = unitRef(state, attacker);
      addEvent(state, { type: 'itemTaken', unit: attacker.id, itemId: 'TARGET' });
    } else {
      const idx = defender.items.findIndex((item) => item.itemId === action.option.itemId && item.identified === action.option.identified);
      attacker.items = attacker.items || [];
      if (idx >= 0 && attacker.items.length < 6) {
        const item = defender.items.splice(idx, 1)[0];
        attacker.items.push(item);
        addEvent(state, { type: 'itemTaken', unit: attacker.id, itemId: item.itemId });
      }
    }
    state.pendingChoice = null;
    applyEndTurn(state, rng);
    return;
  }
  if (choice.kind === 'surrenderGive') {
    const defender = resolveUnit(state, state.battle?.defender);
    const attacker = resolveUnit(state, choice.attacker);
    if (!defender || !attacker) return;
    if (action.option.itemId === 'TARGET') {
      defender.hasTarget = false;
      attacker.hasTarget = true;
      state.targetHolder = unitRef(state, attacker);
      addEvent(state, { type: 'itemTaken', unit: attacker.id, itemId: 'TARGET' });
    } else {
      const idx = defender.items.findIndex((item) => item.itemId === action.option.itemId && item.identified === action.option.identified);
      attacker.items = attacker.items || [];
      if (idx >= 0 && attacker.items.length < 6) {
        const item = defender.items.splice(idx, 1)[0];
        attacker.items.push(item);
        addEvent(state, { type: 'itemTaken', unit: attacker.id, itemId: item.itemId });
      }
    }
    addEvent(state, { type: 'surrendered', unit: defender.id });
    state.pendingChoice = null;
    resolveBattleOutcome(state, rng);
    return;
  }
}

function applyTiming(state, action, rng) {
  if (state.phase === 'react.dodge') {
    const current = resolveUnit(state, state.current);
    const trap = state.move?.trap;
    if (!trap || !current) return;
    state.move.trap = null;
    if (action.hit) {
      addEvent(state, { type: 'trapDodged', unit: current.id, pos: { ...current.pos } });
      state.phase = 'turn.steer';
      return;
    }
    triggerTrap(state, current, trap, rng);
    return;
  }
  if (state.phase === 'react.crit') {
    if (state.battle) {
      state.battle.critNegateAttempt = { defender: action.hit };
      resolveBattleOutcome(state, rng);
    }
    return;
  }
}

export function applyAction(state, action) {
  const next = clone(state);
  next.events = [];
  const rng = makeRng(next.rng?.s ?? 0);
  next.rng = { s: rng.s };

  try {
    if (next.phase === 'mission.over' && action.type === 'confirm') {
      next.result = { win: !!next._missionEnd?.win };
      next.phase = 'completed';
      return { state: next, events: next.events };
    }
    if (next.pendingChoice && action.type === 'pick') {
      applyPick(next, action, rng);
    } else if (next.phase === 'turn.action' && action.type === 'move') {
      applyMove(next, action, rng);
    } else if (next.phase === 'turn.steer' && action.type === 'step') {
      applyStep(next, action, rng);
    } else if (next.phase === 'turn.steer' && action.type === 'stop') {
      applyStop(next, rng);
    } else if ((next.phase === 'turn.postMove' || next.phase === 'turn.action') && action.type === 'attack') {
      applyAttack(next, action, rng);
    } else if (next.phase === 'turn.postMove' && action.type === 'pass') {
      applyPass(next, rng);
    } else if (next.phase === 'turn.action' && action.type === 'rest') {
      applyRest(next, rng);
    } else if (next.phase === 'battle.response' && action.type === 'respond') {
      applyRespond(next, action, rng);
    } else if ((next.phase === 'battle.defCard' || next.phase === 'battle.atkCard') && action.type === 'battleCard') {
      applyBattleCard(next, action, rng);
    } else if ((next.phase === 'react.dodge' || next.phase === 'react.crit') && action.type === 'timing') {
      applyTiming(next, action, rng);
    } else if (action.type === 'pass') {
      applyPass(next, rng);
    } else {
      throw new Error(`invalid action ${JSON.stringify(action)} in phase ${next.phase}`);
    }
  } finally {
    next.rng.s = rng.s;
  }
  return { state: next, events: next.events };
}
