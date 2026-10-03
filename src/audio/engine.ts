// Audio engine: a synthesized free-reed voice (rich harmonics + breath noise),
// live note on/off with smooth pitch bends, and transport-synced playback.
//
// Voices are created per note so each can bend independently. The voice design is
// isolated in `Voice` so it can later be swapped for a sample-based one.

import * as Tone from 'tone';
import { midiToFreq } from '../core/pitch';
import type { Score } from '../core/score';

// Harmonic spectrum of a brass reed: strong low partials, both odd and even.
const PARTIALS = [1, 0.85, 0.62, 0.5, 0.4, 0.3, 0.24, 0.17, 0.12, 0.09, 0.06, 0.045, 0.03];
const RELEASE = 0.09;

let master: Tone.Gain | null = null;

function getMaster(): Tone.Gain {
  if (master) return master;
  const limiter = new Tone.Limiter(-2).toDestination();
  const reverb = new Tone.Reverb({ decay: 1.4, wet: 0.16 }).connect(limiter);
  const vibrato = new Tone.Vibrato({ frequency: 5.4, depth: 0.035 }).connect(reverb);
  const body = new Tone.Filter({ type: 'peaking', frequency: 1300, Q: 0.9, gain: 3 }).connect(vibrato);
  master = new Tone.Gain(0.32).connect(body);
  return master;
}

class Voice {
  private osc: Tone.Oscillator;
  private noise: Tone.Noise;
  private filter: Tone.Filter;
  private noiseFilter: Tone.Filter;
  private env: Tone.AmplitudeEnvelope;
  private disposed = false;

  constructor(private level = 1) {
    this.env = new Tone.AmplitudeEnvelope({ attack: 0.028, decay: 0.15, sustain: 0.82, release: RELEASE }).connect(getMaster());
    this.filter = new Tone.Filter({ type: 'lowpass', frequency: 3000, Q: 0.6 }).connect(this.env);
    this.osc = new Tone.Oscillator({ type: 'custom', partials: PARTIALS, volume: -6 + 20 * Math.log10(this.level) }).connect(this.filter);
    this.noiseFilter = new Tone.Filter({ type: 'bandpass', frequency: 1500, Q: 1.2 }).connect(this.env);
    this.noise = new Tone.Noise({ type: 'pink', volume: -32 }).connect(this.noiseFilter);
  }

  start(midi: number, time: number, glideFrom?: number) {
    const f = midiToFreq(midi);
    const from = glideFrom !== undefined ? midiToFreq(glideFrom) : f * 0.992; // a tiny scoop into the note
    this.osc.frequency.setValueAtTime(from, time);
    this.osc.frequency.exponentialRampToValueAtTime(f, time + (glideFrom !== undefined ? 0.09 : 0.035));
    const cutoff = Math.min(6500, f * 7);
    this.filter.frequency.setValueAtTime(cutoff * 0.45, time);
    this.filter.frequency.exponentialRampToValueAtTime(cutoff, time + 0.07);
    this.noiseFilter.frequency.setValueAtTime(Math.min(5000, f * 2), time);
    this.osc.start(time);
    this.noise.start(time);
    this.env.triggerAttack(time);
  }

  setPitch(midi: number, ramp = 0.035) {
    if (this.disposed) return;
    const f = midiToFreq(midi);
    this.osc.frequency.rampTo(f, ramp);
    this.filter.frequency.rampTo(Math.min(6500, f * 7), ramp);
  }

  stop(time: number) {
    if (this.disposed) return;
    this.env.triggerRelease(time);
    const ms = Math.max(0, (time - Tone.now() + RELEASE + 0.25) * 1000);
    setTimeout(() => this.dispose(), ms);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const n of [this.osc, this.noise, this.filter, this.noiseFilter, this.env]) n.dispose();
  }
}

// ---- Live playing -------------------------------------------------------------

const live = new Map<string, Voice>();

export async function ensureAudio(): Promise<void> {
  if (Tone.getContext().state !== 'running') await Tone.start();
  getMaster();
}

export function noteOn(id: string, midi: number, glideFrom?: number) {
  noteOff(id);
  const v = new Voice();
  v.start(midi, Tone.now(), glideFrom);
  live.set(id, v);
}

export function setPitch(id: string, midi: number) {
  live.get(id)?.setPitch(midi);
}

export function noteOff(id: string) {
  const v = live.get(id);
  if (!v) return;
  v.stop(Tone.now());
  live.delete(id);
}

export function allNotesOff() {
  for (const id of [...live.keys()]) noteOff(id);
}

// ---- Metronome ----------------------------------------------------------------

let clickSynth: Tone.Synth | null = null;

function click(time: number, accent: boolean) {
  clickSynth ??= new Tone.Synth({
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.02 },
    volume: -10,
  }).toDestination();
  clickSynth.triggerAttackRelease(accent ? 1760 : 1175, 0.03, time);
}

// ---- Transport playback -------------------------------------------------------

const transport = () => Tone.getTransport();
const ticksPerBeat = () => transport().PPQ;
const beatTicks = (beats: number) => `${Math.round(beats * ticksPerBeat())}i`;

export interface PlaybackOptions {
  tempo: number;
  startBeat?: number;
  loop?: boolean;
  /** When set, plays a click every beat (accent on bar starts). */
  metronomeBeatsPerBar?: number;
  /** Beats of count-in clicks before the score starts. */
  countIn?: number;
  onEvent?: (index: number, on: boolean) => void;
  onEnd?: () => void;
}

const scheduledVoices = new Set<Voice>();
let metronomeId: number | null = null;
let metronomeBpb = 4;

function scheduleMetronome(beatsPerBar: number) {
  metronomeBpb = beatsPerBar;
  if (metronomeId !== null) transport().clear(metronomeId);
  metronomeId = transport().scheduleRepeat((time) => {
    const beat = Math.round(transport().getTicksAtTime(time) / ticksPerBeat());
    click(time, beat % metronomeBpb === 0);
  }, beatTicks(1), 0);
}

export function setMetronome(beatsPerBar: number | null) {
  if (beatsPerBar === null) {
    if (metronomeId !== null) transport().clear(metronomeId);
    metronomeId = null;
  } else scheduleMetronome(beatsPerBar);
}

/** Plays a score from `startBeat`. Times are in transport ticks so tempo changes apply live. */
export function playScore(score: Score | null, opts: PlaybackOptions) {
  stopPlayback();
  const t = transport();
  t.bpm.value = opts.tempo;
  const countIn = opts.countIn ?? 0;
  const offset = countIn; // score beat 0 sits at transport beat `countIn`
  const startBeat = opts.startBeat ?? 0;

  if (score) {
    for (const ev of score.events) {
      if (ev.rest || ev.start + ev.beats <= startBeat) continue;
      const at = ev.start + offset;
      t.schedule((time) => {
        const dur = Tone.Time(beatTicks(ev.beats)).toSeconds();
        const gap = Math.min(0.06, dur * 0.12);
        ev.midis.forEach((m, k) => {
          if (m === null) return;
          const s = ev.sounds[k];
          const glide = s.type === 'hole' && s.bend > 0 ? m + s.bend : undefined;
          const v = new Voice(ev.midis.length > 1 ? 0.7 : 1);
          scheduledVoices.add(v);
          v.start(m, time, glide);
          v.stop(time + dur - gap);
          setTimeout(() => scheduledVoices.delete(v), (dur + 1) * 1000);
        });
        Tone.getDraw().schedule(() => opts.onEvent?.(ev.index, true), time);
        Tone.getDraw().schedule(() => opts.onEvent?.(ev.index, false), time + dur - gap);
      }, beatTicks(at));
    }
    const end = score.totalBeats + offset;
    if (opts.loop && score.totalBeats > 0) {
      t.loop = true;
      t.loopStart = beatTicks(startBeat + offset);
      t.loopEnd = beatTicks(end);
    } else {
      t.schedule((time) => {
        Tone.getDraw().schedule(() => {
          stopPlayback();
          opts.onEnd?.();
        }, time);
      }, beatTicks(end));
    }
  }

  if (opts.metronomeBeatsPerBar) scheduleMetronome(opts.metronomeBeatsPerBar);
  else if (countIn > 0) {
    // Count-in clicks only.
    for (let b = 0; b < countIn; b++) t.schedule((time) => click(time, b === 0), beatTicks(b));
  }
  // Count-in only applies when starting from the top.
  t.ticks = Math.round((startBeat > 0 ? startBeat + offset : 0) * ticksPerBeat());
  t.start('+0.05');
}

export function pausePlayback() {
  transport().pause();
  Tone.getDraw().cancel(0);
  for (const v of scheduledVoices) v.stop(Tone.now());
  scheduledVoices.clear();
}

export function resumePlayback() {
  transport().start('+0.02');
}

export function stopPlayback() {
  const t = transport();
  t.stop();
  t.cancel(0);
  Tone.getDraw().cancel(0);
  t.loop = false;
  metronomeId = null;
  for (const v of scheduledVoices) v.stop(Tone.now());
  scheduledVoices.clear();
}

export function setTempo(bpm: number) {
  transport().bpm.value = bpm;
}

/** Current transport position in beats. */
export function transportBeats(): number {
  return transport().ticks / ticksPerBeat();
}

export function isTransportRunning(): boolean {
  return transport().state === 'started';
}

/** Plays one event right away (clicking a tab card). */
export function previewMidis(midis: number[], seconds = 0.5, glides: (number | undefined)[] = []) {
  const now = Tone.now();
  midis.forEach((m, k) => {
    const v = new Voice(midis.length > 1 ? 0.7 : 1);
    v.start(m, now, glides[k]);
    v.stop(now + seconds);
  });
}
