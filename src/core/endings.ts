// 1st/2nd endings as the sheet shows them: where on a line each ending's bracket starts and
// stops. An ending runs from the bar it's written on to its ":|", a "||" or "|]", the next
// "|:" or ending, or the end of the line (see repeats.ts for how they're played).

import type { TabEvent } from './htab/types';

const EPS = 1e-6;

export interface EndingSpan {
  /** The times through it's played ([1], [1, 2]…). */
  nums: number[];
  /** The line's events it runs over: from its first note or rest to its last. */
  first: number;
  last: number;
  /** It ends with the ":|" that goes back (its bracket closes with a hook). */
  closed: boolean;
}

/** The endings on a line of events, in order. */
export function endingSpans(events: TabEvent[]): EndingSpan[] {
  const out: EndingSpan[] = [];
  let span: EndingSpan | null = null;
  // The bar being read: where its music is (event indexes), and whether it's begun.
  let firstEi = -1;
  let lastEi = -1;
  const endBar = (style: string | null) => {
    if (firstEi < 0) return;
    if (span) {
      span.last = lastEi;
      if (style === 'repeat-end' || style === 'double' || style === 'final' || style === 'repeat-start' || style === null) {
        span.closed = style === 'repeat-end';
        out.push(span);
        span = null;
      }
    }
    firstEi = -1;
  };
  events.forEach((ev, ei) => {
    if (ev.kind === 'bar') {
      endBar(ev.style);
      return;
    }
    if (ev.beats <= EPS) return;
    if (firstEi < 0) {
      firstEi = ei;
      if (ev.ending?.length) {
        if (span) out.push(span);
        span = { nums: ev.ending, first: ei, last: ei, closed: false };
      }
    }
    lastEi = ei;
  });
  endBar(null);
  if (span) out.push(span);
  return out;
}

/** 2 → "2nd". */
export function ordinal(n: number): string {
  const tail = n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${tail}`;
}

/** "1." / "1. 2." — an ending's label. */
export function endingLabel(nums: number[]): string {
  return nums.map((n) => `${n}.`).join(' ');
}
