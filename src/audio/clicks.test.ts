// Phase 9b: accented clicks fall on the first beat of each bar, of the music and of the count.

import { expect, it } from 'vitest';
import { isAccent } from './clicks';

const accents = (from: number, to: number, info: Parameters<typeof isAccent>[1], bpb: number) => {
  const out: number[] = [];
  for (let b = from; b < to; b++) if (isAccent(b, info, bpb)) out.push(b);
  return out;
};

it('the count before the music accents its own bar starts', () => {
  // Two bars of 3/4 counted in before beat 7.
  expect(accents(1, 7, { offset: 6, countFrom: 1, count: 6 }, 3)).toEqual([1, 4]);
});

it('the music accents its real bar starts, so a pickup comes out right', () => {
  // A one-beat pickup: bars start at 0, 1, 5, 9.
  expect(accents(0, 12, { offset: 0, barStarts: [0, 1, 5, 9], countFrom: 0, count: 0 }, 4)).toEqual([0, 1, 5, 9]);
});

it('without bar starts (recording), every bar of the time signature', () => {
  expect(accents(-4, 8, { offset: 4, countFrom: -4, count: 4 }, 4)).toEqual([-4, 0, 4]);
});

it('a count starting part way through a beat accents the first click of each of its bars', () => {
  // Two bars of 4/4 counted in before beat 10.5: clicks at 2.5, 3.5, … 9.5.
  const info = { offset: 8, countFrom: 2.5, count: 8 };
  const at = [2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5].filter((b) => isAccent(b, info, 4));
  expect(at).toEqual([2.5, 6.5]);
});
