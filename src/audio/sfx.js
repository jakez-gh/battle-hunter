// Sound effects: each engine/UI event maps to a short synth recipe built from
// note()/noise(). Everything is a no-op until synth.unlock() runs, so this
// module is safe to import and call under Node (no window/AudioContext here).
import { note, noise } from './synth.js';

const after = (ms, fn) => setTimeout(fn, ms);

export const sfx = {
  // rattly tumbling ticks
  dieRoll() {
    for (let i = 0; i < 7; i++)
      after(i * 45 + (i % 3) * 8, () =>
        noise({ dur: 0.025, vol: 0.16, freq: 1800 + (i % 4) * 500, q: 5 }));
  },
  cardDraw() {
    noise({ dur: 0.08, vol: 0.12, freq: 900, slide: 3000, q: 2 });
  },
  cardPlay() {
    noise({ dur: 0.04, vol: 0.18, freq: 2200, q: 3 });
    note({ midi: 81, dur: 0.06, type: 'square', vol: 0.1 });
  },
  step() {
    noise({ dur: 0.035, vol: 0.09, freq: 480, q: 1.5 });
  },
  boxOpen() {
    note({ midi: 72, dur: 0.07, type: 'square', vol: 0.11 });
    after(80, () => note({ midi: 79, dur: 0.08, type: 'square', vol: 0.11 }));
    after(160, () => note({ midi: 84, dur: 0.16, type: 'triangle', vol: 0.14 }));
  },
  targetFanfare() {
    [72, 76, 79, 84].forEach((m, i) =>
      after(i * 85, () => note({ midi: m, dur: 0.11, type: 'square', vol: 0.15 })));
    after(340, () => note({ midi: 88, dur: 0.32, type: 'square', vol: 0.16 }));
  },
  flagClaim() {
    note({ midi: 76, dur: 0.08, type: 'square', vol: 0.13 });
    after(90, () => note({ midi: 83, dur: 0.14, type: 'square', vol: 0.13 }));
  },
  trapSpring() {
    note({ midi: 70, dur: 0.18, type: 'sawtooth', vol: 0.16, slide: 90 });
    after(140, () => noise({ dur: 0.12, vol: 0.22, freq: 350, q: 1 }));
  },
  trapDodge() {
    noise({ dur: 0.1, vol: 0.1, freq: 700, slide: 2600, q: 2 });
    after(90, () => note({ midi: 88, dur: 0.06, type: 'square', vol: 0.09 }));
  },
  // damage scales loudness, weight, and pitch — heavier hits start lower (more bass)
  hit(damage = 1) {
    const d = Math.min(damage, 20);
    const startFreq = Math.max(400, 1600 - d * 55); // d=1:1545 d=10:1050 d=20:500
    noise({ dur: 0.1 + d * 0.004, vol: 0.16 + d * 0.009, freq: startFreq, slide: 160 + d * 5, q: 1 });
    note({ midi: 41 - Math.floor(d / 5), dur: 0.1, type: 'square', vol: 0.1 + d * 0.005, slide: 50 });
    if (d >= 7) after(30, () => noise({ dur: 0.15, vol: 0.07 + d * 0.005, freq: 90 + d * 4, slide: 40, q: 0.6, type: 'lowpass' }));
  },
  // charged whoosh, then the impact
  crit() {
    noise({ dur: 0.28, vol: 0.14, freq: 280, slide: 3400, q: 4 });
    after(280, () => {
      noise({ dur: 0.22, vol: 0.32, freq: 1300, slide: 140, q: 1 });
      note({ midi: 36, dur: 0.2, type: 'square', vol: 0.22, slide: 35 });
    });
  },
  block() {
    noise({ dur: 0.05, vol: 0.18, freq: 2600, q: 8 });
    note({ midi: 78, dur: 0.05, type: 'triangle', vol: 0.1 });
  },
  escape() {
    note({ freq: 330, dur: 0.16, type: 'square', vol: 0.12, slide: 1400 });
    noise({ dur: 0.12, vol: 0.08, freq: 800, slide: 2800, q: 2 });
  },
  surrender() {
    note({ midi: 69, dur: 0.12, type: 'triangle', vol: 0.13 });
    after(140, () => note({ midi: 62, dur: 0.2, type: 'triangle', vol: 0.13 }));
  },
  // descending defeat fall + low thud
  defeat() {
    [67, 63, 60, 55].forEach((m, i) =>
      after(i * 130, () => note({ midi: m, dur: 0.14, type: 'square', vol: 0.13 })));
    after(520, () => note({ midi: 48, dur: 0.3, type: 'triangle', vol: 0.15, slide: 70 }));
  },
  heal() {
    [72, 76, 79, 84].forEach((m, i) =>
      after(i * 70, () => note({ midi: m, dur: 0.12, type: 'triangle', vol: 0.12 })));
  },
  monsterSpawn() {
    note({ midi: 38, dur: 0.25, type: 'sawtooth', vol: 0.14 });
    after(220, () => note({ midi: 44, dur: 0.25, type: 'sawtooth', vol: 0.14, slide: 90 }));
  },
  wyrmRoar() {
    note({ freq: 70, dur: 0.7, type: 'sawtooth', vol: 0.22, slide: 45 });
    noise({ dur: 0.7, vol: 0.18, freq: 220, slide: 90, q: 0.8, type: 'lowpass' });
  },
  // victory sting: rising major run into a held fifth
  exitWin() {
    [60, 64, 67, 72, 76].forEach((m, i) =>
      after(i * 95, () => note({ midi: m, dur: 0.12, type: 'square', vol: 0.14 })));
    after(475, () => {
      note({ midi: 79, dur: 0.45, type: 'square', vol: 0.15 });
      note({ midi: 72, dur: 0.45, type: 'triangle', vol: 0.12 });
    });
  },
  lose() {
    [63, 60, 56].forEach((m, i) =>
      after(i * 160, () => note({ midi: m, dur: 0.16, type: 'square', vol: 0.13 })));
    after(480, () => note({ midi: 44, dur: 0.5, type: 'sawtooth', vol: 0.15, slide: 80 }));
  },
  menuMove() {
    note({ midi: 84, dur: 0.035, type: 'square', vol: 0.07 });
  },
  menuConfirm() {
    note({ midi: 79, dur: 0.05, type: 'square', vol: 0.1 });
    after(60, () => note({ midi: 86, dur: 0.08, type: 'square', vol: 0.1 }));
  },
  menuCancel() {
    note({ midi: 74, dur: 0.05, type: 'square', vol: 0.1 });
    after(60, () => note({ midi: 67, dur: 0.08, type: 'square', vol: 0.1 }));
  },
  error() {
    note({ freq: 110, dur: 0.09, type: 'square', vol: 0.12 });
    after(110, () => note({ freq: 104, dur: 0.12, type: 'square', vol: 0.12 }));
  },
};
