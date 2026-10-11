// The backing's instruments (synthesized): a soft pad, a plucked string strum, a round bass,
// and the drone — a held, reedy tone (a harmonium's, or a tanpura's hum). They play into the
// mix's Backing part; the drone on its own into its own part.
//
// Each playback has a session of its own: its instruments, behind a fader. Stopping (or
// pausing, or jumping) fades the session out and throws it away, so nothing it had started or
// meant to stop later can touch the next one's notes; the next playback makes a fresh one.

import * as Tone from 'tone';
import type { BackingNote, BackingStyle } from '../core/backing';
import { outputs } from './voices';

const freq = (midi: number) => Tone.Frequency(midi, 'midi').toFrequency();

function makePad(out: Tone.InputNode): Tone.PolySynth {
  const filter = new Tone.Filter({ type: 'lowpass', frequency: 1400, Q: 0.4 }).connect(out);
  const chorus = new Tone.Chorus({ frequency: 0.6, delayTime: 3.5, depth: 0.4, wet: 0.35 }).connect(filter).start();
  const pad = new Tone.PolySynth(Tone.Synth, {
    // (Three detuned sines: a warm, slowly moving chord.)
    oscillator: { type: 'fatsine', count: 3, spread: 18 } as unknown as Tone.SynthOptions['oscillator'],
    envelope: { attack: 0.35, decay: 0.3, sustain: 0.8, release: 0.9 },
    volume: -12,
  }).connect(chorus);
  pad.maxPolyphony = 32;
  return pad;
}

function makeStrum(out: Tone.InputNode): Tone.PolySynth {
  const filter = new Tone.Filter({ type: 'lowpass', frequency: 2600, Q: 0.6 }).connect(out);
  const strum = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'triangle8' as 'triangle' },
    envelope: { attack: 0.004, decay: 0.9, sustain: 0.12, release: 0.35 },
    volume: -14,
  }).connect(filter);
  strum.maxPolyphony = 40;
  return strum;
}

function makeBass(out: Tone.InputNode): Tone.MonoSynth {
  return new Tone.MonoSynth({
    oscillator: { type: 'triangle' },
    filter: { type: 'lowpass', Q: 1 },
    filterEnvelope: { attack: 0.005, decay: 0.2, sustain: 0.3, release: 0.3, baseFrequency: 180, octaves: 2.2 },
    envelope: { attack: 0.006, decay: 0.35, sustain: 0.5, release: 0.25 },
    volume: -8,
  }).connect(out);
}

/** A drone: three slightly detuned saws, softened; slow to start and to fade. */
function makeDrone(out: Tone.InputNode): Tone.PolySynth {
  const filter = new Tone.Filter({ type: 'lowpass', frequency: 900, Q: 0.5 }).connect(out);
  const synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'fatsawtooth', count: 3, spread: 10 } as unknown as Tone.SynthOptions['oscillator'],
    envelope: { attack: 0.8, decay: 0.5, sustain: 0.9, release: 1.4 },
    volume: -12,
  }).connect(filter);
  synth.maxPolyphony = 8;
  return synth;
}

/** One playback's backing: its instruments (made as needed) behind a fader. */
class Session {
  private fader = new Tone.Gain(1).connect(outputs().backingIn);
  private nodes: Tone.ToneAudioNode[] = [this.fader];
  private pad?: Tone.PolySynth;
  private strum?: Tone.PolySynth;
  private bass?: Tone.MonoSynth;
  private drone?: Tone.PolySynth;

  private keep<T extends Tone.ToneAudioNode>(node: T): T {
    this.nodes.push(node);
    return node;
  }

  /** Makes the instruments a style needs now (before playback starts: no hiccup at the first note). */
  ready(style: BackingStyle) {
    if (style === 'pad') this.padSynth();
    else if (style === 'drone') this.droneSynth();
    else {
      this.strumSynth();
      if (style === 'oompah') this.bassSynth();
    }
  }

  private padSynth = () => (this.pad ??= this.keep(makePad(this.fader)));
  private strumSynth = () => (this.strum ??= this.keep(makeStrum(this.fader)));
  private bassSynth = () => (this.bass ??= this.keep(makeBass(this.fader)));
  private droneSynth = () => (this.drone ??= this.keep(makeDrone(this.fader)));

  /** Plays a backing note at `time` for `seconds`. */
  play(style: BackingStyle, n: BackingNote, time: number, seconds: number) {
    if (n.part === 'bass') {
      this.bassSynth().triggerAttackRelease(freq(n.midis[0]), Math.max(0.05, seconds), time, n.vel);
      return;
    }
    if (style === 'pad') {
      this.padSynth().triggerAttackRelease(n.midis.map(freq), Math.max(0.1, seconds), time, n.vel);
      return;
    }
    // A strum: its notes a moment apart (low to high, or high to low on the way up).
    const synth = this.strumSynth();
    const notes = n.up ? [...n.midis].reverse() : n.midis;
    const gap = style === 'strum' ? 0.014 : 0.004;
    notes.forEach((m, k) => synth.triggerAttackRelease(freq(m), Math.max(0.05, seconds - k * gap), time + k * gap, n.vel));
  }

  /** The drone, held from `time` until the session ends (a loop, a tempo change: it just goes on). */
  hold(midis: number[], time: number, vel: number) {
    this.droneSynth().triggerAttack(midis.map(freq), time, vel);
  }

  /** Fades out and goes (its tail first: no click). */
  end() {
    const now = Tone.immediate();
    this.fader.gain.rampTo(0, 0.12, now);
    const nodes = this.nodes;
    setTimeout(() => nodes.forEach((n) => n.dispose()), 400);
  }
}

let session: Session | null = null;

/** The playing backing session (a new one if there's none). */
export function backingSession(): Session {
  return (session ??= new Session());
}

/** Everything the backing is playing fades and stops (pause, stop, a jump). */
export function stopBacking() {
  session?.end();
  session = null;
}

// ---- The drone on its own -------------------------------------------------------

let ownDrone: Tone.PolySynth | null = null;
let ownNotes: number[] = [];
let ownSince = 0;

/** The drone on its own: `midis` held from now (null: it fades). */
export function setOwnDrone(midis: number[] | null) {
  const now = Tone.immediate();
  // (Let go no earlier than it started: a release before the attack would be lost.)
  if (ownNotes.length) ownDrone?.triggerRelease(ownNotes.map(freq), Math.max(now, ownSince));
  ownNotes = midis ?? [];
  if (!ownNotes.length) return;
  ownDrone ??= makeDrone(outputs().droneIn);
  ownSince = now;
  ownDrone.triggerAttack(ownNotes.map(freq), now, 0.4);
}
