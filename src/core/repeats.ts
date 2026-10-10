// Repeats in playback: the song as it's played, with each |: … :| section played twice.
// The written score keeps one copy of each note; the playback score has them in the order
// they sound, each pointing back at its written note (for highlighting, marks and reports)
// and knowing whether it's the first time through or the repeat.
//
// A :| goes back to the last |: before it, or — with none since the previous repeat — to the
// end of that repeat (or the start of the song). :|: ends one repeat and starts the next.
// First and second endings aren't written in the format, so they aren't played.

import type { BarStyle, TabDoc } from './htab/types';
import type { Score, ScoreEvent } from './score';
import { lineVerses } from './verses';

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

/** A bar as written, for working out the order it's played in. */
interface WrittenBar {
  from: number;
  to: number;
  line: number;
  /** A repeat starts here ("|:"). */
  start: boolean;
  /** It ends a repeat (":|"), played `times` times through (unset: as many as its endings say, else 2). */
  end: boolean;
  times?: number;
  /** How it ends: a double or final bar line stops an ending. */
  endStyle: BarStyle | 'none';
  /** It starts an ending ("[1.]"). */
  ending?: number[];
  /** The ending it's part of (its first bar's index) and the times through that ending plays. */
  region?: { id: number; nums: number[] };
}

/** The song's bars as written (a line's end without a bar line ends one too). */
function writtenBars(doc: TabDoc): WrittenBar[] {
  const bars: WrittenBar[] = [];
  let t = 0;
  let cur: WrittenBar = { from: 0, to: 0, line: 0, start: false, end: false, endStyle: 'none' };
  let touched = false;
  const close = (style: BarStyle | 'none', times?: number) => {
    cur.to = t;
    cur.endStyle = style;
    if (style === 'repeat-end') {
      cur.end = true;
      if (times) cur.times = times;
    }
    bars.push(cur);
    cur = { from: t, to: t, line: cur.line, start: false, end: false, endStyle: 'none' };
    touched = false;
  };
  doc.lines.forEach((line, li) => {
    if (touched) close('none');
    cur.line = li;
    for (const ev of line.events) {
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
        continue;
      }
      if (ev.beats <= EPS) continue;
      if (!touched && ev.ending) cur.ending = ev.ending;
      touched = true;
      t += ev.beats;
    }
  });
  if (touched) close('none');
  // An ending runs from its bar to its ":|", a double or final bar line, the next "|:" or
  // ending, or the end of its line — whichever comes first.
  for (let i = 0; i < bars.length; i++) {
    const nums = bars[i].ending;
    if (!nums) continue;
    const region = { id: i, nums };
    for (let j = i; j < bars.length; j++) {
      const b = bars[j];
      if (j > i && (b.start || b.ending || b.line !== bars[i].line)) break;
      b.region = region;
      if (b.end || b.endStyle === 'double' || b.endStyle === 'final') break;
    }
  }
  return bars;
}

/** How many times through the repeat from bar `start` to its ":|" at bar `end`: its "x3", else its highest ending, else 2. */
function timesThrough(bars: WrittenBar[], start: number, end: number): number {
  if (bars[end].times) return bars[end].times!;
  let most = 2;
  for (let j = start; j <= end; j++) for (const n of bars[j].region?.nums ?? []) most = Math.max(most, n);
  // (The endings straight after the ":|" are this repeat's too: "[2.]", "[3.]".)
  for (let j = end + 1; j < bars.length && bars[j].region; j++) for (const n of bars[j].region!.nums) most = Math.max(most, n);
  return most;
}

/**
 * The stretches of the written song (in beats) in the order they're played, and which time
 * through its repeat each is (1 outside repeats). A ":|" goes back to the last "|:" before it,
 * or — with none since the previous repeat — to just after that repeat (or the start). An
 * ending is played only the times through it's numbered for; the last time through skips the
 * endings that went back, and goes on from the ending numbered for it.
 */
export function playOrder(doc: TabDoc, total: number): { from: number; to: number; pass: number }[] {
  const bars = writtenBars(doc).filter((b) => b.to > b.from + EPS || b.end);
  const out: { from: number; to: number; pass: number }[] = [];
  const play = (b: WrittenBar, pass: number) => {
    if (b.to <= b.from + EPS) return;
    const last = out[out.length - 1];
    if (last && last.pass === pass && Math.abs(last.to - b.from) < EPS) last.to = b.to;
    else out.push({ from: b.from, to: b.to, pass });
  };
  // Where a ":|" goes back to, which time through this is, and whether the repeat has been left
  // by skipping the ending that went back (its last ending still plays as that time through).
  let start = 0;
  let pass = 1;
  let leaving = false;
  for (let i = 0, guard = 0; i < bars.length && guard < 100000; guard++) {
    const b = bars[i];
    if (b.start && i !== start) {
      start = i;
      pass = 1;
      leaving = false;
    }
    if (leaving && !b.region) {
      start = i;
      pass = 1;
      leaving = false;
    }
    if (b.region && !b.region.nums.includes(pass)) {
      // Not this time through: on past it (past the ":|" in it, the repeat is done).
      let j = i;
      while (j < bars.length && bars[j].region === b.region) {
        if (bars[j].end) leaving = true;
        j++;
      }
      i = j;
      continue;
    }
    play(b, pass);
    if (b.end) {
      if (pass < timesThrough(bars, start, i)) {
        pass++;
        i = start;
        continue;
      }
      // Done: a ":|" after this goes back to just after it.
      start = i + 1;
      pass = 1;
      leaving = false;
    }
    i++;
  }
  if (!out.length) out.push({ from: 0, to: total, pass: 1 });
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
  const order = repeats ? playOrder(doc, score.totalBeats) : [{ from: 0, to: score.totalBeats, pass: 1 }];
  // Each line sings the verse of the time through its repeat (verse 2 the second time, in a
  // 2nd ending too): as many verses a time through the song as its repeat is played, so all
  // verses take as many times through the song as the line that needs the most.
  const times = linePasses(score, order);
  const versesOf = doc.lines.map(lineVerses);
  let rounds = 1;
  if (opts.allVerses) versesOf.forEach((n, line) => n > 1 && (rounds = Math.max(rounds, Math.ceil(n / (times.get(line) ?? 1)))));
  const key = `${repeats}:${rounds}`;
  const hit = cache.get(score)?.get(key);
  if (hit) return hit;
  const result = rounds === 1 && order.length === 1 && order[0].from < EPS ? writtenScore(score) : unroll(score, order, rounds, times, versesOf);
  if (!cache.has(score)) cache.set(score, new Map());
  cache.get(score)!.set(key, result);
  return result;
}

type Stretch = { from: number; to: number; pass: number };

/** Each line → the most times through a repeat any of its notes is played in, in one time through `order`. */
function linePasses(score: Score, order: Stretch[]): Map<number, number> {
  const most = new Map<number, number>();
  for (const { from, to, pass } of order) {
    for (const ev of score.events) {
      if (ev.start >= from - EPS && ev.start < to - EPS && pass > (most.get(ev.line) ?? 1)) most.set(ev.line, pass);
    }
  }
  return most;
}

function unroll(score: Score, order: Stretch[], rounds: number, times: Map<number, number>, versesOf: number[]): PlaybackScore {
  const events: ScoreEvent[] = [];
  const orig: number[] = [];
  const pass: number[] = [];
  const round: number[] = [];
  const verse: number[] = [];
  const bars: number[] = [];
  let at = 0;
  /** The verse a note sings the `n`-th time through its repeat in round `r` (past its line's last when it's all been sung). */
  const verseAt = (ev: ScoreEvent, r: number, n: number) => r * (times.get(ev.line) ?? 1) + n - 1;
  for (let r = 0; r < rounds; r++) {
    for (const { from, to, pass: n } of order) {
      // In the last time through, a stretch whose words have all been sung (a third verse
      // that only fills half of a repeat) isn't played again.
      if (r > 0 && r === rounds - 1) {
        const sung = score.events.filter((ev) => ev.start >= from - EPS && ev.start < to - EPS && (versesOf[ev.line] ?? 1) > 1);
        if (sung.length && sung.every((ev) => verseAt(ev, r, n) >= versesOf[ev.line])) continue;
      }
      if (at > EPS) bars.push(at);
      for (const b of score.bars) if (b > from + EPS && b < to - EPS) bars.push(at + b - from);
      for (const ev of score.events) {
        if (ev.start < from - EPS || ev.start >= to - EPS) continue;
        // A tie whose note isn't the one played just before it (the start of a repeat, after
        // the jump back) has nothing to continue: it's played as a note of its own.
        const after = events.at(-1);
        const tied = ev.tied && !!after && orig.at(-1) === ev.index - 1 && !after.rest;
        events.push({ ...ev, index: events.length, start: at + ev.start - from, soundBeats: ev.beats, tied });
        orig.push(ev.index);
        pass.push(n);
        round.push(r);
        // The verse sung: the next each time through its repeat, and on from there each time
        // through the song (all verses) — a line without that many verses sings its last.
        verse.push(Math.max(0, Math.min(verseAt(ev, r, n), (versesOf[ev.line] ?? 1) - 1)));
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
