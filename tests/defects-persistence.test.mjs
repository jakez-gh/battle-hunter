// FAILING regression tests documenting already-diagnosed persistence/codec
// defects (see DEFECTS.md D15, D16, D17). Each test asserts the CORRECT
// (fixed/spec) behavior, so it fails against today's buggy code; each is wrapped
// as a `todo` so the suite stays green until the fix lands (remove the todo
// when the defect is fixed).
//
// Pure: no DOM/canvas/audio/timers/network. save.js falls back to an in-memory
// store under Node; we reset it between leaderboard tests via resetMemoryStore,
// mirroring tests/leaderboard.test.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeRunResult, decodeRunResult } from '../src/share.js';
import {
  storageArea, addLeaderboardEntry, resetMemoryStore, LEADERBOARD_KEY,
} from '../src/save.js';

// --------------------------------------------------------------------------
// D15 — encodeRunResult / decodeRunResult disagree on the legal `date` set.
// Encode writes String(r.date ?? '') with a VALID checksum, but decode rejects
// any date not matching /^\d{4}-\d{2}-\d{2}$/, so a self-produced,
// checksum-valid string with a missing/empty date fails its own decode (codec
// asymmetry — the header contract says decode returns null only for malformed
// or tampered strings). A round-trip of an encoder-produced string must verify.
// --------------------------------------------------------------------------
test('D15: an encoder-produced string with a missing date round-trips (decode != null)',
  { todo: 'DEFECT D15 — encode/decode disagree on legal date; remove todo when fixed (see DEFECTS.md)' },
  () => {
    // Valid run object EXCEPT date is missing -> encode emits an empty date with
    // a correct checksum.
    const run = { version: 1, rootSeed: 3735928559, depthsCleared: 7, score: 12450, won: true };
    const encoded = encodeRunResult(run); // checksum-valid, date field is ''
    const decoded = decodeRunResult(encoded);
    assert.notEqual(
      decoded, null,
      'a self-produced, checksum-valid share string must round-trip (decode must not reject its own encode)',
    );
  });

// --------------------------------------------------------------------------
// D16 — decodeRunResult accepts an unsupported (future) version.
// encodeRunResult({ version: 2, ... }) builds the tag 'BHD2'; decode does
// Number('BHD2'.slice(3)) === 2, which is finite, with no version<=VERSION /
// integer guard, so it is accepted with v1 semantics. An unsupported version
// must be rejected (decode -> null).
// --------------------------------------------------------------------------
test('D16: decode rejects an unsupported future version (returns null)',
  { todo: 'DEFECT D16 — decode accepts unknown version; remove todo when fixed (see DEFECTS.md)' },
  () => {
    const futureRun = {
      version: 2, date: '2026-06-24', rootSeed: 3735928559,
      depthsCleared: 7, score: 12450, won: true,
    };
    const encoded = encodeRunResult(futureRun); // tag 'BHD2', otherwise well-formed + valid checksum
    const decoded = decodeRunResult(encoded);
    assert.equal(
      decoded, null,
      'a string tagged with an unsupported version (BHD2) must be rejected',
    );
  });

// --------------------------------------------------------------------------
// D17 — leaderboard sort corrupts (NaN comparator) on a non-numeric stored
// score. A tampered/foreign stored entry with a non-numeric score makes
// `b.score - a.score` evaluate to NaN, producing an inconsistent comparator
// that mis-orders the board and returns the wrong rank for a legitimate top
// score. The legitimate top score must sort first (rank 0).
// --------------------------------------------------------------------------
test('D17: a legitimate top score outranks a corrupt non-numeric stored score (rank 0)',
  { todo: 'DEFECT D17 — leaderboard NaN comparator on corrupt stored score; remove todo when fixed (see DEFECTS.md)' },
  () => {
    resetMemoryStore();
    const mode = 'relic-dive';
    // Seed the stored leaderboard directly with a corrupt (non-numeric score)
    // entry — replicating a tampered/foreign localStorage payload.
    storageArea().setItem(LEADERBOARD_KEY, JSON.stringify({
      [mode]: [{ name: 'Corrupt', score: 'abc', mode, ts: 1, extras: {} }],
    }));

    // Add a legitimate, clearly-highest numeric score.
    const rank = addLeaderboardEntry(mode, { name: 'Legit', score: 9999, extras: {} });
    assert.equal(
      rank, 0,
      'the legitimate top score must sort first regardless of a corrupt stored entry',
    );
    resetMemoryStore();
  });
