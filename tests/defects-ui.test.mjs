import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Regression tests for already-diagnosed UI defects (see DEFECTS.md).
//
// D04, D20, D21, D22, D23 all live in app/screen handlers and key-dispatch code
// (src/ui/screens.js, src/main.js) that are not cleanly drivable from a pure
// Node test (no DOM / canvas / real key events). These use SOURCE-INTROSPECTION:
// each test asserts the FIXED condition described in DEFECTS.md. These are hard
// regression guards: the defects are fixed, so each test now passes; it will fail
// if the defect regresses.
//
// Reading source via node:fs is pure (no DOM/timers/network).
// ---------------------------------------------------------------------------

const screensSrc = readFileSync(new URL('../src/ui/screens.js', import.meta.url), 'utf8');
const mainSrc = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

// ---------------------------------------------------------------------------
// D04 — Stale session.coopIds leaks co-op hunters into solo story / Quick Start.
// Fix (DEFECTS.md): gate co-op application on mode === 'normal' in
// startMission/pushMission (src/main.js), AND reset app.session.coopIds = []
// in quickStart() (src/ui/screens.js) for defense-in-depth.
// Today neither guard exists, so both assertions fail.

test('D04: startMission/pushMission only apply co-op recruits in normal mode (main.js)',
  () => {
    // FIXED condition: the co-op recruit construction (coopRecs) appears in
    // proximity to a `mode === 'normal'` guard. Today main.js builds
    // `[rec, ...coopRecs]` unconditionally — there is no `mode === 'normal'`
    // anywhere in main.js.
    assert.match(
      mainSrc,
      /(coopRecs[\s\S]{0,500}mode\s*===\s*['"]normal['"])|(mode\s*===\s*['"]normal['"][\s\S]{0,500}coopRecs)/,
      'main.js should gate co-op recruits on session.mode === "normal" near the coopRecs construction',
    );
  });

test('D04: quickStart() resets session.coopIds to [] (screens.js)',
  () => {
    // FIXED condition: screens.js assigns `coopIds = []` (the quickStart reset).
    // The only coopIds initialization today is `coopIds: []` in main.js (colon,
    // different file). screens.js has no `coopIds = []` assignment.
    assert.match(
      screensSrc,
      /coopIds\s*=\s*\[\s*\]/,
      'screens.js quickStart() should reset app.session.coopIds = []',
    );
  });

// ---------------------------------------------------------------------------
// D20 — RESULTS [H] Daily-Hunt shortcut pops to Client (not Hub) in story mode.
// Fix (DEFECTS.md): don't assume the screen below RESULTS is the Hub — pop down
// to the tagged Hub screen / route through the Hub, instead of a blind single
// stack.pop().
// Today the KeyH handler does `app.stack.pop(); // go to hub first`.

test('D20: RESULTS [H] handler does not do a blind single stack.pop() assuming Hub is below (screens.js)',
  () => {
    // BUGGY pattern (present today): a lone `app.stack.pop()` carrying the
    // "go to hub first" comment, which wrongly assumes the Hub sits directly
    // below RESULTS. Per rule 4 we assert the buggy pattern is GONE.
    assert.doesNotMatch(
      screensSrc,
      /app\.stack\.pop\(\);\s*\/\/\s*go to hub first/,
      'screens.js [H] handler must not blind-pop assuming Hub is directly below RESULTS (story leaves Client below)',
    );
  });

// ---------------------------------------------------------------------------
// D21 — Esc during steering opens the pause menu instead of committing the move.
// Fix (DEFECTS.md): gate the global pause shortcut so it does NOT fire while
// steering, e.g. `k === 'cancel' && !host.top() && !steering`.
// Today the guard is `k === 'cancel' && !host.top()` (no `!steering`).

test('D21: global pause shortcut is gated with !steering (screens.js)',
  () => {
    // FIXED condition: the `k === 'cancel' && !host.top()` pause-open guard also
    // checks `!steering` (resilient to spacing / ordering of the !host.top()
    // and !steering clauses).
    assert.match(
      screensSrc,
      /k\s*===\s*['"]cancel['"]\s*&&\s*(!host\.top\(\)\s*&&\s*!steering|!steering\s*&&\s*!host\.top\(\))/,
      "the pause shortcut (k === 'cancel' && !host.top()) must also require !steering",
    );
  });

// ---------------------------------------------------------------------------
// D22 — Held arrow key during steering auto-walks/overshoots (no e.repeat guard).
// Fix (DEFECTS.md): `if (DIR_BY_KEY[k] && !e?.repeat) { … }` mirroring the
// guarded timing minigame.
// Today the step branch is `if (DIR_BY_KEY[k]) {` with no repeat guard.

test('D22: steering step handler ignores auto-repeat via !e?.repeat (screens.js)',
  () => {
    // FIXED condition: the DIR_BY_KEY step branch condition includes !e?.repeat.
    assert.match(
      screensSrc,
      /DIR_BY_KEY\[k\]\s*&&\s*!e\?\.repeat/,
      'the steering step branch (if (DIR_BY_KEY[k])) must add a !e?.repeat auto-repeat guard',
    );
  });

// ---------------------------------------------------------------------------
// D23 — Held Enter falls through the YOUR-TURN menu into the Move/Attack submenu.
// Fix (DEFECTS.md): guard the open-menu dispatch like the timing branch:
// `if (host.top()) { if (!(k === 'confirm' && e?.repeat)) host.key(k); return; }`
// Today it is `if (host.top()) { host.key(k); return; }` (no repeat filter).

test('D23: open-menu key dispatch suppresses confirm auto-repeat (screens.js)',
  () => {
    // FIXED condition: within the `if (host.top())` branch, host.key(k) is
    // guarded so it is not called on a repeated 'confirm'. Match the documented
    // fix pattern: `!(k === 'confirm' && e?.repeat)` guarding host.key.
    assert.match(
      screensSrc,
      /!\(\s*k\s*===\s*['"]confirm['"]\s*&&\s*e\?\.repeat\s*\)/,
      "the open-menu branch (if (host.top())) must guard host.key against repeated 'confirm' via !(k === 'confirm' && e?.repeat)",
    );
  });
