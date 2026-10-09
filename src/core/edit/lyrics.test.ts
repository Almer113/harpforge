// Phase 11c: typing lyrics onto the notes.

import { expect, it } from 'vitest';
import { parseHtab } from '../htab/parser';
import { lyricOf } from '../verses';
import { clearLyrics, fillLyrics, lyricStart, shiftLyrics, shownLyric, singable, songVerseCount, stepSingable, typeLyric } from './lyrics';
import { findItem, fromDoc, type Pos, type Song } from './model';

const song = (body: string) => fromDoc(parseHtab(`---\ntitle: L\n---\n${body}\n`).doc);
/** Each note's syllable in a verse ("" for none). */
const words = (s: Song, verse = 0) => singable(s).map((p) => lyricOf(findItem(s, p)!, verse) ?? '');

it('notes take syllables; ties and rests don’t', () => {
  const s = song('4 5~ | ~ . 6 |');
  expect(singable(s)).toHaveLength(3);
  const [a, b, c] = singable(s);
  expect(stepSingable(s, a, 1)).toEqual(b);
  expect(stepSingable(s, b, 1)).toEqual(c);
  expect(stepSingable(s, c, 1)).toBeNull();
  expect(stepSingable(s, a, -1)).toBeNull();
  // Starting on a rest: the note after it.
  expect(lyricStart(s, { m: 1, start: 1 })).toEqual(c);
  expect(lyricStart(s, undefined)).toEqual(a);
});

it('Space ends a word, "-" joins, Enter finishes', () => {
  let s = song('4 4 6 6 |');
  let at: Pos | null = singable(s)[0];
  const type = (text: string, key: Parameters<typeof typeLyric>[5]) => {
    const r = typeLyric(s, at!, 0, text, shownLyric(s, at!, 0), key);
    s = r.song;
    at = r.next;
  };
  type('Twin', 'join');
  type('kle', 'next');
  type('twin', 'join');
  type('kle', 'done');
  expect(words(s)).toEqual(['Twin-', 'kle', 'twin-', 'kle']);
  expect(at).toBeNull();
});

it('"_" holds a syllable over the next note (or holds this one when nothing is typed)', () => {
  let s = song('4 5 6 -6 |\nw: x x x x');
  const notes = singable(s);
  let r = typeLyric(s, notes[0], 0, 'Oh', shownLyric(s, notes[0], 0), 'hold');
  s = r.song;
  expect(r.next).toEqual(notes[2]);
  r = typeLyric(s, notes[2], 0, '', shownLyric(s, notes[2], 0), 'hold');
  s = r.song;
  expect(r.next).toEqual(notes[3]);
  expect(words(s)).toEqual(['Oh', '', '', 'x']);
});

it('passing over a syllable keeps it as it was (joined or not); going back works', () => {
  const s = song('4 4 6 |\nw: Twin-kle star');
  const notes = singable(s);
  const was = shownLyric(s, notes[0], 0);
  expect(was).toEqual({ text: 'Twin', joined: true });
  const r = typeLyric(s, notes[0], 0, 'Twin', was, 'next');
  expect(words(r.song)).toEqual(['Twin-', 'kle', 'star']);
  // Changed and ended with Space: a word of its own now.
  expect(words(typeLyric(s, notes[0], 0, 'Tw', was, 'next').song)[0]).toBe('Tw');
  expect(typeLyric(s, notes[1], 0, 'kle', shownLyric(s, notes[1], 0), 'prev').next).toEqual(notes[0]);
});

it('types into any verse, adding one', () => {
  let s = song('4 5 |\nw: a b');
  const notes = singable(s);
  expect(songVerseCount(s)).toBe(1);
  s = typeLyric(s, notes[1], 1, 'up', shownLyric(s, notes[1], 1), 'done').song;
  expect(words(s, 0)).toEqual(['a', 'b']);
  expect(words(s, 1)).toEqual(['', 'up']);
  expect(songVerseCount(s)).toBe(2);
  // Clearing it takes the verse away again.
  s = typeLyric(s, notes[1], 1, '', shownLyric(s, notes[1], 1), 'done').song;
  expect(songVerseCount(s)).toBe(1);
});

it('fills lyrics text onto the notes, from a note on, saying what was left over', () => {
  const s = song('4 4 6 6 | -6 -6 6~ |');
  const r = fillLyrics(s, null, 0, 'Twin-kle twin-kle\nlit-tle star and more');
  expect(words(r.song)).toEqual(['Twin-', 'kle', 'twin-', 'kle', 'lit-', 'tle', 'star']);
  expect(r.extra).toEqual(['and', 'more']);
  expect(r.placed).toHaveLength(7);
  // From the third note, in verse 2; "_" leaves a note without words.
  const two = fillLyrics(r.song, { m: 0, start: 2 }, 1, 'up _ the');
  expect(words(two.song, 1)).toEqual(['', '', 'up', '', 'the', '', '']);
  expect(words(two.song, 0)).toEqual(words(r.song, 0));
});

it('clears a verse, on the notes chosen or everywhere', () => {
  const s = song('4 5 6 |\nw: a b c\nw: d e f');
  expect(words(clearLyrics(s, [{ m: 0, start: 1 }], 0))).toEqual(['a', '', 'c']);
  const cleared = clearLyrics(s, null, 1);
  expect(words(cleared, 1)).toEqual(['', '', '']);
  expect(words(cleared, 0)).toEqual(['a', 'b', 'c']);
});

it('moves lyrics a note later or earlier from a note on', () => {
  const s = song('4 5 6 -6 |\nw: a b c');
  const later = shiftLyrics(s, { m: 0, start: 1 }, 0, 1);
  expect(words(later.song)).toEqual(['a', '', 'b', 'c']);
  expect(later.lost).toBeUndefined();
  const earlier = shiftLyrics(s, { m: 0, start: 0 }, 0, -1);
  expect(words(earlier.song)).toEqual(['b', 'c', '', '']);
  expect(earlier.lost).toBe('a');
});

it('a rest block fits the empty space it’s made in', async () => {
  const { restSlot, nextBeat } = await import('./lyrics');
  const s = song('4 . . 5 |');
  // On the first empty beat: a quarter as asked; asked for more, cut before the 5.
  expect(restSlot(s, { m: 0, start: 1 }, 1)).toEqual({ pos: { m: 0, start: 1 }, dur: 1 });
  expect(restSlot(s, { m: 0, start: 1 }, 4)).toEqual({ pos: { m: 0, start: 1 }, dur: 2 });
  // On a note: none.
  expect(restSlot(s, { m: 0, start: 0 }, 1)).toBeNull();
  // After the 4: the empty beat (a rest block to make); after the 5: past the end, none.
  expect(nextBeat(s, { m: 0, start: 0 }, 1)).toEqual({ pos: { m: 0, start: 1 }, dur: 1 });
  expect(nextBeat(s, { m: 0, start: 3 }, 1)).toBeNull();
  // Over a bar line, past a tie.
  const t = song('4 5~ | ~ 6 . . |');
  expect(nextBeat(t, { m: 0, start: 1 }, 1)).toEqual({ pos: { m: 1, start: 1 } });
});
