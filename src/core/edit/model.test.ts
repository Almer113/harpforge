import { describe, expect, it } from 'vitest';
import { DEMOS } from '../../demo/songs';
import { parseHtab } from '../htab/parser';
import { bodyText, serializeHtab } from '../htab/serializer';
import { buildScore, harmonicaFromMeta } from '../score';
import { holeSound } from '../types';
import {
  advance,
  chainAt,
  removeChains,
  setTie,
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

  it('shortens a note running into a placed one; a long note ties into the next measure', () => {
    const s0 = song('4~~~ |');
    expect(body(placeItem(s0, 0, { start: 2, dur: 4, sounds: [holeSound(6, 'blow')] }))).toBe('4~ 6~ | ~~ .~ |');
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
    // 8 beats → bars of 3; the long -5 is tied across the new bar line.
    expect(body(re)).toBe('4 5 6 | 7 -4 -5 | ~ -6 . |');
    // …and changing back merges the tie again.
    expect(body(setTimeSignature(re, '4/4', true))).toBe('4 5 6 7 | -4 -5~ -6 |');
  });
});

describe('edit model: ties', () => {
  const tied = () => song('4 5 6~ | ~ 7 . . |');

  it('reads and writes ties', () => {
    const s = tied();
    expect(s.measures[1].items[0]).toMatchObject({ start: 0, dur: 1, tied: true });
    expect(body(s)).toBe('4 5 6~ | ~ 7 .~ |');
  });

  it('treats a tied chain as one note', () => {
    const s = tied();
    expect(chainAt(s, { m: 1, start: 0 })).toEqual([{ m: 0, start: 2 }, { m: 1, start: 0 }]);
    // Length of the whole note:
    expect(body(updateItem(s, { m: 1, start: 0 }, { dur: 4 }))).toBe('4 5 6~ | ~~ .~ |');
    expect(body(updateItem(s, { m: 0, start: 2 }, { dur: 1 }))).toBe('4 5 6 . | . 7 .~ |');
    // Sound of the whole note:
    expect(body(updateItem(s, { m: 1, start: 0 }, { sounds: [holeSound(5, 'draw')] }))).toBe('4 5 -5~ | ~ 7 .~ |');
    // Deleting any piece deletes the note:
    expect(body(removeChains(s, [{ m: 1, start: 0 }]))).toBe('4 5 .~ | . 7 .~ |');
    // Moving any piece moves the whole note (the grabbed piece lands on the target):
    expect(body(moveItem(s, { m: 1, start: 0 }, { m: 1, start: 2 }))).toBe('4 5 .~ | 6~~ . |');
    expect(body(moveItem(s, { m: 0, start: 2 }, { m: 0, start: 3 }))).toBe('4 5 . 6 | ~~ .~ |');
  });

  it('ties and unties, and drops ties that no longer follow the same note', () => {
    const s = song('4 4 5 5 |');
    expect(body(setTie(s, { m: 0, start: 1 }, true))).toBe('4~ 5 5 |');
    expect(body(setTie(s, { m: 0, start: 3 }, true))).toBe('4 4 5~ |');
    const t = tied();
    expect(body(setTie(t, { m: 1, start: 0 }, false))).toBe('4 5 6~ | 6 7 .~ |');
    // Overwriting the start of a chain leaves the rest as a plain note.
    expect(body(placeItem(t, 0, { start: 2, dur: 2, sounds: [holeSound(3, 'draw')] }))).toBe('4 5 -3~ | 6 7 .~ |');
  });
});

describe('auto snap grid', () => {
  it('follows the note length', async () => {
    const { gridFor } = await import('./model');
    expect(gridFor(1)).toBe(0.5); // quarter
    expect(gridFor(0.5)).toBe(0.5); // eighth
    expect(gridFor(1.5)).toBe(0.5); // dotted quarter
    expect(gridFor(0.25)).toBe(0.25); // sixteenth
    expect(gridFor(0.75)).toBe(0.25); // dotted eighth
    expect(gridFor(1 / 3)).toBeCloseTo(1 / 3); // triplet eighth
    expect(gridFor(2 / 3)).toBeCloseTo(1 / 3); // triplet quarter
    expect(gridFor(1 / 6)).toBeCloseTo(1 / 6); // triplet sixteenth
    expect(gridFor(0.125)).toBe(0.125); // 32nd
  });
  it('goes finer for a note that starts off its grid, and with Shift', async () => {
    const { gridForNote, fineGrid } = await import('./model');
    expect(gridForNote(1, 2)).toBe(0.5);
    expect(gridForNote(1, 2.25)).toBe(0.25); // a syncopated quarter
    expect(gridForNote(0.5, 1.5)).toBe(0.5);
    expect(fineGrid(0.5)).toBe(0.25);
    expect(fineGrid(1 / 3)).toBeCloseTo(1 / 6);
    expect(fineGrid(0.125)).toBe(0.125);
  });
});
