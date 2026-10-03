// Harmonica definitions. Every harmonica is plain data: a list of holes with the
// blow and draw pitch of each, plus which techniques the family supports.
// Adding a tuning or a family means adding data here, not new logic.

import { midiToName, parseNoteName, parsePitchClass } from '../pitch';
import type { Breath, HoleSound } from '../types';

export type Family = 'diatonic' | 'chromatic' | 'tremolo' | 'octave';

/** How many reeds sound per note, and how they're tuned against each other. */
export type Voicing = 'single' | 'tremolo' | 'octave';

export interface HoleDef {
  hole: number;
  blow: number;
  draw: number;
}

export interface HarmonicaSpec {
  family: Family;
  tuning: string;
  key: string;
}

export interface Harmonica {
  spec: HarmonicaSpec;
  name: string;
  holes: HoleDef[];
  hasSlide: boolean;
  bendable: boolean;
  overblows: boolean;
  voicing: Voicing;
}

interface TuningDef {
  id: string;
  name: string;
  family: Family;
  /** Semitone offsets from the key's base pitch. */
  blow: number[];
  draw: number[];
  /** Octave shift of hole 1 relative to the key's base pitch (chromatic sizes). */
  octaveShift?: number;
}

// ---- Diatonic -----------------------------------------------------------

const RICHTER_BLOW = [0, 4, 7, 12, 16, 19, 24, 28, 31, 36];
const RICHTER_DRAW = [2, 7, 11, 14, 17, 21, 23, 26, 29, 33];

function withChanges(arr: number[], changes: Record<number, number>): number[] {
  return arr.map((v, i) => (changes[i + 1] !== undefined ? changes[i + 1] : v));
}

const DIATONIC_TUNINGS: TuningDef[] = [
  { id: 'richter', name: 'Richter (standard)', family: 'diatonic', blow: RICHTER_BLOW, draw: RICHTER_DRAW },
  {
    id: 'paddy-richter', name: 'Paddy Richter', family: 'diatonic',
    blow: withChanges(RICHTER_BLOW, { 3: 9 }), draw: RICHTER_DRAW,
  },
  {
    id: 'country', name: 'Country', family: 'diatonic',
    blow: RICHTER_BLOW, draw: withChanges(RICHTER_DRAW, { 5: 18 }),
  },
  {
    id: 'melody-maker', name: 'Melody Maker', family: 'diatonic',
    blow: withChanges(RICHTER_BLOW, { 3: 9 }), draw: withChanges(RICHTER_DRAW, { 5: 18, 9: 30 }),
  },
  {
    id: 'harmonic-minor', name: 'Harmonic Minor', family: 'diatonic',
    blow: withChanges(RICHTER_BLOW, { 2: 3, 5: 15, 8: 27 }), draw: withChanges(RICHTER_DRAW, { 6: 20, 10: 32 }),
  },
];

/** Diatonic keys with the MIDI pitch of hole 1 blow. */
const DIATONIC_KEYS: { key: string; base: number }[] = [
  { key: 'Low C', base: 48 },
  { key: 'Low D', base: 50 },
  { key: 'Low Eb', base: 51 },
  { key: 'Low E', base: 52 },
  { key: 'Low F', base: 53 },
  { key: 'Low F#', base: 54 },
  { key: 'G', base: 55 },
  { key: 'Ab', base: 56 },
  { key: 'A', base: 57 },
  { key: 'Bb', base: 58 },
  { key: 'B', base: 59 },
  { key: 'C', base: 60 },
  { key: 'Db', base: 61 },
  { key: 'D', base: 62 },
  { key: 'Eb', base: 63 },
  { key: 'E', base: 64 },
  { key: 'F', base: 65 },
  { key: 'F#', base: 66 },
  { key: 'High G', base: 67 },
];

// ---- Chromatic (solo tuning) -------------------------------------------

function soloTuning(holes: number): { blow: number[]; draw: number[] } {
  const blowBlock = [0, 4, 7, 12];
  const drawBlock = [2, 5, 9, 11];
  const blow: number[] = [];
  const draw: number[] = [];
  for (let i = 0; i < holes; i++) {
    const oct = Math.floor(i / 4) * 12;
    blow.push(blowBlock[i % 4] + oct);
    draw.push(drawBlock[i % 4] + oct);
  }
  return { blow, draw };
}

const CHROMATIC_TUNINGS: TuningDef[] = [
  { id: 'solo-12', name: '12-hole solo', family: 'chromatic', ...soloTuning(12) },
  { id: 'solo-10', name: '10-hole solo', family: 'chromatic', ...soloTuning(10) },
  { id: 'solo-14', name: '14-hole solo (from G)', family: 'chromatic', ...shiftedSolo14() },
  { id: 'solo-16', name: '16-hole solo', family: 'chromatic', ...soloTuning(16), octaveShift: -1 },
];

/** 14-hole chromatics start a fourth below middle C: one block lower, starting at G. */
function shiftedSolo14(): { blow: number[]; draw: number[] } {
  const full = soloTuning(16);
  // Drop the first 2 holes of a 16-hole that starts an octave lower → starts at G3.
  return { blow: full.blow.slice(2).map((v) => v - 12), draw: full.draw.slice(2).map((v) => v - 12) };
}

const CHROMATIC_KEYS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

// ---- Tremolo & octave (Wiener system) -----------------------------------
//
// Hole numbers follow Hohner's charts: each number is a blow/draw pair of the
// physical double holes, so tabs read like diatonic tabs. Layouts are written in
// the key of C as note names and stored as offsets from C4.
// Sources: Hohner tuning chart (2025), Wikipedia "Tremolo harmonica".

function layout(blow: string, draw: string): { blow: number[]; draw: number[] } {
  const parse = (row: string) => row.split(/\s+/).map((n) => parseNoteName(n)! - 60);
  return { blow: parse(blow), draw: parse(draw) };
}

const TREMOLO_TUNINGS: TuningDef[] = [
  {
    id: 'asian-24', name: 'Asian 24 (Ocean Star)', family: 'tremolo',
    ...layout('G3 C4 E4 G4 C5 E5 G5 C6 E6 G6 C7 E7', 'D4 F4 A4 B4 D5 F5 A5 B5 D6 F6 A6 B6'),
  },
  {
    id: 'scale-24', name: 'Scale-tuned 24', family: 'tremolo',
    ...layout('C4 E4 G4 C5 C5 E5 G5 C6 C6 E6 G6 C7', 'D4 F4 A4 B4 D5 F5 A5 B5 D6 F6 A6 B6'),
  },
  {
    id: 'echo-24', name: 'Echo 48 / Big Valley', family: 'tremolo',
    ...layout('E3 G3 C4 E4 G4 C5 E5 G5 C6 E6 G6 C7', 'G3 B3 D4 F4 A4 B4 D5 F5 A5 B5 D6 F6'),
  },
  {
    id: 'richter-20', name: 'Golden Melody (Richter 20)', family: 'tremolo',
    ...layout('C4 E4 G4 C5 E5 G5 C6 E6 G6 C7', 'D4 G4 B4 D5 F5 A5 B5 D6 F6 A6'),
  },
  {
    id: 'echo-16', name: 'Echo 32', family: 'tremolo',
    ...layout('E4 G4 C5 E5 G5 C6 E6 G6', 'G4 B4 D5 F5 A5 B5 D6 F6'),
  },
];

// Octave harmonicas: the listed pitch is the main reed; a second reed sounds an octave lower.
const OCTAVE_TUNINGS: TuningDef[] = [
  {
    id: 'lieblinge-24', name: 'Unsere Lieblinge 48', family: 'octave',
    ...layout('C4 E4 G4 C5 E5 G5 C6 E6 G6 C7 E7 G7', 'D4 G4 B4 D5 F5 A5 B5 D6 F6 A6 B6 D7'),
  },
  {
    id: 'comet-20', name: 'Comet 40', family: 'octave',
    ...layout('E4 G4 C5 E5 G5 C6 E6 G6 C7 E7', 'G4 B4 D5 F5 A5 B5 D6 F6 A6 B6'),
  },
  {
    id: 'lieblinge-16', name: 'Unsere Lieblinge 32', family: 'octave',
    ...layout('E4 G4 C5 E5 G5 C6 E6 G6', 'G4 B4 D5 F5 A5 B5 D6 F6'),
  },
];

const DOUBLE_REED_KEYS = ['G', 'Ab', 'A', 'Bb', 'B', 'C', 'Db', 'D', 'Eb', 'E', 'F', 'F#'];

// ---- Registry -----------------------------------------------------------

export const FAMILIES: { id: Family; name: string }[] = [
  { id: 'diatonic', name: 'Diatonic' },
  { id: 'chromatic', name: 'Chromatic' },
  { id: 'tremolo', name: 'Tremolo' },
  { id: 'octave', name: 'Octave' },
];

const FAMILY_IDS = FAMILIES.map((f) => f.id);

const ALL_TUNINGS = [...DIATONIC_TUNINGS, ...CHROMATIC_TUNINGS, ...TREMOLO_TUNINGS, ...OCTAVE_TUNINGS];

export function tuningsFor(family: Family): { id: string; name: string }[] {
  return ALL_TUNINGS.filter((t) => t.family === family).map(({ id, name }) => ({ id, name }));
}

export function keysFor(family: Family): string[] {
  if (family === 'diatonic') return DIATONIC_KEYS.map((k) => k.key);
  return family === 'chromatic' ? CHROMATIC_KEYS : DOUBLE_REED_KEYS;
}

export function defaultSpec(family: Family = 'diatonic'): HarmonicaSpec {
  return { family, tuning: ALL_TUNINGS.find((t) => t.family === family)!.id, key: 'C' };
}

function keyBase(family: Family, key: string): number | null {
  if (family === 'diatonic') {
    const k = DIATONIC_KEYS.find((d) => d.key.toLowerCase() === key.toLowerCase());
    if (k) return k.base;
    const pc = parsePitchClass(key);
    if (pc === null) return null;
    // Unlisted spelling (e.g. "G#"): use the standard range G3..F#4.
    return pc >= 7 ? 48 + pc : 60 + pc;
  }
  const pc = parsePitchClass(key);
  if (pc === null) return null;
  if (family === 'chromatic') return 60 + pc;
  // Tremolo/octave layouts are written in C; G–B keys sit below C, Db–F# above.
  return pc >= 7 ? 48 + pc : 60 + pc;
}

/** Normalizes loosely written specs (unknown values fall back to defaults). */
export function normalizeSpec(partial: Partial<HarmonicaSpec>): HarmonicaSpec {
  const family: Family = FAMILY_IDS.includes(partial.family as Family) ? (partial.family as Family) : 'diatonic';
  const def = defaultSpec(family);
  const tuning = ALL_TUNINGS.some((t) => t.family === family && t.id === partial.tuning) ? partial.tuning! : def.tuning;
  const key = partial.key && keyBase(family, partial.key) !== null ? canonicalKey(family, partial.key) : def.key;
  return { family, tuning, key };
}

function canonicalKey(family: Family, key: string): string {
  const match = keysFor(family).find((k) => k.toLowerCase() === key.toLowerCase());
  return match ?? key;
}

const cache = new Map<string, Harmonica>();

export function getHarmonica(partial: Partial<HarmonicaSpec>): Harmonica {
  const spec = normalizeSpec(partial);
  const id = specId(spec);
  const hit = cache.get(id);
  if (hit) return hit;
  const tuning = ALL_TUNINGS.find((t) => t.family === spec.family && t.id === spec.tuning)!;
  const base = keyBase(spec.family, spec.key)! + 12 * (tuning.octaveShift ?? 0);
  const holes: HoleDef[] = tuning.blow.map((b, i) => ({ hole: i + 1, blow: base + b, draw: base + tuning.draw[i] }));
  const harp: Harmonica = {
    spec,
    name: harmonicaName(spec),
    holes,
    hasSlide: spec.family === 'chromatic',
    bendable: spec.family === 'diatonic',
    overblows: spec.family === 'diatonic',
    voicing: spec.family === 'tremolo' ? 'tremolo' : spec.family === 'octave' ? 'octave' : 'single',
  };
  cache.set(id, harp);
  return harp;
}

export function specId(spec: HarmonicaSpec): string {
  return `${spec.family}/${spec.tuning}/${spec.key}`;
}

export function harmonicaName(spec: HarmonicaSpec): string {
  const tuning = ALL_TUNINGS.find((t) => t.family === spec.family && t.id === spec.tuning);
  if (spec.family === 'diatonic') {
    return tuning && tuning.id !== 'richter' ? `${spec.key} Diatonic · ${tuning.name}` : `${spec.key} Diatonic`;
  }
  const family = FAMILIES.find((f) => f.id === spec.family)!.name;
  return `${spec.key} ${family} · ${tuning?.name ?? spec.tuning}`;
}

/** Every harmonica we know about, for "which harmonica fits this song best?". */
export function allSpecs(): HarmonicaSpec[] {
  const out: HarmonicaSpec[] = [];
  for (const t of ALL_TUNINGS) {
    for (const key of keysFor(t.family)) out.push({ family: t.family, tuning: t.id, key });
  }
  return out;
}

// ---- Reeds and techniques ------------------------------------------------

export function holeDef(harp: Harmonica, hole: number): HoleDef | undefined {
  return harp.holes[hole - 1];
}

/** Deepest bend available on a hole/breath (diatonic: the gap between its two reeds). */
export function maxBend(harp: Harmonica, hole: number, breath: Breath): number {
  const h = holeDef(harp, hole);
  if (!h || !harp.bendable) return 0;
  return breath === 'draw' ? Math.max(0, h.draw - h.blow - 1) : Math.max(0, h.blow - h.draw - 1);
}

/** Whether the hole can be overblown (blow) or overdrawn (draw). */
export function canOver(harp: Harmonica, hole: number, breath: Breath): boolean {
  const h = holeDef(harp, hole);
  if (!h || !harp.overblows) return false;
  return breath === 'blow' ? h.draw > h.blow : h.blow > h.draw;
}

/** MIDI pitch of a hole sound on this harmonica, or null if it can't be played. */
export function soundPitch(harp: Harmonica, s: HoleSound): number | null {
  const h = holeDef(harp, s.hole);
  if (!h) return null;
  if (s.slide && !harp.hasSlide) return null;
  if (s.over) {
    if (s.bend > 0 || s.slide || !canOver(harp, s.hole, s.breath)) return null;
    return s.breath === 'blow' ? h.draw + 1 : h.blow + 1;
  }
  const base = (s.breath === 'blow' ? h.blow : h.draw) + (s.slide ? 1 : 0);
  if (s.bend > 0) {
    if (s.bend > maxBend(harp, s.hole, s.breath)) return null;
    return base - s.bend;
  }
  return base;
}

/** Relative difficulty of a technique; used when choosing between equivalent tabs. */
export function soundCost(s: HoleSound): number {
  if (s.over) return 4;
  let c = 0;
  if (s.bend > 0) c += 1.6 + 0.8 * (s.bend - 1);
  if (s.slide) c += 0.3;
  return c;
}

export interface ReedOption {
  sound: HoleSound;
  midi: number;
  cost: number;
}

const optionCache = new Map<string, ReedOption[]>();

/** Every distinct sound a harmonica can make, with its pitch and difficulty. */
export function allOptions(harp: Harmonica): ReedOption[] {
  const id = specId(harp.spec);
  const hit = optionCache.get(id);
  if (hit) return hit;
  const out: ReedOption[] = [];
  const push = (sound: HoleSound) => {
    const midi = soundPitch(harp, sound);
    if (midi !== null) out.push({ sound, midi, cost: soundCost(sound) });
  };
  for (const h of harp.holes) {
    for (const breath of ['blow', 'draw'] as Breath[]) {
      const slides = harp.hasSlide ? [false, true] : [false];
      for (const slide of slides) push({ type: 'hole', hole: h.hole, breath, bend: 0, over: false, slide });
      for (let b = 1; b <= maxBend(harp, h.hole, breath); b++) {
        push({ type: 'hole', hole: h.hole, breath, bend: b, over: false, slide: false });
      }
      if (canOver(harp, h.hole, breath)) push({ type: 'hole', hole: h.hole, breath, bend: 0, over: true, slide: false });
    }
  }
  optionCache.set(id, out);
  return out;
}

export function rangeLabel(harp: Harmonica): string {
  const lo = Math.min(...harp.holes.map((h) => Math.min(h.blow, h.draw)));
  const hi = Math.max(...harp.holes.map((h) => Math.max(h.blow, h.draw)));
  return `${midiToName(lo)}–${midiToName(hi + (harp.hasSlide ? 1 : 0))}`;
}
