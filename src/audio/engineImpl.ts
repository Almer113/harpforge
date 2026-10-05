// The audio engine itself (loaded on demand through engine.ts, which the app uses): live note on/off with smooth pitch bends, and transport-synced
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

// Live notes start right away: Tone.now() is the scheduling time, a lookahead (0.1 s) ahead.
export function noteOn(id: string, midi: number, glideFrom?: number) {
  noteOff(id);
  const v = createVoice();
  v.start(midi, Tone.immediate(), glideFrom);
  live.set(id, v);
}

export function setPitch(id: string, midi: number) {
  live.get(id)?.setPitch(midi);
}

export function noteOff(id: string) {
  const v = live.get(id);
  if (!v) return;
  v.stop(Tone.immediate());
  live.delete(id);
  soundingFor(0);
}

// ---- Is the app itself making sound? ---------------------------------------------
// The microphone hears the speakers too: notes it picks up while the app is playing
// (a song, a note preview, a key you pressed) aren't yours, so they're ignored.

/** How long a note can still be heard after it stops (release and room). */
const TAIL_MS = 300;
let quietAt = 0;

function soundingFor(seconds: number) {
  quietAt = Math.max(quietAt, performance.now() + seconds * 1000 + TAIL_MS);
}

/** Whether the app is making a note (or just did), so a microphone note now may be the app's own. */
export function appSounding(): boolean {
  return live.size > 0 || scheduledVoices.size > 0 || performance.now() < quietAt;
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
// The playing song's end, so looping can be switched on and off while it plays.
let current: { startBeat: number; end: number; offset: number; endId: number | null; onEnd?: () => void } | null = null;
let endTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Runs `fn` when the transport reaches `time`. Not through Tone's Draw, which silently
 * drops callbacks that come more than 0.25 s late (a hidden browser tab): then the song
 * would never end and the app would stay "playing".
 */
let endFn: (() => void) | null = null;
function atTime(time: number, fn: () => void) {
  clearTimeout(endTimer);
  endFn = fn;
  endTimer = setTimeout(() => {
    endFn = null;
    fn();
  }, Math.max(0, (time - Tone.immediate()) * 1000));
}

function scheduleEnd() {
  if (!current) return;
  const c = current;
  c.endId = transport().schedule((time) => {
    atTime(time, () => {
      stopPlayback();
      c.onEnd?.();
    });
  }, beatTicks(c.end));
}

/** Turns looping on or off while playing, without restarting. */
export function setLoop(on: boolean) {
  const t = transport();
  if (!current) return;
  if (on) {
    if (current.endId !== null) t.clear(current.endId);
    current.endId = null;
    clearTimeout(endTimer);
    t.loopStart = beatTicks(current.startBeat + current.offset);
    t.loopEnd = beatTicks(current.end);
    t.loop = true;
  } else {
    t.loop = false;
    // Already past the end (it was looping)? Then it ends at the next pass; otherwise at the end.
    scheduleEnd();
  }
}

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
          setTimeout(() => {
            scheduledVoices.delete(v);
            soundingFor(0);
          }, (soundDur + 1) * 1000);
        });
        Tone.getDraw().schedule(() => opts.onEvent?.(ev.index, true), time);
        Tone.getDraw().schedule(() => opts.onEvent?.(ev.index, false), time + dur - (ev.soundBeats > ev.beats ? 0 : gap));
      }, beatTicks(at));
    }
    const end = score.totalBeats + offset;
    current = { startBeat, end, offset, endId: null, onEnd: opts.onEnd };
    if (opts.loop && score.totalBeats > 0) setLoop(true);
    else scheduleEnd();
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

// Paused in the moment between reaching the end and acting on it: finish on resume.
let endOnResume: (() => void) | null = null;

export function pausePlayback() {
  clearTimeout(endTimer);
  endOnResume = endFn;
  endFn = null;
  transport().pause();
  Tone.getDraw().cancel(0);
  for (const v of scheduledVoices) v.stop(Tone.immediate());
  if (scheduledVoices.size) soundingFor(0);
  scheduledVoices.clear();
}

export function resumePlayback() {
  transport().start('+0.02');
  if (endOnResume) atTime(Tone.immediate() + 0.02, endOnResume);
  endOnResume = null;
}

export function stopPlayback() {
  const t = transport();
  current = null;
  clearTimeout(endTimer);
  endFn = null;
  endOnResume = null;
  t.stop();
  t.cancel(0);
  Tone.getDraw().cancel(0);
  t.loop = false;
  metronomeId = null;
  for (const v of scheduledVoices) v.stop(Tone.immediate());
  if (scheduledVoices.size) soundingFor(0);
  scheduledVoices.clear();
}

export function setTempo(bpm: number) {
  transport().bpm.value = bpm;
}

/** Transport position in beats right now (what's being heard, not the scheduling lookahead). */
export function transportBeats(): number {
  return transport().getTicksAtTime(Tone.immediate()) / ticksPerBeat();
}


/** Plays one event right away (clicking a tab card). */
export function previewMidis(midis: number[], seconds = 0.5, glides: (number | undefined)[] = []) {
  const now = Tone.immediate();
  if (midis.length) soundingFor(seconds);
  midis.forEach((m, k) => {
    const v = createVoice(midis.length > 1 ? 0.7 : 1);
    v.start(m, now, glides[k]);
    v.stop(now + seconds);
  });
}
