import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Regression tests for renderer defects D05, D09, D19 (see DEFECTS.md).
//
// All three live in renderer internals (unitKey/evKey/canonicalKey,
// diffOverrides, unitFlash) that are NOT exported and NOT observable from a
// pure Node test: createRenderer is the only export, the internal visual map /
// ghost set / flash state can't be inspected, and a canvas mock cannot reveal
// which key a slide was stored under or whether a kill-FX ring was emitted.
// Per the assignment these are therefore SOURCE-INTROSPECTION tests: each regex
// is written against the SPECIFIC suggested fix in DEFECTS.md so it FAILS on the
// current (buggy) source and PASSES once the fix lands.
//
// Reading the source via node:fs is pure (no DOM/canvas/audio/timers/network).
const SRC = readFileSync(new URL('../src/render/renderer.js', import.meta.url), 'utf8');

// --- D05: numeric monster ids mis-prefixed as 'h' ---------------------------
// DEFECTS.md D05: unitKey() stringifies a non-object ref and blindly prefixes
// 'h' unless it already starts with h/m (renderer.js:180-182). Numeric monster
// ids (game.js emits raw rng.int(1000000) ids) therefore key as 'h<id>' while
// the monster actually renders under 'm<id>', so every monster `stepped` event
// teleports instead of sliding. The suggested fix is to resolve the id against
// the real pools via the existing canonicalKey() helper (already used for
// battleStarted at renderer.js:686) on the evKey / stepped path, instead of
// guessing by leading char.
//
// REGEX RATIONALE: evKey() is the single funnel that turns an event's raw
// unit/hunter/monster ref into a key for the `stepped` case (and most others).
// Today its whole body is `return unitKey(ev.unit ?? ... );` — it never touches
// canonicalKey, so this assertion fails now. The fix routes evKey through
// canonicalKey (pool resolution) for raw ids; once it does, the function body
// will reference canonicalKey and this passes. Matching the `function evKey`
// block and requiring `canonicalKey` inside it (whitespace/newline tolerant via
// [\s\S]) ties the assertion to the documented fix rather than to incidental
// text elsewhere in the file.
test('D05: evKey resolves raw monster ids via the pool (canonicalKey), not a bare \'h\' prefix',
  () => {
    const m = SRC.match(/function evKey\(ev\)\s*\{[\s\S]*?\n {2}\}/);
    assert.ok(m, 'expected to locate the evKey() function in renderer.js');
    const body = m[0];
    // The fix resolves the id against the actual pools (canonicalKey) instead of
    // letting unitKey blindly prefix 'h'. Fails today: evKey only calls unitKey.
    assert.match(body, /canonicalKey/,
      'evKey() should resolve raw ids through canonicalKey() (pool lookup) so numeric monster ids key as m<id>, not h<id>');
  });

// --- D09: monster-kill FX / WYRM detonation unreachable ----------------------
// DEFECTS.md D09: ghosts (needed to drive the kill burst/ring/DROP float and the
// WYRM void-detonation) are created in diffOverrides ONLY when a monster present
// in prev.monsters is absent from next.monsters (renderer.js:258-263). But the
// engine never removes a dead monster — on kill it sets hp=0 / pos=null and
// filters by hp>0 (game.js:637-639), and reuses the dead WYRM object on respawn.
// So no ghost is ever created, killKind is undefined (WYRM branch dead) and kpos
// resolves to the now-null position, suppressing the entire kill FX.
// Suggested fix: have diffOverrides make a ghost when a monster transitions
// hp>0 -> hp<=0 (capturing pos/kind then).
//
// REGEX RATIONALE: the fix adds a death-transition test inside diffOverrides.
// Today diffOverrides contains no hp/pos check at all (it only diffs boxes,
// flags and monster id presence). So requiring an hp<=0 (or pos===null) ghost
// trigger inside the diffOverrides body fails now and passes once the suggested
// transition-based ghost creation is added. We scope the search to the
// diffOverrides function body so an unrelated `h.hp <= 0` in draw code (line
// ~3035) cannot satisfy it.
test('D09: diffOverrides creates a ghost when a monster dies (hp<=0 / pos cleared) so kill FX can fire',
  () => {
    const m = SRC.match(/function diffOverrides\(prev, next\)\s*\{[\s\S]*?\n {2}\}/);
    assert.ok(m, 'expected to locate the diffOverrides() function in renderer.js');
    const body = m[0];
    // The fix detects a monster death transition inside diffOverrides and spawns
    // a ghost from it. Match either the hp<=0 transition test or a pos==null
    // test (DEFECTS.md offers both framings), whitespace-tolerant. Fails today:
    // diffOverrides has no such check.
    assert.match(body, /\.hp\s*<=\s*0|pos\s*===?\s*null|pos\s*==\s*null/,
      'diffOverrides() should create a ghost on a hp>0 -> hp<=0 (or pos-cleared) monster transition so kill/detonation FX become reachable');
  });

// --- D19: unitFlash tint freezes at timeScale>1 ------------------------------
// DEFECTS.md D19: the strikeRolled handler sets unitFlash.dur = 360 (the full
// EVENT_DURATIONS.strikeRolled) at renderer.js:735, but anim.t maxes out at the
// time-SCALED duration (eventDuration(ev.type, timeScale), e.g. 120 at
// timeScale>=3, see renderer.js:3612). applyAnimProgress sets unitFlash.t =
// anim.t (renderer.js:1081), so ft = unitFlash.t/unitFlash.dur never reaches 1
// during fast AI playback and the tint freezes (~alpha 0.8) until the next
// strike/defeat/warp or a human keypress. The fix: set
//   dur: eventDuration('strikeRolled', timeScale)
// at the set site so ft reaches 1 / alpha 0 even when compressed (the other two
// unitFlash sets — exitWarpedAway/hunterDefeated — are explicitly cleared in
// endEvent, so only strikeRolled freezes).
//
// REGEX RATIONALE: there are three `unitFlash = { key: ...` set sites; only the
// strikeRolled one is buggy and it is uniquely identified by `key: battle?.d ?? k`.
// We match that exact set site and require its `dur:` to use the time-scaled
// eventDuration(...) call rather than the bare EVENT_DURATIONS.strikeRolled
// constant. Fails today (constant is hardcoded); passes once the dur is computed
// from eventDuration with timeScale.
test('D19: strikeRolled unitFlash duration is time-scaled (eventDuration), so the tint decays at timeScale>1',
  () => {
    // Isolate the strikeRolled unitFlash set site (the one keyed off battle?.d).
    const m = SRC.match(/unitFlash = \{ key: battle\?\.d \?\? k, t: 0, dur:[^\n]*\n[^\n]*\};/);
    assert.ok(m, 'expected to locate the strikeRolled unitFlash assignment (key: battle?.d ?? k) in renderer.js');
    const setSite = m[0];
    // The buggy version hardcodes the full constant; the fix derives dur from the
    // effective (time-scaled) duration so ft = t/dur reaches 1.
    assert.match(setSite, /dur:\s*eventDuration\(\s*['"]strikeRolled['"]\s*,\s*timeScale\s*\)/,
      "strikeRolled unitFlash.dur should be eventDuration('strikeRolled', timeScale) so the tint fades to alpha 0 even under fast-AI compression");
  });
