// @vitest-environment happy-dom
// Phase 7c: files that go out and come back in arrive unchanged (MusicXML, MIDI, numbered
// notation, ABC), and imports read what's really there (chord sheets, guitar tab).

import { describe, expect, it } from 'vitest';
import { isChordSymbol } from './chords';
import { parseAbc, writeAbc } from './formats/abc';
import { isChordLine } from './formats/chordpro';
import { parseGuitarTab } from './formats/guitartab';
import { parseJianpu, writeJianpu } from './formats/jianpu';
import { parseMidi, writeMidi } from './formats/midi';
import { parseMusicXml, writeMusicXml } from './formats/musicxml';
import { parseHtab } from './htab/parser';
import type { TabDoc } from './htab/types';
import { getHarmonica } from './instruments';
import { midiToName } from './pitch';

const C = getHarmonica({ family: 'diatonic', key: 'C' });
const doc = (text: string) => parseHtab(text).doc;
/** Events as text: "D5+F5:4", "~D5+F5:1" (tie), ".:1" (rest), "[D7]" (chord marker), "|". */
function events(d: TabDoc): string[] {
  return d.lines.flatMap((l) => [
    ...(l.section !== undefined ? [`@${l.section}`] : []),
    ...l.events.map((e) => {
      if (e.kind === 'bar') return e.style === 'single' ? '|' : e.style;
      if (e.beats <= 0) return `[${e.chord}]`;
      const chord = e.chord ? `[${e.chord}]` : '';
      if (e.kind === 'rest') return `${chord}.:${+e.beats.toFixed(3)}`;
      const names = e.sounds.map((s) => (s.type === 'pitch' ? midiToName(s.midi) : `h${s.hole}`)).join('+');
      return `${chord}${e.tied ? '~' : ''}${names}:${+e.beats.toFixed(3)}`;
    }),
  ]);
}
const totalBeats = (d: TabDoc) => d.lines.flatMap((l) => l.events).reduce((a, e) => a + (e.kind === 'bar' ? 0 : e.beats), 0);

describe('B17: MusicXML round trip', () => {
  const SONG = `---
title: Round trip
key: D dorian
time: 4/4
---
@ A
D5 E5 F5 G5 | (D5 F5)~~~ | ~ A5 A5 A5 [D7] |
@ B
D5 D5 D5 D5 |
E5 E5 E5 E5 |
@ C
F5 F5 F5 F5 |
`;
  const back = parseMusicXml(writeMusicXml(doc(SONG))).doc;

  it('keeps sections, line breaks, a tied chord and a chord symbol at the end of a bar', () => {
    expect(events(back).join(' ')).toBe(
      '@A D5:1 E5:1 F5:1 G5:1 | D5+F5:4 | ~D5+F5:1 A5:1 A5:1 A5:1 [D7] | @B D5:1 D5:1 D5:1 D5:1 | E5:1 E5:1 E5:1 E5:1 | @C F5:1 F5:1 F5:1 F5:1 |',
    );
  });

  it('keeps the mode of the key', () => {
    expect(back.meta.key).toBe('D dorian');
    for (const key of ['F lydian', 'A mixolydian', 'Em', 'G']) {
      expect(parseMusicXml(writeMusicXml(doc(`---\nkey: ${key}\n---\nC5 |`))).doc.meta.key).toBe(key);
    }
  });

  it('a Low F harp key writes the key signature of F', () => {
    expect(writeMusicXml(doc('---\nkey: Low F\n---\nF4 |'))).toContain('<fifths>-1</fifths>');
  });
});

describe('B18: MIDI', () => {
  /** A one-track (format 0) MIDI file: a melody on channel 1, chords on channel 2. */
  function format0(): Uint8Array {
    const vl = (n: number) => (n < 128 ? [n] : [0x80 | (n >> 7), n & 0x7f]);
    const name = [...new TextEncoder().encode('My Song')];
    const t: number[] = [0, 0xff, 0x03, name.length, ...name];
    const melody = [72, 74, 76, 77];
    melody.forEach((m) => {
      t.push(0, 0x90, m, 90, 0, 0x91, 48, 70, 0, 0x91, 52, 70);
      t.push(...vl(480), 0x80, m, 0, 0, 0x81, 48, 0, 0, 0x81, 52, 0);
    });
    t.push(0, 0xff, 0x2f, 0);
    const head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0];
    return new Uint8Array([...head, 0x4d, 0x54, 0x72, 0x6b, 0, 0, (t.length >> 8) & 0xff, t.length & 0xff, ...t]);
  }
  const notes = (d: TabDoc) => events(d).filter((e) => /\d:/.test(e));

  it('splits a one-track file by channel and takes the melody', () => {
    const r = parseMidi(format0());
    expect(r.doc.meta.title).toBe('My Song');
    expect(notes(r.doc)).toEqual(['C5:1', 'D5:1', 'E5:1', 'F5:1']);
    expect(r.parts?.map((p) => p.label)).toEqual(['My Song · channel 1', 'My Song · channel 2']);
  });

  it('another part can be chosen', () => {
    const r = parseMidi(format0());
    const other = r.choosePart!(r.parts![1].id);
    expect(notes(other.doc)).toEqual(['C3+E3:1', 'C3+E3:1', 'C3+E3:1', 'C3+E3:1']);
    expect(other.part).toBe(r.parts![1].id);
  });

  it('reads back the title of its own export', () => {
    expect(parseMidi(writeMidi(doc('---\ntitle: Own Export\n---\nC5 D5 E5 F5 |'))).doc.meta.title).toBe('Own Export');
  });
});

describe('B19: numbered notation', () => {
  it('a chord symbol after a fractional group neither crashes nor changes the length', () => {
    for (const body of ['4 4 4 {5 6 7}/2 [G]', '{5 6 7}/2 [G] 4 4 4 |']) {
      const d = doc(`---\ntime: 7/8\n---\n${body}`);
      const text = writeJianpu(d, C);
      const back = parseJianpu(text).doc;
      expect(totalBeats(back)).toBeCloseTo(3.5, 6);
      expect(events(back).some((e) => e.includes('[G]'))).toBe(true);
    }
    // The triplets stay a group of their own; the whole beats after them are plain notes.
    expect(writeJianpu(doc('---\ntime: 7/8\n---\n{5 6 7}/2 [G] 4 4 4 |'), C)).toContain("{3' 5' 1''}/2 [G]1' 1' 1' |");
  });

  it('lyrics after a note the harp can\'t play stay on their notes', () => {
    const back = parseJianpu(writeJianpu(doc('4 9o 5 6 |\nw: a b c d'), C)).doc;
    const sung = back.lines.flatMap((l) => l.events).filter((e) => e.kind === 'note').map((e) => (e.kind === 'note' ? e.lyric : ''));
    expect(sung).toEqual(['a', 'c', 'd']);
  });
});

describe('ABC', () => {
  it('"G:|CDEF|" is music, not a header field', () => {
    const d = parseAbc('X:1\nT:t\nM:4/4\nL:1/4\nK:C\nG:|CDEF|\n').doc;
    expect(events(d).filter((e) => /\d:/.test(e))).toEqual(['G4:1', 'C4:1', 'D4:1', 'E4:1', 'F4:1']);
  });

  it('writes quintuplets as tuplets, and reads them back exactly', () => {
    const { text } = writeAbc(doc('{C5 D5 E5 F5 G5} C5 C5 C5 |'));
    expect(text).toContain('(5:4:5');
    const back = parseAbc(text).doc;
    expect(events(back).filter((e) => /\d:/.test(e)).slice(0, 5)).toEqual(['C5:0.2', 'D5:0.2', 'E5:0.2', 'F5:0.2', 'G5:0.2']);
  });

  it('a Low F key is written K:F', () => {
    expect(writeAbc(doc('---\nkey: Low F\n---\nF4 |')).text).toMatch(/^K:F$/m);
  });
});

describe('imports read what is there', () => {
  it('words like "Bad Dad" are lyrics, not chord symbols', () => {
    for (const w of ['Bad', 'Dad', 'Gas', 'Cash']) expect(isChordSymbol(w)).toBe(false);
    for (const c of ['Cmaj7(#11)', 'Am7b5', 'Dsus4', 'G7', 'F#m', 'Bb', 'Cadd9', 'E7(b9)']) expect(isChordSymbol(c)).toBe(true);
    expect(isChordLine('Bad Dad')).toBe(false);
    expect(isChordLine('G   D   Em   C')).toBe(true);
  });

  it('guitar tab: two frets side by side ("35") are two notes', () => {
    const tab = ['e|--35--|', 'B|------|', 'G|------|', 'D|------|', 'A|------|', 'E|------|'].join('\n');
    const d = parseGuitarTab(tab).doc;
    expect(events(d).filter((e) => /\d:/.test(e)).map((e) => e.split(':')[0])).toEqual(['G5', 'A5']);
  });
});
