// The backing's instruments (synthesized, made on first use): a soft pad, a plucked string
// strum, and a round bass. They play into the mix's Backing part.

import * as Tone from 'tone';
import type { BackingNote, BackingStyle } from '../core/backing';
import { outputs } from './voices';

let pad: Tone.PolySynth | null = null;
let strum: Tone.PolySynth | null = null;
let bass: Tone.MonoSynth | null = null;

function padSynth(): Tone.PolySynth {
  if (pad) return pad;
  const filter = new Tone.Filter({ type: 'lowpass', frequency: 1400, Q: 0.4 }).connect(outputs().backingIn);
  const chorus = new Tone.Chorus({ frequency: 0.6, delayTime: 3.5, depth: 0.4, wet: 0.35 }).connect(filter).start();
  pad = new Tone.PolySynth(Tone.Synth, {
    // (Three detuned sines: a warm, slowly moving chord.)
    oscillator: { type: 'fatsine', count: 3, spread: 18 } as unknown as Tone.SynthOptions['oscillator'],
    envelope: { attack: 0.35, decay: 0.3, sustain: 0.8, release: 0.9 },
    volume: -12,
  }).connect(chorus);
  pad.maxPolyphony = 24;
  return pad;
}

function strumSynth(): Tone.PolySynth {
  if (strum) return strum;
  const filter = new Tone.Filter({ type: 'lowpass', frequency: 2600, Q: 0.6 }).connect(outputs().backingIn);
  strum = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'triangle8' as 'triangle' },
    envelope: { attack: 0.004, decay: 0.9, sustain: 0.12, release: 0.35 },
    volume: -14,
  }).connect(filter);
  strum.maxPolyphony = 32;
  return strum;
}

function bassSynth(): Tone.MonoSynth {
  if (bass) return bass;
  bass = new Tone.MonoSynth({
    oscillator: { type: 'triangle' },
    filter: { type: 'lowpass', Q: 1 },
    filterEnvelope: { attack: 0.005, decay: 0.2, sustain: 0.3, release: 0.3, baseFrequency: 180, octaves: 2.2 },
    envelope: { attack: 0.006, decay: 0.35, sustain: 0.5, release: 0.25 },
    volume: -8,
  }).connect(outputs().backingIn);
  return bass;
}

const freq = (midi: number) => Tone.Frequency(midi, 'midi').toFrequency();

/** Plays a backing note at `time` for `seconds`. */
export function playBacking(style: BackingStyle, n: BackingNote, time: number, seconds: number) {
  if (n.part === 'bass') {
    bassSynth().triggerAttackRelease(freq(n.midis[0]), Math.max(0.05, seconds), time, n.vel);
    return;
  }
  if (style === 'pad') {
    padSynth().triggerAttackRelease(n.midis.map(freq), Math.max(0.1, seconds), time, n.vel);
    return;
  }
  // A strum: its notes a moment apart (low to high, or high to low on the way up).
  const synth = strumSynth();
  const notes = n.up ? [...n.midis].reverse() : n.midis;
  const gap = style === 'strum' ? 0.014 : 0.004;
  notes.forEach((m, k) => synth.triggerAttackRelease(freq(m), Math.max(0.05, seconds - k * gap), time + k * gap, n.vel));
}

/** Everything the backing is playing stops (pause, stop). */
export function stopBacking() {
  const now = Tone.immediate();
  pad?.releaseAll(now);
  strum?.releaseAll(now);
  bass?.triggerRelease(now);
}
