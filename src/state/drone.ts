// The drone on its own: a held note of the song's key (or the harmonica's, or one you pick),
// with its fifth if wanted, sounding until it's switched off — to tune bends against, or to
// play over freely. (With a song playing, it can be the backing too: see playback.ts.)

import * as engine from '../audio/engine';
import { droneMidis } from '../core/backing';
import { guessTonic } from '../core/convert';
import { keySpelling, parsePitchClass, pitchClassName } from '../core/pitch';
import { getParsed, useApp, type AppState } from './store';

/** The drone's root (pitch class) for the song open now. */
export function droneTonic(s: Pick<AppState, 'text' | 'droneRoot'>): number {
  const { doc, harp } = getParsed(s.text);
  const harpPc = parsePitchClass(harp.spec.key.replace(/^(Low|High)\s+/i, '')) ?? 0;
  if (typeof s.droneRoot === 'number') return ((s.droneRoot % 12) + 12) % 12;
  if (s.droneRoot === 'harp') return harpPc;
  return guessTonic(doc, harp) ?? harpPc;
}

/** The drone's notes for the song open now. */
export function droneNotes(s: Pick<AppState, 'text' | 'droneRoot' | 'droneFifth'>): number[] {
  return droneMidis(droneTonic(s), s.droneFifth);
}

/** "G + D", the drone's notes named (in the song's spelling). */
export function droneName(s: Pick<AppState, 'text' | 'droneRoot' | 'droneFifth'>): string {
  const { doc, harp } = getParsed(s.text);
  const flats = keySpelling(doc.meta.key ?? harp.spec.key);
  const pc = droneTonic(s);
  const name = (p: number) => pitchClassName(p, flats);
  return s.droneFifth ? `${name(pc)} + ${name(pc + 7)}` : name(pc);
}

/** The drone on or off (from a click: the sound starts there). */
export function toggleDrone(on = !useApp.getState().droneOn) {
  if (on) void engine.ensureAudio();
  useApp.setState({ droneOn: on });
}

// The drone follows its settings, and the song (its key) while it sounds.
let sounding = '';
useApp.subscribe((s) => {
  const want = s.droneOn ? droneNotes(s).join(',') : '';
  if (want === sounding) return;
  sounding = want;
  engine.setDrone(want ? want.split(',').map(Number) : null);
});
