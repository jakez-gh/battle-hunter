// WebAudio primitives: one shared context, enveloped oscillator notes,
// filtered noise bursts, and a step sequencer for music loops.
//
// Browsers block audio until a user gesture; call unlock() from the first
// click/keydown. Every public function is safe to call before unlock (no-op).

let ctx = null;
let master = null;
let musicGain = null;
let sfxGain = null;

export function unlock() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return;
  }
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
  musicGain = ctx.createGain();
  musicGain.gain.value = 0.55;
  musicGain.connect(master);
  sfxGain = ctx.createGain();
  sfxGain.gain.value = 1.0;
  sfxGain.connect(master);
}

export function ready() {
  return ctx !== null && ctx.state === 'running';
}

export function setVolumes({ master: m, music, sfx }) {
  if (!ctx) return;
  if (m !== undefined) master.gain.value = m;
  if (music !== undefined) musicGain.gain.value = music;
  if (sfx !== undefined) sfxGain.gain.value = sfx;
}

// midi note number -> frequency
export function mtof(n) {
  return 440 * 2 ** ((n - 69) / 12);
}

// Play one note. opts: { type, freq|midi, dur, vol, attack, release, slide, dest }
export function note(opts) {
  if (!ctx) return;
  const t0 = opts.at ?? ctx.currentTime;
  const dur = opts.dur ?? 0.15;
  const osc = ctx.createOscillator();
  osc.type = opts.type ?? 'square';
  const f = opts.freq ?? mtof(opts.midi ?? 69);
  osc.frequency.setValueAtTime(f, t0);
  if (opts.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.slide), t0 + dur);
  const g = ctx.createGain();
  const vol = opts.vol ?? 0.2;
  const attack = opts.attack ?? 0.005;
  const release = opts.release ?? 0.05;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + attack);
  g.gain.setValueAtTime(vol, t0 + Math.max(attack, dur - release));
  g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(opts.dest ?? sfxGain);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

// Filtered noise burst (hits, dice, explosions). opts: { dur, vol, freq, q, slide }
export function noise(opts = {}) {
  if (!ctx) return;
  const t0 = opts.at ?? ctx.currentTime;
  const dur = opts.dur ?? 0.12;
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filt = ctx.createBiquadFilter();
  filt.type = opts.type ?? 'bandpass';
  filt.frequency.setValueAtTime(opts.freq ?? 800, t0);
  if (opts.slide) filt.frequency.exponentialRampToValueAtTime(Math.max(1, opts.slide), t0 + dur);
  filt.Q.value = opts.q ?? 1;
  const g = ctx.createGain();
  const vol = opts.vol ?? 0.25;
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filt).connect(g).connect(opts.dest ?? sfxGain);
  src.start(t0);
}

// Step sequencer. A song is { bpm, stepsPerBeat, loop: true, tracks: [...] }.
// Each track: { type: 'square'|'triangle'|'sawtooth'|'noise', vol, steps: [...] }
// where steps is an array of (midi number | null | {midi, dur} ) per step.
// Schedules ahead in small windows; returns a handle with stop().
let current = null;

export function playSong(song) {
  if (!ctx) return null;
  stopSong();
  const stepDur = 60 / song.bpm / (song.stepsPerBeat ?? 4);
  const nSteps = Math.max(...song.tracks.map((t) => t.steps.length));
  const state = { song, step: 0, nextTime: ctx.currentTime + 0.05, timer: null, stopped: false };

  const scheduleWindow = () => {
    if (state.stopped) return;
    const horizon = ctx.currentTime + 0.3;
    while (state.nextTime < horizon) {
      for (const tr of song.tracks) {
        const cell = tr.steps[state.step % tr.steps.length];
        if (cell === null || cell === undefined) continue;
        const midi = typeof cell === 'object' ? cell.midi : cell;
        const durSteps = typeof cell === 'object' ? (cell.dur ?? 1) : 1;
        if (tr.type === 'noise') {
          noise({ at: state.nextTime, dur: stepDur * 0.6, vol: tr.vol ?? 0.08, freq: midi * 40, dest: musicGain });
        } else {
          note({
            at: state.nextTime, midi, dur: stepDur * durSteps * 0.9,
            type: tr.type, vol: tr.vol ?? 0.08, dest: musicGain,
          });
        }
      }
      state.step += 1;
      if (state.step >= nSteps && !song.loop) { state.stopped = true; break; }
      state.nextTime += stepDur;
    }
    if (!state.stopped) state.timer = setTimeout(scheduleWindow, 120);
  };
  scheduleWindow();
  current = state;
  return { stop: () => stopSongState(state) };
}

function stopSongState(state) {
  state.stopped = true;
  if (state.timer) clearTimeout(state.timer);
  if (current === state) current = null;
}

export function stopSong() {
  if (current) stopSongState(current);
}
