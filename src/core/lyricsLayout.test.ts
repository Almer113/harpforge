import { expect, it } from 'vitest';
import { parseHtab } from './htab/parser';
import { hasWords, lineText, lyricsLine, type LyWord } from './lyricsLayout';

const line = (tab: string, li = 0) => lyricsLine(parseHtab(`---\ntitle: T\n---\n${tab}\n`).doc.lines[li]);
/** "Twin(4)-kle(4)" style summary: each syllable's text and the events under it. */
const show = (words: LyWord[]) => words.map((w) => w.syllables.map((s) => `${s.text}(${s.notes.map((n) => n.ei).join(' ')})${s.joined ? '-' : ''}`).join('')).join(' | ');

it('joins syllables into words, each with its note', () => {
  const words = line('4 4 6 6 |\nw: Twin-kle twin-kle');
  expect(show(words)).toBe('Twin(0)-kle(1) | twin(2)-kle(3)');
  expect(lineText(words)).toBe('Twinkle twinkle');
});

it('notes without words are held over the syllable before', () => {
  expect(show(line('4 5 6 | -6 6 |\nw: Oh _ ah'))).toBe('Oh(0 1) | ah(2 4 5)');
  // "*" skips a note the same way.
  expect(show(line('4 5 6\nw: Twin-* kle'))).toBe('Twin(0 1)-kle(2)');
});

it('notes before the first word, and lines without words, are fills a bar at a time', () => {
  expect(show(line('4 5 | 6 -6 | 6\nw: _ _ _ _ star'))).toBe('(0 1) | (3 4) | star(6)');
  const none = line('4 5 | 6 -6 |');
  expect(show(none)).toBe('(0 1) | (3 4)');
  expect(hasWords(none)).toBe(false);
});

it('chords come along; a rest shows only when sung or carrying a chord', () => {
  const words = line('[C] 4 . [G] . 5 _\nw: Hey there you');
  expect(show(words)).toBe('Hey(0 2) | there(3) | you(4)');
  expect(words[0].syllables[0].notes.map((n) => [n.kind, n.chord])).toEqual([['note', 'C'], ['rest', 'G']]);
  expect(words[2].syllables[0].notes[0].kind).toBe('rest');
});

it('ties are left out unless they bring a chord', () => {
  expect(show(line('4~ | ~ 5\nw: long note'))).toBe('long(0) | note(3)');
  const words = line('4 | [G] ~ 5\nw: long note');
  expect(words[0].syllables[0].notes.map((n) => n.kind)).toEqual(['note', 'tie']);
});
