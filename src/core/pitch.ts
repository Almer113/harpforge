// Pitch helpers. Pitches are MIDI note numbers (C4 = 60). Fractional values are
// allowed for in-between pitches while bending.

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function mod12(n: number): number {
  return ((n % 12) + 12) % 12;
}

/**
 * How black keys are named: with flats (true), sharps (false), or per pitch class (a key's
 * spelling: see keySpelling).
 */
export type Spelling = boolean | ((pc: number) => boolean);

export function pitchClassName(midi: number, flats: Spelling = false): string {
  const pc = mod12(Math.round(midi));
  return ((typeof flats === 'function' ? flats(pc) : flats) ? FLAT_NAMES : SHARP_NAMES)[pc];
}

export function midiToName(midi: number, flats: Spelling = false): string {
  const m = Math.round(midi);
  return pitchClassName(m, flats) + (Math.floor(m / 12) - 1);
}

/** Parses a pitch class such as "C", "F#", "Bb" → 0..11, or null. */
export function parsePitchClass(name: string): number | null {
  const m = /^([A-G])([#b♯♭]{0,2})$/.exec(name.trim());
  if (!m) return null;
  let pc = LETTER_PC[m[1]];
  for (const ch of m[2]) pc += ch === '#' || ch === '♯' ? 1 : -1;
  return mod12(pc);
}

/** Parses a note such as "C4", "F#3", "Bb5" → MIDI number. Octave defaults to 4. */
export function parseNoteName(name: string): number | null {
  const m = /^([A-G])([#b♯♭]{0,2})(-?\d)?$/.exec(name.trim());
  if (!m) return null;
  let semis = LETTER_PC[m[1]];
  for (const ch of m[2]) semis += ch === '#' || ch === '♯' ? 1 : -1;
  const octave = m[3] === undefined ? 4 : parseInt(m[3], 10);
  return (octave + 1) * 12 + semis;
}

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Whether a key/chord root conventionally uses flats. */
export function prefersFlats(keyName: string | undefined): boolean {
  if (!keyName) return false;
  const root = keyName.replace(/^(Low|High)\s+/i, '').replace(/m(in(or)?)?$/i, '');
  return /b/.test(root.slice(1)) || root === 'F';
}

export type Mode = 'major' | 'minor' | 'dorian' | 'mixolydian' | 'lydian' | 'phrygian' | 'locrian';

const MODE_WORDS: Record<string, Mode> = {
  '': 'major', maj: 'major', ion: 'major', min: 'minor', m: 'minor', aeo: 'minor',
  dor: 'dorian', mix: 'mixolydian', lyd: 'lydian', phr: 'phrygian', loc: 'locrian',
};

/**
 * Reads a key name: "G", "Em", "F# minor", "Bbmaj", "Edor", "D Mixolydian", "A major".
 * Returns the tonic's pitch class and the mode, or null.
 */
export function parseKey(name: string | undefined): { tonic: number; mode: Mode; root: string } | null {
  if (!name) return null;
  const m = /^\s*(?:(?:Low|High)\s+)?([A-G])([#b♯♭]?)\s*([A-Za-z]*)\s*$/.exec(name);
  if (!m) return null;
  const word = m[3].toLowerCase();
  const mode = word === 'm' ? 'minor' : MODE_WORDS[word.slice(0, 3)];
  if (!mode || (word.length > 3 && !/^(major|minor|ionian|aeolian|dorian|mixolydian|lydian|phrygian|locrian)$/.test(word))) return null;
  const root = m[1] + (m[2] === '♯' ? '#' : m[2] === '♭' ? 'b' : m[2]);
  return { tonic: parsePitchClass(root)!, mode, root };
}

const MODE_SUFFIX: Record<Mode, string> = { major: '', minor: 'm', dorian: ' dorian', mixolydian: ' mixolydian', lydian: ' lydian', phrygian: ' phrygian', locrian: ' locrian' };

const MODE_OFFSET: Record<Mode, number> = { major: 0, dorian: 2, phrygian: 4, lydian: 5, mixolydian: 7, minor: 9, locrian: 11 };

/**
 * The key a key signature and mode name give: (0, "dorian") → "D dorian", (-1, "minor") → "Dm".
 * Unknown mode names count as major.
 */
export function keyFromSignature(fifths: number, modeName?: string): string {
  const word = (modeName ?? 'major').trim().toLowerCase();
  const mode: Mode = word === 'ionian' ? 'major' : word === 'aeolian' ? 'minor' : word in MODE_OFFSET ? (word as Mode) : 'major';
  return pitchClassName(mod12(fifths * 7) + MODE_OFFSET[mode], fifths < 0) + MODE_SUFFIX[mode];
}

/** The pitch classes of a key's scale (C major and A minor share theirs), or null. */
export function keyScale(name: string | undefined): number[] | null {
  const k = parseKey(name);
  if (!k) return null;
  const major = (((k.tonic - MODE_OFFSET[k.mode]) % 12) + 12) % 12;
  return [0, 2, 4, 5, 7, 9, 11].map((i) => (major + i) % 12);
}

/** Whether a key is written with flats (F, Bb, Eb… majors, and modes/minors that share their notes). */
export function keyUsesFlats(name: string | undefined): boolean {
  const k = parseKey(name);
  if (!k) return prefersFlats(name);
  if (k.root.length > 1) return k.root.endsWith('b');
  return [5, 10, 3, 8, 1].includes(mod12(k.tonic - MODE_OFFSET[k.mode]));
}

const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
const spellings = new Map<string, Spelling>();

/**
 * How a key names black keys: its own notes as the key signature has them, and notes outside
 * it that are blue notes or borrowed (♭2, ♭3, ♭6, ♭7 of the tonic) with flats: B♭ in G, not A♯.
 * (The same function for the same key, so it can be compared.)
 */
export function keySpelling(name: string | undefined): Spelling {
  const base = keyUsesFlats(name);
  const k = parseKey(name);
  if (!k) return base;
  const id = `${k.tonic}:${k.mode}:${base}`;
  let fn = spellings.get(id);
  if (!fn) {
    const doPc = mod12(k.tonic - MODE_OFFSET[k.mode]);
    fn = (pc: number) => (MAJOR_STEPS.includes(mod12(pc - doPc)) ? base : base || [1, 3, 8, 10].includes(mod12(pc - k.tonic)));
    spellings.set(id, fn);
  }
  return fn;
}

/** A key moved by `semis` semitones, written the usual way ("G" + 2 → "A", "Em" + 1 → "Fm"). */
export function transposeKey(name: string, semis: number): string {
  const k = parseKey(name);
  // Whole octaves don't change the key's name (Gb stays Gb).
  if (!k || mod12(semis) === 0) return name;
  const pc = mod12(k.tonic + semis);
  const flats = [5, 10, 3, 8, 1].includes(mod12(pc - MODE_OFFSET[k.mode]));
  return pitchClassName(pc, flats) + MODE_SUFFIX[k.mode];
}
