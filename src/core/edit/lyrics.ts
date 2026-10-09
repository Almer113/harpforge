// Typing lyrics onto the notes (the visual editor's lyrics mode): which notes take a
// syllable, and what each key does. The keys are MuseScore's: Space goes on to the next note
// (a new word), "-" goes on joined ("Twin-kle"), "_" holds the syllable over the next note.

import { lyricOf, setLyricOf } from '../verses';
import { allPositions, EPS, findItem, updateItem, type Pos, type Song } from './model';

/** The notes that take a syllable, in order: played notes (a tie continues the one before). */
export function singable(song: Song): Pos[] {
  return allPositions(song).filter((p) => {
    const it = findItem(song, p);
    return !!it && it.sounds.length > 0 && !it.tied && it.dur > EPS;
  });
}

const same = (a: Pos, b: Pos) => a.m === b.m && Math.abs(a.start - b.start) < EPS;

/** The singable note `steps` away from `pos` (null past either end). */
export function stepSingable(song: Song, pos: Pos, steps: number): Pos | null {
  const all = singable(song);
  let i = all.findIndex((p) => same(p, pos));
  if (i < 0) {
    // (Not on a singable note: from where it would be.)
    i = all.findIndex((p) => p.m > pos.m || (p.m === pos.m && p.start > pos.start + EPS));
    if (i < 0) i = all.length;
    if (steps > 0) steps--;
  }
  return all[i + steps] ?? null;
}

/** Where lyrics mode starts: on `pos` if it takes a syllable, else the next that does (or the first). */
export function lyricStart(song: Song, pos: Pos | undefined): Pos | null {
  const all = singable(song);
  if (!pos) return all[0] ?? null;
  return all.find((p) => same(p, pos)) ?? stepSingable(song, pos, 1) ?? all[0] ?? null;
}

/** A note's syllable in verse `verse`, as shown in the typing box: without its joining "-". */
export function shownLyric(song: Song, pos: Pos, verse: number): { text: string; joined: boolean } {
  const it = findItem(song, pos);
  const lyric = it ? (lyricOf(it, verse) ?? '') : '';
  const joined = lyric.length > 1 && lyric.endsWith('-');
  return { text: joined ? lyric.slice(0, -1) : lyric, joined };
}

/** Sets a note's syllable in verse `verse` (undefined clears it). */
export function setLyric(song: Song, pos: Pos, verse: number, text: string | undefined): Song {
  const it = findItem(song, pos);
  if (!it) return song;
  const copy = { lyric: it.lyric, verses: it.verses };
  setLyricOf(copy, verse, text);
  return updateItem(song, pos, verse === 0 ? { lyric: copy.lyric } : { verses: copy.verses });
}

export type LyricKey = 'next' | 'join' | 'hold' | 'prev' | 'done';

/**
 * What a key does in lyrics mode, with `typed` in the box on note `pos`: the song with the
 * syllable written (`was` is what the box showed: left as it was, a syllable keeps its
 * joining), and the note the box goes to next (null: lyrics mode ends).
 *
 * - next (Space): the syllable ends a word; on to the next note.
 * - join ("-"): the syllable joins the next one; on to the next note.
 * - hold ("_"): the syllable carries on over the next note, which gets none; on past it.
 *   With nothing typed, it's this note that's held (from the syllable before).
 * - prev (Shift+Space, or Backspace in an empty box): back a note.
 * - done (Enter): the syllable's written; lyrics mode ends.
 */
export function typeLyric(song: Song, pos: Pos, verse: number, typed: string, was: { text: string; joined: boolean }, key: LyricKey): { song: Song; next: Pos | null } {
  const text = typed.trim().replace(/\s+/g, ' ');
  const joined = key === 'join' ? true : text === was.text ? was.joined : false;
  const syllable = text ? text + (joined && text !== '-' ? '-' : '') : undefined;
  const before = findItem(song, pos);
  let s = before && lyricOf(before, verse) !== syllable ? setLyric(song, pos, verse, syllable) : song;
  switch (key) {
    case 'done':
      return { song: s, next: null };
    case 'prev':
      return { song: s, next: stepSingable(s, pos, -1) ?? pos };
    case 'hold': {
      // Typed: this syllable carries on over the next note. Empty: this note is the held one.
      const held = text ? stepSingable(s, pos, 1) : pos;
      if (!held) return { song: s, next: null };
      s = setLyric(s, held, verse, undefined);
      return { song: s, next: stepSingable(s, held, 1) };
    }
    default:
      return { song: s, next: stepSingable(s, pos, 1) };
  }
}

/** How many verses the song's notes have (at least one). */
export function songVerseCount(song: Song): number {
  let n = 1;
  for (const m of song.measures)
    for (const it of m.items) {
      it.verses?.forEach((x, k) => {
        if (x) n = Math.max(n, k + 2);
      });
    }
  return n;
}
