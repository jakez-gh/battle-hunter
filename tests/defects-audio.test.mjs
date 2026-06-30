// Regression tests for audio defects (D24).
// These are SOURCE-INTROSPECTION tests because the audio module requires
// an AudioContext (unavailable in Node) — the defect lives in the function body,
// not in observable runtime output reachable from a pure Node test.
//
// Each test wraps its assertion as a { todo: '...' } so the file exits 0 even
// while the defect is unresolved. Remove the todo once the fix lands.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const synthSrc = readFileSync(
  new URL('../src/audio/synth.js', import.meta.url),
  'utf8'
);

// ---------------------------------------------------------------------------
// D24 — setVolumes() uses direct gain.value assignment instead of a ramp
// ---------------------------------------------------------------------------

// Extract the setVolumes function body so the regex doesn't accidentally match
// ramp calls in note() or noise().
const setVolumesMatch = synthSrc.match(
  /export\s+function\s+setVolumes\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/
);
const setVolumesBody = setVolumesMatch ? setVolumesMatch[1] : '';

test(
  'D24: setVolumes uses an AudioParam ramp (setTargetAtTime or linearRampToValueAtTime) not a bare .gain.value assignment',
  {
    todo: 'DEFECT D24 — setVolumes assigns gain.value directly causing audio click/pop on slider scrub; remove todo when fixed (see DEFECTS.md)',
  },
  () => {
    // The body must have been extracted; if it's empty the regex failed and
    // the test itself is broken — fail loudly so we notice.
    assert.ok(
      setVolumesBody.length > 0,
      'Could not extract setVolumes body from synth.js — update the extraction regex'
    );

    // PRIMARY assertion: the fixed code must use a scheduled ramp.
    // Currently absent → this fails (todo records the defect).
    assert.match(
      setVolumesBody,
      /setTargetAtTime|linearRampToValueAtTime/,
      'setVolumes must use setTargetAtTime or linearRampToValueAtTime to avoid audio click/pop'
    );

    // SECONDARY assertion: the bare assignment pattern must be gone.
    // Currently present (all three gain nodes are written by direct assignment).
    assert.doesNotMatch(
      setVolumesBody,
      /\.gain\.value\s*=/,
      'setVolumes must not use bare .gain.value = assignment (causes click/pop)'
    );
  }
);
