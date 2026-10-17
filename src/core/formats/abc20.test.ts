// Phase 20a: ABC — choosing a tune or voice, and words written after the tune (W:).

import { describe, expect, it } from 'vitest';
import { serializeHtab } from '../htab/serializer';
import type { NoteEvent } from '../htab/types';
import { lyricOf } from '../verses';
import { parseAbc } from './abc';
import { notesToTab } from '../convert';
import { getHarmonica } from '../instruments';

const notes = (r: ReturnType<typeof parseAbc>) => r.doc.lines.flatMap((l) => l.events).filter((e): e is NoteEvent => e.kind === 'note');
const pitches = (r: ReturnType<typeof parseAbc>) => notes(r).map((e) => (e.sounds[0].type === 'pitch' ? e.sounds[0].midi : 0));

const TWO_VOICES = `X:1
T:Duet
M:4/4
L:1/4
V:1 name="Bass"
V:2 name="Melody"
K:C
V:1
C, E, G, C, |
V:2
c d e f |
`;

describe('ABC: which tune, which voice', () => {
  it('the melody’s voice is taken (by its name), the others offered under Part', () => {
    const r = parseAbc(TWO_VOICES);
    expect(pitches(r)).toEqual([72, 74, 76, 77]);
    expect(r.parts).toEqual([
      { id: '0:1', label: 'Voice 1 (Bass)' },
      { id: '0:2', label: 'Voice 2 (Melody)' },
    ]);
    expect(r.part).toBe('0:2');
    expect(r.warnings[0]).toBe('Imported “Voice 2 (Melody)” as the melody (2 parts: pick another under Part).');
    expect(pitches(r.choosePart!('0:1'))).toEqual([48, 52, 55, 48]);
  });

  it('voices on one line ([V:1] … [V:2] …), unnamed: the higher, one-note-at-a-time one', () => {
    const r = parseAbc('X:1\nM:4/4\nL:1/4\nK:C\n[V:1] c e g c\' | [V:2] [CEG]4 |\n');
    expect(r.part).toBe('0:1');
    expect(pitches(r)).toEqual([72, 76, 79, 84]);
  });

  it('several tunes: the first, the others offered by name', () => {
    const r = parseAbc('X:1\nT:One\nK:C\nC D E F|\n\nX:2\nT:Two\nK:G\nG A B c|\n');
    expect(r.doc.meta.title).toBe('One');
    expect(r.parts!.map((p) => p.label)).toEqual(['Tune 1: One', 'Tune 2: Two']);
    expect(r.choosePart!('1').doc.meta.title).toBe('Two');
  });

  it('one tune, one voice: no choice', () => {
    const r = parseAbc('X:1\nK:C\nC D E F|\n');
    expect([r.parts, r.choosePart]).toEqual([undefined, undefined]);
  });
});

describe('ABC: words written after the tune (W:)', () => {
  const tune = (words: string) => `X:1\nT:S\nM:4/4\nL:1/4\nK:C\nC D E F | G A B c |\nw: Di si-ni se-nang di sa-na\n${words}`;

  it('verses that fit the notes go on them, as verses 2, 3… (Indonesian words split by its rules)', () => {
    const r = parseAbc(tune('W: Di ma-na ma-na ha-ti-ku\nW:\nW: Ke-la-dang sa-wah se-nang ya\n'));
    const ns = notes(r);
    expect(ns.map((e) => lyricOf(e, 1))).toEqual(['Di', 'ma-', 'na', 'ma-', 'na', 'ha-', 'ti-', 'ku']);
    // (Written without hyphens, Indonesian words are split: "Keladang" → ke-la-dang.)
    expect(notes(parseAbc(tune('W: Keladang sawah senang ya\n'))).map((e) => lyricOf(e, 1))).toEqual(['Ke-', 'la-', 'dang', 'sa-', 'wah', 'se-', 'nang', 'ya']);
    expect(r.warnings).toContain('Put 2 verses written after the tune (W:) on the notes.');
  });

  it('numbered verses ("2.") start a new verse', () => {
    const r = parseAbc(tune('W: 2. Di ma-na ma-na\nW: ha-ti-ku\nW: 3. ka-mu a-ku dan di-a ya\n'));
    expect(notes(r).map((e) => lyricOf(e, 2))).toEqual(['ka-', 'mu', 'a-', 'ku', 'dan', 'di-', 'a', 'ya']);
  });

  it('one that doesn’t fit is kept as comment lines at the end, with a pointer to Fill lyrics', () => {
    const r = parseAbc(tune('W: Twinkle twinkle little star\nW: how I wonder\n'));
    expect(r.doc.comments).toEqual(['Words written after the tune (W:), to put on the notes with Fill lyrics from text:', 'Twinkle twinkle little star', 'how I wonder']);
    expect(r.warnings.some((w) => w.includes('didn’t fit the notes'))).toBe(true);
    expect(serializeHtab(r.doc).trimEnd().split('\n').slice(-3)).toEqual(['# Words written after the tune (W:), to put on the notes with Fill lyrics from text:', '# Twinkle twinkle little star', '# how I wonder']);
    // (They come through the import's conversion to a tab.)
    expect(notesToTab(r.doc, getHarmonica({ family: 'diatonic', tuning: 'richter', key: 'C' })).doc.comments).toEqual(r.doc.comments);
  });

  it('a tune without words under it: a verse is fitted to its notes', () => {
    const r = parseAbc('X:1\nM:4/4\nL:1/4\nK:C\nC D E F |\nW: one two three four\n');
    expect(notes(r).map((e) => lyricOf(e, 0))).toEqual(['one', 'two', 'three', 'four']);
  });
});
