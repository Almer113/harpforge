// Chord symbols ("G7", "F#m7b5", "C/E") and finding playable harmonica chords.

import type { Harmonica } from './instruments';
import { mod12, parsePitchClass, pitchClassName } from './pitch';
import type { Breath, HoleSound } from './types';

export interface ChordInfo {
  symbol: string;
  root: number;
  /** Pitch classes, root first. */
  tones: number[];
  /** Semitone intervals from the root, in the same order as tones. */
  intervals: number[];
  bass?: number;
}

// Longest suffixes first so "maj7" wins over "m".
const QUALITIES: [string[], number[]][] = [
  [['maj13', 'M13', 'Δ13'], [0, 4, 7, 11, 14, 21]],
  [['maj9', 'M9', 'Δ9'], [0, 4, 7, 11, 14]],
  [['maj7', 'M7', 'Δ7', 'Δ', 'ma7'], [0, 4, 7, 11]],
  [['m7b5', 'min7b5', 'ø', 'ø7', '-7b5'], [0, 3, 6, 10]],
  [['dim7', '°7', 'o7'], [0, 3, 6, 9]],
  [['m(maj7)', 'mM7', 'mmaj7'], [0, 3, 7, 11]],
  [['m13', 'min13', '-13'], [0, 3, 7, 10, 14, 21]],
  [['m11', 'min11', '-11'], [0, 3, 7, 10, 14, 17]],
  [['m9', 'min9', '-9'], [0, 3, 7, 10, 14]],
  [['m7', 'min7', '-7', 'mi7'], [0, 3, 7, 10]],
  [['m6', 'min6', '-6'], [0, 3, 7, 9]],
  [['madd9', 'm(add9)'], [0, 3, 7, 14]],
  [['7sus4', '7sus'], [0, 5, 7, 10]],
  [['7#9'], [0, 4, 7, 10, 15]],
  [['7b9'], [0, 4, 7, 10, 13]],
  [['7#5', '7+5', 'aug7', '+7'], [0, 4, 8, 10]],
  [['7b5'], [0, 4, 6, 10]],
  [['13'], [0, 4, 7, 10, 14, 21]],
  [['11'], [0, 4, 7, 10, 14, 17]],
  [['9'], [0, 4, 7, 10, 14]],
  [['7'], [0, 4, 7, 10]],
  [['6/9', '69'], [0, 4, 7, 9, 14]],
  [['6'], [0, 4, 7, 9]],
  [['add9', 'add2', '(add9)'], [0, 4, 7, 14]],
  [['sus2'], [0, 2, 7]],
  [['sus4', 'sus'], [0, 5, 7]],
  [['dim', '°', 'o'], [0, 3, 6]],
  [['aug', '+', '#5'], [0, 4, 8]],
  [['min', 'mi', 'm', '-'], [0, 3, 7]],
  [['maj', 'M', ''], [0, 4, 7]],
  [['5'], [0, 7]],
];

export function parseChord(symbol: string): ChordInfo | null {
  const s = symbol.trim();
  const m = /^([A-G][#b♯♭]?)(.*?)(?:\/([A-G][#b♯♭]?))?$/.exec(s);
  if (!m) return null;
  const root = parsePitchClass(m[1].replace('♯', '#').replace('♭', 'b'));
  if (root === null) return null;
  const suffix = m[2].trim();
  let intervals: number[] | null = null;
  for (const [names, ivs] of QUALITIES) {
    if (names.includes(suffix)) {
      intervals = ivs;
      break;
    }
  }
  if (!intervals) {
    // Unknown extension ("maj7(#11)", "7sus4add9"): fall back on the triad implied by its
    // start — but only if it's made of chord vocabulary, so words like "Chorus" aren't chords.
    const vocabulary = suffix.replace(/maj|min|dim|aug|sus|add|alt|no|omit|[mM°øΔ+\-#b♯♭0-9()/,.]/g, '');
    if (vocabulary.length) return null;
    intervals = /^(m(?!aj)|min|-)/.test(suffix) ? [0, 3, 7] : [0, 4, 7];
  }
  const bass = m[3] ? parsePitchClass(m[3].replace('♯', '#').replace('♭', 'b')) ?? undefined : undefined;
  return { symbol: s, root, intervals, tones: intervals.map((i) => mod12(root + i)), bass };
}

/** Whether a word looks like a chord symbol (for chord-over-lyrics detection). */
export function isChordSymbol(word: string): boolean {
  const w = word.replace(/^\(|\)$/g, '');
  if (!/^[A-G]/.test(w)) return false;
  const m = /^([A-G][#b♯♭]?)(.*?)(?:\/([A-G][#b♯♭]?))?$/.exec(w);
  if (!m) return false;
  const suffix = m[2];
  if (QUALITIES.some(([names]) => names.includes(suffix))) return true;
  // Accept extensions like "maj7(#11)", "7(b9)", "sus4add9".
  return /^(maj|min|m|M|dim|aug|sus|add|\+|-|°|ø|Δ)?[0-9#b()+add susmajΔ°ø/]*$/.test(suffix) && suffix.length <= 10;
}

export interface HarmonicaChord {
  sounds: HoleSound[];
  /** 0..1, how much of the chord the voicing covers. */
  coverage: number;
  /** Whether it contains the root. */
  hasRoot: boolean;
  /** Lower is better. */
  cost: number;
}

/**
 * Finds the best way to play a chord: 2–4 neighbouring holes on one breath (no
 * bends) whose notes all belong to the chord, covering its most important tones.
 * Falls back to a single chord tone, preferring the root.
 */
export function findHarmonicaChord(harp: Harmonica, chord: ChordInfo): HarmonicaChord | null {
  const weight = (iv: number) => {
    const i = mod12(iv);
    if (i === 0) return 3; // root
    if (i === 3 || i === 4) return 2.2; // third
    if (i === 7) return 1; // fifth
    return 1.4; // sevenths and colours
  };
  const totalWeight = [...new Set(chord.intervals.map(mod12))].reduce((a, iv) => a + weight(iv), 0);
  const slides = harp.hasSlide ? [false, true] : [false];
  const mid = (harp.holes.length + 1) / 2;
  let best: HarmonicaChord | null = null;

  for (const breath of ['blow', 'draw'] as Breath[]) {
    for (const slide of slides) {
      const pcs = harp.holes.map((h) => mod12((breath === 'blow' ? h.blow : h.draw) + (slide ? 1 : 0)));
      for (let size = 4; size >= 2; size--) {
        for (let start = 0; start + size <= pcs.length; start++) {
          const window = pcs.slice(start, start + size);
          if (!window.every((pc) => chord.tones.includes(pc))) continue;
          const covered = new Set(window.map((pc) => mod12(pc - chord.root)));
          const got = [...covered].reduce((a, iv) => a + weight(iv), 0);
          const coverage = got / totalWeight;
          const hasRoot = covered.has(0);
          const center = start + 1 + (size - 1) / 2;
          const cost =
            (1 - coverage) * 10 +
            (hasRoot ? 0 : 1.5) +
            (chord.bass !== undefined && pcs[start] !== chord.bass ? 0.3 : 0) +
            Math.abs(center - mid) * 0.12 +
            (slide ? 0.4 : 0) +
            (size === 2 ? 0.6 : 0);
          if (!best || cost < best.cost) {
            best = {
              sounds: window.map((_, k) => ({ type: 'hole', hole: start + k + 1, breath, bend: 0, over: false, slide })),
              coverage,
              hasRoot,
              cost,
            };
          }
        }
      }
    }
  }
  if (best && best.coverage >= 0.5) return best;

  // Single note fallback: the root if available, otherwise any chord tone.
  const byImportance = [...chord.intervals].sort((a, b) => weight(b) - weight(a));
  for (const iv of byImportance) {
    const pc = mod12(chord.root + iv);
    let pick: HoleSound | null = null;
    let dist = Infinity;
    for (const h of harp.holes) {
      for (const breath of ['blow', 'draw'] as Breath[]) {
        for (const slide of slides) {
          const p = (breath === 'blow' ? h.blow : h.draw) + (slide ? 1 : 0);
          const d = Math.abs(h.hole - mid) + (slide ? 0.5 : 0);
          if (mod12(p) === pc && d < dist) {
            dist = d;
            pick = { type: 'hole', hole: h.hole, breath, bend: 0, over: false, slide };
          }
        }
      }
    }
    if (pick) {
      const covered = weight(iv) / totalWeight;
      return { sounds: [pick], coverage: covered, hasRoot: iv === 0, cost: 10 * (1 - covered) + 3 };
    }
  }
  return best;
}

/** A chord symbol moved by `semis` semitones: "G7" + 2 → "A7", "C/E" + 1 → "Db/F" (with flats). Unknown symbols are kept. */
export function transposeChord(symbol: string, semis: number, flats: boolean): string {
  if (!parseChord(symbol)) return symbol;
  const move = (name: string) => pitchClassName(mod12(parsePitchClass(name.replace('♯', '#').replace('♭', 'b'))! + semis), flats);
  return symbol.trim().replace(/^([A-G][#b♯♭]?)(.*?)(?:\/([A-G][#b♯♭]?))?$/, (_, root: string, rest: string, bass?: string) => move(root) + rest + (bass ? '/' + move(bass) : ''));
}
