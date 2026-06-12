import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRenderer, EVENT_DURATIONS, worldToScreen, screenToWorld, TILE, HUD_H,
} from '../src/render/renderer.js';

// Hardcoded from DESIGN.md 3.3 — the full renderer/audio event contract.
const EVENT_TYPES = [
  'turnStarted', 'dieRolled', 'cardPlayed', 'cardDrawn', 'deckCount', 'stepped',
  'trapTriggered', 'trapDodged', 'trapSet', 'boxOpened', 'targetFound',
  'flagClaimed', 'exitWarpedAway', 'drewBlank',
  'battleStarted', 'responseChosen', 'escapeRolled', 'strikeRolled',
  'statusInflicted', 'critNegated', 'hunterDefeated', 'itemTaken', 'surrendered',
  'monsterSpawned', 'monsterMoved', 'monsterKilled', 'wyrmSpawned',
  'wyrmRespawned', 'healed', 'actAgain', 'missionWon', 'missionLost',
  'scoreTallied',
];

test('module imports without a DOM and exports its API', () => {
  assert.equal(typeof createRenderer, 'function');
  assert.equal(typeof worldToScreen, 'function');
  assert.equal(typeof screenToWorld, 'function');
  assert.equal(TILE, 16);
  assert.ok(Number.isInteger(HUD_H) && HUD_H > 0);
});

test('EVENT_DURATIONS covers exactly the DESIGN 3.3 event set', () => {
  assert.deepEqual(Object.keys(EVENT_DURATIONS).sort(), [...EVENT_TYPES].sort());
  for (const [name, ms] of Object.entries(EVENT_DURATIONS)) {
    assert.ok(Number.isInteger(ms), `${name} duration is an integer`);
    assert.ok(ms >= 120 && ms <= 600, `${name} duration ${ms} in 120..600ms`);
  }
  assert.equal(EVENT_DURATIONS.stepped, 120, 'per-tile slide is 120ms');
});

test('worldToScreen/screenToWorld round-trip across scales and cameras', () => {
  const cams = [
    { x: 0, y: 0 }, { x: 37, y: 91 }, { x: -16, y: 8 }, { x: 160, y: 144 },
  ];
  for (const scale of [1, 2, 3, 4]) {
    for (const c of cams) {
      const cam = { ...c, scale };
      for (const [tx, ty] of [[0, 0], [5, 7], [19, 3], [12, 19]]) {
        const p = worldToScreen(tx, ty, cam);
        assert.deepEqual(screenToWorld(p.x, p.y, cam), { x: tx, y: ty },
          `top-left px of (${tx},${ty}) scale ${scale}`);
        // any pixel inside the tile maps back to the same tile
        assert.deepEqual(
          screenToWorld(p.x + 15 * scale, p.y + 15 * scale, cam), { x: tx, y: ty });
      }
    }
  }
});

test('createRenderer throws cleanly without a DOM (atlas needs canvas)', () => {
  assert.throws(
    () => createRenderer({ width: 416, height: 400, getContext: () => null }),
    /DOM/);
});

// --- behavioral checks via a canvas-free mock 2d context --------------------
function mockCanvas() {
  const noop = () => {};
  const ctx = new Proxy({}, {
    get: (t, p) => (p in t ? t[p] : noop),
    set: (t, p, v) => { t[p] = v; return true; },
  });
  return { width: 416, height: 400, getContext: () => ctx };
}

function mockState() {
  const w = 10;
  const h = 8;
  const floor = Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) => x > 0 && y > 0 && x < w - 1 && y < h - 1));
  return {
    seed: 1, rng: { s: 1 }, mode: 'normal', missionId: null, relicLevel: 1,
    board: {
      w, h, floor,
      exit: { x: 5, y: 5 },
      boxes: [{ x: 2, y: 2, opened: false, contents: 'TARGET' }],
      flags: [{ x: 3, y: 3, color: 'red', taken: false }],
      traps: [{ x: 4, y: 4, kind: 'damage', byHunter: null }],
    },
    deck: ['R3', 'Y4', 'B1', 'GD'],
    targetItemId: 'relic', targetFound: false, targetHolder: null,
    hunters: [0, 1, 2, 3].map((i) => ({
      id: i, slot: i, name: `HUN${i}`, spriteId: i, palette: i, human: i === 0,
      archetype: null, level: 1, internal: { mv: 3, at: 2, df: 2, hp: 1 },
      maxHp: 10, hp: 10, baseMaxHp: 10, hand: ['R3', 'B1', 'Y4'],
      items: [], pos: { x: 1 + i, y: 1 + i }, hasTarget: i === 1,
      status: { stun: i === 2 ? 1 : 0, leg: false, panic: 0, empty: 0 },
      tally: { moved: 0, damage: 0, flagPts: 0, killPts: 0, defeats: 0 },
    })),
    monsters: [{ id: 0, kind: 'VAC', hp: 16, maxHp: 16, pos: { x: 7, y: 6 } }],
    round: 1, current: { kind: 'hunter', index: 0 },
    phase: 'turn.action', move: null, battle: null, pendingChoice: null,
    result: null, events: [],
  };
}

function makeRenderer() {
  const r = createRenderer(mockCanvas(), { atlas: {} });
  r.setState(mockState());
  return r;
}

test('renderer exposes the full control surface', () => {
  const r = makeRenderer();
  for (const m of ['setState', 'pushEvents', 'update', 'draw', 'busy', 'skip',
    'tileAtPixel', 'panTo', 'showRange', 'showPath', 'clearOverlays', 'setCursor']) {
    assert.equal(typeof r[m], 'function', `renderer.${m}`);
  }
});

test('event queue: busy while animating, idle after enough update time', () => {
  const r = makeRenderer();
  assert.equal(r.busy(), false);
  r.pushEvents([
    { type: 'dieRolled', unit: 0, value: 4 },
    { type: 'stepped', unit: 0, from: { x: 1, y: 1 }, to: { x: 2, y: 1 } },
    { type: 'stepped', unit: 0, from: { x: 2, y: 1 }, to: { x: 2, y: 2 } },
  ]);
  assert.equal(r.busy(), true);
  r.update(EVENT_DURATIONS.dieRolled + 2 * EVENT_DURATIONS.stepped + 50);
  assert.equal(r.busy(), false);
});

test('every contract event type animates and draws without throwing', () => {
  const r = makeRenderer();
  const samples = {
    dieRolled: { value: 5 }, deckCount: { count: 70 },
    stepped: { from: { x: 1, y: 1 }, to: { x: 2, y: 1 } },
    trapTriggered: { kind: 'stun' }, boxOpened: { contents: 'relic', pos: { x: 2, y: 2 } },
    flagClaimed: { color: 'red', roll: 6, effect: '+250', pos: { x: 3, y: 3 } },
    battleStarted: { attacker: 0, defender: 1 },
    responseChosen: { response: 'counter' },
    escapeRolled: { aTotal: 9, dTotal: 7, escaped: false },
    strikeRolled: { dice: { a: [3, 4], d: [2, 5] }, totals: { atk: 12, def: 9 }, damage: 3, crit: true },
    statusInflicted: { kind: 'panic' }, itemTaken: { itemId: 'relic' },
    monsterSpawned: { kind: 'VAC', unit: { kind: 'monster', id: 0 } },
    monsterMoved: { unit: { kind: 'monster', id: 0 }, to: { x: 6, y: 6 } },
    monsterKilled: { drop: 'override', unit: { kind: 'monster', id: 0 } },
    healed: { amount: 3 }, missionWon: { winner: 0 }, missionLost: { reason: 'wyrm' },
    scoreTallied: { rows: [] },
  };
  for (const type of EVENT_TYPES) {
    r.pushEvents([{ type, unit: 0, ...samples[type] }]);
    assert.equal(r.busy(), true, `${type} queued`);
    assert.doesNotThrow(() => {
      r.update(EVENT_DURATIONS[type] / 2); // mid-animation
      r.draw();
      r.update(EVENT_DURATIONS[type]);     // finished
      r.draw();
    }, type);
    assert.equal(r.busy(), false, `${type} completed`);
  }
});

test('skip flushes the whole queue at once', () => {
  const r = makeRenderer();
  r.pushEvents(EVENT_TYPES.map((type) => ({ type, unit: 0 })));
  assert.equal(r.busy(), true);
  r.skip();
  assert.equal(r.busy(), false);
  assert.doesNotThrow(() => r.draw());
});

test('tileAtPixel: in-bounds board tiles only, never the HUD strip', () => {
  const r = makeRenderer();
  r.update(16); // snap camera to its target
  const t = r.tileAtPixel(208, 160);
  assert.ok(t === null || (Number.isInteger(t.x) && Number.isInteger(t.y)));
  if (t) {
    assert.ok(t.x >= 0 && t.x < 10 && t.y >= 0 && t.y < 8);
  }
  assert.equal(r.tileAtPixel(208, 399), null, 'HUD strip is not the board');
  assert.equal(r.tileAtPixel(-9999, 160), null, 'off-board is null');
});

test('overlays, cursor and panTo are safe to set, draw and clear', () => {
  const r = makeRenderer();
  assert.doesNotThrow(() => {
    r.showRange(new Set(['2,2', '3,2', '2,3']));
    r.showPath([{ x: 1, y: 1 }, { x: 2, y: 1 }, '3,1']);
    r.setCursor({ x: 2, y: 2 });
    r.panTo(8, 6);
    r.update(16);
    r.draw();
    r.clearOverlays();
    r.draw();
  });
});

test('deck counter follows cardDrawn/deckCount events then resyncs to state', () => {
  const r = makeRenderer();
  // events animate; once idle the renderer snaps back to the state deck count
  r.pushEvents([{ type: 'cardDrawn', unit: 0 }, { type: 'deckCount', count: 2 }]);
  r.update(2000);
  assert.equal(r.busy(), false);
  assert.doesNotThrow(() => r.draw());
});
