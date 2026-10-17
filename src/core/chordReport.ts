// Phase 19a: what each chord of a chord sheet becomes on a harmonica — the holes it's played
// on, the notes they give, and the chord's notes left out, named by what they are to it
// ("no A (the root)"). Only a missing root or 3rd is a real loss: a missing 5th, 6th or 7th is
// mild, and colour notes (9ths, 11ths, 13ths) aren't counted (four holes can't hold them).

import { findHarmonicaChord, isNoChord, parseChord, type ChordInfo } from './chords';
import type { TabDoc } from './htab/types';
import { soundPitch, type Harmonica } from './instruments';
import { keySpelling, mod12, pitchClassName, type Spelling } from './pitch';
import type { HoleSound } from './types';

/** From worst to best: no way to play it, not a chord symbol the app knows, missing its root or 3rd, missing a 5th/6th/7th, all of it. */
export type ChordLevel = 'none' | 'unknown' | 'thin' | 'mild' | 'full';
const ORDER: ChordLevel[] = ['none', 'unknown', 'thin', 'mild', 'full'];

export interface MissingTone {
  /** Its interval from the root (as the chord spells it). */
  iv: number;
  pc: number;
  /** Its name, spelled from the chord ("G#" in E7). */
  name: string;
  /** "the root", "the 3rd", "the 7th"… */
  role: string;
  /** The root or the 3rd: the chord isn't itself without it. */
  strong: boolean;
}

export interface ChordLine {
  symbol: string;
  /** How many times it's played in the song. */
  count: number;
  info: ChordInfo | null;
  /** The holes it's played on ([] when it can't be). */
  sounds: HoleSound[];
  /** Their notes' names, in the order played ("C E"). */
  notes: string[];
  missing: MissingTone[];
  level: ChordLevel;
}

/** What a tone is to its chord, by its interval from the root. */
export function roleOf(iv: number, intervals: number[]): string {
  switch (iv) {
    case 0:
      return 'the root';
    case 3:
    case 4:
      return 'the 3rd';
    case 6:
    case 7:
    case 8:
      return 'the 5th';
    case 10:
    case 11:
      return 'the 7th';
    case 9:
      // (In a diminished 7th it's the 7th, otherwise the 6th.)
      return intervals.includes(6) ? 'the 7th' : 'the 6th';
    case 2:
      return 'the 2nd';
    case 5:
      return 'the 4th';
    case 1:
      return 'the ♭9th';
    default:
      return `the ${iv}th`;
  }
}

const LETTERS = 'CDEFGAB';
const NATURAL = [0, 2, 4, 5, 7, 9, 11];
/** How many letters up from the root a tone is, by its interval (a 3rd is two letters up). */
const STEPS: Record<number, number> = { 0: 0, 1: 1, 2: 1, 3: 2, 4: 2, 5: 3, 6: 4, 7: 4, 8: 4, 9: 5, 10: 6, 11: 6 };

/**
 * A chord tone's name, spelled from the chord (the 3rd of E is G#, not Ab; the 7th of F is
 * Eb, not D#). `intervals`: the chord's (a diminished 7th's 9 is a 7th: Bbb… named simply).
 */
export function toneName(symbol: string, iv: number, intervals: number[]): string {
  const m = /^([A-G])([#b♯♭]?)/.exec(symbol.trim());
  const root = m ? LETTERS.indexOf(m[1]) : -1;
  if (root < 0 || iv > 12) return pitchClassName(iv);
  const rootPc = mod12(NATURAL[root] + (m![2] === '#' || m![2] === '♯' ? 1 : m![2] ? -1 : 0));
  const steps = iv === 9 && intervals.includes(6) ? 6 : STEPS[mod12(iv)];
  const letter = (root + steps) % 7;
  const diff = mod12(rootPc + iv - NATURAL[letter]);
  const accidental = diff === 0 ? '' : diff === 1 ? '#' : diff === 11 ? 'b' : diff === 2 ? '##' : diff === 10 ? 'bb' : null;
  // (Past a double sharp or flat: its plain name.)
  return accidental === null ? pitchClassName(rootPc + iv) : LETTERS[letter] + accidental;
}

/** The chord's notes `sounds` leave out (colour notes past the octave aren't counted). */
export function missingTones(harp: Harmonica, info: ChordInfo, sounds: HoleSound[]): MissingTone[] {
  const have = new Set(sounds.map((s) => soundPitch(harp, s)).filter((m): m is number => m !== null).map(mod12));
  const out: MissingTone[] = [];
  for (const iv of info.intervals) {
    if (iv > 12) continue;
    const pc = mod12(info.root + iv);
    if (have.has(pc) || out.some((m) => m.pc === pc)) continue;
    out.push({ iv, pc, name: toneName(info.symbol, iv, info.intervals), role: roleOf(iv, info.intervals), strong: iv === 0 || iv === 3 || iv === 4 });
  }
  return out;
}

export function levelOf(sounds: HoleSound[] | null, info: ChordInfo | null, missing: MissingTone[]): ChordLevel {
  if (!info) return 'unknown';
  if (!sounds?.length) return 'none';
  if (missing.some((m) => m.strong)) return 'thin';
  return missing.length ? 'mild' : 'full';
}

/** How the song's chords are named (flats in a flat key, or if the symbols use them). */
export function chordSpelling(doc: TabDoc): Spelling {
  if (doc.meta.key) return keySpelling(doc.meta.key);
  return doc.lines.some((l) => l.events.some((e) => e.kind !== 'bar' && /^[A-G]b/.test(e.chord ?? '')));
}

/**
 * Each chord symbol of a chord sheet as `harp` plays it, the worst first (then in the order
 * they first come). `voicings`: chords to play another way (a substitute picked).
 */
export function chordReport(doc: TabDoc, harp: Harmonica, voicings: Record<string, HoleSound[]> = {}): ChordLine[] {
  const flats = chordSpelling(doc);
  const lines = new Map<string, ChordLine>();
  for (const l of doc.lines)
    for (const e of l.events) {
      if (e.kind !== 'rest' || !e.chord || e.beats <= 0 || isNoChord(e.chord)) continue;
      const known = lines.get(e.chord);
      if (known) {
        known.count++;
        continue;
      }
      const info = parseChord(e.chord);
      const sounds = voicings[e.chord] ?? (info ? findHarmonicaChord(harp, info)?.sounds ?? [] : []);
      const missing = info && sounds.length ? missingTones(harp, info, sounds) : [];
      lines.set(e.chord, {
        symbol: e.chord,
        count: 1,
        info,
        sounds,
        notes: sounds
          .map((s) => soundPitch(harp, s))
          .filter((m): m is number => m !== null)
          .map((m) => {
            // (A chord tone spelled from the chord; another note as the song spells it.)
            const iv = info?.intervals.find((x) => x <= 12 && mod12(info.root + x) === mod12(m));
            return info && iv !== undefined ? toneName(info.symbol, iv, info.intervals) : pitchClassName(m, flats);
          }),
        missing,
        level: levelOf(sounds, info, missing),
      });
    }
  const all = [...lines.values()];
  return all.sort((a, b) => ORDER.indexOf(a.level) - ORDER.indexOf(b.level) || all.indexOf(a) - all.indexOf(b));
}

/** "no A (the root)", "no F (the 7th)", "no A (the root) or C (the 3rd)". */
export function missingText(missing: MissingTone[]): string {
  if (!missing.length) return 'all of it';
  return `no ${missing.map((m) => `${m.name} (${m.role})`).join(missing.length === 2 ? ' or ' : ', ')}`;
}

// ---- Phase 19b: fully playable chords to pick instead --------------------------------------

/** The chord types a group of holes is named as (the common ones; a group that's none of them isn't offered). */
const FULL_TYPES: { suffix: string; ivs: number[] }[] = [
  { suffix: '', ivs: [0, 4, 7] },
  { suffix: 'm', ivs: [0, 3, 7] },
  { suffix: '7', ivs: [0, 4, 7, 10] },
  { suffix: 'm7', ivs: [0, 3, 7, 10] },
  { suffix: 'maj7', ivs: [0, 4, 7, 11] },
  { suffix: '6', ivs: [0, 4, 7, 9] },
  { suffix: 'm7b5', ivs: [0, 3, 6, 10] },
  { suffix: 'dim', ivs: [0, 3, 6] },
  { suffix: 'aug', ivs: [0, 4, 8] },
  { suffix: 'sus4', ivs: [0, 5, 7] },
  { suffix: 'sus2', ivs: [0, 2, 7] },
];

export interface FullChord {
  symbol: string;
  info: ChordInfo;
  sounds: HoleSound[];
}

/**
 * Every chord `harp` plays in full: 3 or 4 neighbouring holes on one breath (no bends), all of
 * whose notes make one chord and nothing else — named, each once (the voicing nearest the
 * middle of the harmonica). `flats`: how to name their roots.
 */
export function fullChords(harp: Harmonica, flats: Spelling = false): FullChord[] {
  const mid = (harp.holes.length + 1) / 2;
  const best = new Map<string, { chord: FullChord; cost: number }>();
  const slides = harp.hasSlide ? [false, true] : [false];
  for (const breath of ['blow', 'draw'] as const)
    for (const slide of slides)
      for (let size = 3; size <= 4; size++)
        for (let start = 0; start + size <= harp.holes.length; start++) {
          const sounds: HoleSound[] = harp.holes.slice(start, start + size).map((h) => ({ type: 'hole', hole: h.hole, breath, bend: 0, over: false, slide }));
          const pcs = new Set(sounds.map((s) => soundPitch(harp, s)).filter((m): m is number => m !== null).map(mod12));
          for (const root of pcs)
            for (const t of FULL_TYPES) {
              const tones = t.ivs.map((iv) => mod12(root + iv));
              if (tones.length !== pcs.size || !tones.every((pc) => pcs.has(pc))) continue;
              const symbol = pitchClassName(root, flats) + t.suffix;
              const info = parseChord(symbol);
              if (!info) continue;
              // (Nearer the middle, with the root at the bottom, without the slide: the one kept.)
              const low = soundPitch(harp, sounds[0]);
              const cost = Math.abs(start + 1 + (size - 1) / 2 - mid) * 0.15 + (low !== null && mod12(low) === root ? 0 : 0.4) + (slide ? 0.5 : 0) + (size === 4 ? 0 : 0.1);
              const had = best.get(symbol);
              if (!had || cost < had.cost) best.set(symbol, { chord: { symbol, info, sounds }, cost });
            }
        }
  return [...best.values()].map((b) => b.chord);
}

export interface Substitute extends FullChord {
  /** Why it stands in: "has Am's C and E (its relative major)". */
  reason: string;
  score: number;
}

const WEIGHT = (iv: number) => (iv === 0 ? 3 : iv === 3 || iv === 4 ? 2.2 : iv === 10 || iv === 11 ? 1.4 : 1);

/**
 * Chords `harp` plays in full that can stand in for `chord`, the best first (at most `limit`):
 * sharing its notes (the root and the 3rd most), related to it (the same root, its relative
 * major or minor), adding little of their own.
 */
export function substitutes(harp: Harmonica, chord: ChordInfo, flats: Spelling = false, limit = 3): Substitute[] {
  const own = chord.intervals.filter((iv) => iv <= 12);
  const ownPcs = new Map(own.map((iv) => [mod12(chord.root + iv), iv]));
  const minor = own.includes(3) && !own.includes(4);
  const out: Substitute[] = [];
  for (const c of fullChords(harp, flats)) {
    const pcs = c.info.tones;
    // (Not the chord itself, as written or spelled another way.)
    if (pcs.length === ownPcs.size && pcs.every((pc) => ownPcs.has(pc))) continue;
    const shared = pcs.filter((pc) => ownPcs.has(pc));
    const sharedIvs = shared.map((pc) => ownPcs.get(pc)!);
    const extra = pcs.filter((pc) => !ownPcs.has(pc));
    // It has to keep the chord's root or 3rd, and two of its notes.
    if (shared.length < 2 || !sharedIvs.some((iv) => iv === 0 || iv === 3 || iv === 4)) continue;
    const sameRoot = c.info.root === chord.root;
    const cMinor = c.info.intervals.includes(3) && !c.info.intervals.includes(4);
    const relative = (minor && !cMinor && c.info.root === mod12(chord.root + 3)) || (!minor && cMinor && c.info.root === mod12(chord.root - 3));
    // A note it adds that grates against the chord: a semitone above one of its notes (a ♭9
    // over the root), or next to its 3rd (major against minor). A semitone below the root —
    // a major 7th — sits well.
    const thirds = own.filter((iv) => iv === 3 || iv === 4).map((iv) => mod12(chord.root + iv));
    const clashes = extra.filter((pc) => ownPcs.has(mod12(pc - 1)) || thirds.some((t) => mod12(pc - t) === 11)).length;
    // (And the tritone over the root, unless the chord has it: a different colour altogether.)
    const tritone = extra.includes(mod12(chord.root + 6)) ? 1.5 : 0;
    const score = sharedIvs.reduce((a, iv) => a + WEIGHT(iv), 0) + (sameRoot ? 2 : 0) + (relative ? 1.5 : 0) - extra.length * 0.8 - clashes * 3 - tritone;
    // (Too little in common, or too much against it, to stand in.)
    if (score < 2.2) continue;
    const names = sharedIvs.sort((a, b) => a - b).map((iv) => toneName(chord.symbol, iv, chord.intervals));
    const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
    const why = sameRoot
      ? c.info.intervals.length < own.length
        ? ' (the same chord, simpler)'
        : ' (the same root)'
      : relative
        ? ` (its relative ${minor ? 'major' : 'minor'})`
        : '';
    const adds = extra.length ? `; adds ${extra.map((pc) => pitchClassName(pc, flats)).join(' ')}` : '';
    out.push({ ...c, score, reason: `has ${chord.symbol}’s ${list}${why}${adds}` });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}
