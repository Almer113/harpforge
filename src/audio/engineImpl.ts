// The audio engine itself (loaded on demand through engine.ts, which the app uses): live note on/off with smooth pitch bends, and transport-synced
// playback. Voices (recorded samples or the synthesized reed) live in voices.ts and
// are created per note so each can bend independently.

import * as Tone from 'tone';
import { soundSpans, type Score } from '../core/score';
import { inCount, isAccent, type ClickInfo } from './clicks';
import { createVoice, outputs, type Voice } from './voices';
import { playBacking, stopBacking } from './backingVoices';
import type { BackingNote, BackingStyle } from '../core/backing';

export { loadSamples, samplesReady, setMixLevels, setSoundMode, setVoicing, type MixLevels, type MixPart, type SoundMode, type Voicing } from './voices';

// ---- Live playing -------------------------------------------------------------

const live = new Map<string, Voice>();

export async function ensureAudio(): Promise<void> {
  if (Tone.getContext().state !== 'running') await Tone.start();
  outputs();
}

// Live notes start right away: Tone.now() is the scheduling time, a lookahead (0.1 s) ahead.
export function noteOn(id: string, midi: number, glideFrom?: number) {
  noteOff(id);
  const v = createVoice(1, 'you');
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
  }).connect(outputs().clicksIn);
  // The first beat of a bar is higher and louder.
  clickSynth.triggerAttackRelease(accent ? 1760 : 1175, 0.03, time, accent ? 1 : 0.55);
}

// ---- Transport playback -------------------------------------------------------

const transport = () => Tone.getTransport();
const ticksPerBeat = () => transport().PPQ;
const beatTicks = (beats: number) => `${Math.round(beats * ticksPerBeat())}i`;

export interface PlaybackOptions {
  tempo: number;
  startBeat?: number;
  loop?: boolean;
  /**
   * Plays (and loops) only this stretch, in score beats: notes are cut at its edges, and a
   * note held into it from before sounds from its start.
   */
  range?: { start: number; end: number };
  /** When set, plays a click every beat (accent on bar starts). */
  metronomeBeatsPerBar?: number;
  /** Beats of count-in clicks before playback starts (from wherever it starts). */
  countIn?: number;
  /** Count in again before each pass of a loop. */
  countEachLoop?: boolean;
  /** Where the score's bars start (score beats), so the clicks accent real bar starts (pickups too). */
  barStarts?: number[];
  /** Beats in a bar (for the count's accents when the metronome is off). */
  beatsPerBar?: number;
  /** Called as each pass of a loop ends and the next begins (in time with what's heard). */
  onLoop?: () => void;
  /** Plays without the melody (its notes still light up): playing along with the microphone. */
  muted?: boolean;
  /** Backing chords under the song (score beats, as the score's notes). */
  backing?: { style: BackingStyle; notes: BackingNote[] };
  onEvent?: (index: number, on: boolean) => void;
  onEnd?: () => void;
}

const scheduledVoices = new Set<Voice>();
// The tune left out (its notes still light up): looked at as each note comes, so it can be
// switched while the song plays.
let tuneOff = false;

/** The tune off or on, now: off, what's sounding stops. */
export function setTuneOff(off: boolean) {
  tuneOff = off;
  if (!off) return;
  for (const v of scheduledVoices) v.stop(Tone.immediate());
  if (scheduledVoices.size) soundingFor(0);
  scheduledVoices.clear();
}
let metronomeId: number | null = null;
let metronomeBpb = 4;
let loopListener: ((time: number) => void) | null = null;
const loopTimers = new Set<ReturnType<typeof setTimeout>>();
// What the clicks need to know about the playing song (see clicks.ts).
let clickInfo: ClickInfo = { offset: 0, countFrom: 0, count: 0 };
const accented = (beat: number) => isAccent(beat, clickInfo, metronomeBpb);
// The playing song's end, so looping can be switched on and off while it plays.
// `loopFrom`: where each pass of a loop starts on the transport (before its count, if it has one).
// `startsAt`: the audio time playback really starts (until then the transport still reports
// where it was before).
let current: { startBeat: number; loopFrom: number; end: number; offset: number; endId: number | null; onEnd?: () => void; startsAt: number } | null = null;
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
    t.loopStart = beatTicks(current.loopFrom);
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
  // A click on every beat of the score (the transport may be offset by a fraction of a beat).
  const frac = ((clickInfo.offset % 1) + 1) % 1;
  metronomeId = transport().scheduleRepeat((time) => {
    const beat = Math.round((transport().getTicksAtTime(time) / ticksPerBeat() - clickInfo.offset) * 1000) / 1000;
    // The count has its own clicks (so the metronome going on or off mid-song never changes it).
    if (!inCount(beat, clickInfo)) click(time, accented(beat));
  }, beatTicks(1), beatTicks(frac));
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
  // Score beat b sits at transport beat b + offset, so the count fits before wherever playback starts.
  const offset = countIn;
  // (A range that's no longer inside the song, after an edit, plays the song instead.)
  const range = opts.range && score && Math.min(opts.range.end, score.totalBeats) > opts.range.start + 1e-6 ? opts.range : undefined;
  tuneOff = !!opts.muted;
  const startBeat = range ? range.start : (opts.startBeat ?? 0);

  if (score) {
    const until = range ? Math.min(range.end, score.totalBeats) : score.totalBeats;
    // Where each note's sound starts and ends (a tied piece belongs to the note it continues).
    const heads = soundSpans(score);
    for (const ev of score.events) {
      if (ev.rest || ev.start + ev.beats <= startBeat + 1e-6 || ev.start >= until - 1e-6) continue;
      const from = Math.max(ev.start, startBeat);
      const head = heads[ev.index];
      // A note sounds from its own start, or from where playback starts when it's held into it.
      const attack = !ev.tied ? ev.start >= startBeat - 1e-6 : false;
      const heldIn = !attack && head.start < startBeat - 1e-6 && ev.start <= startBeat + 1e-6;
      const sounds = attack || heldIn;
      const at = from + offset;
      t.schedule((time) => {
        const dur = Tone.Time(beatTicks(Math.min(ev.start + ev.beats, until) - from)).toSeconds();
        const gap = Math.min(0.06, dur * 0.12);
        // The note sounds through its ties; ties themselves only move the highlight.
        const soundDur = Tone.Time(beatTicks(Math.min(head.end, until) - from)).toSeconds();
        const soundGap = Math.min(0.06, soundDur * 0.12);
        if (sounds && !tuneOff) ev.midis.forEach((m, k) => {
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
    // The backing: from where playback starts (a loop's notes come round with the transport).
    if (opts.backing) {
      const { style, notes } = opts.backing;
      for (const n of notes) {
        if (n.at < startBeat - 1e-6 || n.at >= until - 1e-6) continue;
        const len = Math.min(n.dur, until - n.at);
        t.schedule((time) => playBacking(style, n, time, Tone.Time(beatTicks(len)).toSeconds()), beatTicks(n.at + offset));
      }
    }
    const end = until + offset;
    current = { startBeat, loopFrom: startBeat + (opts.countEachLoop ? 0 : offset), end, offset, endId: null, onEnd: opts.onEnd, startsAt: Infinity };
    if (opts.loop && score.totalBeats > 0) setLoop(true);
    else scheduleEnd();
  }

  if (opts.onLoop) {
    const onLoop = opts.onLoop;
    // A timer, not Tone's Draw (which waits for animation frames and drops late calls): the
    // pass is scored and the trainer steps even when the page is in the background.
    loopListener = (time: number) => {
      const id = setTimeout(() => {
        loopTimers.delete(id);
        onLoop();
      }, Math.max(0, (time - Tone.immediate()) * 1000));
      loopTimers.add(id);
    };
    t.on('loop', loopListener);
  }
  clickInfo = { offset, barStarts: opts.barStarts, countFrom: startBeat - countIn, count: countIn };
  metronomeBpb = opts.metronomeBeatsPerBar ?? opts.beatsPerBar ?? (countIn || 4);
  if (opts.metronomeBeatsPerBar) scheduleMetronome(opts.metronomeBeatsPerBar);
  if (countIn > 0) {
    // Count-in clicks only, on the beats before the music (each pass, when a loop counts in again).
    for (let b = 0; b < countIn - 1e-6; b++) t.schedule((time) => click(time, accented(startBeat - countIn + b)), beatTicks(startBeat + b));
  }
  // Playback starts with the count (if any) just before `startBeat`.
  t.ticks = Math.round(startBeat * ticksPerBeat());
  const startsAt = Tone.now() + 0.05;
  if (current) current.startsAt = startsAt;
  t.start(startsAt);
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
  stopBacking();
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
  if (loopListener) t.off('loop', loopListener);
  loopListener = null;
  for (const id of loopTimers) clearTimeout(id);
  loopTimers.clear();
  metronomeId = null;
  for (const v of scheduledVoices) v.stop(Tone.immediate());
  if (scheduledVoices.size) soundingFor(0);
  scheduledVoices.clear();
  stopBacking();
}

export function setTempo(bpm: number) {
  transport().bpm.value = bpm;
}

/** Where in the song (score beats) playback is right now, or null when it isn't playing. */
export function scoreBeatNow(): number | null {
  if (!current || transport().state !== 'started' || Tone.immediate() < current.startsAt) return null;
  return transportBeats() - current.offset;
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
    // (A note you asked to hear: yours, so it sounds with the tune off.)
    const v = createVoice(midis.length > 1 ? 0.7 : 1, 'you');
    v.start(m, now, glides[k]);
    v.stop(now + seconds);
  });
}
