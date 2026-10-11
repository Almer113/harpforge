// The app's way to the audio engine. The engine (engineImpl.ts, with Tone.js and the
// voices) is about a third of the app's code, so it loads separately: in the background
// right after the page opens (preloadAudio), or at the first sound if that comes sooner.
// Until it's there, a note being held starts as soon as it arrives, playback and samples
// wait for it, and the status checks answer "silent".

import type { Score } from '../core/score';
import type { PlaybackOptions } from './engineImpl';
import type { MixLevels, SoundMode, Voicing } from './voices';

export type { PlaybackOptions } from './engineImpl';
export type { MixLevels, MixPart, SoundMode, Voicing } from './voices';

type Impl = typeof import('./engineImpl');

let impl: Impl | null = null;
let loading: Promise<Impl> | null = null;
// Settings made before the engine arrived, handed over when it does.
let soundMode: SoundMode | null = null;
let voicing: Voicing | null = null;
let mix: MixLevels | null = null;
let onLoadFailed: ((e: unknown) => void) | null = null;
const ignore = () => {};

/** Called when the engine can't be downloaded (offline, or the app was updated). */
export function setAudioLoadFailed(fn: (e: unknown) => void): void {
  onLoadFailed = fn;
}

/** Loads the engine; after a failed download the next call tries again. */
function load(quiet = false): Promise<Impl> {
  loading ??= import('./engineImpl').then(
    (m) => {
      impl = m;
      if (voicing) m.setVoicing(voicing);
      if (soundMode) m.setSoundMode(soundMode);
      if (mix) m.setMixLevels(mix);
      return m;
    },
    (e: unknown) => {
      loading = null;
      if (!quiet) onLoadFailed?.(e);
      throw e;
    },
  );
  return loading;
}

/** Fetches the engine in the background (so the first note or Play is instant). */
export function preloadAudio(): void {
  load(true).catch(ignore);
}

export async function ensureAudio(): Promise<void> {
  await (await load()).ensureAudio();
}

// ---- Live notes ---------------------------------------------------------------

// Notes pressed before the engine arrived: started when it does, if still held.
const waiting = new Map<string, { midi: number; glideFrom?: number }>();

export function noteOn(id: string, midi: number, glideFrom?: number) {
  if (impl) return impl.noteOn(id, midi, glideFrom);
  waiting.set(id, { midi, glideFrom });
  load()
    .then((m) => {
      const w = waiting.get(id);
      waiting.delete(id);
      if (w) m.noteOn(id, w.midi, w.glideFrom);
    })
    .catch(() => waiting.delete(id));
}

export function setPitch(id: string, midi: number) {
  if (impl) return impl.setPitch(id, midi);
  const w = waiting.get(id);
  if (w) w.midi = midi;
}

export function noteOff(id: string) {
  waiting.delete(id);
  impl?.noteOff(id);
}

export function appSounding(): boolean {
  return impl?.appSounding() ?? false;
}

/** Plays one event right away (clicking a tab card). */
export function previewMidis(midis: number[], seconds?: number, glides?: (number | undefined)[]) {
  if (impl) return impl.previewMidis(midis, seconds, glides);
  load()
    .then((m) => m.previewMidis(midis, seconds, glides))
    .catch(ignore);
}

// ---- Sound ----------------------------------------------------------------------

export function setVoicing(v: Voicing) {
  voicing = v;
  impl?.setVoicing(v);
}

export function setSoundMode(m: SoundMode) {
  soundMode = m;
  impl?.setSoundMode(m);
}

/** The master volume and each part's level (0 for a part that's off). */
export function setMix(levels: MixLevels) {
  mix = levels;
  impl?.setMixLevels(levels);
}

/** The drone on its own: these notes held from now (null: it fades). Starts the engine if need be. */
let drone: number[] | null = null;
export function setDrone(midis: number[] | null) {
  drone = midis;
  if (impl) return impl.setOwnDrone(midis);
  if (!midis) return;
  // (What's wanted once the engine is there: it may have been switched off meanwhile.)
  load()
    .then((m) => m.setOwnDrone(drone))
    .catch(ignore);
}

/** Leaves the tune out from now (or brings it back), while playing too. */
export function setTuneOff(off: boolean) {
  impl?.setTuneOff(off);
}

export async function loadSamples(): Promise<boolean> {
  try {
    return await (await load()).loadSamples();
  } catch {
    return false;
  }
}

export function samplesReady(): boolean {
  return impl?.samplesReady() ?? false;
}

// ---- Playback ---------------------------------------------------------------------
// (Playback always starts after ensureAudio, so the engine is there by then.)

export function playScore(score: Score | null, opts: PlaybackOptions) {
  if (impl) return impl.playScore(score, opts);
  load()
    .then((m) => m.playScore(score, opts))
    .catch(ignore);
}

export function pausePlayback() {
  impl?.pausePlayback();
}

export function resumePlayback() {
  impl?.resumePlayback();
}

export function stopPlayback() {
  impl?.stopPlayback();
}

export function setTempo(bpm: number) {
  impl?.setTempo(bpm);
}

export function setLoop(on: boolean) {
  impl?.setLoop(on);
}

export function setMetronome(beatsPerBar: number | null) {
  impl?.setMetronome(beatsPerBar);
}

/** Where in the song (score beats) playback is right now, or null when it isn't playing. */
export function scoreBeatNow(): number | null {
  return impl?.scoreBeatNow() ?? null;
}

/** Transport position in beats right now. */
export function transportBeats(): number {
  return impl?.transportBeats() ?? 0;
}
