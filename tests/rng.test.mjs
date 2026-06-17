import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../src/engine/rng.js';

test('same seed produces identical sequences', () => {
  const a = makeRng(12345);
  const b = makeRng(12345);
  for (let i = 0; i < 100; i++) assert.equal(a.float(), b.float());
});

test('different seeds diverge', () => {
  const a = makeRng(1);
  const b = makeRng(2);
  const seqA = Array.from({ length: 10 }, () => a.float());
  const seqB = Array.from({ length: 10 }, () => b.float());
  assert.notDeepEqual(seqA, seqB);
});

test('d6 stays in range and hits every face', () => {
  const rng = makeRng(7);
  const seen = new Set();
  for (let i = 0; i < 1000; i++) {
    const v = rng.d6();
    assert.ok(v >= 1 && v <= 6);
    seen.add(v);
  }
  assert.equal(seen.size, 6);
});

test('range is inclusive on both ends', () => {
  const rng = makeRng(9);
  const seen = new Set();
  for (let i = 0; i < 1000; i++) seen.add(rng.range(2, 4));
  assert.deepEqual([...seen].sort(), [2, 3, 4]);
});

test('shuffle permutes without losing elements', () => {
  const rng = makeRng(3);
  const arr = rng.shuffle([1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual([...arr].sort((x, y) => x - y), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('pick returns an element of the array', () => {
  const rng = makeRng(11);
  const pool = ['a', 'b', 'c', 'd'];
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(rng.pick(pool));
  // All pool elements should eventually be picked; every pick is in the pool.
  for (const v of seen) assert.ok(pool.includes(v));
  assert.ok(seen.size === pool.length, 'pick covers full pool given enough draws');
});

test('int returns an integer in [0, n)', () => {
  const rng = makeRng(13);
  for (let i = 0; i < 200; i++) {
    const v = rng.int(7);
    assert.ok(Number.isInteger(v) && v >= 0 && v < 7);
  }
  const seen = new Set();
  for (let i = 0; i < 500; i++) seen.add(rng.int(4));
  assert.deepEqual([...seen].sort(), [0, 1, 2, 3]);
});
