// Phase 12b: backing chords from the chord symbols — which notes, when, how loud.

import { describe, expect, it } from 'vitest';
import { backingNotes, bassNote, chordSpans, chordVoicing, hasChords, pulseOf } from './backing';
import { parseHtab } from './htab/parser';
import { buildScore, harmonicaFromMeta } from './score';

const score = (body: string, time = '4/4') => {
  const { doc } = parseHtab(`---\ntitle: B\ntime: ${time}\n---\n${body}\n`);
  return buildScore(doc, harmonicaFromMeta(doc.meta)).score;
};
/** "beat:part" for each backing note. */
const rhythm = (body: string, style: 'pad' | 'strum' | 'oompah', time = '4/4') =>
  backingNotes(score(body, time), time, style).map((n) => `${n.at}${n.part === 'bass' ? 'B' : n.up ? 'u' : 'c'}`).join(' ');

describe('the chords', () => {
  it('each lasts until the next; N.C. is silence; other brackets change nothing', () => {
    const spans = chordSpans(score('[C] 4 4 [G7] 5 5 | [N.C.] 6 6 [Fine] 6 6 |'));
    expect(spans.map((c) => [c.start, c.end, c.tones?.length ?? null])).toEqual([
      [0, 2, 3],
      [2, 4, 4],
      [4, 8, null],
    ]);
    expect(hasChords(score('4 5 6 |'))).toBe(false);
  });

  it('voiced close together under the harmonica, the bass low (a slash chord’s bass under it)', () => {
    expect(chordVoicing([0, 4, 7])).toEqual([52, 55, 60]); // E3 G3 C4
    // A 9th chord: four notes, its 5th left out.
    expect(chordVoicing([0, 4, 7, 10, 2])).toHaveLength(4);
    expect(chordVoicing([0, 4, 7, 10, 2])).not.toContain(55);
    expect(bassNote(0)).toBe(48);
    const slash = chordSpans(score('[C/E] 4 4 4 4 |'))[0];
    expect(bassNote(slash.bass!)).toBe(40); // E2
  });

  it('the beat a meter is felt in', () => {
    expect([pulseOf('4/4'), pulseOf('3/4'), pulseOf('6/8'), pulseOf('2/2'), pulseOf('7/8')]).toEqual([1, 1, 1.5, 2, 1]);
  });
});

describe('the styles', () => {
  it('pad: held for as long as each chord lasts, the bass with it', () => {
    const notes = backingNotes(score('[C] 4 4 4 4 | [G] 5 5 5 5 |'), '4/4', 'pad');
    expect(notes.map((n) => [n.at, n.dur, n.midis.length])).toEqual([
      [0, 4, 4],
      [4, 4, 4],
    ]);
  });

  it('strum in 4/4: down, down-up, down, down-up; the bar’s first stronger', () => {
    expect(rhythm('[C] 4 4 4 4 |', 'strum')).toBe('0c 1c 1.5u 2c 3c 3.5u');
    const [first, second] = backingNotes(score('[C] 4 4 4 4 |'), '4/4', 'strum');
    expect(first.vel).toBeGreaterThan(second.vel);
  });

  it('oom-pah: 4/4 bass, chord, bass (the fifth), chord; a waltz in 3/4; a lilt in 6/8', () => {
    expect(rhythm('[C] 4 4 4 4 |', 'oompah')).toBe('0B 1c 2B 3c');
    const fifth = backingNotes(score('[C] 4 4 4 4 |'), '4/4', 'oompah')[2];
    expect(fifth.midis).toEqual([43]); // G2
    expect(rhythm('[C] 4 4 4 | 4 4 4 |', 'oompah', '3/4')).toBe('0B 1c 2c 3B 4c 5c');
    expect(rhythm('[C] {4 4 4}~~/2 {4 4 4}~~/2 |', 'oompah', '6/8')).toBe('0B 1.5c');
  });

  it('a chord change on a beat is followed; N.C. stops it', () => {
    expect(rhythm('[C] 4 4 [N.C.] 4 4 |', 'oompah')).toBe('0B 1c');
  });

  it('a pickup’s beats are the end of a bar: no bass on it', () => {
    expect(rhythm('[C] 4 | [G] 5 5 5 5 |', 'oompah')).toBe('0c 1B 2c 3B 4c');
  });

  it('from part way: a pad at once, strums from the next beat', () => {
    const s = score('[C] 4~~~ | [G] 5~~~ |');
    expect(backingNotes(s, '4/4', 'pad', 2.5).map((n) => [n.at, n.dur])).toEqual([
      [2.5, 1.5],
      [4, 4],
    ]);
    expect(backingNotes(s, '4/4', 'strum', 2.5)[0].at).toBe(3);
  });
});
