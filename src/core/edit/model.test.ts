import { describe, expect, it } from 'vitest';
import { DEMOS } from '../../demo/songs';
import { parseHtab } from '../htab/parser';
import { bodyText, serializeHtab } from '../htab/serializer';
import { buildScore, harmonicaFromMeta } from '../score';
import { holeSound } from '../types';
import {
  advance,
  deleteMeasure,
  duplicateMeasure,
  fromDoc,
  insertMeasure,
  moveItem,
  placeItem,
  removeItems,
  setTimeSignature,
  toDoc,
  updateItem,
  type Song,
} from './model';

const song = (body: string, time = '4/4') => fromDoc(parseHtab(`---\ntime: ${time}\n---\n${body}`).doc);
const body = (s: Song) => bodyText(toDoc(s).lines);

describe('edit model: doc ↔ measures', () => {
  it('round-trips every demo song: same music, and stable on a second pass', () => {
    // Timing, sounds, chords and lyrics of every note (rests may merge: ". ." ≡ ".~").
    const music = (doc: ReturnType<typeof toDoc>) => {
      const harp = harmonicaFromMeta(doc.meta);
      return buildScore(doc, harp).score.events.filter((e) => !e.rest || e.chord).map((e) => [e.start, e.beats, e.midis, e.chord, e.lyric]);
    };
    for (const { text } of DEMOS) {
      const doc = parseHtab(text).doc;
      const once = toDoc(fromDoc(doc));
      expect(music(once)).toEqual(music(doc));
      expect(serializeHtab(toDoc(fromDoc(once)))).toBe(serializeHtab(once));
    }
  });

  it('splits measures at bars and keeps lines, sections, chords and lyrics', () => {
    const s = song('@ A\n[C] 4 -4 5 6 | 6~~~ |\nw: a b c d e\n-5 . . . |');
    expect(s.measures).toHaveLength(3);
    expect(s.measures[0]).toMatchObject({ section: 'A', lineBreak: true });
    expect(s.measures[0].items[0]).toMatchObject({ start: 0, dur: 1, chord: 'C', lyric: 'a' });
    expect(s.measures[2].lineBreak).toBe(true);
    expect(s.measures[2].items).toHaveLength(1); // rests are gaps
  });

  it('bars unbarred tabs by the time signature', () => {
    const s = song('4 4 6 6 -6 -6 6~', '4/4');
    expect(s.measures.map((m) => m.items.length)).toEqual([4, 3]);
    expect(body(s)).toBe('4 4 6 6 | -6 -6 6~ |');
  });
});

describe('edit model: notes', () => {
  const base = () => song('4 5 6 7 |');

  it('overwrites what a placed note lands on', () => {
    const s = placeItem(base(), 0, { start: 1, dur: 2, sounds: [holeSound(3, 'draw')] });
    expect(body(s)).toBe('4 -3~ 7 |');
  });

  it('shortens a note running into a placed one and clips to the measure', () => {
    const s0 = song('4~~~ |');
    expect(body(placeItem(s0, 0, { start: 2, dur: 4, sounds: [holeSound(6, 'blow')] }))).toBe('4~ 6~ |');
  });

  it('deletes into rests and moves/copies between measures', () => {
    const s = song('4 5 6 7 | . . . . |');
    expect(body(removeItems(s, [{ m: 0, start: 1 }]))).toBe('4 . 6 7 | .~~~ |');
    expect(body(moveItem(s, { m: 0, start: 0 }, { m: 1, start: 2 }))).toBe('. 5 6 7 | .~ 4 . |');
    expect(body(moveItem(s, { m: 0, start: 0 }, { m: 1, start: 0.5 }, true))).toBe('4 5 6 7 | {. 4~ .}~ .~ |');
  });

  it('changes durations (longer overwrites, shorter leaves a rest)', () => {
    const s = base();
    expect(body(updateItem(s, { m: 0, start: 0 }, { dur: 2 }))).toBe('4~ 6 7 |');
    expect(body(updateItem(s, { m: 0, start: 0 }, { dur: 0.5 }))).toBe('{4 .} 5 6 7 |');
    expect(body(updateItem(s, { m: 0, start: 3 }, { sounds: [holeSound(8, 'draw')], chord: 'G' }))).toBe('4 5 6 [G] -8 |');
  });

  it('advances the caret into the next measure', () => {
    const s = base();
    expect(advance(s, { m: 0, start: 3 }, 1)).toEqual({ m: 1, start: 0 });
    expect(advance(s, { m: 0, start: 1 }, 0.5)).toEqual({ m: 0, start: 1.5 });
  });
});

describe('edit model: measures and time signatures', () => {
  it('inserts, duplicates and deletes measures', () => {
    const s = song('4 5 6 7 | -4 -5 -6 -7 |');
    expect(body(insertMeasure(s, 1))).toBe('4 5 6 7 | .~~~ | -4 -5 -6 -7 |');
    expect(body(duplicateMeasure(s, 0))).toBe('4 5 6 7 | 4 5 6 7 | -4 -5 -6 -7 |');
    expect(body(deleteMeasure(s, 0))).toBe('-4 -5 -6 -7 |');
  });

  it('moves the end bar to the new last measure when the song grows', () => {
    const s = song('4 5 6 7 |]');
    expect(body(insertMeasure(s, 1))).toBe('4 5 6 7 | .~~~ |]');
    expect(body(placeItem(s, 2, { start: 0, dur: 1, sounds: [holeSound(4, 'blow')] }))).toBe('4 5 6 7 | .~~~ | 4 .~~ |]');
  });

  it('keeps bars when only the meter changes, or reflows notes into the new bars', () => {
    const s = song('4 5 6 7 | -4 -5~ -6 |');
    const kept = setTimeSignature(s, '3/4', false);
    expect(kept.cap).toBe(3);
    expect(kept.measures).toHaveLength(2);
    const re = setTimeSignature(s, '3/4', true);
    expect(re.meta.time).toBe('3/4');
    // 8 beats → bars of 3; the long -5 is split across the bar line.
    expect(body(re)).toBe('4 5 6 | 7 -4 -5 | -5 -6 . |');
  });
});
