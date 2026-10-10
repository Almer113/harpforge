// 1st/2nd endings as the sheet shows them: where on a line each ending's bracket starts and
// stops. An ending runs from the bar it's written on to its ":|", a "||" or "|]", the next
// "|:" or ending, or the end of the line (see repeats.ts for how they're played).

import type { TabDoc, TabEvent } from './htab/types';
import type { Score } from './score';

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

/** What the editor knows of a bar, for its ending's bracket. */
interface BarLike {
  ending?: number[];
  startBar?: string;
  endBar: string;
  lineBreak: boolean;
}

/**
 * Each bar's place under an ending's bracket (the visual editor's measures): its numbers,
 * whether the bracket starts or stops there, and whether it closes with a hook (":|").
 */
export function measureEndings(bars: BarLike[]): ({ nums: number[]; start: boolean; end: boolean; closed: boolean } | null)[] {
  const out: ({ nums: number[]; start: boolean; end: boolean; closed: boolean } | null)[] = bars.map(() => null);
  for (let i = 0; i < bars.length; i++) {
    const nums = bars[i].ending;
    if (!nums?.length) continue;
    let j = i;
    for (; j + 1 < bars.length; j++) {
      const b = bars[j];
      const next = bars[j + 1];
      if (b.endBar === 'repeat-end' || b.endBar === 'double' || b.endBar === 'final') break;
      if (next.startBar === 'repeat-start' || next.ending?.length || next.lineBreak) break;
    }
    for (let k = i; k <= j; k++) out[k] = { nums, start: k === i, end: k === j, closed: k === j && bars[j].endBar === 'repeat-end' };
    i = j;
  }
  return out;
}

/** Whether a passage (in beats) holds the start of an ending: looped, it plays as written, every ending in turn. */
export function passageHasEndings(doc: TabDoc, score: Score, range: { start: number; end: number }): boolean {
  return score.events.some((ev) => {
    if (ev.start < range.start - EPS || ev.start >= range.end - EPS) return false;
    const src = doc.lines[ev.line]?.events[ev.eventIndex];
    return !!src && src.kind !== 'bar' && !!src.ending?.length;
  });
}
