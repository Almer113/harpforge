import { describe, expect, it } from 'vitest';
import { guessTonic, harpForPosition, suggestHarmonicas, transposeDoc } from './convert';
import { parseHtab } from './htab/parser';
import { parseKey, transposeKey } from './pitch';

const top = (key: string, notes: string, families?: string[]) => {
  const doc = parseHtab(`---\nkey: ${key}\n---\n${notes}`).doc;
  const s = suggestHarmonicas(doc, { limit: 3, families })[0];
  return `${s.name}${s.position ? ` p${s.position}` : ''}`;
};

describe('harmonica suggestions', () => {
  it('picks what players would: plain Richter harps in the usual positions', () => {
    // Blues in A → D harp, 2nd position (cross harp).
    expect(top('A', 'A4 C5 D5 D#5 E5 G5 A5 G5 E5 D#5 D5 C5 A4 . A4 C5 A4 G4 A4')).toBe('D Diatonic p2');
    expect(top('C', 'C5 C5 G5 G5 A5 A5 G5 F5 F5 E5 E5 D5 D5 C5')).toBe('C Diatonic p1');
    expect(top('G', 'G4 A4 B4 C5 D5 E5 F#5 G5 D5 B4 G4')).toBe('G Diatonic p1');
    expect(top('D', 'D5 E5 F#5 G5 A5 B5 A5 F#5 D5 E5 D5')).toBe('D Diatonic p1');
    // A natural-minor tune: a plain G harp, not a special tuning.
    expect(top('Em', 'E4 F#4 G4 A4 B4 C5 D5 E5 B4 G4 E4 F#4 E4', ['diatonic'])).toBe('G Diatonic p4');
  });

  it('reads modal and spelled-out keys', () => {
    expect(parseKey('Edor')).toMatchObject({ tonic: 4, mode: 'dorian' });
    expect(parseKey('D Mixolydian')).toMatchObject({ tonic: 2, mode: 'mixolydian' });
    expect(parseKey('A major')).toMatchObject({ tonic: 9, mode: 'major' });
    expect(parseKey('F#m')).toMatchObject({ tonic: 6, mode: 'minor' });
    expect(parseKey('Bb')).toMatchObject({ tonic: 10, mode: 'major' });
    expect(parseKey('H')).toBeNull();
    expect(guessTonic(parseHtab('---\nkey: Edor\n---\nD4 E4').doc)).toBe(4);
  });

  it('transposes keys with the usual spelling', () => {
    expect(transposeKey('G', 2)).toBe('A');
    expect(transposeKey('C', 5)).toBe('F');
    expect(transposeKey('C', 3)).toBe('Eb');
    expect(transposeKey('Em', 1)).toBe('Fm');
    expect(transposeKey('Am', 1)).toBe('Bbm');
    expect(transposeKey('D dorian', 2)).toBe('E dorian');
  });
});

describe('changing the harp key', () => {
  it('keeping the holes moves the song key, chord symbols and note names', () => {
    const doc = parseHtab('---\nkey: G\n---\n[G] -2 [D7] -4 C5 |').doc;
    const moved = transposeDoc(doc, 2);
    expect(moved.meta.key).toBe('A');
    const evs = moved.lines[0].events.filter((e) => e.kind === 'note');
    expect(evs.map((e) => e.chord)).toEqual(['A', 'E7', undefined]);
    expect(evs[2]).toMatchObject({ sounds: [{ type: 'pitch', midi: 74 }] });
    expect(transposeDoc(parseHtab('---\nkey: C\n---\n[C/E] 4').doc, 3).lines[0].events[0]).toMatchObject({ chord: 'Eb/G' });
  });

  it('finds the harp for a position', () => {
    expect(harpForPosition(9, 2)).toBe(2); // A song, 2nd position → D harp
    expect(harpForPosition(9, 1)).toBe(9);
    expect(harpForPosition(4, 3)).toBe(2); // E dorian, 3rd → D harp
  });
});
