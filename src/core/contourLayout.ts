// Phase 18: the contour view's layout — the melody's shape. Each line of the tab is a row;
// each note a bar along it, as long as it lasts (x: beats from the line's start) and as high
// as it sounds (its pitch, a bend at the pitch it bends to). The same pitch range on every
// row, so a note is at the same height wherever it is. Lanes: the pitches the song uses.

import { holeSoundText } from './htab/serializer';
import type { BarStyle, TabDoc } from './htab/types';
import { lineEndings } from './endings';
import { eventKey, type Score } from './score';
import type { Sound } from './types';

export interface ContourBar {
  /** The score event (a chord's notes share it). */
  index: number;
  /** From the line's start, and how long it lasts, in beats. */
  x: number;
  w: number;
  midi: number;
  sound: Sound;
  /** Continues the note before it (a tie): drawn joined to it. */
  tied: boolean;
  /** One note of a harmonica chord. */
  chord: boolean;
}

export interface ContourRow {
  /** The tab line it's drawn from. */
  li: number;
  section?: string;
  /** The line's length in beats. */
  beats: number;
  bars: ContourBar[];
  /** Bar lines (and repeat signs) along it. */
  barLines: { x: number; style: BarStyle; times?: number }[];
  /** Chord symbols above it. */
  chords: { x: number; text: string }[];
  /** 1st/2nd ending brackets (from, to in beats). */
  endings: { from: number; to: number; nums: number[]; continued: boolean; closed: boolean }[];
  /** Each note or rest's start and length (by its index in the line's events), for words under it. */
  slots: { ei: number; index: number; x: number; w: number }[];
}

export interface ContourLayout {
  rows: ContourRow[];
  /** The pitches the song uses, high to low, with the holes it plays each one on. */
  lanes: { midi: number; holes: string[] }[];
  /** The range drawn on every row. */
  lo: number;
  hi: number;
  /** The longest row, in beats. */
  maxBeats: number;
}

export function contourLayout(doc: TabDoc, score: Score, indexByKey: Map<string, number>): ContourLayout {
  const lanes = new Map<number, Map<string, number>>();
  const rows: ContourRow[] = [];
  const spans = lineEndings(doc);
  doc.lines.forEach((line, li) => {
    if (!line.events.length && line.section === undefined) return;
    const row: ContourRow = { li, section: line.section, beats: 0, bars: [], barLines: [], chords: [], endings: [], slots: [] };
    const starts = new Map<number, number>();
    const ends = new Map<number, number>();
    let t = 0;
    line.events.forEach((ev, ei) => {
      if (ev.kind === 'bar') {
        row.barLines.push({ x: t, style: ev.style, ...(ev.times ? { times: ev.times } : {}) });
        return;
      }
      starts.set(ei, t);
      ends.set(ei, t + ev.beats);
      if (ev.chord) row.chords.push({ x: t, text: ev.chord });
      const index = indexByKey.get(eventKey(li, ei));
      if (ev.beats > 0 && index !== undefined) {
        row.slots.push({ ei, index, x: t, w: ev.beats });
        const sev = score.events[index];
        if (ev.kind === 'note' && sev) {
          ev.sounds.forEach((sound, k) => {
            const midi = sev.midis[k];
            if (midi === null || midi === undefined) return;
            row.bars.push({ index, x: t, w: ev.beats, midi, sound, tied: !!sev.tied, chord: ev.sounds.length > 1 });
            if (sound.type === 'hole') {
              const holes = lanes.get(midi) ?? new Map<string, number>();
              const h = holeSoundText(sound);
              holes.set(h, (holes.get(h) ?? 0) + 1);
              lanes.set(midi, holes);
            } else if (!lanes.has(midi)) lanes.set(midi, new Map());
          });
        }
      }
      t += ev.beats;
    });
    row.beats = t;
    for (const e of spans[li] ?? []) {
      const from = starts.get(e.first);
      const to = ends.get(e.last);
      if (from !== undefined && to !== undefined) row.endings.push({ from, to, nums: e.nums, continued: e.continued, closed: e.closed });
    }
    rows.push(row);
  });
  const pitches = [...lanes.keys()].sort((a, b) => b - a);
  return {
    rows,
    // (A pitch's holes, the one played most first.)
    lanes: pitches.map((midi) => ({ midi, holes: [...lanes.get(midi)!].sort((a, b) => b[1] - a[1]).map(([h]) => h) })),
    lo: pitches.length ? pitches[pitches.length - 1] : 60,
    hi: pitches.length ? pitches[0] : 72,
    maxBeats: Math.max(1, ...rows.map((r) => r.beats)),
  };
}

/**
 * How tall a semitone is drawn: tall enough to read, short enough that a song with a wide range
 * still fits a row on the screen.
 */
export function semitoneHeight(lo: number, hi: number, room = 220, min = 5, max = 12): number {
  const span = Math.max(1, hi - lo);
  return Math.max(min, Math.min(max, room / span));
}
