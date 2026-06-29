import test from 'node:test';
import assert from 'node:assert/strict';
import { MONSTERS, monsterStats, SPAWN_CHANCE, DROP_CHANCE, MAX_REGULAR_MONSTERS } from '../src/engine/monsters.js';
import {
  STORY_MISSIONS, RIVALS, rivalStats, interpolateInternal, displayStats,
  makeNormalMission, applyResults, storyClearReward, LEVEL_UP_FEES,
} from '../src/engine/missions.js';

const KINDS = ['VAC', 'OOZ', 'FNG', 'WYRM'];

test('spawn/drop constants match DESIGN.md §2.10 values', () => {
  assert.equal(SPAWN_CHANCE, 0.2);
  assert.equal(DROP_CHANCE, 0.5);
  assert.equal(MAX_REGULAR_MONSTERS, 2);
});

// DESIGN.md §2.10 spot values: [mv, at, df, hp] at levels 1/5/8/10/15.
const SPOT = {
  VAC: { 1: [2, 2, 2, 16], 5: [3, 3, 2, 20], 8: [3, 3, 2, 23], 10: [4, 4, 2, 25], 15: [5, 5, 3, 30] },
  OOZ: { 1: [1, 5, 0, 25], 5: [1, 7, 0, 35], 8: [1, 8, 0, 44], 10: [1, 9, 0, 49], 15: [1, 12, 0, 60] },
  FNG: { 1: [1, 6, 3, 13], 5: [1, 7, 4, 17], 8: [2, 8, 4, 20], 10: [2, 8, 5, 22], 15: [3, 10, 6, 27] },
  WYRM: { 1: [3, 12, 3, 19], 5: [4, 13, 3, 23], 8: [4, 14, 4, 26], 10: [4, 14, 4, 31], 15: [5, 15, 5, 36] },
};

test('monster stat tables match DESIGN spot values', () => {
  for (const kind of KINDS) {
    for (const [lvl, [mv, at, df, hp]] of Object.entries(SPOT[kind])) {
      assert.deepEqual(monsterStats(kind, Number(lvl)), { mv, at, df, hp }, `${kind} L${lvl}`);
    }
  }
});

test('every monster has 15 levels with monotone stats', () => {
  for (const kind of KINDS) {
    assert.equal(MONSTERS[kind].table.length, 15, kind);
    for (let lvl = 2; lvl <= 15; lvl++) {
      const prev = monsterStats(kind, lvl - 1);
      const cur = monsterStats(kind, lvl);
      for (const k of ['mv', 'at', 'df']) {
        assert.ok(cur[k] >= prev[k], `${kind} ${k} dips at L${lvl}`);
      }
      assert.ok(cur.hp > prev.hp, `${kind} hp not strictly increasing at L${lvl}`);
    }
  }
});

test('monster kill bonuses, drops and crit riders', () => {
  assert.equal(MONSTERS.VAC.killBonus, 500);
  assert.equal(MONSTERS.OOZ.killBonus, 500);
  assert.equal(MONSTERS.FNG.killBonus, 750);
  assert.equal(MONSTERS.WYRM.killBonus, 500);
  assert.equal(MONSTERS.VAC.dropItemId, 'override');
  assert.equal(MONSTERS.OOZ.dropItemId, 'repellent');
  assert.equal(MONSTERS.FNG.dropItemId, 'patch');
  assert.equal(MONSTERS.WYRM.dropItemId, 'tamer');
  assert.equal(MONSTERS.VAC.critRider, 'none');
  assert.equal(MONSTERS.OOZ.critRider, 'none');
  assert.equal(MONSTERS.FNG.critRider, 'empty');
  assert.equal(MONSTERS.WYRM.critRider, 'stun');
});

test('monsterStats clamps level and rejects unknown kinds', () => {
  assert.deepEqual(monsterStats('VAC', 0), monsterStats('VAC', 1));
  assert.deepEqual(monsterStats('VAC', 99), monsterStats('VAC', 15));
  assert.throws(() => monsterStats('XYZ', 1), /unknown monster kind/);
});

const ARCHETYPES = [
  'Normal', 'Turtle', 'Bandit', 'Speedster', 'Defender', 'Guardian', 'Bully',
  'Elite', 'Battler', 'Survivor', 'Collector', 'Runner', 'Sprint spec.',
  'Attack spec.', 'Defense spec.', 'HP spec.',
];

test('story missions: 15 entries, valid lineups', () => {
  assert.equal(STORY_MISSIONS.length, 15);
  STORY_MISSIONS.forEach((m, i) => {
    assert.equal(m.id, i + 1);
    assert.equal(m.level, i + 1);
    assert.ok(m.title.length > 0);
    assert.ok(m.opponents.length >= 1 && m.opponents.length <= 3, `M${m.id} lineup`);
    for (const o of m.opponents) {
      assert.ok(
        ARCHETYPES.includes(o) || o === 'RAVEN' || o === 'keld' || o === 'mira',
        `M${m.id} unknown opponent ${o}`,
      );
    }
  });
});

test('story missions: types, carriers, rivals, target overrides per DESIGN', () => {
  const byId = new Map(STORY_MISSIONS.map((m) => [m.id, m]));
  for (const m of STORY_MISSIONS) {
    const expected = m.id === 2 ? 'rescue' : (m.id === 3 || m.id === 6) ? 'resteal' : 'fetch';
    assert.equal(m.type, expected, `M${m.id} type`);
    if (m.type === 'resteal') assert.equal(m.opponents[m.carrierIndex], 'RAVEN', `M${m.id} carrier`);
    else assert.equal(m.carrierIndex, null);
    assert.equal(m.targetItemId, m.id === 7 ? 'actuator' : null, `M${m.id} target`);
  }
  // all-RAVEN lineups: M2, M8-12, M14, M15
  for (const id of [2, 8, 9, 10, 11, 12, 14, 15]) {
    assert.deepEqual(byId.get(id).opponents, ['RAVEN', 'RAVEN', 'RAVEN'], `M${id}`);
  }
  assert.deepEqual(byId.get(1).opponents, ['Normal', 'Normal', 'Normal']); // §2.15: M1 = 3 Normal AI
  for (const id of [4, 6]) {
    assert.ok(byId.get(id).opponents.includes('keld') && byId.get(id).opponents.includes('mira'), `M${id} rivals`);
  }
});

test('makeNormalMission relic level = ceil(mean level), clamped 1-15', () => {
  const at = (...levels) => makeNormalMission(levels.map((level) => ({ level }))).level;
  assert.equal(at(1, 1, 1, 1), 1);
  assert.equal(at(1, 2, 3, 4), 3); // mean 2.5
  assert.equal(at(2, 2, 2, 3), 3); // mean 2.25
  assert.equal(at(4, 4, 4, 4), 4);
  assert.equal(at(15, 15, 15, 15), 15);
  assert.equal(at(7), 7); // solo
});

test('rival displayed stats match DESIGN at L1 and L15', () => {
  assert.deepEqual(rivalStats('keld', 1), {
    internal: { mv: 3, at: 7, df: 2, hp: 3 }, mv: 1, at: 7, df: 1, maxHp: 16,
  });
  const k15 = rivalStats('keld', 15);
  assert.deepEqual([k15.mv, k15.at, k15.df, k15.maxHp], [3, 15, 1, 30]);
  const m1 = rivalStats('mira', 1);
  assert.deepEqual([m1.mv, m1.at, m1.df, m1.maxHp], [2, 4, 0, 19]);
  const m15 = rivalStats('mira', 15);
  assert.deepEqual([m15.mv, m15.at, m15.df, m15.maxHp], [5, 8, 0, 36]);
  assert.equal(RIVALS.keld.priority, 'Clever');
  assert.equal(RIVALS.mira.priority, 'Clever');
  assert.throws(() => rivalStats('nobody', 1), /unknown rival/);
});

test('rival interpolation: one internal point per level, monotone', () => {
  for (const id of ['keld', 'mira']) {
    let prev = null;
    for (let lvl = 1; lvl <= 15; lvl++) {
      const { internal } = rivalStats(id, lvl);
      const total = internal.mv + internal.at + internal.df + internal.hp;
      assert.equal(total, 15 + (lvl - 1), `${id} L${lvl} point total`);
      if (prev) {
        for (const k of ['mv', 'at', 'df', 'hp']) {
          assert.ok(internal[k] >= prev[k], `${id} ${k} dips at L${lvl}`);
        }
      }
      prev = internal;
    }
  }
});

test('displayStats applies the §2.1 derivations', () => {
  assert.deepEqual(displayStats({ mv: 7, at: 5, df: 5, hp: 2 }, 4),
    { mv: 2, at: 5, df: 2, maxHp: 7 + 6 + 3 });
});

test('interpolateInternal hits exact endpoints', () => {
  const l1 = { mv: 1, at: 9, df: 1, hp: 4 };
  const l15 = { mv: 2, at: 20, df: 1, hp: 6 }; // Attack spec.-shaped line
  assert.deepEqual(interpolateInternal(l1, l15, 1), l1);
  assert.deepEqual(interpolateInternal(l1, l15, 15), l15);
});

test('applyResults pays credits, carries items and maxHP damage', () => {
  const roster = [
    { id: 'a', level: 3, credits: 100, items: [], maxHp: 40 },
    { id: 'b', level: 1, credits: 50, items: [{ itemId: 'scrap', identified: true }], maxHp: 30 },
  ];
  const result = {
    relicLevel: 3, win: true,
    hunters: [{
      id: 'a', score: 10000, items: [{ itemId: 'gold', identified: false }],
      maxHp: 20, returnedTarget: true, targetPrice: 10000,
    }],
  };
  const next = applyResults(roster, result);
  // 100 + floor(10000*3/15) + 10000 target price
  assert.equal(next[0].credits, 100 + 2000 + 10000);
  assert.deepEqual(next[0].items, [{ itemId: 'gold', identified: false }]);
  assert.equal(next[0].maxHp, 20); // defeat halving persists until hospital
  assert.deepEqual(next[1], roster[1]); // non-participant untouched
  assert.equal(roster[0].credits, 100); // input not mutated
});

test('applyResults: WYRM wipe clears items and banked credits', () => {
  const roster = [{ id: 'a', level: 2, credits: 9000, items: [{ itemId: 'gold', identified: true }], maxHp: 40 }];
  const result = {
    relicLevel: 2, win: false, wipe: true,
    hunters: [{ id: 'a', score: 5000, items: [], maxHp: 20, returnedTarget: false }],
  };
  const [a] = applyResults(roster, result);
  assert.equal(a.credits, 0);
  assert.deepEqual(a.items, []);
  assert.equal(a.maxHp, 20);
});

test('story clear reward = quarter of next level-up fee', () => {
  assert.equal(LEVEL_UP_FEES.length, 14);
  assert.equal(LEVEL_UP_FEES.reduce((a, b) => a + b, 0), 241500);
  assert.equal(storyClearReward(1), 250);
  assert.equal(storyClearReward(14), 46500 / 4);
  assert.equal(storyClearReward(15), 46500 / 4); // capped
  const roster = [{ id: 'a', level: 1, credits: 0, items: [], maxHp: 16 }];
  const result = {
    relicLevel: 1, win: true, storyCleared: true,
    hunters: [{ id: 'a', score: 1500, items: [], maxHp: 16, returnedTarget: true, targetPrice: 100 }],
  };
  const [a] = applyResults(roster, result);
  assert.equal(a.credits, 100 + 100 + 250); // floor(1500*1/15) + price + reward
});
