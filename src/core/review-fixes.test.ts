// @vitest-environment happy-dom
// Regressions found reviewing phases 1–2.
import { describe, expect, it } from 'vitest';
import { transposeChord } from './chords';
import { retab } from './convert';
import { fromDoc, insertMeasure, setTimeSignature, updateItem } from './edit/model';
import { replaceLines, spliceBody } from './edit/splice';
import { parseAbc } from './formats/abc';
import { slugify } from './formats/common';
import { writeMusicXml } from './formats/musicxml';
import { parseHtab } from './htab/parser';
import type { NoteEvent } from './htab/types';
import { getHarmonica } from './instruments';
import { transposeKey } from './pitch';

const doc = (body: string, time = '4/4') => `---\ntime: ${time}\n---\n${body}\n`;
const song = (text: string) => fromDoc(parseHtab(text).doc);
const C = getHarmonica({ family: 'diatonic', tuning: 'richter', key: 'C' });

describe('lyrics after a comment or blank line', () => {
  it('stay with their line when the next line is edited', () => {
    const text = doc('4 5 6 7 |\n# c\nw: a b c d\n5 5 5 5 |');
    const s = song(text);
    expect(spliceBody(text, updateItem(s, { m: 1, start: 0 }, { sounds: [{ type: 'hole', hole: 6, breath: 'blow', bend: 0, over: false, slide: false }] }))).toBe(
      '4 5 6 7 |\n# c\nw: a b c d\n6 5 5 5 |',
    );
  });

  it('an edited lyric replaces the old one', () => {
    const text = doc('4 5 6 7 |\n\nw: a b c d');
    const body = spliceBody(text, updateItem(song(text), { m: 0, start: 0 }, { lyric: 'X' }));
    const lyrics = parseHtab(doc(body)).doc.lines[0].events.filter((e) => e.kind === 'note').map((e) => (e as NoteEvent).lyric);
    expect(lyrics).toEqual(['X', 'b', 'c', 'd']);
    expect(body.match(/w:/g)).toHaveLength(1);
  });

  it('are not duplicated by re-tabbing', () => {
    const text = '---\nharmonica: diatonic\nharp-key: C\n---\n4 5 6 7 |\n\nw: a b c d\n';
    const r = retab(parseHtab(text).doc, C, getHarmonica({ family: 'diatonic', tuning: 'richter', key: 'G' }));
    expect(replaceLines(text, r.doc.lines).match(/w:/g)).toHaveLength(1);
  });
});

describe('time signature changes', () => {
  it('a first bar that only runs on to the next line is not a pickup', () => {
    const text = doc('4 5 6\n7 | 8 9 10 10 |');
    const s = setTimeSignature(song(text), '4/4', true);
    expect(s.measures[0].len).toBeUndefined();
    expect(s.measures[0].items).toHaveLength(4);
  });

  it('keeps a chord mark at the end of its bar', () => {
    const text = doc('4 5 6 7 [G] |\n[C] 4 5 6 7 |');
    // (In 3/4 the G mark and the C chord fall on the same beat mid-bar, where only one chord fits.)
    for (const t of ['2/4', '4/4']) {
      const body = spliceBody(text, setTimeSignature(song(text), t, true));
      const chords = parseHtab(doc(body, t)).doc.lines.flatMap((l) => l.events).filter((e) => e.kind !== 'bar' && e.chord).map((e) => (e.kind !== 'bar' ? e.chord : ''));
      expect(chords, t).toEqual(['G', 'C']);
    }
  });

  it('a measure inserted after a run-on bar gets its own bar line', () => {
    const text = doc('4 5 6\n7 | 8 9 10 10 |');
    const body = spliceBody(text, insertMeasure(song(text), 1));
    expect(song(doc(body)).measures).toHaveLength(4);
  });
});

describe('keys and chords', () => {
  it('a whole-octave move keeps the names', () => {
    expect(transposeKey('Gb', 12)).toBe('Gb');
    expect(transposeKey('C#m', -12)).toBe('C#m');
    expect(transposeChord('Gb7', 12)).toBe('Gb7');
  });
});

describe('formats', () => {
  it('MusicXML quintuplets add up to whole bars', () => {
    const xml = writeMusicXml(parseHtab(doc('{4 5 6 5 4} 4 4 4 |')).doc, C);
    const durs = [...xml.matchAll(/<duration>(\d+)<\/duration>/g)].map((m) => +m[1]);
    expect(durs.reduce((a, b) => a + b, 0)).toBe(4 * 1680);
  });

  it('MusicXML keeps a repeat that starts after a full bar', () => {
    const xml = writeMusicXml(parseHtab(doc('4 5 6 7 |: 4 5 6 7 :|')).doc, C);
    expect(xml).toContain('<repeat direction="forward"/>');
    expect(xml).toContain('<repeat direction="backward"/>');
  });

  it('MusicXML writes every piece of a split note with a type', () => {
    const xml = writeMusicXml(parseHtab(doc('{4~~~~ .}~ 5 5 |')).doc, C);
    const notes = xml.split('<note>').slice(1);
    expect(notes.every((n) => n.includes('<type>'))).toBe(true);
  });

  it('ABC: a tie keeps its accidental only for the same letter', () => {
    const r = parseAbc('X:1\nT:t\nM:4/4\nL:1/4\nK:C\nC D E ^G- | A B c d |');
    const names = r.doc.lines.flatMap((l) => l.events).filter((e) => e.kind === 'note').map((e) => ((e as NoteEvent).sounds[0] as { midi: number }).midi);
    expect(names[4]).toBe(69); // A, not G#
  });

  it('file names keep Japanese letters whole', () => {
    expect(slugify('がっこう')).toBe('がっこう');
    expect(slugify('Frère Jacques')).toBe('frere-jacques');
  });
});
