// @vitest-environment happy-dom
// Phase 11e: verses in ABC and MusicXML, both ways.

import { expect, it } from 'vitest';
import { parseHtab } from '../htab/parser';
import type { TabDoc } from '../htab/types';
import { harmonicaFromMeta } from '../score';
import { lyricOf, songVerses } from '../verses';
import { parseAbc, writeAbc } from './abc';
import { parseMusicXml, writeMusicXml } from './musicxml';

/** Each verse's syllables, in order, over the whole song. */
const versesOf = (doc: TabDoc) =>
  Array.from({ length: songVerses(doc) }, (_, v) =>
    doc.lines
      .flatMap((l) => l.events)
      .filter((e) => e.kind === 'note' && !e.tied)
      .map((e) => (e.kind === 'note' ? (lyricOf(e, v) ?? '') : ''))
      .join(' ')
      .trim(),
  );

const SONG = '---\ntitle: V\n---\n4 4 6 6 |\nw: Twin-kle twin-kle\nw: Up a-bove the\n-6 -6 6~ |\nw: lit-tle star\nw: world so high\n';

it('ABC: every w: line under the music is a verse (the holes line HarpForge writes isn’t)', () => {
  const abc = 'X:1\nT:V\nM:4/4\nL:1/4\nK:C\nc c g g |\nw: 4 4 6 6\nw: Twin-kle twin-kle\nw: Up a-bove the\nA A G2 |\nw: lit-tle star\nw: world so high\n';
  const { doc, warnings } = parseAbc(abc);
  expect(versesOf(doc)).toEqual(['Twin- kle twin- kle lit- tle star', 'Up a- bove the world so high']);
  expect(warnings.join(' ')).not.toMatch(/first verse/);
  // "+:" carries on the verse it follows.
  const plus = parseAbc('X:1\nT:V\nM:4/4\nL:1/4\nK:C\nc c g g |\nw: one two\n+: three four\nw: five six seven eight\n');
  expect(versesOf(plus.doc)).toEqual(['one two three four', 'five six seven eight']);
});

it('ABC: verses come back from our own export', () => {
  const doc = parseHtab(SONG).doc;
  const back = parseAbc(writeAbc(doc, harmonicaFromMeta(doc.meta), { tabLine: true }).text).doc;
  expect(versesOf(back)).toEqual(versesOf(doc));
});

it('MusicXML: lyric numbers are verses, and come back from our own export', () => {
  const doc = parseHtab(SONG).doc;
  const xml = writeMusicXml(doc, harmonicaFromMeta(doc.meta));
  expect(xml).toContain('<lyric number="2"><syllabic>begin</syllabic><text>a</text></lyric>');
  expect(xml).toContain('<lyric number="3" name="tab">');
  const back = parseMusicXml(xml).doc;
  expect(versesOf(back)).toEqual(versesOf(doc));
});

it('MusicXML: numbers as written, in order (a file with only verse 2 on a note keeps it as verse 2)', () => {
  const note = (step: string, lyrics: string) => `<note><pitch><step>${step}</step><octave>5</octave></pitch><duration>1</duration><type>quarter</type>${lyrics}</note>`;
  const ly = (n: number, t: string) => `<lyric number="${n}"><syllabic>single</syllabic><text>${t}</text></lyric>`;
  const xml = `<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"><part-name>M</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>2</beats><beat-type>4</beat-type></time></attributes>${note('C', ly(1, 'one') + ly(2, 'uno'))}${note('E', ly(2, 'dos'))}</measure></part></score-partwise>`;
  expect(versesOf(parseMusicXml(xml).doc)).toEqual(['one', 'uno dos']);
});
