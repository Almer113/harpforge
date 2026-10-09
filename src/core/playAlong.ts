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
   * The unplayed note a note played at `beat` would be: of that pitch, within the window.
   * Late is preferred over early: a note played after an unplayed note's moment is that note
   * (so playing steadily a little late doesn't push every note onto the next one).
   */
  match(beat: number, midi: number, win: { ok: number }): Expected | null {
    const pitch = Math.round(midi);
    let behind: Expected | null = null;
    let ahead: Expected | null = null;
    for (const e of this.expected) {
      if (this.marks.has(e.index) || !e.midis.includes(pitch) || Math.abs(beat - e.start) > win.ok + 1e-9) continue;
      if (e.start <= beat + 1e-9) behind ??= e;
      else if (!ahead || e.start < ahead.start) ahead = e;
    }
    return behind ?? ahead;
  }

  /**
   * A note you played at score beat `beat` marks the note it matches (see match); otherwise
   * it's a stray (a wrong note, or one far off the beat), unless it's another note of a chord
   * just played (keys and MIDI give a chord's notes one by one).
   */
  attack(beat: number, midi: number, win: { ok: number; good: number }): { index: number; mark: Mark } | null {
    const best = this.match(beat, midi, win);
    if (!best) {
      const pitch = Math.round(midi);
      const chordNote = this.expected.some((e) => this.marks.has(e.index) && this.marks.get(e.index) !== 'missed' && e.midis.length > 1 && e.midis.includes(pitch) && Math.abs(beat - e.start) <= win.ok + 1e-9);
      if (!chordNote) this.strays++;
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
