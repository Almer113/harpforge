import type { Sound } from '../types';

/** Character range in the source text. */
export interface Span {
  start: number;
  end: number;
}

export interface NoteEvent {
  kind: 'note';
  /** One sound, or several played together (a harmonica chord). */
  sounds: Sound[];
  beats: number;
  /** Chord symbol shown above, e.g. "G7". */
  chord?: string;
  lyric?: string;
  src?: Span;
}

export interface RestEvent {
  kind: 'rest';
  beats: number;
  chord?: string;
  /** Lyrics over a rest: used by chord sheets, where chords have no melody yet. */
  lyric?: string;
  src?: Span;
}

export type BarStyle = 'single' | 'double' | 'final' | 'repeat-start' | 'repeat-end';

export interface BarEvent {
  kind: 'bar';
  style: BarStyle;
  src?: Span;
}

export type TabEvent = NoteEvent | RestEvent | BarEvent;

export interface TabLine {
  /** Section heading shown above this line (from an "@ Verse" line). */
  section?: string;
  events: TabEvent[];
  src?: Span;
}

export interface TabMeta {
  title?: string;
  artist?: string;
  /** Harmonica family: diatonic | chromatic. */
  harmonica: string;
  tuning?: string;
  /** Key of the harmonica. */
  harpKey?: string;
  /** Key of the song (optional). */
  key?: string;
  position?: string;
  tempo: number;
  time: string;
  /** Any other header fields, kept verbatim. */
  extra: Record<string, string>;
}

export interface ParseIssue {
  message: string;
  span: Span;
  severity: 'error' | 'warning';
}

export interface TabDoc {
  meta: TabMeta;
  lines: TabLine[];
}

export interface ParseResult {
  doc: TabDoc;
  issues: ParseIssue[];
}

export function defaultMeta(): TabMeta {
  return { harmonica: 'diatonic', tuning: 'richter', harpKey: 'C', tempo: 100, time: '4/4', extra: {} };
}

/** Bar length in beats. A beat is a quarter note (6/8 → 3, 2/2 → 4). */
export function beatsPerBar(meta: TabMeta): number {
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(meta.time);
  if (!m) return 4;
  const n = parseInt(m[1], 10);
  const d = parseInt(m[2], 10);
  return n > 0 && d > 0 ? (n * 4) / d : 4;
}
