// The app's way to the audio engine. The engine (engineImpl.ts, with Tone.js and the
// voices) is about a third of the app's code, so it loads separately: in the background
// right after the page opens (preloadAudio), or at the first sound if that comes sooner.
// Until it's there, a note being held starts as soon as it arrives, playback and samples
// wait for it, and the status checks answer "silent".

import type { Score } from '../core/score';
import type { PlaybackOptions } from './engineImpl';
import type { SoundMode, Voicing } from './voices';

export type { PlaybackOptions } from './engineImpl';
export type { SoundMode, Voicing } from './voices';

type Impl = typeof import('./engineImpl');

let impl: Impl | null = null;
let loading: Promise<Impl> | null = null;
// Settings made before the engine arrived, handed over when it does.
let soundMode: SoundMode | null = null;
let voicing: Voicing | null = null;

function load(): Promise<Impl> {
  loading ??= import('./engineImpl').then((m) => {
    impl = m;
    if (voicing) m.setVoicing(voicing);
    if (soundMode) m.setSoundMode(soundMode);
    return m;
  });
  return loading;
}

/** Fetches the engine in the background (so the first note or Play is instant). */
export function preloadAudio(): void {
  void load();
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
  void load().then((m) => {
    const w = waiting.get(id);
    waiting.delete(id);
    if (w) m.noteOn(id, w.midi, w.glideFrom);
  });
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
  void load().then((m) => m.previewMidis(midis, seconds, glides));
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

export async function loadSamples(): Promise<boolean> {
  return (await load()).loadSamples();
}

export function samplesReady(): boolean {
  return impl?.samplesReady() ?? false;
}

// ---- Playback ---------------------------------------------------------------------
// (Playback always starts after ensureAudio, so the engine is there by then.)

export function playScore(score: Score | null, opts: PlaybackOptions) {
  if (impl) return impl.playScore(score, opts);
  void load().then((m) => m.playScore(score, opts));
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

/** Transport position in beats right now. */
export function transportBeats(): number {
  return impl?.transportBeats() ?? 0;
}
