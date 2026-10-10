// Harmonica voices.
//
// - SampleVoice plays real recordings of a Hohner Special 20 (VCSL, CC0), picking
//   the nearest recorded note and pitch-shifting it (so bends glide naturally),
//   looping the sustain for held notes.
// - SynthVoice is a synthesized reed: a reed-like spectrum shaped by mouth/hand
//   cavity resonances, a breathy "chiff" on the attack, and the small pitch and
//   loudness fluctuations of a real player.
//
// Both layer themselves for tremolo (two detuned reeds) and octave harmonicas.

import * as Tone from 'tone';
import { midiToFreq } from '../core/pitch';

export type Voicing = 'single' | 'tremolo' | 'octave';
export type SoundMode = 'samples' | 'synth';

export interface Voice {
  start(midi: number, time: number, glideFrom?: number): void;
  setPitch(midi: number, ramp?: number): void;
  stop(time: number): void;
  dispose(): void;
}

interface Layer {
  cents: number;
  level: number;
}

// Reeds sounding per note. Tremolo reeds are tuned slightly apart so they beat;
// octave harmonicas add a reed an octave below the written note.
const VOICINGS: Record<Voicing, Layer[]> = {
  single: [{ cents: 0, level: 1 }],
  tremolo: [
    { cents: -9, level: 0.72 },
    { cents: 9, level: 0.72 },
  ],
  octave: [
    { cents: 0, level: 0.85 },
    { cents: -1200, level: 0.6 },
  ],
};

let voicing: Voicing = 'single';
let mode: SoundMode = 'samples';

export function setVoicing(v: Voicing) {
  voicing = v;
}

export function setSoundMode(m: SoundMode) {
  mode = m;
  if (m === 'samples') void loadSamples();
}

// ---- Shared output chain --------------------------------------------------------

/** The parts of the mix: the song's melody, its backing, the clicks, and what you play. */
export type MixPart = 'tune' | 'backing' | 'clicks' | 'you';
/** The harmonica's parts (they share its sound: reed resonances and room). */
type HarpPart = 'tune' | 'you';

let chain: {
  synthIn: Tone.Gain;
  sampleIn: Tone.Gain;
  /** Each harmonica part's way in (its level), for synth and samples. */
  parts: Record<HarpPart, { synth: Tone.Gain; sample: Tone.Gain }>;
  /** The level of every part, the master volume last. */
  levels: Record<MixPart, Tone.Gain[]>;
  master: Tone.Gain;
  /** Where the clicks and the backing go (after their levels). */
  clicksIn: Tone.Gain;
  backingIn: Tone.Gain;
} | null = null;

export function outputs() {
  if (chain) return chain;
  const limiter = new Tone.Limiter(-2).toDestination();
  const master = new Tone.Gain(1).connect(limiter);
  const reverb = new Tone.Reverb({ decay: 1.3, wet: 0.14 }).connect(master);
  const mix = new Tone.Gain(1).connect(reverb);
  // Synth: cupped-hands / mouth resonances and a touch of vibrato.
  const vibrato = new Tone.Vibrato({ frequency: 5.2, depth: 0.025 }).connect(mix);
  const formant2 = new Tone.Filter({ type: 'peaking', frequency: 2700, Q: 1.8, gain: 3 }).connect(vibrato);
  const formant1 = new Tone.Filter({ type: 'peaking', frequency: 1100, Q: 1.1, gain: 4 }).connect(formant2);
  const synthIn = new Tone.Gain(0.3).connect(formant1);
  const sampleIn = new Tone.Gain(0.45).connect(mix); // matched in loudness to the synth
  const part = () => ({ synth: new Tone.Gain(1).connect(synthIn), sample: new Tone.Gain(1).connect(sampleIn) });
  const parts = { tune: part(), you: part() };
  // Clicks are dry; the backing has the room's reverb too.
  const clicksIn = new Tone.Gain(1).connect(master);
  const backingIn = new Tone.Gain(1).connect(mix);
  chain = {
    synthIn,
    sampleIn,
    parts,
    levels: { tune: [parts.tune.synth, parts.tune.sample], you: [parts.you.synth, parts.you.sample], clicks: [clicksIn], backing: [backingIn] },
    master,
    clicksIn,
    backingIn,
  };
  if (pendingMix) setMixLevels(pendingMix);
  return chain;
}

/** Each part's level (0–1, 0 when it's off) and the master volume. */
export interface MixLevels {
  master: number;
  parts: Record<MixPart, number>;
}
let pendingMix: MixLevels | null = null;

/** Sets the mix (smoothly, so a slider doesn't click). Before any sound, kept for when there is. */
export function setMixLevels(mix: MixLevels) {
  pendingMix = mix;
  if (!chain) return;
  const at = Tone.now();
  // (Volume heard as even steps: the slider's square.)
  const curve = (x: number) => Math.max(0, Math.min(1, x)) ** 2;
  chain.master.gain.rampTo(curve(mix.master), 0.05, at);
  for (const p of Object.keys(chain.levels) as MixPart[]) for (const g of chain.levels[p]) g.gain.rampTo(curve(mix.parts[p]), 0.05, at);
}

const db = (gain: number) => 20 * Math.log10(Math.max(1e-4, gain));
const RELEASE = 0.1;

function disposeLater(time: number, fn: () => void) {
  const ms = Math.max(0, (time - Tone.now() + RELEASE + 0.3) * 1000);
  setTimeout(fn, ms);
}

// ---- Synthesized reed -------------------------------------------------------------

// A free reed's spectrum: strong 2nd and 3rd harmonics, gently falling above.
const REED = [1, 0.92, 0.78, 0.5, 0.44, 0.33, 0.26, 0.2, 0.15, 0.11, 0.09, 0.07, 0.05, 0.04, 0.03];

class SynthVoice implements Voice {
  private layers = VOICINGS[voicing];
  private oscs: Tone.Oscillator[];
  private tone: Tone.Filter;
  private flutterGain: Tone.Gain;
  private flutter: Tone.LFO;
  private drift: Tone.LFO;
  private env: Tone.AmplitudeEnvelope;
  private noise: Tone.Noise;
  private noiseEnv: Tone.AmplitudeEnvelope;
  private noiseFilter: Tone.Filter;
  private disposed = false;

  constructor(level = 1, part: HarpPart = 'tune') {
    const out = outputs().parts[part].synth;
    this.env = new Tone.AmplitudeEnvelope({ attack: 0.035, decay: 0.25, sustain: 0.86, release: RELEASE }).connect(out);
    this.flutterGain = new Tone.Gain(1).connect(this.env);
    this.tone = new Tone.Filter({ type: 'lowpass', frequency: 3000, Q: 0.5 }).connect(this.flutterGain);
    this.oscs = this.layers.map((l) => new Tone.Oscillator({ type: 'custom', partials: REED, volume: -6 + db(level * l.level) }).connect(this.tone));
    // Breath: tiny, irregular loudness and pitch movements.
    this.flutter = new Tone.LFO({ frequency: 4 + Math.random() * 2.5, min: 0.93, max: 1, phase: Math.random() * 360 }).connect(this.flutterGain.gain);
    this.drift = new Tone.LFO({ frequency: 0.3 + Math.random() * 0.5, min: -4, max: 4, phase: Math.random() * 360 });
    for (const o of this.oscs) this.drift.connect(o.detune);
    // Air noise with an attack "chiff".
    this.noiseEnv = new Tone.AmplitudeEnvelope({ attack: 0.004, decay: 0.09, sustain: 0.25, release: RELEASE }).connect(out);
    this.noiseFilter = new Tone.Filter({ type: 'bandpass', frequency: 2500, Q: 0.8 }).connect(this.noiseEnv);
    this.noise = new Tone.Noise({ type: 'pink', volume: -27 + db(level) }).connect(this.noiseFilter);
  }

  start(midi: number, time: number, glideFrom?: number) {
    const glide = glideFrom !== undefined ? 0.09 : 0.04;
    this.oscs.forEach((osc, i) => {
      const c = this.layers[i].cents;
      const f = midiToFreq(midi + c / 100);
      // Bends start on the unbent note; plain notes scoop in from slightly flat.
      const from = glideFrom !== undefined ? midiToFreq(glideFrom + c / 100) : f * 0.985;
      osc.frequency.setValueAtTime(from, time);
      osc.frequency.exponentialRampToValueAtTime(f, time + glide);
      osc.start(time);
    });
    const f = midiToFreq(midi);
    const cutoff = Math.min(7500, f * 8);
    this.tone.frequency.setValueAtTime(cutoff * 0.35, time);
    this.tone.frequency.exponentialRampToValueAtTime(cutoff, time + 0.08);
    this.noiseFilter.frequency.setValueAtTime(Math.min(6000, Math.max(1200, f * 2.5)), time);
    this.flutter.start(time);
    this.drift.start(time);
    this.noise.start(time);
    this.env.triggerAttack(time);
    this.noiseEnv.triggerAttack(time);
  }

  setPitch(midi: number, ramp = 0.035) {
    if (this.disposed) return;
    this.oscs.forEach((osc, i) => osc.frequency.rampTo(midiToFreq(midi + this.layers[i].cents / 100), ramp));
    this.tone.frequency.rampTo(Math.min(7500, midiToFreq(midi) * 8), ramp);
  }

  stop(time: number) {
    if (this.disposed) return;
    this.env.triggerRelease(time);
    this.noiseEnv.triggerRelease(time);
    disposeLater(time, () => this.dispose());
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const n of [...this.oscs, this.noise, this.noiseFilter, this.noiseEnv, this.tone, this.flutter, this.drift, this.flutterGain, this.env]) n.dispose();
  }
}

// ---- Recorded samples -----------------------------------------------------------------

interface SampleInfo {
  midi: number;
  tuneCents: number;
  file: string;
  loopStart: number;
  loopEnd: number;
}

interface Sample extends SampleInfo {
  buffer: Tone.ToneAudioBuffer;
}

let bank: Sample[] | null = null;
let loading: Promise<boolean> | null = null;

/** Loads the sample set once (about 1 MB). Resolves false if it can't be loaded. */
export function loadSamples(): Promise<boolean> {
  if (bank) return Promise.resolve(true);
  loading ??= (async () => {
    try {
      const base = `${import.meta.env.BASE_URL}samples/harmonica/`;
      const manifest = (await (await fetch(base + 'manifest.json')).json()) as { notes: SampleInfo[] };
      const loaded = await Promise.all(
        manifest.notes.map(async (n) => ({ ...n, buffer: await Tone.ToneAudioBuffer.fromUrl(base + n.file) })),
      );
      bank = loaded.sort((a, b) => a.midi - b.midi);
      return true;
    } catch {
      loading = null;
      return false;
    }
  })();
  return loading;
}

export function samplesReady(): boolean {
  return !!bank;
}

/** The recording to stretch for a pitch: the nearest, preferring one above (shifting down sounds more natural). */
function nearest(midi: number): Sample {
  let best = bank![0];
  let bestScore = Infinity;
  for (const s of bank!) {
    const d = midi - s.midi;
    const score = Math.abs(d) + (d > 0 ? 0.25 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return best;
}

const rateFor = (s: Sample, midi: number) => Math.pow(2, (midi - s.midi - s.tuneCents / 100) / 12);

class SampleVoice implements Voice {
  private layers = VOICINGS[voicing];
  private parts: { src: Tone.ToneBufferSource; sample: Sample; cents: number }[] = [];
  private env: Tone.AmplitudeEnvelope;
  private disposed = false;

  constructor(
    private level = 1,
    part: HarpPart = 'tune',
  ) {
    this.env = new Tone.AmplitudeEnvelope({ attack: 0.008, decay: 0, sustain: 1, release: RELEASE + 0.03 }).connect(outputs().parts[part].sample);
  }

  start(midi: number, time: number, glideFrom?: number) {
    for (const l of this.layers) {
      const target = midi + l.cents / 100;
      const sample = nearest(target);
      const gain = new Tone.Gain(this.level * l.level).connect(this.env);
      const src = new Tone.ToneBufferSource({
        url: sample.buffer,
        loop: true,
        loopStart: sample.loopStart,
        loopEnd: sample.loopEnd,
        playbackRate: rateFor(sample, glideFrom !== undefined ? glideFrom + l.cents / 100 : target),
      }).connect(gain);
      if (glideFrom !== undefined) src.playbackRate.exponentialRampToValueAtTime(rateFor(sample, target), time + 0.09);
      src.start(time);
      this.parts.push({ src, sample, cents: l.cents });
      src.onended = () => gain.dispose();
    }
    this.env.triggerAttack(time);
  }

  setPitch(midi: number, ramp = 0.035) {
    if (this.disposed) return;
    for (const p of this.parts) p.src.playbackRate.rampTo(rateFor(p.sample, midi + p.cents / 100), ramp);
  }

  stop(time: number) {
    if (this.disposed) return;
    this.env.triggerRelease(time);
    for (const p of this.parts) p.src.stop(time + RELEASE + 0.05);
    disposeLater(time, () => this.dispose());
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const p of this.parts) p.src.dispose();
    this.env.dispose();
  }
}

/** A voice in the current sound mode (synth until the samples have loaded), in the mix's `part`. */
export function createVoice(level = 1, part: HarpPart = 'tune'): Voice {
  if (mode === 'samples' && bank) return new SampleVoice(level, part);
  return new SynthVoice(level, part);
}
