// Phase 9a: passages (a stretch of a song, for looping) and how a looped stretch sounds.

import { describe, expect, it } from 'vitest';
import { parseHtab } from './htab/parser';
import { barAt, barNumberAt, barPassage, barStarts, describePassage, eventsIn, joinPassages } from './passage';
import { buildScore, harmonicaFromMeta, soundSpans } from './score';

const score = (body: string) => {
  const doc = parseHtab(`---\n---\n${body}`).doc;
  return buildScore(doc, harmonicaFromMeta(doc.meta)).score;
};

describe('bars', () => {
  it('start where the bar lines are, with a pickup as bar 1', () => {
    const s = score('4 | 5 5 5 5 | 6 6 6 6 |\n7 7 7 7 |');
    expect(barStarts(s)).toEqual([0, 1, 5, 9]);
    expect(barAt(s, 6)).toBe(2);
    expect(barPassage(s, 2)).toEqual({ start: 5, end: 9 });
    expect(barPassage(s, 3)).toEqual({ start: 9, end: 13 });
    expect(barNumberAt(s, 5)).toBe(3);
    expect(barNumberAt(s, 6)).toBeNull();
  });

  it('a bar carried over to the next line has one number', () => {
    const s = score('4 4 | 5 5\n5 5 | 6 6 6 6 |');
    expect(barStarts(s)).toEqual([0, 2, 6]);
    expect(barNumberAt(s, 4)).toBeNull();
  });
});

describe('passages', () => {
  const s = score('4 4 4 4 | 5 5 5 5 | 6 6 6 6 | 7 7 7 7 |');
  it('hold the notes that start in them', () => {
    expect(eventsIn(s, { start: 4, end: 8 })).toEqual([4, 5, 6, 7]);
    expect(eventsIn(s, joinPassages({ start: 9, end: 10 }, { start: 4, end: 5 }))).toEqual([4, 5, 6, 7, 8, 9]);
  });

  it('are named by their bars', () => {
    expect(describePassage(s, { start: 4, end: 8 })).toBe('bar 2');
    expect(describePassage(s, { start: 4, end: 16 })).toBe('bars 2–4');
    expect(describePassage(s, { start: 5, end: 9 })).toBe('bars 2–3');
  });
});

it('a tied note sounds from its first piece to its last tie', () => {
  const s = score('4 5~ | ~ 6 . 6 |');
  const spans = soundSpans(s);
  // 5 (beat 1) is tied over the bar line to beat 4: both pieces sound from 1 to 4.
  expect(spans[1]).toEqual({ start: 1, end: 4 });
  expect(spans[2]).toEqual({ start: 1, end: 4 });
  expect(spans[3]).toEqual({ start: 4, end: 5 });
});
