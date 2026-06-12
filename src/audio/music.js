// Original compositions for the synth.js step sequencer. Every tune here is
// written for this project from scratch — late-90s peppy console synth feel,
// melodies our own. Songs are plain data: { bpm, stepsPerBeat, loop, tracks }.
import { playSong, stopSong } from './synth.js';

// --- tiny notation helpers (data builders, no audio) ---

const SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// 'C#4' -> midi number (C4 = 60)
function midi(tok) {
  const m = /^([A-G])(#?)(\d)$/.exec(tok);
  if (!m) throw new Error('bad note token: ' + tok);
  return SEMI[m[1]] + (m[2] ? 1 : 0) + 12 * (+m[3] + 1);
}

// Melody line from space-separated bars: '.' rest, '~' ties previous note.
function mel(...bars) {
  const out = [];
  for (const tok of bars.join(' ').trim().split(/\s+/)) {
    if (tok === '.') out.push(null);
    else if (tok === '~') {
      out.push(null);
      for (let i = out.length - 2; i >= 0; i--) {
        if (out[i] === null) continue;
        if (typeof out[i] === 'number') out[i] = { midi: out[i], dur: 2 };
        else out[i].dur += 1;
        break;
      }
    } else out.push(midi(tok));
  }
  return out;
}

// Drum line: k kick, s snare, h hat, '.' rest (value feeds noise freq = v*40).
function drum(...bars) {
  const map = { k: 5, s: 28, h: 88 };
  return [...bars.join('').replace(/\s+/g, '')].map((c) => map[c] ?? null);
}

const rep = (s, n) => Array(n).fill(s);

// --- title: catchy mid-tempo, C major, C-Am-F-G ---

const tbC = 'C3 . G2 . C3 . G2 . C3 . G2 . C3 . G2 .';
const tbA = 'A2 . E2 . A2 . E2 . A2 . E2 . A2 . E2 .';
const tbF = 'F2 . C3 . F2 . C3 . F2 . C3 . F2 . C3 .';
const tbG = 'G2 . D3 . G2 . D3 . G2 . D3 . B2 . D3 .';
const taC = '. . E4 . . . G4 . . . E4 . . . G4 .';
const taA = '. . C4 . . . E4 . . . C4 . . . E4 .';
const taF = '. . C4 . . . F4 . . . C4 . . . F4 .';
const taG = '. . D4 . . . G4 . . . D4 . . . G4 .';

const title = {
  bpm: 116, stepsPerBeat: 4, loop: true,
  tracks: [
    { type: 'square', vol: 0.09, steps: mel(
      'G4 . C5 . E5 ~ . . D5 . E5 . C5 ~ . .',
      'A4 . C5 . E5 ~ . . E5 . D5 . C5 . A4 .',
      'F4 . A4 . C5 ~ . . D5 . C5 . A4 ~ . .',
      'B4 . D5 . G5 ~ . . F5 . D5 . B4 ~ . .',
      'G4 . C5 . E5 ~ . . G5 . E5 . D5 ~ . .',
      'A5 ~ . G5 E5 ~ . C5 D5 ~ E5 . D5 ~ . .',
      'F5 ~ . E5 D5 ~ . C5 A4 . C5 . D5 ~ . .',
      'G4 . B4 . D5 ~ . . G5 ~ ~ ~ . . . .',
    ) },
    { type: 'triangle', vol: 0.13, steps: mel(tbC, tbA, tbF, tbG, tbC, tbA, tbF, tbG) },
    { type: 'sawtooth', vol: 0.045, steps: mel(taC, taA, taF, taG, taC, taA, taF, taG) },
    { type: 'noise', vol: 0.06, steps: drum(...rep('k.h.s.h.k.h.s.hh', 7), 'k.h.s.h.k.h.s.ss') },
  ],
};

// --- hub: relaxed, F major, F-Dm-Bb-C ---

const hbF = 'F2 . . C3 . . F3 .';
const hbD = 'D2 . . A2 . . D3 .';
const hbB = 'A#2 . . F3 . . A#2 .';
const hbC = 'C3 . . G2 . . C3 .';

const hub = {
  bpm: 84, stepsPerBeat: 2, loop: true,
  tracks: [
    { type: 'triangle', vol: 0.11, steps: mel(
      'A4 ~ . C5 . A4 G4 .',
      'F4 ~ . A4 . G4 F4 .',
      'D4 . F4 . G4 ~ . .',
      'E4 ~ . G4 . . C5 .',
      'A4 ~ . C5 . D5 C5 .',
      'A4 ~ . F4 . G4 A4 .',
      'A#4 ~ . A4 . G4 F4 .',
      'G4 ~ ~ . E4 ~ . .',
    ) },
    { type: 'triangle', vol: 0.12, steps: mel(hbF, hbD, hbB, hbC, hbF, hbD, hbB, hbC) },
    { type: 'noise', vol: 0.035, steps: drum(...rep('k.h...h.', 7), 'k.h...hh') },
  ],
};

// --- dungeon1: driving E minor, Em-Em-C-D / Em-Em-C-B ---

const d1E = 'E2 . E3 . E2 . E3 . E2 . E3 . E2 . E3 .';
const d1C = 'C2 . C3 . C2 . C3 . C2 . C3 . C2 . C3 .';
const d1D = 'D2 . D3 . D2 . D3 . D2 . D3 . D2 . D3 .';
const d1B = 'B1 . B2 . B1 . B2 . B1 . B2 . B1 . B2 .';
const d1r1 = 'E4 . G4 . B4 ~ . . A4 G4 A4 . G4 . E4 .';
const d1r2 = 'E4 . G4 . B4 ~ . . D5 ~ C5 . B4 ~ . .';

const dungeon1 = {
  bpm: 132, stepsPerBeat: 4, loop: true,
  tracks: [
    { type: 'square', vol: 0.09, steps: mel(
      d1r1, d1r2,
      'C5 ~ . B4 C5 . E5 . D5 . C5 . B4 . A4 .',
      'D5 ~ . C5 D5 . F#4 . A4 ~ . . F#4 . D4 .',
      d1r1, d1r2,
      'C5 ~ . E5 D5 ~ . C5 B4 . A4 . G4 . A4 .',
      'F#4 . A4 . B4 ~ . . D#5 ~ ~ . B4 . F#4 .',
    ) },
    { type: 'triangle', vol: 0.14, steps: mel(d1E, d1E, d1C, d1D, d1E, d1E, d1C, d1B) },
    { type: 'noise', vol: 0.07, steps: drum(...rep('k.hhs.h.k.hhs.h.', 7), 'k.hhs.h.k.s.ssss') },
  ],
};

// --- dungeon2: driving A dorian, Am-D-Am-G / Am-D-F-E ---

const d2A = 'A2 . . A2 . A3 . . A2 . . A2 . G2 A2 .';
const d2D = 'D3 . . D3 . D2 . . D3 . . D3 . C3 D3 .';
const d2F = 'F2 . . F2 . F3 . . F2 . . F2 . E2 F2 .';
const d2G = 'G2 . . G2 . G3 . . G2 . . G2 . F2 G2 .';
const d2E = 'E2 . . E2 . E3 . . E2 . . E2 . D2 E2 .';
const d2sA = '. . E4 . . . A4 . . . E4 . . . A4 .';
const d2sD = '. . F#4 . . . A4 . . . F#4 . . . A4 .';
const d2sF = '. . F4 . . . A4 . . . F4 . . . A4 .';
const d2sG = '. . G4 . . . B4 . . . G4 . . . B4 .';
const d2sE = '. . G#4 . . . B4 . . . G#4 . . . B4 .';
const d2m1 = 'A4 . C5 . E5 . D5 C5 D5 ~ . . C5 . A4 .';
const d2m2 = 'F#4 . A4 . D5 ~ . . E5 . F#5 . E5 . D5 .';

const dungeon2 = {
  bpm: 140, stepsPerBeat: 4, loop: true,
  tracks: [
    { type: 'square', vol: 0.09, steps: mel(
      d2m1, d2m2,
      'E5 ~ . D5 C5 ~ . A4 B4 ~ C5 . B4 . G4 .',
      'G4 . B4 . D5 ~ . . B4 . G4 . A4 ~ . .',
      d2m1, d2m2,
      'F5 ~ . E5 D5 . C5 . A4 . C5 . D5 ~ . .',
      'E5 ~ . B4 G#4 . B4 . E4 ~ . . . . E5 .',
    ) },
    { type: 'triangle', vol: 0.14, steps: mel(d2A, d2D, d2A, d2G, d2A, d2D, d2F, d2E) },
    { type: 'sawtooth', vol: 0.04, steps: mel(d2sA, d2sD, d2sA, d2sG, d2sA, d2sD, d2sF, d2sE) },
    { type: 'noise', vol: 0.07, steps: drum(...rep('k.h.s.hhk.h.s.h.', 7), 'k.h.s.hhk.s.ssss') },
  ],
};

// --- battle: tense D minor short loop, chromatic creep ---

const bb1 = 'D2 . D2 D2 . D2 . D2 D2 . D2 . F2 . G2 G#2';

const battle = {
  bpm: 156, stepsPerBeat: 4, loop: true,
  tracks: [
    { type: 'square', vol: 0.08, steps: mel(
      'D5 . . F5 . . E5 . D5 . . F5 . . A5 G#5',
      'A5 ~ . G5 F5 . E5 . F5 . E5 . D5 . C#5 .',
      'D5 . . F5 . . E5 . D5 . . F5 . . G5 A5',
      'A#5 ~ . A5 G5 . F5 . E5 ~ . C#5 D5 ~ . .',
    ) },
    { type: 'triangle', vol: 0.15, steps: mel(
      bb1,
      'A2 . A2 A2 . A2 . A2 G#2 . G#2 . G2 . F2 E2',
      bb1,
      'A#2 . A#2 A#2 . A#2 . A#2 A2 . A2 . C3 . C#3 .',
    ) },
    { type: 'noise', vol: 0.07, steps: drum(...rep('kkh.s.hkk.h.s.hh', 3), 'kkh.s.hkk.s.ssss') },
  ],
};

// --- results: upbeat jingle, no loop ---

const results = {
  bpm: 126, stepsPerBeat: 4, loop: false,
  tracks: [
    { type: 'square', vol: 0.11, steps: mel(
      'C5 . C5 . C5 . E5 ~ G5 ~ . . E5 ~ . .',
      'F5 . F5 . F5 . A5 ~ G5 ~ . . E5 . C5 .',
      'D5 . E5 . F5 ~ . . G5 . A5 . B5 ~ . .',
      'C6 ~ ~ ~ ~ ~ ~ ~ . . . . . . . .',
    ) },
    { type: 'triangle', vol: 0.13, steps: mel(
      'C3 . G2 . C3 . G2 . C3 . G2 . C3 . . .',
      'F2 . C3 . F2 . C3 . F2 . C3 . F2 . . .',
      'G2 . D3 . G2 . D3 . G2 . G2 . G2 . . .',
      'C3 ~ ~ ~ ~ ~ ~ ~ . . . . . . . .',
    ) },
    { type: 'noise', vol: 0.06, steps: drum(...rep('k.h.s.h.k.h.s.h.', 3), 'kk..s...........') },
  ],
};

// --- gameover: short falling sting, no loop ---

const gameover = {
  bpm: 76, stepsPerBeat: 2, loop: false,
  tracks: [
    { type: 'triangle', vol: 0.12, steps: mel(
      'A4 ~ G4 ~ F4 ~ E4 ~',
      'D4 ~ E4 ~ A3 ~ ~ ~',
    ) },
    { type: 'triangle', vol: 0.12, steps: mel(
      'A2 ~ ~ ~ F2 ~ ~ ~',
      'D2 ~ ~ ~ E2 ~ A1 ~',
    ) },
    { type: 'noise', vol: 0.05, steps: drum('k.......', '........') },
  ],
};

export const SONGS = { title, hub, dungeon1, dungeon2, battle, results, gameover };

export function playMusic(name) {
  const song = SONGS[name];
  if (!song) throw new Error('unknown song: ' + name);
  return playSong(song); // null before unlock(); playSong stops any prior song
}

export function stopMusic() {
  stopSong();
}
