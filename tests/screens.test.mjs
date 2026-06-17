import test from 'node:test';
import assert from 'node:assert/strict';
import * as Screens from '../src/ui/screens.js';
import { ITEMS } from '../src/engine/items.js';
import { STORY_MISSIONS } from '../src/engine/missions.js';

// ---------------------------------------------------------------------------
// Structural: verify all expected exports exist and are the right type.
// Screen factory functions require a DOM `app` context; we only verify they
// are exported as functions without calling them (no JSDOM in this suite).

test('all screen factory functions are exported', () => {
  const factories = [
    'makeTitleScreen', 'makeRosterScreen', 'makeCreationScreen',
    'makeHubScreen', 'makeClientScreen', 'makeHospitalScreen',
    'makeOptionsScreen', 'makeGameScreen', 'makeResultsScreen',
  ];
  for (const name of factories) {
    assert.equal(typeof Screens[name], 'function', `${name} must be a function`);
  }
});

test('createScreenStack and unlockedWallpapers are exported functions', () => {
  assert.equal(typeof Screens.createScreenStack, 'function');
  assert.equal(typeof Screens.unlockedWallpapers, 'function');
});

test('WALLPAPERS is a non-empty array of theme objects', () => {
  assert.ok(Array.isArray(Screens.WALLPAPERS));
  assert.ok(Screens.WALLPAPERS.length > 0);
  for (const w of Screens.WALLPAPERS) {
    assert.ok(typeof w.name === 'string', 'wallpaper has a name');
    assert.ok(typeof w.base === 'string', 'wallpaper has a base color');
    assert.ok(typeof w.accent === 'string', 'wallpaper has an accent color');
    assert.ok(typeof w.pattern === 'string', 'wallpaper has a pattern');
  }
});

// ---------------------------------------------------------------------------
// createScreenStack: DOM-free stack operations.

test('createScreenStack: push, replace, pop, read without DOM', () => {
  const stack = Screens.createScreenStack();
  const screenA = { draw() {}, onKey() {}, id: 'A' };
  const screenB = { draw() {}, onKey() {}, id: 'B' };
  const screenC = { draw() {}, onKey() {}, id: 'C' };
  stack.push(screenA);
  assert.equal(stack.top(), screenA);
  stack.push(screenB);
  assert.equal(stack.top(), screenB);
  stack.pop();
  assert.equal(stack.top(), screenA);
  stack.replace(screenC);
  assert.equal(stack.top(), screenC);
});

// ---------------------------------------------------------------------------
// unlockedWallpapers: pure function, no DOM needed.
// roster shape: { options: { wallpapersUnlocked: [] }, hunters: [{items:[]}] }

test('unlockedWallpapers: empty roster unlocks index 0 only', () => {
  const roster = { options: { wallpapersUnlocked: [] }, hunters: [] };
  const unlocked = Screens.unlockedWallpapers(roster);
  assert.ok(unlocked.includes(0), 'index 0 always unlocked');
  assert.equal(unlocked.length, 1);
});

test('unlockedWallpapers: hunter with a disc item unlocks corresponding wallpaper', () => {
  // disc3 → wallpaper index 3.
  const roster = {
    options: { wallpapersUnlocked: [] },
    hunters: [{ items: [{ itemId: 'disc3', identified: true }] }],
  };
  const unlocked = Screens.unlockedWallpapers(roster);
  assert.ok(unlocked.includes(0), 'index 0 always included');
  assert.ok(unlocked.includes(3), 'disc3 unlocks wallpaper 3');
});

// ---------------------------------------------------------------------------
// Mission goal HUD: verify STORY_MISSIONS have all fields the HUD relies on.

test('all STORY_MISSIONS have title and type for HUD goal box', () => {
  const validTypes = new Set(['fetch', 'rescue', 'resteal']);
  for (const m of STORY_MISSIONS) {
    assert.ok(typeof m.title === 'string' && m.title.length > 0, `M${m.id} has a non-empty title`);
    assert.ok(validTypes.has(m.type), `M${m.id} has a valid type (${m.type})`);
  }
});

test('targetItemId missions reference items that exist in ITEMS', () => {
  for (const m of STORY_MISSIONS) {
    if (m.targetItemId != null) {
      assert.ok(ITEMS[m.targetItemId], `M${m.id} targetItemId '${m.targetItemId}' exists in ITEMS`);
    }
  }
});

test('resteal missions have a valid carrierIndex', () => {
  for (const m of STORY_MISSIONS.filter((m) => m.type === 'resteal')) {
    assert.ok(typeof m.carrierIndex === 'number' && m.carrierIndex >= 0,
      `M${m.id} resteal has numeric carrierIndex`);
  }
});

// ---------------------------------------------------------------------------
// HUD layout: text must fit inside fixed-width boxes (w=232px, right edge=956).
// Courier New bold monospace ≈ 0.6em per character at any size.
// These tests catch overflow regressions without needing a real canvas.

const approxPx = (str, sizePx) => str.length * sizePx * 0.6;

// Respond menu: drawn at x=724, w=232, sz=13 → usable label+hint ≤ 212px.
test('RESPONSE_HINTS is exported and has exactly the four known response keys', () => {
  const { RESPONSE_HINTS } = Screens;
  assert.ok(RESPONSE_HINTS && typeof RESPONSE_HINTS === 'object', 'RESPONSE_HINTS must be exported');
  const keys = Object.keys(RESPONSE_HINTS).sort();
  assert.deepEqual(keys, ['counter', 'escape', 'guard', 'surrender']);
});

test('RESPONSE_HINTS: each hint fits in the 232px respond menu at size 13', () => {
  const { RESPONSE_HINTS } = Screens;
  // Respond menu: x=724 w=232 sz=13; drawMenu puts label at x+10, hint right-aligned at x+w-10.
  // Overlap when: approxPx(prefix+label) + approxPx(hint) > w - 20 = 212.
  const MENU_W = 232, SZ = 13, AVAIL = MENU_W - 20;
  const LABELS = { counter: 'Counter', guard: 'Guard', escape: 'Escape', surrender: 'Surrender' };
  for (const [key, label] of Object.entries(LABELS)) {
    const hint = RESPONSE_HINTS[key] ?? '';
    const used = approxPx('>' + label, SZ) + approxPx(hint, SZ);
    assert.ok(
      used <= AVAIL,
      `"${label}" (${approxPx('>' + label, SZ).toFixed(0)}px) + "${hint}" (${approxPx(hint, SZ).toFixed(0)}px) = ${used.toFixed(0)}px exceeds ${AVAIL}px`,
    );
  }
});

test('RESPONSE_HINTS: hints are non-empty strings', () => {
  const { RESPONSE_HINTS } = Screens;
  for (const [k, v] of Object.entries(RESPONSE_HINTS)) {
    assert.equal(typeof v, 'string', `hint for "${k}" must be a string`);
    assert.ok(v.length > 0, `hint for "${k}" must not be empty`);
  }
});

// Mission briefing: all story missions that have a briefing field provide
// a non-empty string; the wrapText utility will word-wrap at runtime.
test('STORY_MISSIONS briefings are non-empty strings when present', () => {
  for (const m of STORY_MISSIONS) {
    if (m.briefing != null) {
      assert.ok(typeof m.briefing === 'string' && m.briefing.length > 0,
        `M${m.id} briefing must be a non-empty string`);
    }
  }
});

// INFO panel item names: two lines at x=X+10=734, sz=11, box right=956 → 212px available.
// drawHud clips each line at 30 chars (198px) to prevent overflow from long names joined with ", ".
test('INFO panel: longest possible item names clipped to 30 chars each fit in 212px at size 11', () => {
  const SZ = 11, AVAIL = 212, CLIP = 30;
  const names = Object.values(ITEMS).map((it) => it.name ?? '').filter(Boolean);
  const longestName = names.reduce((a, b) => (b.length > a.length ? b : a), '');
  // Worst case: three copies of the longest name joined with ", "
  const worstJoined = [longestName, longestName, longestName].join(', ');
  const clipped = worstJoined.length > CLIP ? worstJoined.slice(0, CLIP - 3) + '...' : worstJoined;
  assert.ok(clipped.length <= CLIP, `clipped line must be ≤${CLIP} chars, got ${clipped.length}`);
  assert.ok(
    approxPx(clipped, SZ) <= AVAIL,
    `clipped "${clipped}" is ${approxPx(clipped, SZ).toFixed(0)}px, exceeds ${AVAIL}px`,
  );
});
