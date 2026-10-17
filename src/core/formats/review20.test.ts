// @vitest-environment happy-dom
// Phase 20 review: what the reviewers found, kept fixed.

import { describe, expect, it } from 'vitest';
import { parseHtab } from '../htab/parser';
import type { NoteEvent, RestEvent, TabDoc } from '../htab/types';
import { harmonicaFromMeta } from '../score';
import { isHeld, lyricOf } from '../verses';
import { parseAbc } from './abc';
import { parseChordPro } from './chordpro';
import { parseGuitarPro } from './guitarpro';
import { parseMidi, writeMidi } from './midi';
import { parseMuseScore } from './musescore';
import { parseMusicXml } from './musicxml';

const notesOf = (d: TabDoc) => d.lines.flatMap((l) => l.events).filter((e): e is NoteEvent => e.kind === 'note');
const midi = (e: NoteEvent) => (e.sounds[0]?.type === 'pitch' ? e.sounds[0].midi : 0);
/** The tab as "pitch:beats" and "r:beats", bar by bar. */
const shape = (d: TabDoc) =>
  d.lines
    .flatMap((l) => l.events)
    .map((e) => (e.kind === 'bar' ? '|' : `${e.kind === 'note' ? midi(e) : 'r'}:${+e.beats.toFixed(3)}`))
    .join(' ');

/** A one-track MIDI file of `events` ([delta ticks, bytes…]), 480 ticks a beat. */
function midiFile(events: number[][]): Uint8Array {
  const track = [...events.flat(), 0, 0xff, 0x2f, 0];
  const len = track.length;
  return new Uint8Array([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0, 0x4d, 0x54, 0x72, 0x6b, (len >>> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff, ...track]);
}
const lyric = (s: string) => [0xff, 0x05, s.length, ...new TextEncoder().encode(s)];
const QUARTER = [0x83, 0x60];

describe('MIDI', () => {
  it('words on the right notes when the tune comes in after a bar of rest', () => {
    const doc = parseHtab('---\ntitle: M\ntempo: 100\n---\n. . . . | [C] 4 5 6 -4 | [G] -4 -5 6 6 |\nw: one two three four five six sev-en\n').doc;
    const back = parseMidi(writeMidi(doc, harmonicaFromMeta(doc.meta))).doc;
    const ns = notesOf(back);
    expect(ns.slice(0, 8).map((e) => lyricOf(e, 0))).toEqual(['one', 'two', 'three', 'four', 'five', 'six', 'sev-', 'en']);
    expect(ns[0].chord).toBe('C');
  });

  it('a lyric event that only breaks the line ends the word before it', () => {
    const ev: number[][] = [];
    ['Hel', 'lo ', 'world', '\r', 'Next '].forEach((w, k) => {
      if (w === '\r') ev.push([0, ...lyric(w)]);
      else ev.push([0, ...lyric(w)], [0, 0x90, 60 + k, 90], [...QUARTER, 0x80, 60 + k, 0]);
    });
    expect(notesOf(parseMidi(midiFile(ev)).doc).map((e) => lyricOf(e, 0))).toEqual(['Hel-', 'lo', 'world', 'Next']);
  });

  it('the same pitch on two channels: two notes, each its own length', () => {
    const file = midiFile([
      [0, 0x90, 60, 90],
      [0, 0x91, 60, 90],
      [...QUARTER, 0x81, 60, 0],
      [...QUARTER, 0x80, 60, 0],
    ]);
    const r = parseMidi(file);
    const lens = (id: string) => notesOf(r.choosePart!(id).doc).map((e) => e.beats);
    expect([lens('0:0'), lens('0:1')]).toEqual([[2], [1]]);
  });
});

describe('ABC', () => {
  const SRC = 'X:1\nT:V\nM:4/4\nL:1/4\nV:1 name="Melody"\nV:2 name="Bass"\nK:C\n[V:1] cdef|\n[V:2] C,D,E,F,|\n';
  it('voices written "[V:n]" at the start of each line, defined in the header: each read', () => {
    const r = parseAbc(SRC);
    expect(notesOf(r.doc).map(midi)).toEqual([72, 74, 76, 77]);
    expect(notesOf(r.choosePart!(r.parts!.find((p) => /Bass/.test(p.label))!.id).doc).map(midi)).toEqual([48, 50, 52, 53]);
  });

  it('a first tune with no notes (an index): the default comes from a tune that has them', () => {
    const r = parseAbc('X:1\nT:Index\nK:C\n\nX:2\nT:Real\nL:1/4\nK:C\nCDEF|\n');
    expect(r.doc.meta.title).toBe('Real');
    expect(notesOf(r.doc)).toHaveLength(4);
  });
});

describe('MusicXML', () => {
  it('a second voice: rests where it waits, and bars it isn’t in filled', () => {
    const n = (step: string, oct: number, dur: number, voice: number) => `<note><pitch><step>${step}</step><octave>${oct}</octave></pitch><duration>${dur}</duration><voice>${voice}</voice></note>`;
    const xml = `<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">
      <measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>${n('C', 4, 4, 1)}<backup><duration>2</duration></backup>${n('E', 5, 2, 2)}</measure>
      <measure number="2">${n('C', 4, 4, 1)}</measure>
      <measure number="3">${n('C', 4, 4, 1)}<backup><duration>4</duration></backup>${n('G', 5, 4, 2)}</measure>
    </part></score-partwise>`;
    const r = parseMusicXml(xml, { part: '0:2' });
    expect(shape(r.doc)).toBe('r:2 76:2 | r:4 | 79:4 |');
  });
});

describe('ChordPro', () => {
  it('{chorus} in a file with no chords: the chorus’s words again', () => {
    const r = parseChordPro('{soc}\nLa la la\n{eoc}\nVerse words here\n{chorus}\n');
    const words = r.doc.lines.map((l) => (l.events[0] as RestEvent).lyric);
    expect(words).toEqual(['La la la', 'Verse words here', 'La la la']);
    expect(r.warnings.join(' ')).not.toContain('{chorus}');
  });
});

describe('MuseScore', () => {
  const chord = (p: number, inner = '') => `<Chord>${inner}<durationType>quarter</durationType><Note><pitch>${p}</pitch></Note></Chord>`;
  // The piano on top keeps the repeats, the tempo, the rehearsal mark and the ending, as MuseScore writes them.
  const MSCX = `<museScore version="4.20"><Score><Division>480</Division>
    <Part><Staff id="1"/><trackName>Piano</trackName></Part><Part><Staff id="2"/><trackName>Voice</trackName></Part>
    <Staff id="1">
      <Measure><startRepeat/><voice><TimeSig><sigN>4</sigN><sigD>4</sigD></TimeSig><Tempo><tempo>1.5</tempo></Tempo><RehearsalMark><text>Verse</text></RehearsalMark>${chord(48)}${chord(48)}${chord(48)}${chord(48)}</voice></Measure>
      <Measure><voice><Spanner type="Volta"><Volta><endings>1</endings></Volta><next><location><measures>1</measures></location></next></Spanner>${chord(48)}${chord(48)}${chord(48)}${chord(48)}</voice><endRepeat>2</endRepeat></Measure>
    </Staff>
    <Staff id="2">
      <Measure><voice><TimeSig><sigN>4</sigN><sigD>4</sigD></TimeSig>${chord(72, '<Lyrics><text>Oh</text><ticks_f>1/4</ticks_f></Lyrics>')}${chord(74)}${chord(76)}${chord(77, '<Lyrics><text>la</text><ticks>480</ticks></Lyrics>')}</voice></Measure>
      <Measure><voice>${chord(79)}${chord(77)}${chord(76)}${chord(74)}</voice></Measure>
    </Staff>
  </Score></museScore>`;

  it('the sung staff gets the score’s repeats, ending, tempo and section from the top staff', () => {
    const r = parseMuseScore(MSCX);
    expect(r.part).toBe('2:0');
    const events = r.doc.lines.flatMap((l) => l.events);
    expect(events.flatMap((e) => (e.kind === 'bar' ? [e.style] : []))).toEqual(['repeat-start', 'single', 'repeat-end']);
    expect(events.find((e) => e.kind === 'note' && e.ending)).toBeTruthy();
    expect([r.doc.meta.tempo, r.doc.lines[0].section]).toEqual([90, 'Verse']);
  });

  it('a held syllable: over each note up to its end (in ticks, or as MuseScore 4’s fraction)', () => {
    const ns = notesOf(parseMuseScore(MSCX).doc);
    // "Oh" for a whole note's quarter after it: held over the next note; "la" a quarter on: over the one after.
    expect([isHeld(ns[1], 0), isHeld(ns[2], 0), isHeld(ns[4], 0), isHeld(ns[5], 0)]).toEqual([true, false, true, false]);
  });
});

describe('Guitar Pro 7–8', () => {
  const note = (id: number, midiNo: number) => `<Note id="${id}"><Properties><Property name="Midi"><Number>${midiNo}</Number></Property></Properties></Note>`;
  // A two-staff piano, then the vocal; 6/8 at 60 dotted quarters; a pickup of one eighth.
  const GPIF = `<GPIF><Score><Title>T</Title></Score>
    <MasterTrack><Anacrusis/><Automations><Automation><Type>Tempo</Type><Bar>0</Bar><Value>60 3</Value></Automation></Automations></MasterTrack>
    <Tracks>
      <Track id="0"><Name>Piano</Name><Staves><Staff/><Staff/></Staves></Track>
      <Track id="1"><Name>Vocal</Name><Staves><Staff/></Staves></Track>
      <Track id="2"><Name>Kit</Name><InstrumentSet><Type>drumKit</Type></InstrumentSet></Track>
    </Tracks>
    <MasterBars>
      <MasterBar><Time>6/8</Time><Bars>0 1 2 3</Bars></MasterBar>
      <MasterBar><Time>6/8</Time><Bars>4 5 6 7</Bars></MasterBar>
    </MasterBars>
    <Bars>${[0, 1, 2, 3, 4, 5, 6, 7].map((b) => `<Bar id="${b}"><Voices>${b} -1 -1 -1</Voices></Bar>`).join('')}</Bars>
    <Voices>${[0, 1, 2, 3, 4, 5, 6, 7].map((b) => `<Voice id="${b}"><Beats>${b}</Beats></Voice>`).join('')}</Voices>
    <Beats>${[0, 1, 2, 3, 4, 5, 6, 7].map((b) => `<Beat id="${b}"><Rhythm ref="${b < 4 ? 0 : 1}"/><Notes>${b}</Notes></Beat>`).join('')}</Beats>
    <Notes>${note(0, 72)}${note(1, 48)}${note(2, 67)}${note(3, 36)}${note(4, 72)}${note(5, 48)}${note(6, 69)}${note(7, 36)}</Notes>
    <Rhythms><Rhythm id="0"><NoteValue>Eighth</NoteValue></Rhythm><Rhythm id="1"><NoteValue>Half</NoteValue><AugmentationDot count="1"/></Rhythm></Rhythms>
  </GPIF>`;

  it('each staff its own part, the vocal reading its own bars; the drums left out', () => {
    const r = parseGuitarPro(GPIF);
    expect(r.parts!.map((p) => p.label)).toEqual(['Piano · staff 1', 'Piano · staff 2', 'Vocal']);
    expect(notesOf(r.choosePart!('1:0').doc).map(midi)).toEqual([67, 69]);
    expect(notesOf(r.choosePart!('0.1:0').doc).map(midi)).toEqual([48, 48]);
  });

  it('the tempo in quarter notes (60 dotted quarters: 90); the pickup kept short', () => {
    const r = parseGuitarPro(GPIF, { part: '1:0' });
    expect(r.doc.meta.tempo).toBe(90);
    expect(shape(r.doc)).toBe('67:0.5 | 69:3 |');
  });
});
