// Live playing from mouse/keyboard: sounds, visual "held" state, and recording.

import * as engine from '../audio/engine';
import { soundPitch } from '../core/instruments';
import type { HoleSound } from '../core/types';
import { getParsed, useApp } from '../state/store';
import { recordPress, recordRelease, recordUpdate } from './recorder';

function harp() {
  return getParsed(useApp.getState().text).harp;
}

function setHeld(id: string, sound: HoleSound | null) {
  useApp.setState((s) => {
    const held = { ...s.held };
    if (sound) held[id] = sound;
    else delete held[id];
    return { held };
  });
}

/** Starts a sound. Returns false if the harmonica can't play it. */
export function press(id: string, sound: HoleSound): boolean {
  const midi = soundPitch(harp(), sound);
  if (midi === null) return false;
  void engine.ensureAudio().then(() => {
    // Only start if still held (key may have been released while audio was starting).
    if (useApp.getState().held[id]) engine.noteOn(id, midi, sound.bend > 0 ? midi + sound.bend : undefined);
  });
  setHeld(id, sound);
  recordPress(id, sound);
  return true;
}

/**
 * Changes a held sound (bend, slide). `pitch` may be fractional for smooth mouse
 * bends; otherwise it's derived from the sound.
 */
export function change(id: string, sound: HoleSound, pitch?: number) {
  if (!useApp.getState().held[id]) return;
  const midi = pitch ?? soundPitch(harp(), sound);
  if (midi === null) return;
  engine.setPitch(id, midi);
  setHeld(id, sound);
  recordUpdate(id, sound);
}

export function release(id: string) {
  if (!useApp.getState().held[id]) return;
  engine.noteOff(id);
  setHeld(id, null);
  recordRelease(id);
}

export function releaseAll() {
  for (const id of Object.keys(useApp.getState().held)) release(id);
}
