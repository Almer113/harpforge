// Phase 20f2: Guitar Pro 3–5 files (binary), written here byte by byte for each version.

import { describe, expect, it } from 'vitest';
import type { NoteEvent, TabEvent } from '../htab/types';
import { lyricOf } from '../verses';
import { parseGp345 } from './gp345';
import { detectKind, importBytes } from './index';

class W {
  a: number[] = [];
  u8(v: number) {
    this.a.push(v & 255);
  }
  i16(v: number) {
    this.u8(v);
    this.u8(v >> 8);
  }
  i32(v: number) {
    for (let k = 0; k < 4; k++) this.u8(v >> (8 * k));
  }
  zeros(n: number) {
    for (let k = 0; k < n; k++) this.u8(0);
  }
  chars(s: string) {
    for (const c of s) this.u8(c.charCodeAt(0));
  }
  byteText(s: string, size: number) {
    this.u8(s.length);
    this.chars(s);
    this.zeros(size - s.length);
  }
  intByteText(s: string) {
    this.i32(s.length + 1);
    this.u8(s.length);
    this.chars(s);
  }
  intText(s: string) {
    this.i32(s.length);
    this.chars(s);
  }
}

interface Note {
  string: number;
  fret: number;
  tie?: boolean;
  /** A bend and a grace note on it (for the bytes they take). */
  effects?: boolean;
}
interface Beat {
  dur: number;
  dotted?: boolean;
  tuplet?: number;
  notes: Note[];
  chord?: string;
  tempo?: number;
}
interface Bar {
  num?: number;
  repeatStart?: boolean;
  repeatEnd?: number;
  ending?: number;
  marker?: string;
}

const STANDARD = [64, 59, 55, 50, 45, 40];
const q = (fret: number, more: Partial<Beat> = {}, note: Partial<Note> = {}): Beat => ({ dur: 0, notes: [{ string: 0, fret, ...note }], ...more });

// Track 0 a bass (a low E a bar); track 1 the melody on the top string (fret 8 = C5).
// Bar 1 (repeat start, marker "Verse", C chord): 4 quarters, the last tied to bar 2's first.
// Bar 2 (1st ending, repeat end ×2, G7): the tied note, a triplet of eighths, a dotted quarter, an eighth.
// Bar 3 (2nd ending, the tempo to 120): a half note, a half rest.
const BARS: Bar[] = [{ num: 4, repeatStart: true, marker: 'Verse' }, { repeatEnd: 2, ending: 1 }, { ending: 2 }];
const MELODY: Beat[][] = [
  [q(8, { chord: 'C' }), q(10, {}, { effects: true }), q(12), q(13)],
  [q(13, { chord: 'G7' }, { tie: true }), q(15, { dur: 1, tuplet: 3 }), q(13, { dur: 1, tuplet: 3 }), q(12, { dur: 1, tuplet: 3 }), q(10, { dotted: true }), q(8, { dur: 1 })],
  [q(8, { dur: -1, tempo: 120 }), { dur: -1, notes: [] }],
];
const BASS: Beat[][] = [0, 1, 2].map(() => [{ dur: -2, notes: [{ string: 5, fret: 0 }] }]);

function gpFile(ver: number): Uint8Array {
  const w = new W();
  w.byteText(`FICHIER GUITAR PRO v${(ver / 100).toFixed(2)}`, 30);
  for (const s of ['Di Sini Senang', '', 'Folk', '', '']) w.intByteText(s);
  if (ver >= 500) w.intByteText('');
  for (let k = 0; k < 3; k++) w.intByteText('');
  w.i32(0);
  if (ver < 500) w.u8(0);
  if (ver >= 400) {
    w.i32(2); // the melody's
    w.i32(1);
    w.intText('Di si-ni se-nang');
    for (let k = 0; k < 4; k++) {
      w.i32(1);
      w.intText('');
    }
  }
  if (ver >= 510) w.zeros(19);
  if (ver >= 500) {
    w.zeros(30);
    for (let k = 0; k < 11; k++) w.intByteText('');
  }
  w.i32(90);
  if (ver >= 510) w.u8(0);
  w.u8(0);
  w.zeros(ver >= 400 ? 4 : 3);
  w.zeros(64 * 12);
  if (ver >= 500) w.zeros(42);
  w.i32(BARS.length);
  w.i32(2);
  for (const b of BARS) {
    const flags = (b.num ? 0x03 : 0) | (b.repeatStart ? 0x04 : 0) | (b.repeatEnd ? 0x08 : 0) | (b.ending ? 0x10 : 0) | (b.marker ? 0x20 : 0);
    w.u8(flags);
    if (b.num) {
      w.u8(b.num);
      w.u8(4);
    }
    if (b.repeatEnd) w.u8(ver >= 500 ? b.repeatEnd : b.repeatEnd - 1);
    if (b.ending && ver < 500) w.u8(b.ending);
    if (b.marker) {
      w.intByteText(b.marker);
      w.zeros(4);
    }
    if (ver >= 500) {
      if (flags & 0x03) w.zeros(4);
      w.u8(b.ending ? 1 << (b.ending - 1) : 0);
      w.zeros(2);
    }
  }
  for (const name of ['Bass', 'Melody']) {
    w.u8(0);
    w.byteText(name, 40);
    w.i32(6);
    for (let k = 0; k < 7; k++) w.i32(STANDARD[k] ?? 0);
    w.i32(1);
    w.i32(name === 'Bass' ? 2 : 1);
    w.i32(2);
    w.i32(24);
    w.i32(0);
    w.zeros(4);
    if (ver >= 500) w.zeros(45);
    if (ver >= 510) {
      w.zeros(4);
      w.intByteText('');
      w.intByteText('');
    }
  }
  BARS.forEach((_, bi) => {
    for (const track of [BASS, MELODY]) {
      if (ver >= 500) w.u8(0);
      for (let v = 0; v < (ver >= 500 ? 2 : 1); v++) {
        const beats = v === 0 ? track[bi] : [];
        w.i32(beats.length);
        for (const b of beats) {
          const rest = !b.notes.length;
          w.u8((b.dotted ? 0x01 : 0) | (b.chord ? 0x02 : 0) | (b.tempo ? 0x10 : 0) | (b.tuplet ? 0x20 : 0) | (rest ? 0x40 : 0));
          if (rest) w.u8(2);
          w.u8(b.dur);
          if (b.tuplet) w.i32(b.tuplet);
          if (b.chord) {
            if (ver >= 500) {
              w.zeros(17);
              w.byteText(b.chord, 21);
              w.zeros(4 + 4 + 28 + 1 + 5 + 26);
            } else {
              w.u8(0);
              w.intByteText(b.chord);
              w.i32(0);
            }
          }
          if (b.tempo) {
            w.u8(255);
            if (ver >= 500) w.zeros(16);
            for (let k = 0; k < 6; k++) w.u8(255);
            if (ver >= 500) w.intByteText('');
            w.i32(b.tempo);
            w.zeros(ver >= 510 ? 2 : 1);
            if (ver >= 400) w.u8(0);
            if (ver >= 500) w.u8(0);
            if (ver >= 510) {
              w.intByteText('');
              w.intByteText('');
            }
          }
          w.u8(b.notes.reduce((f, n) => f | (1 << (6 - n.string)), 0));
          for (const n of [...b.notes].sort((x, y) => x.string - y.string)) {
            w.u8(0x20 | (n.effects ? 0x08 : 0));
            w.u8(n.tie ? 2 : 1);
            w.u8(n.fret);
            if (ver >= 500) w.u8(0);
            if (n.effects) {
              w.u8(0x11);
              if (ver >= 400) w.u8(0);
              w.u8(1);
              w.i32(50);
              w.i32(2);
              for (const [at, by] of [
                [0, 0],
                [60, 50],
              ]) {
                w.i32(at);
                w.i32(by);
                w.u8(0);
              }
              w.zeros(ver >= 500 ? 5 : 4);
            }
          }
          if (ver >= 500) w.i16(0);
        }
      }
    }
  });
  return new Uint8Array(w.a);
}

const all = (r: ReturnType<typeof parseGp345>) => r.doc.lines.flatMap((l) => l.events);
const notes = (r: ReturnType<typeof parseGp345>) => all(r).filter((e): e is NoteEvent => e.kind === 'note');
const midi = (e: NoteEvent) => (e.sounds[0]?.type === 'pitch' ? e.sounds[0].midi : 0);

describe('Guitar Pro 3–5', () => {
  for (const ver of [300, 406, 500, 510]) {
    describe(`version ${ver / 100}`, () => {
      const r = parseGp345(gpFile(ver));

      it('the song: title, artist, time; the tempo played longest, its change said', () => {
        const { meta } = r.doc;
        expect([meta.title, meta.artist, meta.time, meta.tempo]).toEqual(['Di Sini Senang', 'Folk', '4/4', 90]);
        expect(r.warnings.join(' ')).toContain('90–120 bpm');
      });

      it('the melody taken, the bass offered under Part', () => {
        expect(r.parts).toEqual([
          { id: '0:0', label: 'Bass' },
          { id: '1:0', label: 'Melody' },
        ]);
        expect(r.part).toBe('1:0');
        expect(notes(r.choosePart!('0:0')).map(midi)).toEqual([40, 40, 40]);
      });

      it('notes from string and fret; a triplet, a dot, a tie over the bar line, a rest', () => {
        const ns = notes(r);
        expect(ns.map(midi)).toEqual([72, 74, 76, 77, 77, 79, 77, 76, 74, 72, 72]);
        expect(ns.map((e) => +e.beats.toFixed(3))).toEqual([1, 1, 1, 1, 1, 0.333, 0.333, 0.333, 1.5, 0.5, 2]);
        expect(ns[4].tied).toBe(true);
        expect(all(r).filter((e) => e.kind === 'rest').map((e) => (e as { beats: number }).beats)).toEqual([2]);
      });

      it('chords, repeats, endings, the end bar, the marker as a section', () => {
        const events = all(r);
        expect(events.flatMap((e) => (e.kind !== 'bar' && e.chord ? [e.chord] : []))).toEqual(['C', 'G7']);
        expect(events.flatMap((e) => (e.kind === 'bar' ? [e.style] : []))).toEqual(['repeat-start', 'single', 'repeat-end', 'final']);
        const firstOf = (bar: number) => {
          let n = 0;
          for (const e of events as TabEvent[]) {
            if (e.kind === 'bar' && e.style !== 'repeat-start') n++;
            else if (e.kind !== 'bar' && n === bar) return e;
          }
        };
        expect([firstOf(1)?.ending, firstOf(2)?.ending]).toEqual([[1], [2]]);
        expect(r.doc.lines[0].section).toBe('Verse');
      });
    });
  }

  // (Guitar Pro 3 keeps no words.)
  for (const ver of [406, 500, 510]) {
    it(`version ${ver / 100}: the words, laid on the melody’s notes (the tied one takes none)`, () => {
      expect(notes(parseGp345(gpFile(ver))).slice(0, 6).map((e) => lyricOf(e, 0))).toEqual(['Di', 'si-', 'ni', 'se-', undefined, 'nang']);
    });
  }

  it('recognised by name, and by its opening words; a cut-off file said plainly', () => {
    const file = gpFile(510);
    expect(detectKind('song.gp5', file)).toBe('gp3to5');
    expect(detectKind('download', file)).toBe('gp3to5');
    expect(importBytes('song.gp4', gpFile(406)).doc.meta.title).toBe('Di Sini Senang');
    expect(() => parseGp345(file.subarray(0, 900))).toThrow(/could not be read/);
  });
});
