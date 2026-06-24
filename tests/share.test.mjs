// Daily Hunt share-codec tests. The codec is the pure, verifiable half of
// Phase 1 "1D" (the UI calls it). Guarantees: round-trip fidelity, determinism,
// tamper/corruption rejection, and that distinct runs encode distinctly.

import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeRunResult, decodeRunResult, formatShare } from '../src/share.js';

const sample = {
  version: 1, date: '2026-06-24', rootSeed: 3735928559,
  depthsCleared: 7, score: 12450, won: true,
};

test('share: round-trips losslessly', () => {
  const decoded = decodeRunResult(encodeRunResult(sample));
  assert.deepEqual(decoded, sample);
});

test('share: encoding is deterministic (same result -> same string)', () => {
  assert.equal(encodeRunResult(sample), encodeRunResult({ ...sample }));
});

test('share: a wiped run round-trips and reads as won=false', () => {
  const wiped = { ...sample, won: false, depthsCleared: 3, score: 4100 };
  const decoded = decodeRunResult(encodeRunResult(wiped));
  assert.deepEqual(decoded, wiped);
  assert.equal(decoded.won, false);
});

test('share: tampering with any field is rejected by the checksum', () => {
  const enc = encodeRunResult(sample);
  // Flip the score field (5th of 7 dot-separated parts) without fixing checksum.
  const parts = enc.split('.');
  parts[4] = (parseInt(parts[4], 36) + 1).toString(36);
  assert.equal(decodeRunResult(parts.join('.')), null, 'edited score must not verify');

  // Corrupt a single character anywhere.
  const corrupt = enc.slice(0, 5) + (enc[5] === 'a' ? 'b' : 'a') + enc.slice(6);
  assert.equal(decodeRunResult(corrupt), null);
});

test('share: malformed input returns null, never throws', () => {
  for (const bad of ['', 'garbage', 'BHD1.x', null, undefined, 42, 'BHD1.2026-06-24.zz.7.aa.1', {}]) {
    assert.equal(decodeRunResult(bad), null, `should reject: ${String(bad)}`);
  }
});

test('share: distinct runs encode distinctly', () => {
  const a = encodeRunResult(sample);
  const b = encodeRunResult({ ...sample, depthsCleared: 8 });
  const c = encodeRunResult({ ...sample, score: 12451 });
  assert.notEqual(a, b);
  assert.notEqual(a, c);
});

test('share: formatShare is human-readable and its last line decodes', () => {
  const block = formatShare(sample);
  assert.match(block, /Daily Hunt 2026-06-24/);
  assert.match(block, /Depth 7/);
  assert.match(block, /12,450 pts/);
  assert.match(block, /BANKED/);
  const lastLine = block.split('\n').at(-1);
  assert.deepEqual(decodeRunResult(lastLine), sample, 'embedded share string must verify');
});

test('share: large seeds (full uint32) survive the round-trip', () => {
  const r = { ...sample, rootSeed: 0xffffffff };
  assert.equal(decodeRunResult(encodeRunResult(r)).rootSeed, 0xffffffff);
});
