// @vitest-environment happy-dom
// The review of Phases 15–20: what was found, kept fixed.

import { describe, expect, it } from 'vitest';
import { findNow } from '../components/editor/FindBar';
import { isBlankSong } from '../demo/songs';
import type { FindState } from '../state/store';
import { parseChord } from './chords';
import { setLyric } from './edit/lyrics';
import { fromDoc, toDoc } from './edit/model';
import { repeatSection, sectionRepeat, sameMusic } from './edit/sections';
import { exportDoc, importBytes, importText, sniffText } from './formats';
import { gcd } from './formats/common';
import { parseHtab } from './htab/parser';
import { serializeHtab } from './htab/serializer';
import type { NoteEvent, TabDoc } from './htab/types';
import { harmonicaFromMeta } from './score';

const doc = (body: string, head = '') => parseHtab(`---\ntitle: T\n${head}---\n${body}\n`).doc;
const body = (d: TabDoc) => serializeHtab(d).split('---\n')[2].trim();
const notes = (d: TabDoc) => d.lines.flatMap((l) => l.events).filter((e): e is NoteEvent => e.kind === 'note');

describe('chord symbols', () => {
  const ivs = (s: string) => {
    const c = parseChord(s);
    return c ? `${c.root}:${c.intervals.join(',')}` : null;
  };
  it('a double flat or sharp root; a note left out; C2; a root in lower case', () => {
    expect(['Bbb', 'F##', 'C(no3)', 'C7(no5)', 'C2', 'am', 'dm7', 'c#m'].map(ivs)).toEqual(['9:0,4,7', '7:0,4,7', '0:0,7', '0:0,4,10', '0:0,4,7,14', '9:0,3,7', '2:0,3,7,10', '1:0,3,7']);
    expect(parseChord('Chorus')).toBeNull();
  });
});

describe('lyrics typed in the Inspector', () => {
  it('"Oh_", "*" and "~" written so they read back as typed, the other words kept in place', () => {
    const d = doc('4 5 6 7 |\nw: a b c d');
    const typed = (t: string) => body(toDoc(setLyric(fromDoc(d), { m: 0, start: 0 }, 0, t))).split('\n')[1];
    expect(['Oh_', '*', '~', 'a~b'].map(typed)).toEqual(['w: Oh b c d', 'w: * b c d', 'w: * b c d', 'w: a~b b c d']);
  });
});

describe('a blank song', () => {
  it('a new tab emptied again, or with only a setting changed, is blank; one with anything written isn’t', () => {
    expect(isBlankSong('---\ntitle: Untitled\nharmonica: diatonic\nharp-key: G\n---\n. . . . |\n')).toBe(true);
    expect(isBlankSong('---\ntitle: Untitled\n---\n# remember this\n')).toBe(false);
    expect(isBlankSong('---\ntitle: Untitled\n---\n. . . . |\nw: _ la\n')).toBe(false);
    expect(isBlankSong('---\ntitle: Mine\n---\n')).toBe(false);
    expect(isBlankSong('---\ntitle: Untitled\n---\n4 |\n')).toBe(false);
  });
});

describe('section tools', () => {
  it('two repeats in a row aren’t one section repeat', () => {
    const song = fromDoc(doc('@ A\n|: 4 4 4 4 :|: 5 5 5 5 :|\n\n@ B\n6 6 6 6 |]'));
    expect(sectionRepeat(song, 0)).toBeNull();
  });

  it('the same music reads the same, whatever order an edit gave its keys', () => {
    const song = fromDoc(doc('@ A\n4 4 4 4 |\n@ B\n5 5 5 5 |]'));
    const edited = repeatSection(song, 1, 3);
    expect(sameMusic(fromDoc(parseHtab(serializeHtab(toDoc(edited))).doc), edited)).toBe(true);
  });

  it('the find bar’s Section scope stays on its section when bars are added before it', () => {
    const before = fromDoc(doc('@ A\n4 4 4 4 | 4 4 4 4 |\n@ B\n6 6 6 6 | 5 5 5 5 |]'));
    const f: FindState = { query: '6', by: '', chords: false, scope: 'section', section: [2, 4], sectionNo: 1, sectionName: 'B', notes: [] };
    const after = fromDoc(doc('@ A\n4 4 4 4 | 4 4 4 4 | 6 4 4 4 |\n@ B\n6 6 6 6 | 5 5 5 5 |]'));
    expect(findNow(before, f)).toHaveLength(4);
    expect(findNow(after, f).map((x) => x.at.m)).toEqual([3, 3, 3, 3]);
  });
});

describe('formats', () => {
  it('a tab with its header isn’t numbered notation for "1=C" in its words; "X:" and "K:" lines don’t make ABC; notes by name with bars are a tab', () => {
    expect(sniffText('---\ntitle: x\n---\n4 5 6 -6 |\nw: do re 1=C mi\n')).toBe('htab');
    expect(sniffText('4 5 6 -6 | 6 6 6 |\nK: hello\nX: there\n')).not.toBe('abc');
    expect(sniffText('X:1\nT:t\nK:C\nCDEF|\n')).toBe('abc');
    expect(sniffText('C4 E4 G4 | A4 G4 E4 |\nD4 D4 E4 F4 |')).toBe('htab');
  });

  it('MIDI: a track length past the end of the file doesn’t hang; no timing is said', () => {
    const head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0];
    const file = new Uint8Array([...head, 0x4d, 0x54, 0x72, 0x6b, 0xff, 0xff, 0xff, 0xff, 0, 0x90, 60, 90, 0x83, 0x60, 0x80, 60, 0]);
    const t = performance.now();
    expect(notes(importBytes('x.mid', file).doc)).toHaveLength(1);
    expect(performance.now() - t).toBeLessThan(1000);
    const noDivision = new Uint8Array([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, 0]);
    expect(() => importBytes('x.mid', noDivision)).toThrow(/no timing/);
  });

  it('a damaged number in a file: the import is still safe to open and export, and says so', () => {
    const xml = `<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"><part-name>A</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes><note><pitch><step>C</step><octave>5</octave></pitch><duration>abc</duration></note><note><pitch><step>D</step><octave>5</octave></pitch><duration>1</duration></note></measure></part></score-partwise>`;
    const r = importText(xml);
    expect(notes(r.doc).map((e) => e.beats)).toEqual([1]);
    expect(r.warnings.join(' ')).toContain('impossible length');
    expect(() => exportDoc('abc', r.doc, harmonicaFromMeta(r.doc.meta))).not.toThrow();
    expect(gcd(Number.NaN, 4)).toBe(1);
  });

  it('ChordPro: words in brackets stay words; a tempo up to 400 kept', () => {
    const d = doc('4 5 6 -6 | 6 6 6~ |\nw: Is-ti-ka-nya [ka-mi] ce-ri-a', 'tempo: 400\n');
    const cho = exportDoc('chordpro', d, harmonicaFromMeta(d.meta)).data as string;
    expect(cho).toContain('(kami)');
    expect(importText(cho, 'chordpro').doc.meta.tempo).toBe(400);
  });

  it('MusicXML: a section starting with "|:" keeps it on its own line', () => {
    const d = doc('@ A\n|: 4 5 6 -6 :|');
    const back = importText(exportDoc('musicxml', d, harmonicaFromMeta(d.meta)).data as string, 'musicxml').doc;
    expect(back.lines.find((l) => l.events.some((e) => e.kind === 'note'))?.events[0]).toEqual({ kind: 'bar', style: 'repeat-start' });
    expect(back.lines.findIndex((l) => l.section === 'A')).toBe(0);
  });

  it('ABC: a chord at the end of a bar stays there', () => {
    const d = doc('4 4 4 [F] | 5 5 5 5 [C] |');
    const back = importText(exportDoc('abc', d, harmonicaFromMeta(d.meta)).data as string, 'abc').doc;
    const events = back.lines.flatMap((l) => l.events);
    const firstBar = events.slice(0, events.findIndex((e) => e.kind === 'bar'));
    expect(firstBar.some((e) => e.kind === 'rest' && e.chord === 'F' && e.beats === 0)).toBe(true);
  });

  it('a time signature that can’t be played reads as 4/4', () => {
    expect([doc('4 |', 'time: 4/0\n').meta.time, doc('4 |', 'time: abc\n').meta.time, doc('4 |', 'time: 6/8\n').meta.time]).toEqual(['4/4', '4/4', '6/8']);
  });
});
