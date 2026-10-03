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

const silentIds = new Set<string>();
type PlayedListener = (midi: number, id: string) => void;
const playedListeners = new Set<PlayedListener>();

/** Subscribe to every note started live (keyboard, mouse, MIDI, microphone). */
export function onPlayed(fn: PlayedListener): () => void {
  playedListeners.add(fn);
  return () => playedListeners.delete(fn);
}

/**
 * Starts a sound. Returns false if the harmonica can't play it. `silent` shows and
 * records the note without synthesising it (the microphone: you're playing a real harp).
 */
export function press(id: string, sound: HoleSound, opts: { silent?: boolean } = {}): boolean {
  const midi = soundPitch(harp(), sound);
  if (midi === null) return false;
  if (opts.silent) silentIds.add(id);
  else {
    silentIds.delete(id);
    void engine.ensureAudio().then(() => {
      // Only start if still held (key may have been released while audio was starting).
      if (useApp.getState().held[id]) engine.noteOn(id, midi, sound.bend > 0 ? midi + sound.bend : undefined);
    });
  }
  setHeld(id, sound);
  recordPress(id, sound);
  for (const fn of playedListeners) fn(midi, id);
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
  if (!silentIds.has(id)) engine.setPitch(id, midi);
  setHeld(id, sound);
  recordUpdate(id, sound);
}

export function release(id: string) {
  if (!useApp.getState().held[id]) return;
  if (!silentIds.delete(id)) engine.noteOff(id);
  setHeld(id, null);
  recordRelease(id);
}

export function releaseAll() {
  for (const id of Object.keys(useApp.getState().held)) release(id);
}
