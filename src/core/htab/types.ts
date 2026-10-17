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
  /** The syllable sung on it (verse 1); a trailing "-" joins it to the next one. */
  lyric?: string;
  /** Its syllables in verses 2, 3… (verses[0] is verse 2); see verses.ts. */
  verses?: (string | undefined)[];
  /**
   * The verses (0 = verse 1) where it holds the syllable before it ("_" in the "w:" line:
   * "Oh___"), rather than having no words ("*"). A hold takes no new syllable.
   */
  holds?: number[];
  /**
   * Tied from the previous note: it keeps sounding instead of being played again
   * (written as a bare "~", e.g. "6~ | ~~ 5"). Its sounds are the previous note's.
   */
  tied?: boolean;
  /** Its bar starts a 1st/2nd… ending ("[1.]"): the times through the repeat it's played (1-based). */
  ending?: number[];
  src?: Span;
}

export interface RestEvent {
  kind: 'rest';
  beats: number;
  chord?: string;
  /** Lyrics over a rest: used by chord sheets, where chords have no melody yet. */
  lyric?: string;
  verses?: (string | undefined)[];
  /**
   * The verses (0 = verse 1) where it holds the syllable before it ("_" in the "w:" line:
   * "Oh___"), rather than having no words ("*"). A hold takes no new syllable.
   */
  holds?: number[];
  /** Written "_": the harp rests while a syllable is sung (the "w:" line counts it like a note). */
  sung?: boolean;
  /** Its bar starts an ending (see NoteEvent.ending). */
  ending?: number[];
  src?: Span;
}

export type BarStyle = 'single' | 'double' | 'final' | 'repeat-start' | 'repeat-end';

export interface BarEvent {
  kind: 'bar';
  style: BarStyle;
  /** A repeat end played more than twice (":|x3"): how many times through in all. */
  times?: number;
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
  /** 'info' is a note, not a problem (e.g. an extra verse that's kept but not shown). */
  severity: 'error' | 'warning' | 'info';
}

export interface TabDoc {
  meta: TabMeta;
  lines: TabLine[];
  /** Comment lines written at the end of the tab ("# …"): words an import couldn't place, say. */
  comments?: string[];
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
