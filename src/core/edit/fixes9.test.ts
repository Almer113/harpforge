// The Phase 6–8 review's fixes: Insert mode closes gaps at the end of a bar, line breaks
// stay after the same note, chord symbols on ties survive editing, half-beat ChordPro bars.

import { describe, expect, it } from 'vitest';
import { parseChordPro } from '../formats/chordpro';
import { parseHtab } from '../htab/parser';
import { bodyText } from '../htab/serializer';
import { copyText, pasteText } from './clipboard';
import { changeLengths, deleteNotes, fromDoc, setTimeSignature, toDoc, type Song } from './model';

const song = (b: string, time = '4/4') => fromDoc(parseHtab(`---\ntime: ${time}\n---\n${b}`).doc);
const body = (s: Song) => bodyText(toDoc(s).lines);

describe('Insert mode closes a gap at the end of a bar', () => {
  it('deleting the last note of a bar pulls the next bar back', () => {
    expect(body(deleteNotes(song('4 4 4 4 | 5 6 7 8 |'), [{ m: 0, start: 3 }], true))).toBe('4 4 4 5 | 6 7 8 . |');
  });

  it('shortening the last note of a bar pulls the next bar back', () => {
    expect(body(changeLengths(song('4 4 4 4 | 5 6 7 8 |'), [{ m: 0, start: 3 }], 0.5, true).song)).toBe('4 4 4 {4 5} | {~ 6} {~ 7} {~ 8} {~ .} |');
  });

  it("deleting the note before a line break: a split bar's line starts with the same note, a bar line's stays", () => {
    expect(body(deleteNotes(song('4 4 4 4 | 5 5\n6 6 | 7 7 7 7 |'), [{ m: 1, start: 1 }], true))).toBe('4 4 4 4 | 5\n6 6 7 | 7 7 7 . |');
    expect(body(deleteNotes(song('4 5 6 7 |\n8 9 10 1 |'), [{ m: 0, start: 3 }], true))).toBe('4 5 6 8 |\n9 10 1 . |');
  });

  it('lines starting at a bar line stay there while the music flows across them', () => {
    expect(body(deleteNotes(song('4 4 4 4 | 5 6 7 8 |\n4 5 6 7 | 7 7 7 7 |'), [{ m: 0, start: 3 }], true))).toBe('4 4 4 5 | 6 7 8 4 |\n5 6 7 7 | 7 7 7 . |');
  });
});

describe('a chord symbol on a tie', () => {
  const TIE = '4 [G] ~ 5 6 | 7 7 7 7 |';
  it('stays through re-barring', () => {
    expect(body(setTimeSignature(song(TIE), '3/4', true))).toContain('[G]');
  });

  it('stays through Insert-mode edits in its bar', () => {
    expect(body(deleteNotes(song(TIE), [{ m: 0, start: 3 }], true))).toContain('[G]');
  });

  it('deleting or changing the length of the tied note does not crash', () => {
    expect(() => deleteNotes(song(TIE), [{ m: 0, start: 0 }, { m: 0, start: 1 }], true)).not.toThrow();
    expect(() => changeLengths(song(TIE), [{ m: 0, start: 0 }, { m: 0, start: 1 }], 0.5, true)).not.toThrow();
  });

  it('stays when copied and pasted', () => {
    const s = song(TIE);
    const text = copyText(s, [{ m: 0, start: 0 }]);
    const r = pasteText(song('7 7 7 7 | 8 8 8 8 |'), text, { m: 1, start: 0 });
    expect(r && body(r.song)).toContain('[G]');
  });
});

describe('ChordPro', () => {
  it('a meter whose bar ends on a half beat imports (it used to hang)', () => {
    const r = parseChordPro('{time: 7/8}\nla [G]la la [C]la\n');
    const beats = r.doc.lines[0].events.reduce((a, e) => a + (e.kind === 'bar' ? 0 : e.beats), 0);
    expect(beats % 3.5).toBeCloseTo(0);
  });
});
