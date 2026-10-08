// A passage: a stretch of a song in beats (score time), for looping and practising part
// of it. Chosen by Shift+clicking notes or clicking bar numbers; named by its bars.

import type { Score, ScoreEvent } from './score';

export interface Passage {
  start: number;
  end: number;
}

const EPS = 1e-6;

/** Where each bar starts (bar 1 at 0), up to the end of the song. */
export function barStarts(score: Score): number[] {
  const out = [0];
  for (const b of [...score.bars].sort((x, y) => x - y)) {
    if (b > out[out.length - 1] + EPS && b < score.totalBeats - EPS) out.push(b);
  }
  return out;
}

/** The bar (0-based) a beat falls in. */
export function barAt(score: Score, beat: number, starts = barStarts(score)): number {
  let i = 0;
  while (i + 1 < starts.length && starts[i + 1] <= beat + EPS) i++;
  return i;
}

/** Bar `i` (0-based) as a passage. */
export function barPassage(score: Score, i: number, starts = barStarts(score)): Passage {
  const k = Math.max(0, Math.min(i, starts.length - 1));
  return { start: starts[k], end: k + 1 < starts.length ? starts[k + 1] : score.totalBeats };
}

/** The bar number shown for a bar starting at `beat` (1-based), or null if no bar starts there. */
export function barNumberAt(score: Score, beat: number, starts = barStarts(score)): number | null {
  const i = starts.findIndex((s) => Math.abs(s - beat) < EPS);
  return i < 0 ? null : i + 1;
}

/** The stretch covering two passages (in either order). */
export function joinPassages(a: Passage, b: Passage): Passage {
  return { start: Math.min(a.start, b.start), end: Math.max(a.end, b.end) };
}

export function eventPassage(ev: ScoreEvent): Passage {
  return { start: ev.start, end: ev.start + ev.beats };
}

/** Whether an event starts inside a passage. */
export function inPassage(ev: ScoreEvent, p: Passage): boolean {
  return ev.start >= p.start - EPS && ev.start < p.end - EPS;
}

/** The score indexes of the events that start inside a passage. */
export function eventsIn(score: Score, p: Passage): number[] {
  return score.events.filter((ev) => inPassage(ev, p)).map((ev) => ev.index);
}

/** "bar 5" or "bars 5–8". */
export function describePassage(score: Score, p: Passage): string {
  const starts = barStarts(score);
  const a = barAt(score, p.start, starts) + 1;
  const b = barAt(score, Math.max(p.start, p.end - EPS * 10), starts) + 1;
  return a === b ? `bar ${a}` : `bars ${a}–${b}`;
}
