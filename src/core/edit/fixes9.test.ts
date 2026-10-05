// The Phase 6–8 review's fixes: Insert mode closes gaps at the end of a bar, line breaks
// stay after the same note, chord symbols on ties survive editing, half-beat ChordPro bars.

import { describe, expect, it } from 'vitest';
import { parseChordPro } from '../formats/chordpro';
import { parseHtab } from '../htab/parser';
import { bodyText, serializeHtab } from '../htab/serializer';
import { copyText, pasteText } from './clipboard';
import { changeLengths, deleteNotes, fromDoc, setTimeSignature, toDoc, updateItem, type Song } from './model';
import { holeSound } from '../types';

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

describe('bars longer than the time signature', () => {
  it('a long rest in a tab without bar lines keeps its length through an edit', () => {
    const s = song('4 .~~~~~ 5 6');
    expect(body(s)).toBe('4 .~~~~~ 5 6');
    expect(body(updateItem(s, { m: 1, start: 0 }, { sounds: [holeSound(7, 'blow')] }))).toBe('4 .~~~~~ 7 6');
  });

  it('notes placed and lengthened in a longer bar (time changed without re-barring) keep its length', () => {
    const s = song('4 4 4 . | 5 5 5 5 |', '3/4');
    expect(body(updateItem(s, { m: 0, start: 2 }, { dur: 2 }))).toBe('4 4 4~ | 5 5 5 5 |');
    expect(copyText(s, [{ m: 0, start: 0 }, { m: 1, start: 0 }])).toBe('4 .~~ | 5');
  });

  it('pasted text without a header is read in the song’s time signature', () => {
    const r = pasteText(song('4 4 4 | 5 5 5 |', '3/4'), '6 6 6 | 7', { m: 0, start: 0 });
    expect(r && body(r.song)).toBe('6 6 6 | 7 5 5 |');
  });
});

it('lengths in fifteenths and thirtieths of a beat are written exactly', () => {
  const doc = parseHtab('---\n---\n{4 5 6 7 8}/3 {4 5}~~/2 |').doc;
  const ev = doc.lines[0].events.filter((e) => e.kind !== 'bar');
  // A fifth of a third of a beat, and its half.
  const text = serializeHtab({ ...doc, lines: [{ events: [{ ...ev[0], beats: 1 / 15 }, { ...ev[1], beats: 14 / 15 }, { ...ev[2], beats: 1 / 30 }, { ...ev[3], beats: 29 / 30 + 2 }] }] });
  const back = parseHtab(text).doc.lines[0].events.filter((e) => e.kind !== 'bar').map((e) => e.beats);
  expect(back.map((b) => Math.round(b * 30))).toEqual([2, 28, 1, 89]);
});

it('re-barring keeps a repeat sign that only rests follow', () => {
  expect(body(setTimeSignature(song('4 4 4 4 :| . . . . |]'), '3/4', true))).toBe('4 4 4 | 4 :|');
});
