// Repeats in playback: the song as it's played, with each |: … :| section played twice.
// The written score keeps one copy of each note; the playback score has them in the order
// they sound, each pointing back at its written note (for highlighting, marks and reports)
// and knowing whether it's the first time through or the repeat.
//
// A :| goes back to the last |: before it, or — with none since the previous repeat — to the
// end of that repeat (or the start of the song). :|: ends one repeat and starts the next.
// First and second endings aren't written in the format, so they aren't played.

import type { TabDoc } from './htab/types';
import type { Score, ScoreEvent } from './score';

const EPS = 1e-6;

export interface PlaybackScore {
  score: Score;
  /** Playback index → the written note's index. */
  orig: number[];
  /** Playback index → 1 the first time through, 2 the repeat. */
  pass: number[];
  /** Whether any repeat is played (the playback score isn't just the written one). */
  repeats: boolean;
}

/** The repeat signs in the order written, with where they are in beats. */
export function repeatSigns(doc: TabDoc): { kind: 'start' | 'end'; at: number }[] {
  const out: { kind: 'start' | 'end'; at: number }[] = [];
  let t = 0;
  for (const line of doc.lines) {
    for (const ev of line.events) {
      if (ev.kind === 'bar') {
        if (ev.style === 'repeat-start') out.push({ kind: 'start', at: t });
        else if (ev.style === 'repeat-end') out.push({ kind: 'end', at: t });
      } else t += ev.beats;
    }
  }
  return out;
}

/** The stretches of the written song (in beats) in the order they're played. */
export function playOrder(doc: TabDoc, total: number): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  let pos = 0;
  // Where a :| with no |: of its own goes back to: the end of the last repeat (or the start).
  let floor = 0;
  // The last |: written since then. (In order written: in ":|:" the |: starts the next one,
  // and a "|: :|" with nothing between repeats nothing.)
  let start: number | null = null;
  for (const sign of repeatSigns(doc)) {
    if (sign.kind === 'start') {
      start = sign.at;
      continue;
    }
    const end = sign.at;
    if (end <= floor + EPS || end > total + EPS) continue;
    const from = start ?? floor;
    if (end > pos + EPS) out.push({ from: pos, to: end });
    if (end > from + EPS) out.push({ from, to: end });
    pos = end;
    floor = end;
    start = null;
  }
  if (total > pos + EPS || !out.length) out.push({ from: pos, to: total });
  return out;
}

/** The written score as it's played: each note once, in order. */
export function writtenScore(score: Score): PlaybackScore {
  return { score, orig: score.events.map((ev) => ev.index), pass: score.events.map(() => 1), repeats: false };
}

const cache = new WeakMap<Score, PlaybackScore>();

/** The score with its repeats played (the written one when it has none). */
export function playbackScore(doc: TabDoc, score: Score): PlaybackScore {
  const hit = cache.get(score);
  if (hit) return hit;
  const order = playOrder(doc, score.totalBeats);
  const result = order.length === 1 && order[0].from < EPS ? writtenScore(score) : unroll(score, order);
  cache.set(score, result);
  return result;
}

function unroll(score: Score, order: { from: number; to: number }[]): PlaybackScore {
  const events: ScoreEvent[] = [];
  const orig: number[] = [];
  const pass: number[] = [];
  const bars: number[] = [];
  const seen = new Map<number, number>();
  let at = 0;
  for (const { from, to } of order) {
    if (at > EPS) bars.push(at);
    for (const b of score.bars) if (b > from + EPS && b < to - EPS) bars.push(at + b - from);
    for (const ev of score.events) {
      if (ev.start < from - EPS || ev.start >= to - EPS) continue;
      const n = (seen.get(ev.index) ?? 0) + 1;
      seen.set(ev.index, n);
      // A tie whose note isn't the one played just before it (the start of a repeat, after
      // the jump back) has nothing to continue: it's played as a note of its own.
      const after = events.at(-1);
      const tied = ev.tied && !!after && orig.at(-1) === ev.index - 1 && !after.rest;
      events.push({ ...ev, index: events.length, start: at + ev.start - from, soundBeats: ev.beats, tied });
      orig.push(ev.index);
      pass.push(n);
    }
    at += to - from;
  }
  // A tie carries the note before it in the order played.
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (!ev.tied || ev.rest) continue;
    for (let k = i - 1; k >= 0; k--) {
      const head = events[k];
      if (head.rest) break;
      if (!head.tied) {
        head.soundBeats += ev.beats;
        break;
      }
    }
  }
  return { score: { events, totalBeats: at, bars }, orig, pass, repeats: true };
}

/** Where written note `index` is played (its `pass`-th time if it repeats, else its first). */
export function playbackIndexOf(p: PlaybackScore, index: number, pass = 1): number | undefined {
  let first: number | undefined;
  for (let i = 0; i < p.orig.length; i++) {
    if (p.orig[i] !== index) continue;
    if (p.pass[i] === pass) return i;
    first ??= i;
  }
  return first;
}
