// Pitch helpers. Pitches are MIDI note numbers (C4 = 60). Fractional values are
// allowed for in-between pitches while bending.

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function mod12(n: number): number {
  return ((n % 12) + 12) % 12;
}

export function pitchClassName(midi: number, flats = false): string {
  return (flats ? FLAT_NAMES : SHARP_NAMES)[mod12(Math.round(midi))];
}

export function midiToName(midi: number, flats = false): string {
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
