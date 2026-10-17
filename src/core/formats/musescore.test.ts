// @vitest-environment happy-dom
// Phase 20e: MuseScore files (.mscx, and .mscz zipped).

import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import type { NoteEvent, TabEvent } from '../htab/types';
import { isHeld, lyricOf } from '../verses';
import { detectKind, importBytes, sniffText } from './index';
import { parseMuseScore, tpcName } from './musescore';

const chord = (pitch: number, type = 'quarter', inner = '') => `<Chord>${inner}<durationType>${type}</durationType><Note><pitch>${pitch}</pitch></Note></Chord>`;
const lyric = (text: string, syllabic = 'single', no = 0, extra = '') => `<Lyrics>${no ? `<no>${no}</no>` : ''}<syllabic>${syllabic}</syllabic><text>${text}</text>${extra}</Lyrics>`;
const harmony = (root: number, name = '') => `<Harmony><root>${root}</root>${name ? `<name>${name}</name>` : ''}</Harmony>`;

const MSCX = `<?xml version="1.0" encoding="UTF-8"?>
<museScore version="3.02">
  <Score>
    <Division>480</Division>
    <metaTag name="workTitle">Di Sini Senang</metaTag>
    <metaTag name="composer">Folk</metaTag>
    <Part><Staff id="1"/><trackName>Piano</trackName></Part>
    <Part><Staff id="2"/><trackName>Voice</trackName></Part>
    <Staff id="1">
      <Measure><voice><TimeSig><sigN>4</sigN><sigD>4</sigD></TimeSig>${chord(48, 'whole')}</voice></Measure>
      <Measure><voice>${chord(48, 'whole')}</voice></Measure>
      <Measure><voice>${chord(48, 'whole')}</voice></Measure>
    </Staff>
    <Staff id="2">
      <Measure>
        <startRepeat/>
        <voice>
          <KeySig><accidental>0</accidental></KeySig>
          <TimeSig><sigN>4</sigN><sigD>4</sigD></TimeSig>
          <Tempo><tempo>1.5</tempo></Tempo>
          <RehearsalMark><text>Verse</text></RehearsalMark>
          ${harmony(14)}
          ${chord(72, 'quarter', lyric('Di') + lyric('Ka', 'single', 1))}
          ${chord(74, 'quarter', lyric('si', 'begin') + lyric('se', 'single', 1, '<ticks>960</ticks>'))}
          ${chord(76, 'quarter', lyric('ni', 'end'))}
          <Chord><durationType>quarter</durationType><Note><pitch>77</pitch><Spanner type="Tie"><Tie/><next><location><fractions>1/4</fractions></location></next></Spanner></Note></Chord>
        </voice>
      </Measure>
      <Measure>
        <voice>
          <Spanner type="Volta"><Volta><endings>1</endings></Volta><next><location><measures>1</measures></location></next></Spanner>
          ${harmony(15, '7')}
          <Chord><durationType>quarter</durationType><Note><pitch>77</pitch><Spanner type="Tie"><prev><location><fractions>-1/4</fractions></location></prev></Spanner></Note></Chord>
          <Tuplet><normalNotes>2</normalNotes><actualNotes>3</actualNotes><baseNote>eighth</baseNote></Tuplet>
          ${chord(79, 'eighth')}${chord(77, 'eighth')}${chord(76, 'eighth')}
          <endTuplet/>
          <Chord><dots>1</dots><durationType>quarter</durationType><Note><pitch>74</pitch></Note></Chord>
          ${chord(72, 'eighth')}
        </voice>
        <endRepeat>2</endRepeat>
      </Measure>
      <Measure>
        <voice>
          <Spanner type="Volta"><Volta><endings>2</endings></Volta><next><location><measures>1</measures></location></next></Spanner>
          ${chord(72, 'half')}
          <Rest><durationType>half</durationType></Rest>
          <BarLine><subtype>end</subtype></BarLine>
        </voice>
      </Measure>
    </Staff>
  </Score>
</museScore>
`;

const all = (r: ReturnType<typeof parseMuseScore>) => r.doc.lines.flatMap((l) => l.events);
const notes = (r: ReturnType<typeof parseMuseScore>) => all(r).filter((e): e is NoteEvent => e.kind === 'note');
const midi = (e: NoteEvent) => (e.sounds[0]?.type === 'pitch' ? e.sounds[0].midi : 0);

describe('MuseScore', () => {
  it('the title, composer, key, time and tempo', () => {
    const { meta } = parseMuseScore(MSCX).doc;
    expect([meta.title, meta.artist, meta.key, meta.time, meta.tempo]).toEqual(['Di Sini Senang', 'Folk', 'C', '4/4', 90]);
  });

  it('the sung staff taken (the voice), the piano offered under Part', () => {
    const r = parseMuseScore(MSCX);
    expect(r.parts).toEqual([
      { id: '1:0', label: 'Piano' },
      { id: '2:0', label: 'Voice' },
    ]);
    expect(r.part).toBe('2:0');
    expect(notes(r.choosePart!('1:0')).map(midi)).toEqual([48, 48, 48]);
  });

  it('notes and their lengths: dots, a triplet, a tie over the bar line, a rest', () => {
    const r = parseMuseScore(MSCX);
    const ns = notes(r);
    expect(ns.map(midi)).toEqual([72, 74, 76, 77, 77, 79, 77, 76, 74, 72, 72]);
    expect(ns.map((e) => +e.beats.toFixed(3))).toEqual([1, 1, 1, 1, 1, 0.333, 0.333, 0.333, 1.5, 0.5, 2]);
    expect(ns[4].tied).toBe(true);
    expect(all(r).filter((e) => e.kind === 'rest').map((e) => (e as { beats: number }).beats)).toEqual([2]);
  });

  it('the words, verse by verse (a syllable held on over the next note)', () => {
    const ns = notes(parseMuseScore(MSCX));
    expect(ns.slice(0, 3).map((e) => lyricOf(e, 0))).toEqual(['Di', 'si-', 'ni']);
    expect(ns.slice(0, 3).map((e) => lyricOf(e, 1))).toEqual(['Ka', 'se', undefined]);
    expect(isHeld(ns[2], 1)).toBe(true);
  });

  it('chord symbols (roots by MuseScore’s numbering), repeats, endings, the end bar, a rehearsal mark as a section', () => {
    const r = parseMuseScore(MSCX);
    const events = all(r);
    expect(events.flatMap((e) => (e.kind !== 'bar' && e.chord ? [e.chord] : []))).toEqual(['C', 'G7']);
    expect(events.flatMap((e) => (e.kind === 'bar' ? [e.style] : []))).toEqual(['repeat-start', 'single', 'repeat-end', 'final']);
    const firstOf = (bar: number) => {
      let n = 0;
      for (const e of events as TabEvent[]) {
        if (e.kind === 'bar' && e.style !== 'repeat-start') n++;
        else if (e.kind !== 'bar' && n === bar) return e;
      }
    };
    expect([firstOf(1)?.ending, firstOf(2)?.ending]).toEqual([[1], [2]]);
    expect(r.doc.lines[0].section).toBe('Verse');
  });

  it('roots: C, G, F, Bb, F#, Eb', () => {
    expect([14, 15, 13, 12, 20, 11].map(tpcName)).toEqual(['C', 'G', 'F', 'Bb', 'F#', 'Eb']);
  });

  it('recognised: .mscx text (not taken for MusicXML), and a zip with a score in it — not only by its name', () => {
    expect(sniffText(MSCX)).toBe('mscx');
    const zip = zipSync({ 'score.mscx': strToU8(MSCX), 'META-INF/container.xml': strToU8('<container><rootfiles><rootfile full-path="score.mscx"/></rootfiles></container>') });
    expect(detectKind('song.mscz', zip)).toBe('mscz');
    expect(detectKind('download', zip)).toBe('mscz');
    const imported = importBytes('song.mscz', zip);
    expect([imported.kind, imported.doc.meta.title]).toEqual(['mscz', 'Di Sini Senang']);
  });
});
