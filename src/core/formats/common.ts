// Shared helpers for import/export formats.

import { soundPitch, type Harmonica } from '../instruments';
import { mod12 } from '../pitch';
import type { NoteEvent, TabDoc, TabMeta } from '../htab/types';
import { defaultMeta } from '../htab/types';

/** Result of importing any format: an instrument-neutral document (pitches or chord-sheet rests). */
export interface Imported {
  doc: TabDoc;
  warnings: string[];
  format: string;
  /** The parts the file holds (tunes, voices, tracks…), when there's a choice. */
  parts?: PartChoice[];
  /** The part imported. */
  part?: string;
  /** Imports another of `parts`. */
  choosePart?: (id: string) => Imported;
}

/** A part of a file the import can take instead (a tune, a voice, a track…). */
export interface PartChoice {
  id: string;
  label: string;
}

/**
 * How much a part looks like the melody: named so ("melody", "voice", "harmonica"…), then
 * one note at a time, then high (the tune is usually on top).
 */
export function melodyScore(doc: TabDoc, name = ''): number {
  const notes = doc.lines.flatMap((l) => l.events).filter((e): e is NoteEvent => e.kind === 'note' && !e.tied);
  if (!notes.length) return -Infinity;
  const pitches = notes.flatMap((e) => eventMidis(e));
  const single = notes.filter((e) => e.sounds.length === 1).length / notes.length;
  const avg = pitches.reduce((a, m) => a + m, 0) / Math.max(1, pitches.length);
  const named = /harmonica|harp|melod|lead|vocal|voice|solo|tune|sopran|singer|lyric/i.test(name) ? 1000 : /bass|accomp|drum|perc|chord|rhythm|pad/i.test(name) ? -500 : 0;
  const sung = notes.some((e) => e.lyric) ? 200 : 0;
  return named + sung + single * 100 + avg / 10 + Math.min(notes.length, 50) / 10;
}

/** The warning when a part was picked from several: which one, and that there are others. */
export function partWarning(label: string, count: number): string {
  return `Imported “${label}” as the melody (${count} parts: pick another under Part).`;
}

export function notesMeta(partial: Partial<TabMeta> = {}): TabMeta {
  const meta = { ...defaultMeta(), ...partial, extra: { ...partial.extra } };
  meta.tuning = undefined;
  meta.harpKey = undefined;
  return meta;
}

/** MIDI pitches of a note event (hole sounds resolved on the harmonica). */
export function eventMidis(e: NoteEvent, harp?: Harmonica): number[] {
  const out: number[] = [];
  for (const s of e.sounds) {
    const m = s.type === 'pitch' ? s.midi : harp ? soundPitch(harp, s) : null;
    if (m !== null) out.push(m);
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

// ---- Key signatures -------------------------------------------------------------

const LETTER_FIFTHS: Record<string, number> = { F: -1, C: 0, G: 1, D: 2, A: 3, E: 4, B: 5 };
const MODE_SHIFT: Record<string, number> = {
  maj: 0, ion: 0, '': 0, mix: -1, dor: -2, min: -3, m: -3, aeo: -3, phr: -4, loc: -5, lyd: 1,
};

/**
 * Number of sharps (+) or flats (−) for a key like "G", "Bbm", "D dorian", "F#min".
 * Returns null for unknown keys.
 */
export function keyFifths(key: string | undefined): number | null {
  if (!key) return null;
  // "Low F" and "High G" harps have the key signature of F and G.
  const m = /^\s*(?:(?:Low|High)\s+)?([A-G])([#b♯♭]?)\s*([A-Za-z]*)/i.exec(key);
  if (!m) return null;
  let f = LETTER_FIFTHS[m[1]];
  if (m[2] === '#' || m[2] === '♯') f += 7;
  if (m[2] === 'b' || m[2] === '♭') f -= 7;
  const mode = m[3].toLowerCase();
  const shift = MODE_SHIFT[mode] ?? MODE_SHIFT[mode.slice(0, 3)] ?? (mode.startsWith('m') ? -3 : 0);
  const total = f + shift;
  return total >= -7 && total <= 7 ? total : null;
}

const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

/** Accidental (in semitones) the key signature gives each letter. */
export function keySignature(fifths: number): Record<string, number> {
  const sig: Record<string, number> = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
  if (fifths > 0) SHARP_ORDER.slice(0, fifths).forEach((l) => (sig[l] = 1));
  if (fifths < 0) FLAT_ORDER.slice(0, -fifths).forEach((l) => (sig[l] = -1));
  return sig;
}

export const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

/** Spells a MIDI pitch as letter + accidental + octave, preferring the key's direction. */
export function spell(midi: number, fifths: number): { letter: string; alter: number; octave: number } {
  const pc = mod12(midi);
  const sig = keySignature(fifths);
  // In-key spelling first.
  for (const letter of LETTERS) {
    if (mod12(LETTER_PC[letter] + sig[letter]) === pc) {
      const alter = sig[letter];
      return { letter, alter, octave: Math.floor((midi - LETTER_PC[letter] - alter) / 12) - 1 };
    }
  }
  // Otherwise a natural, or a sharp/flat following the key's direction.
  for (const letter of LETTERS) {
    if (LETTER_PC[letter] === pc) return { letter, alter: 0, octave: Math.floor(midi / 12) - 1 };
  }
  const useFlat = fifths < 0;
  for (const letter of LETTERS) {
    const alter = useFlat ? -1 : 1;
    if (mod12(LETTER_PC[letter] + alter) === pc) {
      return { letter, alter, octave: Math.floor((midi - LETTER_PC[letter] - alter) / 12) - 1 };
    }
  }
  return { letter: 'C', alter: 0, octave: 4 };
}

export function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** Best rational approximation n/d of x with d from `dens`. */
export function toFraction(x: number, dens = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48]): [number, number] {
  for (const d of dens) {
    const n = Math.round(x * d);
    if (Math.abs(n / d - x) < 1e-6) {
      const g = gcd(n, d) || 1;
      return [n / g, d / g];
    }
  }
  const d = dens[dens.length - 1];
  const n = Math.max(1, Math.round(x * d));
  const g = gcd(n, d) || 1;
  return [n / g, d / g];
}

export function slugify(title: string): string {
  // Keep letters and digits of any script (a Chinese title stays Chinese); drop accents from
  // Latin letters only (Japanese dakuten are part of the letter) and punctuation.
  return title.toLowerCase().normalize('NFKD').replace(/(\p{Script=Latin})\p{M}+/gu, '$1').normalize('NFC').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'tab';
}
