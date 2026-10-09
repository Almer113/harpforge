// The lyrics view's layout: a tab line as words, the words as syllables, and each syllable
// with the notes sung on it (its own note first, then any held over it). Notes before the
// line's first syllable, or in a line with no words, are fills: one group per bar.

import type { TabLine } from './htab/types';

/** A column above a syllable: a played note, or a rest that's sung or carries a chord. */
export interface LyNote {
  /** The event's index in its line. */
  ei: number;
  kind: 'note' | 'rest' | 'tie';
  chord?: string;
}

export interface LySyllable {
  notes: LyNote[];
  /** The words ("" for a fill: notes with no words). */
  text: string;
  /** Continues into the next syllable of the same word ("Twin-" of "Twin-kle"). */
  joined: boolean;
}

export interface LyWord {
  syllables: LySyllable[];
}

export function lyricsLine(line: TabLine): LyWord[] {
  const words: LyWord[] = [];
  let word: LyWord | null = null;
  let syl: LySyllable | null = null;
  line.events.forEach((ev, ei) => {
    if (ev.kind === 'bar') {
      // A bar ends a fill, so a line of notes wraps bar by bar.
      if (syl && !syl.text) syl = null;
      return;
    }
    const col: LyNote | null =
      ev.kind === 'note'
        ? ev.tied
          ? ev.chord ? { ei, kind: 'tie', chord: ev.chord } : null
          : { ei, kind: 'note', chord: ev.chord }
        : ev.lyric !== undefined || ev.sung || ev.chord
          ? { ei, kind: 'rest', chord: ev.chord }
          : null;
    if (!col) return;
    // (A syllable of only "~", a joined space, is no words.)
    if (ev.lyric !== undefined && ev.lyric.trim() !== '') {
      const joined = ev.lyric.endsWith('-') && ev.lyric.length > 1;
      const next: LySyllable = { notes: [col], text: joined ? ev.lyric.slice(0, -1) : ev.lyric, joined };
      if (syl?.joined && word) word.syllables.push(next);
      else {
        word = { syllables: [next] };
        words.push(word);
      }
      syl = next;
      return;
    }
    // No words on it: held over the syllable before (a melisma), or a fill.
    if (!syl) {
      syl = { notes: [], text: '', joined: false };
      word = { syllables: [syl] };
      words.push(word);
    }
    syl.notes.push(col);
  });
  return words;
}

/** Whether a line has any words. */
export function hasWords(words: LyWord[]): boolean {
  return words.some((w) => w.syllables.some((s) => s.text));
}

/** The words of a line as plain text ("Twinkle twinkle little star"). */
export function lineText(words: LyWord[]): string {
  return words
    .map((w) => w.syllables.map((s) => s.text).join(''))
    .filter(Boolean)
    .join(' ');
}
