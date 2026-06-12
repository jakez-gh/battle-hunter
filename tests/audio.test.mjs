import test from 'node:test';
import assert from 'node:assert/strict';
import { SONGS, playMusic, stopMusic } from '../src/audio/music.js';
import { sfx } from '../src/audio/sfx.js';

const SONG_NAMES = ['title', 'hub', 'dungeon1', 'dungeon2', 'battle', 'results', 'gameover'];
const LOOPS = { title: true, hub: true, dungeon1: true, dungeon2: true, battle: true, results: false, gameover: false };
const VOICES = ['square', 'triangle', 'sawtooth', 'noise'];

test('SONGS exports exactly the required songs', () => {
  assert.deepEqual(Object.keys(SONGS).sort(), [...SONG_NAMES].sort());
});

for (const name of SONG_NAMES) {
  test(`song "${name}" has a valid structure`, () => {
    const song = SONGS[name];
    assert.equal(typeof song.bpm, 'number');
    assert.ok(song.bpm > 0);
    assert.ok(Number.isInteger(song.stepsPerBeat) && song.stepsPerBeat > 0);
    assert.equal(song.loop, LOOPS[name]);
    assert.ok(Array.isArray(song.tracks) && song.tracks.length > 0);
    for (const tr of song.tracks) {
      assert.ok(VOICES.includes(tr.type), `voice ${tr.type}`);
      assert.ok(Array.isArray(tr.steps) && tr.steps.length > 0);
      for (const cell of tr.steps) {
        if (cell === null) continue;
        if (typeof cell === 'number') {
          assert.ok(Number.isInteger(cell), `non-int step ${cell}`);
          if (tr.type !== 'noise') assert.ok(cell >= 24 && cell <= 96, `midi ${cell} out of range`);
        } else {
          assert.ok(Number.isInteger(cell.midi), 'object cell needs int midi');
          assert.ok(Number.isInteger(cell.dur) && cell.dur >= 1, 'object cell needs positive dur');
          if (tr.type !== 'noise') assert.ok(cell.midi >= 24 && cell.midi <= 96);
        }
      }
    }
  });

  test(`song "${name}" tracks align to whole bars`, () => {
    const song = SONGS[name];
    const bar = 4 * song.stepsPerBeat;
    for (const tr of song.tracks) assert.equal(tr.steps.length % bar, 0, `track length ${tr.steps.length}`);
  });

  test(`song "${name}" has lead, bass and percussion voices`, () => {
    const song = SONGS[name];
    const tonal = song.tracks.filter((t) => t.type !== 'noise');
    const perc = song.tracks.filter((t) => t.type === 'noise');
    assert.ok(tonal.length >= 2, 'needs at least lead + bass');
    assert.ok(perc.length >= 1, 'needs a percussion track');
    const bars = Math.max(...song.tracks.map((t) => t.steps.length)) / (4 * song.stepsPerBeat);
    for (const tr of tonal) {
      const notes = tr.steps.filter((c) => c !== null);
      assert.ok(notes.length >= 2 * bars, 'tonal track too sparse to be a melody/bassline');
    }
  });
}

test('dungeon songs run 8+ bars', () => {
  for (const name of ['dungeon1', 'dungeon2']) {
    const song = SONGS[name];
    const bar = 4 * song.stepsPerBeat;
    const longest = Math.max(...song.tracks.map((t) => t.steps.length));
    assert.ok(longest >= 8 * bar, `${name} only ${longest / bar} bars`);
  }
});

test('playMusic/stopMusic are safe without an AudioContext', () => {
  for (const name of SONG_NAMES) assert.doesNotThrow(() => playMusic(name));
  assert.doesNotThrow(() => stopMusic());
  assert.throws(() => playMusic('nope'));
});

const SFX_KEYS = [
  'dieRoll', 'cardDraw', 'cardPlay', 'step', 'boxOpen', 'targetFanfare',
  'flagClaim', 'trapSpring', 'trapDodge', 'hit', 'crit', 'block', 'escape',
  'surrender', 'defeat', 'heal', 'monsterSpawn', 'wyrmRoar', 'exitWin',
  'lose', 'menuMove', 'menuConfirm', 'menuCancel', 'error',
];

test('sfx exports every required event sound as a function', () => {
  for (const key of SFX_KEYS) assert.equal(typeof sfx[key], 'function', `missing sfx.${key}`);
});

test('sfx calls are no-ops under Node (no AudioContext)', () => {
  for (const key of SFX_KEYS) assert.doesNotThrow(() => sfx[key]());
  assert.doesNotThrow(() => sfx.hit(15)); // damage-scaled variant
});
