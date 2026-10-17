// @vitest-environment happy-dom
// Phase 20d: every verse in the ChordPro, numbered-notation and plain-text exports; ChordPro's
// {chorus}; and verse 2 kept through the formats that carry verses.

import { describe, expect, it } from 'vitest';
import { parseHtab } from '../htab/parser';
import type { NoteEvent, TabDoc } from '../htab/types';
import { harmonicaFromMeta } from '../score';
import { lyricOf } from '../verses';
import { parseChordPro, writeChordPro } from './chordpro';
import { exportDoc, importText } from './index';
import { writeJianpu } from './jianpu';
import { DEFAULT_PLAIN_TEXT, writePlainText } from './plaintext';

const SONG = `---
title: Verses
harmonica: diatonic
harp-key: C
time: 4/4
---
@ Verse
[C] 4 4 5 6 |
w: Di si-ni ya
w: Di sa-na ya
@ Chorus
[F] -6 -6 6 5 |
w: La la li lo
`;
const doc = parseHtab(SONG).doc;
const harp = harmonicaFromMeta(doc.meta);
/** The words of verse `v`, a syllable a note. */
const verse = (d: TabDoc, v: number) => d.lines.flatMap((l) => l.events).filter((e): e is NoteEvent => e.kind === 'note' && !e.tied).map((e) => lyricOf(e, v) ?? '');

describe('ChordPro', () => {
  it('a section sung twice over: written once for each verse, its chords over each; the chorus as {soc} … {eoc}', () => {
    expect(writeChordPro(doc).split('\n').slice(3)).toEqual([
      '',
      '{comment: Verse 1}',
      '[C]Di sini ya',
      '',
      '{comment: Verse 2}',
      '[C]Di sana ya',
      '',
      '{start_of_chorus}',
      '[F]La la li lo',
      '{end_of_chorus}',
      '',
    ]);
  });

  it('{chorus} brings the last chorus back there', () => {
    const r = parseChordPro('{title: S}\n{soc}\n[F]La la [C]li lo\n{eoc}\n{c: Verse 2}\n[G]Hey there\n{chorus}\n');
    expect(r.doc.lines.map((l) => [l.section, l.events.flatMap((e) => (e.kind === 'rest' && e.chord ? [e.chord] : [])).join(' ')])).toEqual([
      ['Chorus', 'F C'],
      ['Verse 2', 'G'],
      ['Chorus', 'F C'],
    ]);
  });

  it('{chorus} with no chorus before it: left out, and said', () => {
    expect(parseChordPro('{title: S}\n[G]Hey\n{chorus}\n').warnings).toContain('“{chorus}” with no chorus ({soc} … {eoc}) before it: left out.');
  });
});

describe('numbered notation and plain text: every verse', () => {
  it('numbered notation: a w: line for each verse, read back as verses', () => {
    const text = writeJianpu(doc, harp);
    expect(text).toContain('w: Di si-ni ya\nw: Di sa-na ya');
    const back = importText(text, 'jianpu').doc;
    expect(verse(back, 1).slice(0, 4)).toEqual(['Di', 'sa-', 'na', 'ya']);
  });

  it('plain text: a row of words for each verse, lined up under the tab', () => {
    const rows = writePlainText(doc, harp, { ...DEFAULT_PLAIN_TEXT, title: false }).split('\n');
    const at = rows.findIndex((r) => r.startsWith('4'));
    expect(rows[at - 1]).toBe('C');
    expect(rows[at + 1]).toMatch(/^Di\s+si-\s+ni\s+ya$/);
    expect(rows[at + 2]).toMatch(/^Di\s+sa-\s+na\s+ya$/);
    // (Each syllable under its note.)
    expect(rows[at + 1].indexOf('ni')).toBe(rows[at].indexOf('5'));
  });
});

describe('verse 2 kept through the formats that carry verses', () => {
  for (const kind of ['abc', 'musicxml', 'jianpu'] as const) {
    it(kind, () => {
      const { data } = exportDoc(kind, doc, harp);
      const back = importText(data as string, kind).doc;
      expect(verse(back, 1).slice(0, 4)).toEqual(verse(doc, 1).slice(0, 4));
    });
  }
});
