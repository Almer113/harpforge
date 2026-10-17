// Phase 18a: the contour view's layout.

import { describe, expect, it } from 'vitest';
import { parseHtab } from './htab/parser';
import { buildScore, eventKey, harmonicaFromMeta } from './score';
import { contourLayout, semitoneHeight } from './contourLayout';

const layoutOf = (body: string, head = 'title: C') => {
  const { doc } = parseHtab(`---\n${head}\n---\n${body}\n`);
  const { score } = buildScore(doc, harmonicaFromMeta(doc.meta));
  const indexByKey = new Map(score.events.map((e) => [eventKey(e.line, e.eventIndex), e.index]));
  return contourLayout(doc, score, indexByKey);
};

describe('the contour layout', () => {
  it('a row per line: each note where it starts, as long as it lasts, at its pitch', () => {
    const l = layoutOf('4 -4~ 5 |\n6 |');
    expect(l.rows).toHaveLength(2);
    expect(l.rows[0].bars.map((b) => [b.x, b.w, b.midi])).toEqual([
      [0, 1, 72],
      [1, 2, 74],
      [3, 1, 76],
    ]);
    expect(l.rows[0].barLines).toEqual([{ x: 4, style: 'single' }]);
    expect([l.lo, l.hi, l.maxBeats]).toEqual([72, 79, 4]);
  });

  it('a bend at the pitch it bends to; a chord: a bar for each note', () => {
    const l = layoutOf("-3' (4 5 6) |");
    expect(l.rows[0].bars.map((b) => [b.midi, b.chord])).toEqual([
      [70, false],
      [72, true],
      [76, true],
      [79, true],
    ]);
    expect(l.rows[0].bars[1].index).toBe(l.rows[0].bars[3].index);
  });

  it('lanes: the pitches used, high to low, with the holes played on each (most used first)', () => {
    const l = layoutOf('-2 3 3 -4 |');
    expect(l.lanes).toEqual([
      { midi: 74, holes: ['-4'] },
      { midi: 67, holes: ['3', '-2'] },
    ]);
  });

  it('a tied note: its own bar, joined to the one before; rests are gaps', () => {
    const l = layoutOf('6~ | ~ . 5 |');
    expect(l.rows[0].bars.map((b) => [b.x, b.w, b.tied])).toEqual([
      [0, 2, false],
      [2, 1, true],
      [4, 1, false],
    ]);
  });

  it('sections, chord symbols, repeat signs and endings', () => {
    const l = layoutOf('@ Verse\n|: [C] 4 4 | [1.] [G] -4 -4 :| [2.] 4 4 |]');
    const row = l.rows[0];
    expect(row.section).toBe('Verse');
    expect(row.chords).toEqual([{ x: 0, text: 'C' }, { x: 2, text: 'G' }]);
    expect(row.barLines.map((b) => [b.x, b.style])).toEqual([
      [0, 'repeat-start'],
      [2, 'single'],
      [4, 'repeat-end'],
      [6, 'final'],
    ]);
    expect(row.endings.map((e) => [e.from, e.to, e.nums])).toEqual([
      [2, 4, [1]],
      [4, 6, [2]],
    ]);
  });

  it('a semitone is tall enough to read, short enough for a wide range', () => {
    expect(semitoneHeight(60, 64)).toBe(12);
    expect(semitoneHeight(48, 96)).toBe(5);
    expect(semitoneHeight(60, 84)).toBeCloseTo(220 / 24);
  });
});
