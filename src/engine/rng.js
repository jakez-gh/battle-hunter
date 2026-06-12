// Seeded PRNG (mulberry32). All engine randomness flows through one instance
// so games are reproducible from a seed — required for tests and replays.
export function makeRng(seed) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    // float in [0, 1)
    float: next,
    // integer in [0, n)
    int: (n) => Math.floor(next() * n),
    // integer in [lo, hi] inclusive
    range: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    // standard die
    d6: () => 1 + Math.floor(next() * 6),
    // in-place Fisher–Yates
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    },
    pick: (arr) => arr[Math.floor(next() * arr.length)],
  };
}
