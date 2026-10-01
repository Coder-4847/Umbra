/**
 * All of UMBRA's sound, synthesised with WebAudio at runtime: no audio files.
 *   - `play(name, { x, y })` one-shot effects from the SOUNDS table; with a
 *     position they are panned and attenuated relative to the listener
 *   - an ambience drone per chapter, with a tension pulse on top that
 *     `setTension(0..1)` fades in as guards get suspicious / alert
 * Browsers only allow audio after a user gesture, so the context is created
 * on the first key press or pointer down. Without WebAudio (Node, old
 * browsers) every call is a no-op.
 */
const HEARING_RANGE = 760; // px from the listener at which a positioned sound fades out
const PAN_RANGE = 420;

const DEFAULT_VOLUME = { master: 0.8, sfx: 0.9, ambience: 0.6 };

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.volume = { ...DEFAULT_VOLUME };
    this.listener = { x: 0, y: 0 };
    this.tension = 0;
    this.ambience = null;
    this.ambienceChapter = null;
    this.played = []; // names of recent sounds, for tests and debugging
    this._noiseBuffer = null;
  }

  /** Call once at startup: arms the first-gesture unlock. */
  init() {
    const Ctx = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!Ctx || !globalThis.addEventListener) return;
    const unlock = () => {
      if (!this.ctx) this._create(Ctx);
      if (this.ctx.state === 'suspended') this.ctx.resume();
    };
    globalThis.addEventListener('keydown', unlock);
    globalThis.addEventListener('pointerdown', unlock);
  }

  _create(Ctx) {
    const ctx = (this.ctx = new Ctx());
    this.master = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.ambienceBus = ctx.createGain();
    // Keeps stacked effects (alarm + shots + barks) from clipping.
    const limiter = ctx.createDynamicsCompressor();
    this.sfxBus.connect(this.master);
    this.ambienceBus.connect(this.master);
    this.master.connect(limiter).connect(ctx.destination);
    this._applyVolume();
    if (this.ambienceChapter !== null) this._startAmbience(this.ambienceChapter);
  }

  // --- volume ------------------------------------------------------------------

  /** `{ master, sfx, ambience }`, each 0..1; missing keys keep their value. */
  setVolume(volume = {}) {
    for (const key of Object.keys(DEFAULT_VOLUME)) {
      if (typeof volume[key] === 'number') this.volume[key] = Math.min(1, Math.max(0, volume[key]));
    }
    this._applyVolume();
  }

  _applyVolume() {
    if (!this.ctx) return;
    this.master.gain.value = this.volume.master;
    this.sfxBus.gain.value = this.volume.sfx;
    this.ambienceBus.gain.value = this.volume.ambience;
  }

  setListener(x, y) {
    this.listener.x = x;
    this.listener.y = y;
  }

  // --- one-shots -----------------------------------------------------------------

  play(name, { x, y, volume = 1 } = {}) {
    const sound = SOUNDS[name];
    if (!sound) return;
    this.played.push(name);
    if (this.played.length > 64) this.played.shift();
    const { ctx } = this;
    if (!ctx || ctx.state !== 'running') return;

    let gain = volume;
    let pan = 0;
    if (x !== undefined) {
      const dx = x - this.listener.x;
      const dist = Math.hypot(dx, y - this.listener.y);
      gain *= Math.max(0, 1 - dist / HEARING_RANGE) ** 1.5;
      pan = Math.max(-1, Math.min(1, dx / PAN_RANGE)) * 0.8;
      if (gain < 0.01) return;
    }

    const out = ctx.createGain();
    out.gain.value = gain;
    if (ctx.createStereoPanner) {
      const panner = ctx.createStereoPanner();
      panner.pan.value = pan;
      out.connect(panner).connect(this.sfxBus);
    } else out.connect(this.sfxBus);
    sound(new Voice(this, out, ctx.currentTime));
  }

  _noise() {
    if (!this._noiseBuffer) {
      const { ctx } = this;
      const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this._noiseBuffer = buffer;
    }
    return this._noiseBuffer;
  }

  // --- ambience + tension ---------------------------------------------------------

  /** Start (or switch to) a chapter's drone. `null` stops it. */
  setAmbience(chapter) {
    if (chapter === this.ambienceChapter) return;
    this.ambienceChapter = chapter;
    if (!this.ctx) return;
    this._stopAmbience();
    if (chapter !== null) this._startAmbience(chapter);
  }

  _startAmbience(chapter) {
    const { ctx } = this;
    const mood = AMBIENCE[chapter] ?? AMBIENCE[0];
    const now = ctx.currentTime;
    const nodes = [];
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, now);
    out.gain.linearRampToValueAtTime(1, now + 2.5);
    out.connect(this.ambienceBus);

    // Drone: two slightly detuned low voices through a dark filter.
    const droneFilter = ctx.createBiquadFilter();
    droneFilter.type = 'lowpass';
    droneFilter.frequency.value = 260;
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.14;
    droneFilter.connect(droneGain).connect(out);
    for (const [ratio, type] of [[1, 'sine'], [1.498, 'triangle'], [2.01, 'sine']]) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = mood.root * ratio;
      osc.connect(droneFilter);
      osc.start();
      nodes.push(osc);
    }

    // Air: filtered noise that swells slowly (wind, surf, ventilation).
    const air = ctx.createBufferSource();
    air.buffer = this._noise();
    air.loop = true;
    const airFilter = ctx.createBiquadFilter();
    airFilter.type = 'bandpass';
    airFilter.frequency.value = mood.airTone;
    airFilter.Q.value = 0.6;
    const airGain = ctx.createGain();
    airGain.gain.value = mood.air;
    const swell = ctx.createOscillator();
    swell.frequency.value = mood.swell;
    const swellDepth = ctx.createGain();
    swellDepth.gain.value = mood.air * 0.6;
    swell.connect(swellDepth).connect(airGain.gain);
    air.connect(airFilter).connect(airGain).connect(out);
    air.start();
    swell.start();
    nodes.push(air, swell);

    // Tension: a low pulse, silent until guards get interested.
    const pulse = ctx.createOscillator();
    pulse.type = 'sawtooth';
    pulse.frequency.value = mood.root * 2;
    const pulseFilter = ctx.createBiquadFilter();
    pulseFilter.type = 'lowpass';
    pulseFilter.frequency.value = 300;
    const throb = ctx.createGain();
    throb.gain.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 1.6;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.5;
    lfo.connect(lfoDepth).connect(throb.gain);
    const tensionGain = ctx.createGain();
    tensionGain.gain.value = 0;
    pulse.connect(pulseFilter).connect(throb).connect(tensionGain).connect(out);
    pulse.start();
    lfo.start();
    nodes.push(pulse, lfo);

    this.ambience = { out, nodes, tensionGain, lfo, pulseFilter };
    this._applyTension(0.1);
  }

  _stopAmbience() {
    const ambience = this.ambience;
    if (!ambience) return;
    this.ambience = null;
    const now = this.ctx.currentTime;
    ambience.out.gain.cancelScheduledValues(now);
    ambience.out.gain.setTargetAtTime(0, now, 0.25);
    for (const node of ambience.nodes) node.stop(now + 1.2);
  }

  /** 0 = calm, ~0.5 = someone is suspicious, 1 = alert. */
  setTension(level) {
    const clamped = Math.min(1, Math.max(0, level));
    if (clamped === this.tension) return;
    this.tension = clamped;
    this._applyTension(clamped > 0.6 ? 0.25 : 0.9);
  }

  _applyTension(timeConstant) {
    const ambience = this.ambience;
    if (!ambience) return;
    const now = this.ctx.currentTime;
    const t = this.tension;
    ambience.tensionGain.gain.setTargetAtTime(t * 0.3, now, timeConstant);
    ambience.lfo.frequency.setTargetAtTime(1.6 + t * 2.6, now, timeConstant);
    ambience.pulseFilter.frequency.setTargetAtTime(260 + t * 900, now, timeConstant);
  }
}

/** One sound being built: helpers that schedule oscillators and noise bursts into `out`. */
class Voice {
  constructor(engine, out, time) {
    this.engine = engine;
    this.ctx = engine.ctx;
    this.out = out;
    this.t = time;
  }

  /** A pitched blip. `to` slides the pitch; `at` delays it (seconds). */
  tone(freq, duration, { type = 'sine', gain = 0.3, to = null, at = 0, attack = 0.005 } = {}) {
    const { ctx } = this;
    const start = this.t + at;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, start + duration);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(gain, start + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(env).connect(this.out);
    osc.start(start);
    osc.stop(start + duration + 0.02);
    return this;
  }

  /** A filtered noise burst. `to` sweeps the filter. */
  noise(duration, { filter = 'lowpass', freq = 1000, to = null, q = 1, gain = 0.3, at = 0, attack = 0.003 } = {}) {
    const { ctx } = this;
    const start = this.t + at;
    const src = ctx.createBufferSource();
    src.buffer = this.engine._noise();
    src.loop = true;
    const biquad = ctx.createBiquadFilter();
    biquad.type = filter;
    biquad.Q.value = q;
    biquad.frequency.setValueAtTime(freq, start);
    if (to) biquad.frequency.exponentialRampToValueAtTime(to, start + duration);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(gain, start + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    src.connect(biquad).connect(env).connect(this.out);
    src.start(start, Math.random() * 0.5);
    src.stop(start + duration + 0.02);
    return this;
  }
}

/** Per-chapter ambience: drone root (Hz), how much "air" noise, its colour and how fast it swells. */
const AMBIENCE = {
  0: { root: 55, air: 0.05, airTone: 500, swell: 0.07 },
  1: { root: 55, air: 0.07, airTone: 700, swell: 0.09 }, // rooftops: wind
  2: { root: 49, air: 0.035, airTone: 300, swell: 0.05 }, // warehouse: still, boomy
  3: { root: 61.7, air: 0.04, airTone: 1400, swell: 0.03 }, // lab: air conditioning hiss
  4: { root: 51.9, air: 0.09, airTone: 900, swell: 0.12 }, // snow: gusts
  5: { root: 58.3, air: 0.06, airTone: 2200, swell: 0.2 }, // jungle: insects
  6: { root: 41.2, air: 0.03, airTone: 220, swell: 0.04 }, // bunker: deep rumble
  7: { root: 65.4, air: 0.035, airTone: 1100, swell: 0.03 }, // skyscraper: ventilation
  8: { root: 55, air: 0.05, airTone: 1800, swell: 0.15 }, // estate: night garden
  9: { root: 46.2, air: 0.1, airTone: 420, swell: 0.11 }, // harbor: surf
  10: { root: 43.7, air: 0.06, airTone: 600, swell: 0.08 }, // black site
};

/** name -> builds the sound on a Voice. Gains are relative; the buses set the real level. */
const SOUNDS = {
  // movement
  step: (v) => v.noise(0.07, { freq: 420, gain: 0.22 }),
  splash: (v) => v.noise(0.2, { filter: 'bandpass', freq: 1500, to: 500, q: 0.8, gain: 0.3 }),
  stairs: (v) => v.noise(0.05, { freq: 600, gain: 0.25 }).noise(0.05, { freq: 600, gain: 0.25, at: 0.11 }).noise(0.05, { freq: 600, gain: 0.25, at: 0.22 }),
  elevator: (v) => v.tone(98, 1.1, { type: 'triangle', gain: 0.16, to: 130, attack: 0.2 }),
  ding: (v) => v.tone(1568, 0.9, { gain: 0.22 }).tone(2093, 0.7, { gain: 0.1 }),

  // takedowns
  takedown: (v) => v.noise(0.09, { filter: 'highpass', freq: 2500, to: 900, gain: 0.2 }).tone(140, 0.16, { to: 60, gain: 0.4 }),
  takedownLoud: (v) => v.noise(0.22, { freq: 2600, to: 300, gain: 0.5 }).tone(170, 0.28, { type: 'square', to: 50, gain: 0.35 }),
  parry: (v) => v.tone(880, 0.25, { type: 'square', gain: 0.16 }).tone(1320, 0.3, { type: 'square', gain: 0.12 }).noise(0.08, { filter: 'highpass', freq: 4000, gain: 0.25 }),
  bossWound: (v) => v.tone(110, 0.5, { to: 40, gain: 0.5 }).noise(0.6, { freq: 2400, to: 200, gain: 0.3 }),
  bossReappear: (v) => v.tone(180, 0.45, { type: 'sawtooth', to: 520, gain: 0.14, attack: 0.1 }),

  // bodies and objects
  grab: (v) => v.noise(0.1, { freq: 300, gain: 0.3 }),
  drop: (v) => v.noise(0.12, { freq: 220, gain: 0.35 }).tone(80, 0.12, { to: 50, gain: 0.25 }),
  sink: (v) => v.noise(0.5, { filter: 'bandpass', freq: 1200, to: 300, q: 0.7, gain: 0.45 }).tone(320, 0.5, { to: 70, gain: 0.25, at: 0.08 }),
  intel: (v) => v.tone(880, 0.14, { type: 'triangle', gain: 0.25 }).tone(1320, 0.3, { type: 'triangle', gain: 0.25, at: 0.09 }),
  hack: (v) => v.tone(620, 0.07, { type: 'square', gain: 0.12 }).tone(830, 0.07, { type: 'square', gain: 0.12, at: 0.08 }).tone(1100, 0.16, { type: 'square', gain: 0.12, at: 0.16 }),

  // detection
  spotted: (v) => v.tone(660, 0.1, { type: 'square', gain: 0.2 }).tone(990, 0.22, { type: 'square', gain: 0.2, at: 0.1 }),
  bodyFound: (v) => v.tone(440, 0.16, { type: 'triangle', gain: 0.28 }).tone(330, 0.35, { type: 'triangle', gain: 0.28, at: 0.15 }),
  bark: (v) => v.tone(320, 0.11, { type: 'sawtooth', to: 170, gain: 0.3 }).noise(0.1, { filter: 'bandpass', freq: 700, q: 1.5, gain: 0.3 }).tone(300, 0.12, { type: 'sawtooth', to: 150, gain: 0.3, at: 0.19 }).noise(0.1, { filter: 'bandpass', freq: 650, q: 1.5, gain: 0.3, at: 0.19 }),
  birds: (v) => {
    for (let i = 0; i < 7; i++) v.noise(0.06, { filter: 'highpass', freq: 2600 + i * 250, gain: 0.2, at: i * 0.055 + Math.random() * 0.02 });
    v.tone(2400, 0.12, { to: 3200, gain: 0.08, at: 0.05 }).tone(2800, 0.1, { to: 2200, gain: 0.07, at: 0.2 });
  },
  radio: (v) => v.noise(0.22, { filter: 'bandpass', freq: 2200, q: 2, gain: 0.2 }).tone(1040, 0.08, { type: 'square', gain: 0.1, at: 0.22 }),
  laser: (v) => v.tone(1500, 0.28, { type: 'sawtooth', to: 260, gain: 0.2 }),
  cameraAlarm: (v) => v.tone(1250, 0.07, { type: 'square', gain: 0.16 }).tone(1250, 0.07, { type: 'square', gain: 0.16, at: 0.12 }).tone(1250, 0.07, { type: 'square', gain: 0.16, at: 0.24 }),
  alarm: (v) => {
    for (let i = 0; i < 3; i++) v.tone(740, 0.2, { type: 'square', gain: 0.18, at: i * 0.44 }).tone(550, 0.2, { type: 'square', gain: 0.18, at: i * 0.44 + 0.22 });
  },

  // combat
  shot: (v) => v.noise(0.12, { filter: 'highpass', freq: 1400, gain: 0.5 }).tone(150, 0.12, { to: 50, gain: 0.35 }),
  hurt: (v) => v.tone(220, 0.25, { type: 'sawtooth', to: 70, gain: 0.3 }).noise(0.12, { freq: 900, gain: 0.3 }),

  // results
  clear: (v) => [523, 659, 784, 1047].forEach((f, i) => v.tone(f, 0.4, { type: 'triangle', gain: 0.22, at: i * 0.1 })),
  fail: (v) => [440, 349, 294].forEach((f, i) => v.tone(f, 0.45, { type: 'sawtooth', gain: 0.12, at: i * 0.17 })),
  star: (v) => v.tone(990, 0.2, { type: 'triangle', gain: 0.22 }).tone(1485, 0.25, { type: 'triangle', gain: 0.12, at: 0.03 }),

  // menus
  uiMove: (v) => v.tone(700, 0.04, { type: 'triangle', gain: 0.12 }),
  uiSelect: (v) => v.tone(560, 0.06, { type: 'triangle', gain: 0.2 }).tone(840, 0.12, { type: 'triangle', gain: 0.2, at: 0.05 }),
  uiBack: (v) => v.tone(520, 0.06, { type: 'triangle', gain: 0.16 }).tone(350, 0.12, { type: 'triangle', gain: 0.16, at: 0.05 }),
  uiDeny: (v) => v.tone(150, 0.16, { type: 'square', gain: 0.12 }),
  uiBuy: (v) => [660, 880, 1320].forEach((f, i) => v.tone(f, 0.2, { type: 'triangle', gain: 0.2, at: i * 0.07 })),
};

export const SOUND_NAMES = Object.keys(SOUNDS);
export const audio = new AudioEngine();
