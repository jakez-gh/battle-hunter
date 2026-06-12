// Monster catalog per DESIGN.md §2.10. Stat tables are researched data for
// relic levels 1-15; each row is [MV, AT, DF, HP]. Not tunable.

export const SPAWN_CHANCE = 0.2; // per moved-turn check; halved by a yellow move card
export const DROP_CHANCE = 0.5; // counter-item drop on kill (if killer has room)
export const MAX_REGULAR_MONSTERS = 2; // WYRM is on top of this cap

export const MONSTERS = {
  VAC: {
    name: 'VAC', killBonus: 500, dropItemId: 'override', critRider: 'none',
    table: [
      [2, 2, 2, 16], [2, 2, 2, 17], [2, 2, 2, 18], [3, 2, 2, 19], [3, 3, 2, 20],
      [3, 3, 2, 21], [3, 3, 2, 22], [3, 3, 2, 23], [4, 3, 2, 24], [4, 4, 2, 25],
      [4, 4, 3, 26], [4, 4, 3, 27], [4, 4, 3, 28], [5, 4, 3, 29], [5, 5, 3, 30],
    ],
  },
  OOZ: {
    name: 'OOZ', killBonus: 500, dropItemId: 'repellent', critRider: 'none',
    table: [
      [1, 5, 0, 25], [1, 5, 0, 29], [1, 6, 0, 30], [1, 6, 0, 34], [1, 7, 0, 35],
      [1, 7, 0, 39], [1, 8, 0, 40], [1, 8, 0, 44], [1, 9, 0, 45], [1, 9, 0, 49],
      [1, 10, 0, 50], [1, 10, 0, 54], [1, 11, 0, 55], [1, 11, 0, 59], [1, 12, 0, 60],
    ],
  },
  FNG: {
    name: 'FNG', killBonus: 750, dropItemId: 'patch', critRider: 'empty',
    table: [
      [1, 6, 3, 13], [1, 6, 3, 14], [1, 7, 3, 15], [1, 7, 4, 16], [1, 7, 4, 17],
      [2, 7, 4, 18], [2, 7, 4, 19], [2, 8, 4, 20], [2, 8, 5, 21], [2, 8, 5, 22],
      [3, 8, 5, 23], [3, 8, 5, 24], [3, 9, 5, 25], [3, 9, 6, 26], [3, 10, 6, 27],
    ],
  },
  WYRM: {
    name: 'WYRM', killBonus: 500, dropItemId: 'tamer', critRider: 'stun',
    table: [
      [3, 12, 3, 19], [3, 12, 3, 20], [3, 13, 3, 21], [3, 13, 3, 22], [4, 13, 3, 23],
      [4, 14, 3, 24], [4, 14, 3, 25], [4, 14, 4, 26], [4, 14, 4, 27], [4, 14, 4, 31],
      [4, 14, 4, 32], [4, 15, 4, 33], [5, 15, 4, 34], [5, 15, 4, 35], [5, 15, 5, 36],
    ],
  },
};

// Stats for a monster of `kind` at relic `level` (clamped to 1-15).
export function monsterStats(kind, level) {
  const m = MONSTERS[kind];
  if (!m) throw new Error(`unknown monster kind: ${kind}`);
  const [mv, at, df, hp] = m.table[Math.max(1, Math.min(15, level)) - 1];
  return { mv, at, df, hp };
}
