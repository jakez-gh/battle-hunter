import test from 'node:test';
import assert from 'node:assert/strict';
import * as Screens from '../src/ui/screens.js';

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
