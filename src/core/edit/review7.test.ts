// Phase 7 review: what the review found, fixed. Insert mode and placing notes keep bars
// split over two lines, unbarred tabs and short last bars as written; re-barring keeps the
// whole repeat; copy, MIDI rhythm, ChordPro words and odd meters read right.

import { describe, expect, it } from 'vitest';
import { writeMidi, parseMidi } from '../formats/midi';
import { parseChordPro } from '../formats/chordpro';
import { parseHtab } from '../htab/parser';
import { bodyText, serializeHtab } from '../htab/serializer';
import type { TabDoc } from '../htab/types';
import { buildScore, harmonicaFromMeta } from '../score';
import { holeSound } from '../types';
import { copyText } from './clipboard';
import { changeLengths, deleteNotes, fromDoc, makeRoom, placeItem, setTimeSignature, toDoc, type Song } from './model';

const song = (b: string, time = '4/4') => fromDoc(parseHtab(`---\ntime: ${time}\n---\n${b}`).doc);
const body = (s: Song) => bodyText(toDoc(s).lines);
const three = { dur: 1, sounds: [holeSound(3, 'blow')] };
const insert = (s: Song, m: number, start: number) => placeItem(makeRoom(s, { m, start }, 1, true), m, { start, ...three });
const SPLIT = '4 4 4 4 | 5 5\n6 6 | 7 7 7 7 |';

describe('a bar split over two lines of text', () => {
  it('Insert mode keeps it split, the line starting after the same note', () => {
    expect(body(insert(song(SPLIT), 1, 0))).toBe('4 4 4 4 | 3 5 5\n6 | 6 7 7 7 | 7 .~~ |');
    expect(body(deleteNotes(song(SPLIT), [{ m: 1, start: 0 }], true))).toBe('4 4 4 4 | 5\n6 6 7 | 7 7 7 . |');
    expect(body(changeLengths(song(SPLIT), [{ m: 1, start: 1 }], 2, true).song)).toBe('4 4 4 4 | 5 5\n~ 6 | 6 7 7 7 | 7 .~~ |');
  });

  it('copying across it writes no bar line', () => {
    expect(copyText(song(SPLIT), [{ m: 1, start: 1 }, { m: 2, start: 0 }])).toBe('5 6');
  });
});

describe('the last bar, and tabs without bar lines', () => {
  it('a note placed past the end of a short last bar makes it longer', () => {
    expect(body(placeItem(song('4 4 4 4 | 5 5'), 1, { start: 1, dur: 2, sounds: three.sounds }))).toBe('4 4 4 4 | 5 3~');
    expect(body(placeItem(song('4 4 4 4 | 5 5 |'), 1, { start: 1, dur: 2, sounds: three.sounds }))).toBe('4 4 4 4 | 5 3~ |');
    expect(body(placeItem(song('4 5 6 7 8 9'), 1, { start: 1, dur: 2, sounds: three.sounds }))).toBe('4 5 6 7 8 3~');
  });

  it('Insert mode adds no bar lines to an unbarred tab, and its lines start after the same notes', () => {
    expect(body(insert(song('4 5 6 7 8 9\n1 2 3'), 0, 0))).toBe('3 4 5 6 7 8 9\n1 2 3');
    expect(body(insert(song('4 5 6 7 8 9\n1 2 3'), 1, 0))).toBe('4 5 6 7 3 8 9\n1 2 3');
    expect(body(deleteNotes(song('4 5 6 7 8 9\n1 2 3'), [{ m: 0, start: 0 }], true))).toBe('5 6 7 8 9\n1 2 3');
  });
});

it('re-barring keeps the rests before a closing repeat sign (the repeat stays the same length)', () => {
  expect(body(setTimeSignature(song('|: 4 5 6 7 | 8 8 . . :|'), '3/4', true))).toBe('|: 4 5 6 | 7 8 8 | .~ :|');
});

it('a full 7/8 bar is counted from its start; only a short first bar is a pickup', () => {
  const text = serializeHtab(parseHtab('---\ntime: 7/8\n---\n4 5 {6 -6 6}~~/2 |\n{4 5~}~~/2 | 6 6 6 {6}/2 |\n').doc);
  expect(text).toContain('4 5 {6 -6} {6}/2 |');
  expect(text).toContain('{4}/2 5 |');
});

it('ChordPro: a word split by the first chord stays one word', () => {
  expect(parseChordPro('Well-[G]known [C]words').doc.lines[0].events.map((e) => (e.kind === 'bar' ? null : e.lyric))).toEqual(['Well-known', 'words', null]);
});

describe('MIDI rhythm', () => {
  const music = (d: TabDoc) =>
    buildScore(d, harmonicaFromMeta(d.meta)).score.events.filter((e) => !e.tied && !e.rest).map((e) => [+e.start.toFixed(4), +e.soundBeats.toFixed(4), e.midis.join('+')]);

  it('a dotted eighth followed by a rest comes back exact', () => {
    const d = parseHtab('---\nharmonica: diatonic\nharp-key: C\n---\n4 4 4 4 | -5~~ {-4~~ .} |').doc;
    const back = parseMidi(writeMidi(d, harmonicaFromMeta(d.meta))).doc;
    expect(music(back)).toEqual(music(d));
  });

  /** A one-track MIDI file from [start, end, pitch] in beats (480 ticks a beat). */
  function midiOf(notes: [number, number, number][]): Uint8Array {
    const evs = notes.flatMap(([a, b, m]) => [[Math.round(a * 480), 0x90, m, 90], [Math.round(b * 480), 0x80, m, 0]]).sort((x, y) => x[0] - y[0]);
    const vl = (n: number) => { const out = [n & 0x7f]; n >>= 7; while (n > 0) { out.unshift((n & 0x7f) | 0x80); n >>= 7; } return out; };
    const t: number[] = [];
    let last = 0;
    for (const [tick, st, m, v] of evs) {
      t.push(...vl(tick - last), st, m, v);
      last = tick;
    }
    t.push(0, 0xff, 0x2f, 0);
    const head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0];
    return new Uint8Array([...head, 0x4d, 0x54, 0x72, 0x6b, (t.length >>> 24) & 0xff, (t.length >> 16) & 0xff, (t.length >> 8) & 0xff, t.length & 0xff, ...t]);
  }

  it('slightly uneven human timing is not read as quintuplets or septuplets', () => {
    const swing = [0, 0.58, 1.02, 1.6, 2.01, 2.57, 3.03, 3.62].map((s, k, all): [number, number, number] => [s, (all[k + 1] ?? 4) - 0.05, 60 + k]);
    const jitter = [0, 0.55, 0.97, 1.46, 2.04, 2.5, 2.95, 3.53].map((s, k, all): [number, number, number] => [s, (all[k + 1] ?? 4) - 0.05, 62 + k]);
    for (const notes of [swing, jitter]) {
      const lens = music(parseMidi(midiOf(notes)).doc).map(([, len]) => len as number);
      for (const len of lens) expect([4, 3, 6, 12].some((d) => Math.abs(len * d - Math.round(len * d)) < 1e-3)).toBe(true);
    }
  });
});
