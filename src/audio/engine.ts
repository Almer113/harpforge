// Audio engine: live note on/off with smooth pitch bends, and transport-synced
// playback. Voices (recorded samples or the synthesized reed) live in voices.ts and
// are created per note so each can bend independently.

import * as Tone from 'tone';
import type { Score } from '../core/score';
import { createVoice, outputs, type Voice } from './voices';

export { loadSamples, samplesReady, setSoundMode, setVoicing, type SoundMode, type Voicing } from './voices';

// ---- Live playing -------------------------------------------------------------

const live = new Map<string, Voice>();

export async function ensureAudio(): Promise<void> {
  if (Tone.getContext().state !== 'running') await Tone.start();
  outputs();
}

export function noteOn(id: string, midi: number, glideFrom?: number) {
  noteOff(id);
  const v = createVoice();
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
        // The note sounds through its ties; ties themselves only move the highlight.
        const soundDur = Tone.Time(beatTicks(ev.soundBeats)).toSeconds();
        const soundGap = Math.min(0.06, soundDur * 0.12);
        if (!ev.tied) ev.midis.forEach((m, k) => {
          if (m === null) return;
          const s = ev.sounds[k];
          const glide = s.type === 'hole' && s.bend > 0 ? m + s.bend : undefined;
          const v = createVoice(ev.midis.length > 1 ? 0.7 : 1);
          scheduledVoices.add(v);
          v.start(m, time, glide);
          v.stop(time + soundDur - soundGap);
          setTimeout(() => scheduledVoices.delete(v), (soundDur + 1) * 1000);
        });
        Tone.getDraw().schedule(() => opts.onEvent?.(ev.index, true), time);
        Tone.getDraw().schedule(() => opts.onEvent?.(ev.index, false), time + dur - (ev.soundBeats > ev.beats ? 0 : gap));
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
    const v = createVoice(midis.length > 1 ? 0.7 : 1);
    v.start(m, now, glides[k]);
    v.stop(now + seconds);
  });
}
