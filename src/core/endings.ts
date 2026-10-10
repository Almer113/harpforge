// Repeats and 1st/2nd endings as written: the song's bars, and which bars each ending runs
// over. One rule for playing them (repeats.ts), drawing them (the sheet, the editor) and
// warning about them (the parser):
//
// An ending runs from the bar it's written on to its ":|", a "||" or "|]", the next "|:" or
// ending, or the end of its line — except that a 1st ending whose ":|" is on a later line
// (one that wraps) runs on to that ":|".

import type { BarStyle, TabDoc, TabEvent } from './htab/types';
import type { Score } from './score';

const EPS = 1e-6;

/** What the region rule needs to know of a bar. */
export interface RegionBar {
  /** A repeat starts here ("|:"). */
  start: boolean;
  /** It ends with ":|". */
  end: boolean;
  /** How it ends ('none': no bar line, the bar carries on on the next line). */
  endStyle: BarStyle | 'none' | string;
  /** The line it's on (bars on different lines are where an ending may stop). */
  line: number;
  /** It starts an ending ("[1.]"): the times through it's played. */
  ending?: number[];
  /** The ending it's part of: its first bar's index, and its numbers. */
  region?: { id: number; nums: number[] };
}

/** Marks each bar with the ending it's part of (see the rule above). */
export function assignRegions<T extends RegionBar>(bars: T[]): T[] {
  const stops = (b: RegionBar) => b.end || b.endStyle === 'double' || b.endStyle === 'final';
  for (let i = 0; i < bars.length; i++) {
    const nums = bars[i].ending;
    if (!nums?.length) continue;
    // Whether its ":|" comes before anything that would end it (then it runs on over lines).
    let reachesEnd = false;
    for (let k = i; k < bars.length; k++) {
      if (k > i && (bars[k].start || bars[k].ending?.length)) break;
      if (bars[k].end) {
        reachesEnd = true;
        break;
      }
      if (stops(bars[k])) break;
    }
    const region = { id: i, nums };
    let j = i;
    for (; j < bars.length; j++) {
      const b = bars[j];
      if (j > i && (b.start || b.ending?.length)) break;
      if (j > i && b.line !== bars[j - 1].line && !reachesEnd) break;
      b.region = region;
      if (stops(b)) {
        j++;
        break;
      }
    }
    i = Math.max(i, j - 1);
  }
  return bars;
}

/** A bar of the song as written. */
export interface WrittenBar extends RegionBar {
  /** Where it is, in beats. */
  from: number;
  to: number;
  /** A repeat end played more than twice (":|x3"). */
  times?: number;
  endStyle: BarStyle | 'none';
  /** Its music on its line: the first and last event (note or rest) indexes (-1: none). */
  first: number;
  last: number;
}

/** The song's bars as written (a line's end without a bar line ends one too), with their endings. */
export function docBars(doc: Pick<TabDoc, 'lines'>): WrittenBar[] {
  const bars: WrittenBar[] = [];
  let t = 0;
  const fresh = (line: number): WrittenBar => ({ from: t, to: t, line, start: false, end: false, endStyle: 'none', first: -1, last: -1 });
  let cur = fresh(0);
  let touched = false;
  const close = (style: BarStyle | 'none', times?: number) => {
    cur.to = t;
    cur.endStyle = style;
    if (style === 'repeat-end') {
      cur.end = true;
      if (times) cur.times = times;
    }
    bars.push(cur);
    cur = fresh(cur.line);
    touched = false;
  };
  doc.lines.forEach((line, li) => {
    if (touched) close('none');
    cur.line = li;
    line.events.forEach((ev, ei) => {
      if (ev.kind === 'bar') {
        if (touched) close(ev.style, ev.times);
        // ("|: :|" with nothing between: an empty repeat, which plays nothing.)
        else if (ev.style === 'repeat-end' && cur.start) close(ev.style, ev.times);
        else if (ev.style === 'repeat-end' && bars.length) {
          // (":|" with no music since the last bar line: it ends that bar.)
          const last = bars[bars.length - 1];
          last.end = true;
          last.endStyle = 'repeat-end';
          if (ev.times) last.times = ev.times;
        }
        if (ev.style === 'repeat-start') cur.start = true;
        return;
      }
      if (ev.beats <= EPS) return;
      if (!touched) {
        cur.first = ei;
        if (ev.ending?.length) cur.ending = ev.ending;
      }
      cur.last = ei;
      touched = true;
      t += ev.beats;
    });
  });
  if (touched) close('none');
  return assignRegions(bars);
}

export interface EndingSpan {
  /** The times through it's played ([1], [1, 2]…). */
  nums: number[];
  /** The line's events it runs over: from its first note or rest to its last. */
  first: number;
  last: number;
  /** It began on an earlier line (no label here). */
  continued: boolean;
  /** It ends here, with the ":|" that goes back (its bracket closes with a hook). */
  closed: boolean;
}

/** Each line's ending brackets, in order (a 1st ending that wraps has a part on each line). */
export function lineEndings(doc: Pick<TabDoc, 'lines'>): EndingSpan[][] {
  const out: EndingSpan[][] = doc.lines.map(() => []);
  const bars = docBars(doc);
  bars.forEach((b, k) => {
    if (!b.region || b.first < 0) return;
    const list = out[b.line];
    const prev = list[list.length - 1];
    const sameRun = k > 0 && bars[k - 1].region === b.region && bars[k - 1].line === b.line;
    const next = bars[k + 1];
    const endsHere = !next || next.region !== b.region;
    if (sameRun && prev) {
      prev.last = b.last;
      prev.closed = endsHere && b.end;
    } else list.push({ nums: b.region.nums, first: b.first, last: b.last, continued: b.region.id !== k, closed: endsHere && b.end });
  });
  return out;
}

/** The endings on one line of events, in order. */
export function endingSpans(events: TabEvent[]): EndingSpan[] {
  return lineEndings({ lines: [{ events }] })[0];
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
  let line = 0;
  const regions = assignRegions(
    bars.map((b, i): RegionBar => {
      if (i > 0 && b.lineBreak) line++;
      return { start: b.startBar === 'repeat-start', end: b.endBar === 'repeat-end', endStyle: b.endBar, line, ending: b.ending };
    }),
  );
  return regions.map((b, i) => {
    if (!b.region) return null;
    const end = regions[i + 1]?.region !== b.region;
    return { nums: b.region.nums, start: b.region.id === i, end, closed: end && b.end };
  });
}

/** Whether a passage (in beats) holds the start of an ending: looped, it plays as written, every ending in turn. */
export function passageHasEndings(doc: TabDoc, score: Score, range: { start: number; end: number }): boolean {
  return score.events.some((ev) => {
    if (ev.start < range.start - EPS || ev.start >= range.end - EPS) return false;
    const src = doc.lines[ev.line]?.events[ev.eventIndex];
    return !!src && src.kind !== 'bar' && !!src.ending?.length;
  });
}
