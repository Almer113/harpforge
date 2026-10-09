// Play along, checked: while the song plays, each note you play is matched to the note
// you were meant to start then. A note is in time, early or late (inside a forgiving
// window), or missed when its window goes by without it. Pure: the timing (where you
// are in the song when a note arrives) comes from the caller.

import type { Passage } from './passage';
import type { Score } from './score';

export type Mark = 'hit' | 'early' | 'late' | 'missed';

export interface Expected {
  index: number;
  start: number;
  midis: number[];
}

/** How a pass went: notes in time, early, late, missed, and notes that matched nothing. */
export interface PassResult {
  hit: number;
  early: number;
  late: number;
  missed: number;
  strays: number;
  total: number;
  /** Every note was played (in time, early or late). */
  clean: boolean;
  /** Score indexes of the missed notes (for the practice report). */
  missedAt: number[];
  /** Score indexes of the notes played early or late. */
  offAt: number[];
}

/**
 * The window around each note, in beats: `ok` either side counts as played, `good` as in
 * time. At least 150 ms (a quarter of a beat at slow tempos), in time within half of that.
 */
export function windows(bpm: number): { ok: number; good: number } {
  const beatSec = 60 / bpm;
  const ok = Math.max(0.15 / beatSec, 0.25);
  return { ok, good: ok / 2 };
}

/** The notes to play (not rests or ties, with a pitch the harmonica has), inside `range` if given. */
export function expectedNotes(score: Score, range?: Passage | null): Expected[] {
  return score.events
    .filter((ev) => !ev.rest && !ev.tied && ev.midis.some((m) => m !== null))
    .filter((ev) => !range || (ev.start >= range.start - 1e-6 && ev.start < range.end - 1e-6))
    .map((ev) => ({ index: ev.index, start: ev.start, midis: ev.midis.filter((m): m is number => m !== null).map(Math.round) }));
}

export class AlongChecker {
  readonly marks = new Map<number, Mark>();
  strays = 0;

  constructor(readonly expected: Expected[]) {}

  /**
   * A note you played at score beat `beat`: the nearest unplayed note of that pitch within
   * the window gets its mark; otherwise it's a stray (a wrong note, or one far off the beat).
   */
  attack(beat: number, midi: number, win: { ok: number; good: number }): { index: number; mark: Mark } | null {
    const pitch = Math.round(midi);
    let best: Expected | null = null;
    for (const e of this.expected) {
      if (this.marks.has(e.index) || !e.midis.includes(pitch)) continue;
      const d = Math.abs(beat - e.start);
      if (d <= win.ok + 1e-9 && (!best || d < Math.abs(beat - best.start))) best = e;
    }
    if (!best) {
      this.strays++;
      return null;
    }
    const d = beat - best.start;
    const mark: Mark = Math.abs(d) <= win.good + 1e-9 ? 'hit' : d < 0 ? 'early' : 'late';
    this.marks.set(best.index, mark);
    return { index: best.index, mark };
  }

  /** Notes whose window has passed by `beat` without being played: marked missed (returned). */
  missedBy(beat: number, win: { ok: number }): number[] {
    const out: number[] = [];
    for (const e of this.expected) {
      if (this.marks.has(e.index) || e.start + win.ok >= beat) continue;
      this.marks.set(e.index, 'missed');
      out.push(e.index);
    }
    return out;
  }

  /**
   * The pass so far, every note not played counting as missed. With `upTo` (playback stopped
   * part way), only the notes before it count.
   */
  result(upTo?: number): PassResult {
    const due = upTo === undefined ? this.expected : this.expected.filter((e) => e.start < upTo || this.marks.has(e.index));
    const count = (m: Mark) => due.filter((e) => (this.marks.get(e.index) ?? 'missed') === m).length;
    const missedAt = due.filter((e) => (this.marks.get(e.index) ?? 'missed') === 'missed').map((e) => e.index);
    const offAt = due.filter((e) => ['early', 'late'].includes(this.marks.get(e.index) ?? '')).map((e) => e.index);
    return {
      hit: count('hit'),
      early: count('early'),
      late: count('late'),
      missed: missedAt.length,
      strays: this.strays,
      total: due.length,
      clean: due.length > 0 && missedAt.length === 0,
      missedAt,
      offAt,
    };
  }

  /** Starts a new pass (a loop came round). */
  reset() {
    this.marks.clear();
    this.strays = 0;
  }
}

/**
 * The microphone's delay, from a calibration: you play a note with each click, and the
 * detected notes' offsets from the nearest click (in beats) give it in milliseconds.
 * Null without enough notes close to the clicks.
 */
export function latencyFrom(offsets: number[], bpm: number): number | null {
  const near = offsets.filter((d) => Math.abs(d) <= 0.45).sort((a, b) => a - b);
  if (near.length < 4) return null;
  const median = near[Math.floor(near.length / 2)];
  return Math.round(median * (60 / bpm) * 1000);
}
