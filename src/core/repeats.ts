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
import { lineVerses, songVerses } from './verses';

const EPS = 1e-6;

export interface PlaybackScore {
  score: Score;
  /** Playback index → the written note's index. */
  orig: number[];
  /** Playback index → 1 the first time through, 2 the repeat. */
  pass: number[];
  /** Playback index → which time through the whole song (0 = first; more with all verses). */
  round: number[];
  /** Playback index → the verse it sings (0 = verse 1). */
  verse: number[];
  /** Whether it isn't just the written score (repeats or verses played). */
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

/** Where written note `index` is played: its `pass`-th time in round `round` if there is one, else in that round, else its first time. */
export function playbackIndexOf(p: PlaybackScore, index: number, pass = 1, round = 0): number | undefined {
  let first: number | undefined;
  let inRound: number | undefined;
  for (let i = 0; i < p.orig.length; i++) {
    if (p.orig[i] !== index) continue;
    if (p.round[i] === round) {
      if (p.pass[i] === pass) return i;
      inRound ??= i;
    }
    first ??= i;
  }
  return inRound ?? first;
}

const written = new WeakMap<Score, PlaybackScore>();

/** The written score as it's played: each note once, in order, verse 1. */
export function writtenScore(score: Score): PlaybackScore {
  const hit = written.get(score);
  if (hit) return hit;
  const zeros = score.events.map(() => 0);
  const result: PlaybackScore = { score, orig: score.events.map((ev) => ev.index), pass: score.events.map(() => 1), round: zeros, verse: zeros, repeats: false };
  written.set(score, result);
  return result;
}

const cache = new WeakMap<Score, Map<string, PlaybackScore>>();

/**
 * The score as it's played: with its repeats (`repeats`, default on) and, with `allVerses`,
 * once through for each verse (rounds). The written one when that changes nothing.
 */
export function playbackScore(doc: TabDoc, score: Score, opts: { repeats?: boolean; allVerses?: boolean } = {}): PlaybackScore {
  const repeats = opts.repeats ?? true;
  const rounds = opts.allVerses ? Math.max(1, songVerses(doc)) : 1;
  const key = `${repeats}:${rounds}`;
  const hit = cache.get(score)?.get(key);
  if (hit) return hit;
  const order = repeats ? playOrder(doc, score.totalBeats) : [{ from: 0, to: score.totalBeats }];
  const result = rounds === 1 && order.length === 1 && order[0].from < EPS ? writtenScore(score) : unroll(doc, score, order, rounds);
  if (!cache.has(score)) cache.set(score, new Map());
  cache.get(score)!.set(key, result);
  return result;
}

function unroll(doc: TabDoc, score: Score, order: { from: number; to: number }[], rounds: number): PlaybackScore {
  const events: ScoreEvent[] = [];
  const orig: number[] = [];
  const pass: number[] = [];
  const round: number[] = [];
  const verse: number[] = [];
  const bars: number[] = [];
  const versesOf = doc.lines.map(lineVerses);
  let at = 0;
  for (let r = 0; r < rounds; r++) {
    const seen = new Map<number, number>();
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
        round.push(r);
        // The verse sung: one a round (all verses), else one a time through a repeat — a line
        // without that many verses sings its last.
        verse.push(Math.max(0, Math.min(rounds > 1 ? r : n - 1, (versesOf[ev.line] ?? 1) - 1)));
      }
      at += to - from;
    }
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
  return { score: { events, totalBeats: at, bars }, orig, pass, round, verse, repeats: true };
}
