// @vitest-environment happy-dom
// Phase 20f: Guitar Pro 7–8 files (.gp: a zip holding Content/score.gpif).

import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import type { NoteEvent, TabEvent } from '../htab/types';
import { lyricOf } from '../verses';
import { parseGuitarPro } from './guitarpro';
import { detectKind, importBytes } from './index';

const fretted = (id: number, string: number, fret: number, tie = '') =>
  `<Note id="${id}">${tie}<Properties><Property name="String"><String>${string}</String></Property><Property name="Fret"><Fret>${fret}</Fret></Property></Properties></Note>`;
const pitched = (id: number, midi: number) => `<Note id="${id}"><Properties><Property name="Midi"><Number>${midi}</Number></Property></Properties></Note>`;
const beat = (id: number, rhythm: number, notes: number[], inner = '') => `<Beat id="${id}"><Rhythm ref="${rhythm}"/>${notes.length ? `<Notes>${notes.join(' ')}</Notes>` : ''}${inner}</Beat>`;
const words = (...lines: string[]) => `<Lyrics>${lines.map((l) => `<Line><![CDATA[${l}]]></Line>`).join('')}</Lyrics>`;
const tuning = `<Staves><Staff><Properties><Property name="Tuning"><Pitches>40 45 50 55 59 64</Pitches></Property></Properties></Staff></Staves>`;

// Track 0 a guitar (a low E, a whole note a bar); track 1 the lead, sung, on the same tuning.
// Bar 1 (repeat start, section "Verse", C chord): 4 quarters, the last tied to bar 2's first.
// Bar 2 (1st ending, repeat end ×2): the tied note, a triplet of eighths, a dotted quarter, an eighth.
// Bar 3 (2nd ending): a half note, a half rest.
const GPIF = `<?xml version="1.0" encoding="utf-8"?>
<GPIF>
  <Score><Title><![CDATA[Di Sini Senang]]></Title><Artist><![CDATA[Folk]]></Artist></Score>
  <MasterTrack><Automations>
    <Automation><Type>Tempo</Type><Bar>0</Bar><Position>0</Position><Value>90 2</Value></Automation>
  </Automations></MasterTrack>
  <Tracks>
    <Track id="0"><Name><![CDATA[Rhythm guitar]]></Name>${tuning}</Track>
    <Track id="1"><Name><![CDATA[Lead vocal]]></Name>${tuning}
      <Properties><Property name="DiagramCollection"><Items><Item id="0" name="C"/><Item id="1" name="G7"/></Items></Property></Properties>
    </Track>
  </Tracks>
  <MasterBars>
    <MasterBar><Key><AccidentalCount>0</AccidentalCount><Mode>Major</Mode></Key><Time>4/4</Time><Repeat start="true" end="false" count="0"/><Section><Letter><![CDATA[A]]></Letter><Text><![CDATA[Verse]]></Text></Section><Bars>0 3</Bars></MasterBar>
    <MasterBar><Time>4/4</Time><Repeat start="false" end="true" count="2"/><AlternateEndings>1</AlternateEndings><Bars>1 4</Bars></MasterBar>
    <MasterBar><Time>4/4</Time><AlternateEndings>2</AlternateEndings><Bars>2 5</Bars></MasterBar>
  </MasterBars>
  <Bars>
    <Bar id="0"><Voices>0 -1 -1 -1</Voices></Bar>
    <Bar id="1"><Voices>1 -1 -1 -1</Voices></Bar>
    <Bar id="2"><Voices>2 -1 -1 -1</Voices></Bar>
    <Bar id="3"><Voices>3 -1 -1 -1</Voices></Bar>
    <Bar id="4"><Voices>4 -1 -1 -1</Voices></Bar>
    <Bar id="5"><Voices>5 -1 -1 -1</Voices></Bar>
  </Bars>
  <Voices>
    <Voice id="0"><Beats>0</Beats></Voice>
    <Voice id="1"><Beats>1</Beats></Voice>
    <Voice id="2"><Beats>2</Beats></Voice>
    <Voice id="3"><Beats>10 11 12 13</Beats></Voice>
    <Voice id="4"><Beats>14 15 16 17 18 19</Beats></Voice>
    <Voice id="5"><Beats>20 21</Beats></Voice>
  </Voices>
  <Beats>
    ${beat(0, 0, [0])}${beat(1, 0, [1])}${beat(2, 0, [2])}
    ${beat(10, 1, [10], `<Chord>0</Chord>${words('Di', 'Ka')}`)}
    ${beat(11, 1, [11], words('si-', 'se'))}
    ${beat(12, 1, [12], words('ni'))}
    ${beat(13, 1, [13])}
    ${beat(14, 1, [14], '<Chord>1</Chord>')}
    ${beat(15, 2, [15])}${beat(16, 2, [16])}${beat(17, 2, [17])}
    ${beat(18, 3, [18])}${beat(19, 4, [19])}
    ${beat(20, 5, [20])}${beat(21, 5, [])}
  </Beats>
  <Notes>
    ${fretted(0, 0, 0)}${fretted(1, 0, 0)}${fretted(2, 0, 0)}
    ${fretted(10, 4, 13)}${fretted(11, 5, 10)}${fretted(12, 5, 12)}
    ${fretted(13, 5, 13, '<Tie origin="true" destination="false"/>')}
    ${fretted(14, 5, 13, '<Tie origin="false" destination="true"/>')}
    ${fretted(15, 5, 15)}${fretted(16, 5, 13)}${fretted(17, 5, 12)}
    ${pitched(18, 74)}${pitched(19, 72)}${pitched(20, 72)}
  </Notes>
  <Rhythms>
    <Rhythm id="0"><NoteValue>Whole</NoteValue></Rhythm>
    <Rhythm id="1"><NoteValue>Quarter</NoteValue></Rhythm>
    <Rhythm id="2"><NoteValue>Eighth</NoteValue><PrimaryTuplet num="3" den="2"/></Rhythm>
    <Rhythm id="3"><NoteValue>Quarter</NoteValue><AugmentationDot count="1"/></Rhythm>
    <Rhythm id="4"><NoteValue>Eighth</NoteValue></Rhythm>
    <Rhythm id="5"><NoteValue>Half</NoteValue></Rhythm>
  </Rhythms>
</GPIF>
`;

const all = (r: ReturnType<typeof parseGuitarPro>) => r.doc.lines.flatMap((l) => l.events);
const notes = (r: ReturnType<typeof parseGuitarPro>) => all(r).filter((e): e is NoteEvent => e.kind === 'note');
const midi = (e: NoteEvent) => (e.sounds[0]?.type === 'pitch' ? e.sounds[0].midi : 0);

describe('Guitar Pro 7–8', () => {
  it('the title, artist, key, time and tempo', () => {
    const { meta } = parseGuitarPro(GPIF).doc;
    expect([meta.title, meta.artist, meta.key, meta.time, meta.tempo]).toEqual(['Di Sini Senang', 'Folk', 'C', '4/4', 90]);
  });

  it('the sung track taken, the guitar offered under Part', () => {
    const r = parseGuitarPro(GPIF);
    expect(r.parts).toEqual([
      { id: '0:0', label: 'Rhythm guitar' },
      { id: '1:0', label: 'Lead vocal' },
    ]);
    expect(r.part).toBe('1:0');
    expect(notes(r.choosePart!('0:0')).map(midi)).toEqual([40, 40, 40]);
  });

  it('notes from string and fret on the tuning (or their stored pitch); lengths with a triplet and a dot; a tie; a rest', () => {
    const r = parseGuitarPro(GPIF);
    const ns = notes(r);
    expect(ns.map(midi)).toEqual([72, 74, 76, 77, 77, 79, 77, 76, 74, 72, 72]);
    expect(ns.map((e) => +e.beats.toFixed(3))).toEqual([1, 1, 1, 1, 1, 0.333, 0.333, 0.333, 1.5, 0.5, 2]);
    expect(ns[4].tied).toBe(true);
    expect(all(r).filter((e) => e.kind === 'rest').map((e) => (e as { beats: number }).beats)).toEqual([2]);
  });

  it('the words, verse by verse', () => {
    const ns = notes(parseGuitarPro(GPIF));
    expect(ns.slice(0, 3).map((e) => lyricOf(e, 0))).toEqual(['Di', 'si-', 'ni']);
    expect(ns.slice(0, 2).map((e) => lyricOf(e, 1))).toEqual(['Ka', 'se']);
  });

  it('chords, repeats, endings, the end bar, a section', () => {
    const r = parseGuitarPro(GPIF);
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

  it('the track’s lyrics text laid on its notes when no beat has words', () => {
    const plain = GPIF.replace(/<Lyrics>.*?<\/Lyrics>/g, '').replace(
      '<Track id="1"><Name><![CDATA[Lead vocal]]></Name>',
      '<Track id="1"><Name><![CDATA[Lead vocal]]></Name><Lyrics dispatched="true"><Line><Text><![CDATA[Di si-ni se-nang]]></Text><Offset>0</Offset></Line></Lyrics>',
    );
    const ns = notes(parseGuitarPro(plain));
    // (The tied note takes no syllable.)
    expect(ns.slice(0, 6).map((e) => lyricOf(e, 0))).toEqual(['Di', 'si-', 'ni', 'se-', undefined, 'nang']);
  });

  it('tempo changes: the one played longest kept, and said', () => {
    const r = parseGuitarPro(GPIF.replace('</Automations>', '<Automation><Type>Tempo</Type><Bar>2</Bar><Position>0</Position><Value>120 2</Value></Automation></Automations>'));
    expect(r.doc.meta.tempo).toBe(90);
    expect(r.warnings.join(' ')).toContain('90–120 bpm');
  });

  it('recognised by name and by what’s in the zip; .gpx turned away plainly', () => {
    const zip = zipSync({ 'VERSION': strToU8('7.0'), 'Content/score.gpif': strToU8(GPIF) });
    expect(detectKind('song.gp', zip)).toBe('gp');
    expect(detectKind('download', zip)).toBe('gp');
    const imported = importBytes('song.gp', zip);
    expect([imported.kind, imported.doc.meta.title, imported.part]).toEqual(['gp', 'Di Sini Senang', '1:0']);
    expect(() => importBytes('old.gpx', new Uint8Array([0x42, 0x43, 0x46, 0x5a]))).toThrow(/Guitar Pro 6/);
  });
});
