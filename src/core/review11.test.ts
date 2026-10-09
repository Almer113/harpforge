// @vitest-environment happy-dom
// Phase 11 review fixes: verses kept everywhere they go, and the edge cases found.

import { expect, it } from 'vitest';
import { chordSheetToTab } from './convert';
import { pasteText } from './edit/clipboard';
import { fillLyrics, singable } from './edit/lyrics';
import { findItem, fromDoc } from './edit/model';
import { parseAbc, writeAbc } from './formats/abc';
import { parseJianpu } from './formats/jianpu';
import { parseMusicXml, writeMusicXml } from './formats/musicxml';
import { parseHtab, splitLyrics } from './htab/parser';
import type { TabDoc } from './htab/types';
import { getHarmonica } from './instruments';
import { playbackScore } from './repeats';
import { buildScore, harmonicaFromMeta } from './score';
import { suggestBreaks, syllablesId } from './syllables';
import { lyricOf, songVerses } from './verses';

const parse = (body: string) => parseHtab(`---\ntitle: R\n---\n${body}\n`).doc;
/** Each verse's syllables over the whole song ("" for a note without), notes and sung rests. */
const versesOf = (doc: TabDoc) =>
  Array.from({ length: songVerses(doc) }, (_, v) =>
    doc.lines
      .flatMap((l) => l.events)
      .filter((e) => (e.kind === 'note' && !e.tied) || (e.kind === 'rest' && (e.sung || e.lyric || e.verses)))
      .map((e) => (e.kind === 'bar' ? '' : (lyricOf(e, v) ?? '')))
      .join(' ')
      .trim(),
  );

it('ABC: an empty verse keeps its row, and a lone hyphen survives', () => {
  const doc = parse('4 5 |\nw: a b\n6 7 |\nw:\nw: c d');
  const back = parseAbc(writeAbc(doc, harmonicaFromMeta(doc.meta), { tabLine: true }).text).doc;
  expect(versesOf(back)).toEqual(versesOf(doc));
  // (Joined syllables are still written joined.)
  const twin = parse('4 4 |\nw: Twin-kle');
  expect(writeAbc(twin, harmonicaFromMeta(twin.meta)).text).toContain('w: Twin-kle');
  const dash = parse(String.raw`4 5 |` + '\nw: ' + String.raw`\- a`);
  expect(versesOf(parseAbc(writeAbc(dash, harmonicaFromMeta(dash.meta)).text).doc)).toEqual(['- a']);
});

it('MusicXML: a song whose verse 1 is empty keeps verse 2 as verse 2; words on rests come back', () => {
  const gap = parse('4 5 |\nw:\nw: a b');
  expect(versesOf(parseMusicXml(writeMusicXml(gap, harmonicaFromMeta(gap.meta))).doc)).toEqual(['', 'a b']);
  const sung = parse('_ 4 5 |\nw: Oh la la\nw: Ah do re');
  expect(versesOf(parseMusicXml(writeMusicXml(sung, harmonicaFromMeta(sung.meta))).doc)).toEqual(['Oh la la', 'Ah do re']);
});

it('pasting keeps a sung rest with words only in verse 2', () => {
  const s = fromDoc(parse('4 4 4 4 |'));
  const r = pasteText(s, '_ 5 5 5 |\nw: * a b c\nw: X d e f', { m: 0, start: 0 })!;
  expect(lyricOf(findItem(r.song, { m: 0, start: 0 })!, 1)).toBe('X');
});

it('chord sheet to tab keeps every verse', () => {
  const doc = parse('[C] _ _ [G] _ _ |\nw: one two three four\nw: five six seven eight');
  const tab = chordSheetToTab(doc, getHarmonica({ family: 'diatonic', key: 'C' })).doc;
  expect(songVerses(tab)).toBe(2);
  expect(versesOf(tab)[1]).toContain('five');
});

it('numbered notation import: each w: line a verse', () => {
  const { doc } = parseJianpu('1=C 4/4\n1 2 3 4 |\nw: a b c d\nw: e f g h\n');
  expect(versesOf(doc)).toEqual(['a b c d', 'e f g h']);
});

it('typing and filling count sung rests as a w: line does', () => {
  const s = fromDoc(parse('4 _ 5 6 |\nw: a b c d'));
  expect(singable(s)).toHaveLength(4);
  const r = fillLyrics(s, null, 0, 'w x y z');
  expect(singable(r.song).map((p) => lyricOf(findItem(r.song, p)!, 0))).toEqual(['w', 'x', 'y', 'z']);
});

it('all verses goes on through a song’s own repeat: verse 2 the second time, not a second round', () => {
  const doc = parse('|: 4 5 :|\nw: a b\nw: c d');
  const p = playbackScore(doc, buildScore(doc, harmonicaFromMeta(doc.meta)).score, { allVerses: true });
  expect(p.verse).toEqual([0, 0, 1, 1]);
  const four = parse('|: 4 5 :|\nw: a b\nw: c d\nw: e f\nw: g h');
  const q = playbackScore(four, buildScore(four, harmonicaFromMeta(four.meta)).score, { allVerses: true });
  expect(q.verse).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
});

it('syllables: words like "constructor" don’t trip on built-in names; "~" words stay whole', async () => {
  const s = await suggestBreaks(['constructor', 'toString', 'Kasih~mu'], 'en', {});
  expect(s.get('constructor')).toBe('con-struc-tor');
  expect(s.get('Kasih~mu')).toBe('Kasih~mu');
  expect(syllablesId('Kasih~mu')).toEqual(['Kasih~mu']);
});

it('a syllable of only "~" is no syllable; "a~" is "a"', () => {
  expect(splitLyrics('a ~ b~ c')).toEqual(['a', '*', 'b', 'c']);
});
