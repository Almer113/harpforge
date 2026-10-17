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
  /** Not on this harmonica (no pitch): drawn as a "?" over the lanes (`midi` is then NaN). */
  off?: boolean;
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
  /** The pitches the song uses, high to low, with the holes it plays each one on and how often it's played. */
  lanes: { midi: number; holes: string[]; uses: number }[];
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
  // A chord symbol with no note after it on its line goes on the next note (as it's played).
  let pendingChord: string | undefined;
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
      if (ev.beats <= 0) {
        if (ev.chord) pendingChord = ev.chord;
        return;
      }
      const chord = ev.chord ?? pendingChord;
      pendingChord = undefined;
      if (chord) row.chords.push({ x: t, text: chord });
      const index = indexByKey.get(eventKey(li, ei));
      if (ev.beats > 0 && index !== undefined) {
        row.slots.push({ ei, index, x: t, w: ev.beats });
        const sev = score.events[index];
        if (ev.kind === 'note' && sev) {
          ev.sounds.forEach((sound, k) => {
            const midi = sev.midis[k];
            if (midi === null || midi === undefined) {
              row.bars.push({ index, x: t, w: ev.beats, midi: NaN, sound, tied: !!sev.tied, chord: ev.sounds.length > 1, off: true });
              return;
            }
            row.bars.push({ index, x: t, w: ev.beats, midi, sound, tied: !!sev.tied, chord: ev.sounds.length > 1 });
            // (A tied-over part isn't played again: it doesn't count as a time the hole is used.)
            if (sound.type === 'hole' && !sev.tied) {
              const holes = lanes.get(midi) ?? new Map<string, number>();
              const h = holeSoundText(sound);
              holes.set(h, (holes.get(h) ?? 0) + 1);
              lanes.set(midi, holes);
            } else if (sound.type !== 'hole' && !lanes.has(midi)) lanes.set(midi, new Map());
            if (sound.type === 'hole' && !lanes.has(midi)) lanes.set(midi, new Map([[holeSoundText(sound), 1]]));
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
    lanes: pitches.map((midi) => {
      const holes = [...lanes.get(midi)!].sort((a, b) => b[1] - a[1]);
      return { midi, holes: holes.map(([h]) => h), uses: holes.reduce((n, [, c]) => n + c, 0) };
    }),
    lo: pitches.length ? pitches[pitches.length - 1] : 60,
    hi: pitches.length ? pitches[0] : 72,
    maxBeats: Math.max(1, ...rows.map((r) => r.beats)),
  };
}

/**
 * A row too long for `fit` beats, in parts that fit: broken at bar lines (or, in a line
 * without them, between notes). Each part starts at 0; the section heading goes on the first,
 * an ending carried over to the next part continues there (no label again).
 */
export function wrapRow(row: ContourRow, fit: number): ContourRow[] {
  if (row.beats <= fit + 1e-6) return [row];
  const bars = row.barLines.map((b) => b.x).filter((x) => x > 1e-6 && x < row.beats - 1e-6);
  const notes = row.slots.map((s) => s.x).filter((x) => x > 1e-6);
  const parts: [number, number][] = [];
  let from = 0;
  const after = (list: number[]) => list.filter((x) => x > from + 1e-6);
  const within = (list: number[]) => after(list).filter((x) => x - from <= fit + 1e-6);
  while (row.beats - from > fit + 1e-6) {
    // The furthest bar line that fits; else (a bar longer than the width) the furthest note
    // start that does; else the nearest break there is.
    const next = within(bars).at(-1) ?? within(notes).at(-1) ?? after(bars)[0] ?? after(notes)[0];
    if (next === undefined) break;
    parts.push([from, next]);
    from = next;
  }
  parts.push([from, row.beats]);
  const inside = (x: number, a: number, b: number, last: boolean) => x >= a - 1e-6 && (last ? x <= b + 1e-6 : x < b - 1e-6);
  return parts.map(([a, b], k) => {
    const last = k === parts.length - 1;
    return {
      ...row,
      section: k === 0 ? row.section : undefined,
      beats: b - a,
      bars: row.bars.filter((n) => inside(n.x, a, b, false)).map((n) => ({ ...n, x: n.x - a })),
      // At a break: the bar line ends the part before (a |: starts the next one instead).
      barLines: row.barLines
        .filter((l) => {
          if (k > 0 && Math.abs(l.x - a) < 1e-6) return l.style === 'repeat-start';
          if (!last && Math.abs(l.x - b) < 1e-6) return l.style !== 'repeat-start';
          return inside(l.x, a, b, true);
        })
        .map((l) => ({ ...l, x: l.x - a })),
      chords: row.chords.filter((c) => inside(c.x, a, b, last)).map((c) => ({ ...c, x: c.x - a })),
      endings: row.endings
        .filter((e) => e.from < b - 1e-6 && e.to > a + 1e-6)
        .map((e) => ({ ...e, from: Math.max(e.from, a) - a, to: Math.min(e.to, b) - a, continued: e.continued || e.from < a - 1e-6, closed: e.closed && e.to <= b + 1e-6 })),
      slots: row.slots.filter((s) => inside(s.x, a, b, false)).map((s) => ({ ...s, x: s.x - a })),
    };
  });
}

/**
 * The lanes whose names can be shown `gap` px apart (a semitone `step` px tall): where two would
 * crowd each other, the one played more keeps its name.
 */
export function namedLanes(lanes: ContourLayout['lanes'], step: number, gap = 11): Set<number> {
  const kept: ContourLayout['lanes'] = [];
  for (const lane of lanes) {
    const last = kept[kept.length - 1];
    if (!last || (last.midi - lane.midi) * step >= gap) kept.push(lane);
    else if (lane.uses > last.uses) {
      // (It takes the place of the one above, if that leaves room after the one before.)
      const before = kept[kept.length - 2];
      if (!before || (before.midi - lane.midi) * step >= gap) kept[kept.length - 1] = lane;
    }
  }
  return new Set(kept.map((l) => l.midi));
}

/**
 * How tall a semitone is drawn: tall enough to read, short enough that a song with a wide range
 * still fits a row on the screen.
 */
export function semitoneHeight(lo: number, hi: number, room = 220, min = 5, max = 12): number {
  const span = Math.max(1, hi - lo);
  return Math.max(min, Math.min(max, room / span));
}
