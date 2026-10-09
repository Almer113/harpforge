// Phase 11a: verses — every "w:" line under a tab line is a verse.

import { expect, it } from 'vitest';
import { writeAbc as abc } from './formats/abc';
import { harmonicaFromMeta } from './score';
import type { TabDoc } from './htab/types';

const writeAbc = (d: TabDoc, _h?: unknown, opts = {}) => abc(d, harmonicaFromMeta(d.meta), opts);
import { parseHtab } from './htab/parser';
import { serializeHtab as serialize } from './htab/serializer';
import { lyricsLine, lineText as wordsOf } from './lyricsLayout';
import { spliceBody as applyEdit } from './edit/splice';
import { fromDoc, updateItem } from './edit/model';
import { lineVerses, lyricOf, setLyricOf, shownVerses, songVerses } from './verses';

const doc = (body: string) => `---\ntitle: V\n---\n${body}\n`;
const parse = (body: string) => parseHtab(doc(body)).doc;
const notes = (body: string, li = 0) => parse(body).lines[li].events.filter((e) => e.kind !== 'bar');

it('reads each lyrics line as a verse of its tab line', () => {
  const d = parse('4 5 6 |\nw: one two three\nw: four five six\nw: sev-en eight');
  expect(notes('4 5 6 |\nw: one two three\nw: four five six\nw: sev-en eight').map((e) => [0, 1, 2].map((v) => lyricOf(e as never, v)))).toEqual([
    ['one', 'four', 'sev-'],
    ['two', 'five', 'en'],
    ['three', 'six', 'eight'],
  ]);
  expect(lineVerses(d.lines[0])).toBe(3);
  expect(songVerses(d)).toBe(3);
  expect(parseHtab(doc('4 5 6 |\nw: a b c\nw: d e f')).issues).toEqual([]);
});

it('writes every verse back, an empty one keeping its place', () => {
  const text = doc('4 5 6 |\nw: a b c\nw:\nw: g h i');
  expect(serialize(parseHtab(text).doc)).toContain('4 5 6 |\nw: a b c\nw:\nw: g h i');
});

it('a literal hyphen ending a syllable isn’t a join (and survives a round trip)', () => {
  const d = parse(String.raw`4 5 6 |` + '\n' + String.raw`w: x\- y z`);
  const words = lyricsLine(d.lines[0]);
  expect(wordsOf(words)).toBe('x‐ y z');
  expect(words[0].syllables[0].joined).toBe(false);
  expect(serialize(d)).toContain(String.raw`w: x\- y z`);
});

it('an edit keeps every verse under its line', () => {
  const text = doc('4 5 6 7 |\nw: a b c d\nw: e f g h');
  const song = fromDoc(parseHtab(text).doc);
  const out = applyEdit(text, updateItem(song, { m: 0, start: 1 }, { sounds: [{ type: 'hole', hole: 6, breath: 'blow', bend: 0, over: false, slide: false }] }));
  expect(out).toContain('4 6 6 7 |\nw: a b c d\nw: e f g h');
});

it('setLyricOf tidies away empty verses', () => {
  const ev: { lyric?: string; verses?: (string | undefined)[] } = {};
  setLyricOf(ev, 2, 'x');
  expect(ev.verses).toEqual([undefined, 'x']);
  setLyricOf(ev, 2, undefined);
  expect(ev.verses).toBeUndefined();
  setLyricOf(ev, 0, 'a');
  expect(ev.lyric).toBe('a');
});

it('shows all verses, or the one chosen if there is one', () => {
  expect(shownVerses(3, 0)).toEqual([0, 1, 2]);
  expect(shownVerses(3, 2)).toEqual([1]);
  expect(shownVerses(3, 5)).toEqual([0, 1, 2]);
  expect(shownVerses(0, 0)).toEqual([0]);
});

it('the staff gets a lyrics line per verse (or just the one chosen)', () => {
  const d = parse('4 5 |\nw: a b\nw: c d');
  expect(writeAbc(d).text).toMatch(/w: a b\nw: c d/);
  expect(writeAbc(d, undefined, { verses: [1] }).text).toMatch(/w: c d/);
  expect(writeAbc(d, undefined, { verses: [1] }).text).not.toMatch(/w: a b/);
  // An empty verse 1 here keeps verse 2 on its own row.
  const gap = parse('4 5 |\nw:\nw: c d');
  expect(writeAbc(gap).text).toMatch(/w: \* \*\nw: c d/);
});

it('more syllables than notes: a warning on that w: line (they aren’t sung, and an edit would drop them)', () => {
  const text = '---\ntitle: W\n---\n4 5 |\nw: a b c d\nw: e f\n';
  const { issues } = parseHtab(text);
  expect(issues).toHaveLength(1);
  expect(issues[0].message).toMatch(/^2 syllables more than the notes above/);
  expect(text.slice(issues[0].span.start, issues[0].span.end)).toBe('w: a b c d');
  // ("*" place-holders past the end count for nothing.)
  expect(parseHtab('---\ntitle: W\n---\n4 5 |\nw: a b * *\n').issues).toHaveLength(0);
});
