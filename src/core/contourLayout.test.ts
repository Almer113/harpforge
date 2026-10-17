// Phase 18a: the contour view's layout.

import { describe, expect, it } from 'vitest';
import { parseHtab } from './htab/parser';
import { buildScore, eventKey, harmonicaFromMeta } from './score';
import { contourLayout, namedLanes, semitoneHeight, wrapRow } from './contourLayout';

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
      { midi: 74, holes: ['-4'], uses: 1 },
      { midi: 67, holes: ['3', '-2'], uses: 3 },
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

  it('a row too long for the width: broken at its bar lines, each part from 0', () => {
    const row = layoutOf('@ V\n[C] 4 4 4 4 | 5 5 5 5 | [G] 6 6 6 6 | -4 -4 -4 -4 |').rows[0];
    const parts = wrapRow(row, 9);
    expect(parts.map((p) => [p.section, p.beats, p.bars.length, p.bars[0].x])).toEqual([
      ['V', 8, 8, 0],
      [undefined, 8, 8, 0],
    ]);
    expect(parts[1].chords).toEqual([{ x: 0, text: 'G' }]);
    expect(parts[0].barLines.map((b) => b.x)).toEqual([4, 8]);
    expect(wrapRow(row, 99)).toEqual([row]);
  });

  it('broken inside an ending: its bracket carries on (no label again); a |: starts the next part', () => {
    const row = layoutOf('4 4 4 4 |: 5 5 5 5 | [1.] 6 6 6 6 | 6 6 6 6 :| [2.] 4 4 4 4 |]').rows[0];
    const parts = wrapRow(row, 4);
    expect(parts).toHaveLength(5);
    expect(parts[0].barLines.map((b) => b.style)).toEqual([]);
    expect(parts[1].barLines.map((b) => [b.x, b.style])).toEqual([[0, 'repeat-start'], [4, 'single']]);
    expect(parts[2].endings.map((e) => [e.from, e.to, e.continued, e.closed])).toEqual([[0, 4, false, false]]);
    expect(parts[3].endings.map((e) => [e.from, e.to, e.continued, e.closed])).toEqual([[0, 4, true, true]]);
  });

  it('a line without bar lines: broken between notes', () => {
    const row = layoutOf('4 5 6 7 4 5 6 7').rows[0];
    expect(wrapRow(row, 3).map((p) => p.beats)).toEqual([3, 3, 2]);
  });

  it('a chord symbol at a line’s end goes on the next line’s first note (as it plays)', () => {
    const l = layoutOf('4 4 4 [G] |\n5 5 5 5 |');
    expect(l.rows[0].chords).toEqual([]);
    expect(l.rows[1].chords).toEqual([{ x: 0, text: 'G' }]);
  });

  it('a bar wider than the width is broken between notes (it doesn’t run off the side)', () => {
    const row = layoutOf('4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 | 5 5 |').rows[0];
    const parts = wrapRow(row, 12.4);
    expect(parts.every((p) => p.beats <= 12.4)).toBe(true);
    expect(parts.map((p) => p.beats)).toEqual([12, 6]);
  });

  it('a tied-over part doesn’t count as playing the hole again (the lane’s holes, most used first)', () => {
    const l = layoutOf('-2~ | ~ 3 |');
    expect(l.lanes).toEqual([{ midi: 67, holes: ['-2', '3'], uses: 2 }]);
    expect(layoutOf('4~ | ~ |').lanes).toEqual([{ midi: 72, holes: ['4'], uses: 1 }]);
  });

  it('a note not on this harmonica: a bar without a pitch (drawn as "?"), not left out', () => {
    const l = layoutOf('4 11 |');
    expect(l.rows[0].bars.map((b) => [b.x, b.off ?? false, Number.isNaN(b.midi)])).toEqual([
      [0, false, false],
      [1, true, true],
    ]);
    expect(l.lanes.map((x) => x.midi)).toEqual([72]);
  });

  it('lane names that would crowd each other: the one played more keeps its name', () => {
    const lanes = [
      { midi: 77, holes: ['-5'], uses: 1 },
      { midi: 76, holes: ['5'], uses: 4 },
      { midi: 72, holes: ['4'], uses: 2 },
    ];
    expect([...namedLanes(lanes, 6)]).toEqual([76, 72]);
    expect([...namedLanes(lanes, 12)]).toEqual([77, 76, 72]);
  });

  it('a semitone is tall enough to read, short enough for a wide range', () => {
    expect(semitoneHeight(60, 64)).toBe(12);
    expect(semitoneHeight(48, 96)).toBe(5);
    expect(semitoneHeight(60, 84)).toBeCloseTo(220 / 24);
  });
});
