// Editing by note (Notes mode): you choose the pitch, and the app chooses the hole for the
// harmonica — the easiest way, with the least hand movement from the notes around it.
// Notes the harp can't play are kept as note names (pitch tokens).

import { allOptions, soundPitch, type Harmonica, type ReedOption } from '../instruments';
import { keyScale, parsePitchClass } from '../pitch';
import type { HoleSound, Sound } from '../types';
import { allPositions, findItem, realBeat, type Pos, type Song } from './model';

export function pitchOf(harp: Harmonica, s: Sound): number | null {
  return s.type === 'pitch' ? s.midi : soundPitch(harp, s);
}

/** Every way to play a note on this harp, easiest first (then the lower hole). */
export function waysToPlay(harp: Harmonica, midi: number): ReedOption[] {
  return allOptions(harp)
    .filter((o) => o.midi === midi)
    .sort((a, b) => a.cost - b.cost || a.sound.hole - b.sound.hole || (a.sound.breath === 'blow' ? -1 : 1));
}

/** Whether a sound is a note this harp can't play (kept as a note name). */
export function offHarp(harp: Harmonica, s: Sound): boolean {
  return s.type === 'pitch' ? waysToPlay(harp, s.midi).length === 0 : soundPitch(harp, s) === null;
}

export interface Near {
  before?: HoleSound;
  after?: HoleSound;
}

/** The holes played just before and just after `pos` (which needn't hold a note yet). */
export function neighbours(song: Song, pos: Pos): Near {
  const at = realBeat(song, pos);
  let before: { t: number; s: HoleSound } | undefined;
  let after: { t: number; s: HoleSound } | undefined;
  for (const p of allPositions(song)) {
    const s = findItem(song, p)?.sounds.find((x): x is HoleSound => x.type === 'hole');
    if (!s) continue;
    const t = realBeat(song, p);
    if (t < at - 1e-6 && (!before || t >= before.t)) before = { t, s };
    if (t > at + 1e-6 && (!after || t < after.t)) after = { t, s };
  }
  return { before: before?.s, after: after?.s };
}

/** The hole for a note: easy to play and close to its neighbours. Off the harp: the note name. */
export function chooseSound(harp: Harmonica, midi: number, near: Near = {}): Sound {
  const ways = waysToPlay(harp, midi);
  if (!ways.length) return { type: 'pitch', midi };
  const dist = (o: ReedOption, n: HoleSound | undefined, w: number) => (n ? Math.abs(o.sound.hole - n.hole) * w : 0);
  let best = ways[0];
  let bestScore = Infinity;
  for (const o of ways) {
    const score = o.cost + dist(o, near.before, 0.4) + dist(o, near.after, 0.2);
    if (score < bestScore - 1e-9) {
      best = o;
      bestScore = score;
    }
  }
  return best.sound;
}

/** Holes for a chord's notes (low to high), each close to the one before. */
export function chooseSounds(harp: Harmonica, midis: number[], near: Near = {}): Sound[] {
  const out: Sound[] = [];
  let prev = near.before;
  for (const m of [...midis].sort((a, b) => a - b)) {
    const s = chooseSound(harp, m, { before: prev, after: out.length ? undefined : near.after });
    out.push(s);
    if (s.type === 'hole') prev = s;
  }
  return out;
}

/** Parses typed notes: "D5", "Bb4", "c#5", "C5 E5 G5" or "(C5 E5)". Null if any isn't a note. */
export function parseNotes(text: string): number[] | null {
  const tokens = text.replace(/[(),]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length || tokens.length > 8) return null;
  const out: number[] = [];
  for (const t of tokens) {
    const m = /^([A-Ga-g])([#b♯♭]?)(-?\d)$/.exec(t);
    if (!m) return null;
    const pc = parsePitchClass(m[1].toUpperCase() + (m[2] === '♯' ? '#' : m[2] === '♭' ? 'b' : m[2]));
    if (pc === null) return null;
    const midi = (parseInt(m[3], 10) + 1) * 12 + pc;
    if (midi < 12 || midi > 120) return null;
    out.push(midi);
  }
  return out;
}

/** The scale notes step through: the song's key, else the harp's key (major). */
export function stepScale(songKey: string | undefined, harp: Harmonica): number[] {
  return keyScale(songKey) ?? keyScale(harp.spec.key.replace(/^(Low|High)\s+/i, '')) ?? [0, 2, 4, 5, 7, 9, 11];
}

/**
 * Moves each note to the next note of the scale (or a semitone, `chromatic`) up or down,
 * and picks its hole. Null if a note has no pitch or would leave the musical range.
 */
export function stepNotes(harp: Harmonica, sounds: Sound[], dir: 1 | -1, chromatic: boolean, scale: number[], near: Near = {}): Sound[] | null {
  const targets: number[] = [];
  for (const s of sounds) {
    const m = pitchOf(harp, s);
    if (m === null) return null;
    let t = m + dir;
    if (!chromatic) while (!scale.includes(((t % 12) + 12) % 12)) t += dir;
    if (t < 24 || t > 108) return null;
    targets.push(t);
  }
  return chooseSounds(harp, targets, near);
}
