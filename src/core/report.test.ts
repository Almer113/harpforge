// Phase 9e: the practice report.

import { expect, it } from 'vitest';
import { parseHtab } from './htab/parser';
import type { PassResult } from './playAlong';
import { accuracy, alongReport, practiceReport } from './report';
import { buildScore, harmonicaFromMeta } from './score';

const doc = parseHtab("---\n---\n4 -3' 5 6 | -3' -3' (4 5) 6 |\n").doc;
const score = buildScore(doc, harmonicaFromMeta(doc.meta)).score;
const pass = (p: Partial<PassResult>): PassResult => ({ hit: 0, early: 0, late: 0, missed: 0, strays: 0, total: 8, clean: false, missedAt: [], offAt: [], ...p });

it('play along: the holes and bars missed most, worst first, and how the passes went', () => {
  const r = alongReport(score, [
    pass({ hit: 5, late: 1, missed: 2, missedAt: [1, 4], offAt: [6] }),
    pass({ hit: 7, missed: 1, missedAt: [5] }),
    pass({ hit: 8, clean: true }),
  ]);
  expect(r).toMatchObject({ passes: 3, clean: 1, notes: 24, played: 21, inTime: 20 });
  expect(accuracy(r)).toBe(88);
  expect(r.holes[0]).toEqual({ label: "-3'", misses: 3, off: 0 });
  expect(r.holes[1]).toEqual({ label: '(4 5)', misses: 0, off: 1 });
  expect(r.bars.map((b) => [b.bar, b.misses, b.off])).toEqual([[2, 2, 1], [1, 1, 0]]);
  expect(r.bars[0].passage).toEqual({ start: 4, end: 8 });
});

it('practice mode: the wrong notes tried on each note', () => {
  const r = practiceReport(score, 8, { 1: 2, 4: 1, 7: 1 });
  expect(r).toMatchObject({ mode: 'practice', played: 8, mistakes: 4 });
  expect(accuracy(r)).toBe(67);
  expect(r.holes.map((h) => h.label)).toEqual(["-3'", '6']);
  expect(r.bars.map((b) => b.bar)).toEqual([1, 2]);
});
