// @vitest-environment happy-dom
// Phase 20b: MusicXML — choosing a part or voice, and timewise scores.

import { describe, expect, it } from 'vitest';
import type { NoteEvent } from '../htab/types';
import { lyricOf } from '../verses';
import { parseMusicXml } from './musicxml';

const note = (step: string, octave: number, voice = '1', lyric = '') =>
  `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>1</duration><voice>${voice}</voice><type>quarter</type>${lyric ? `<lyric number="1"><text>${lyric}</text></lyric>` : ''}</note>`;
const attrs = '<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>';
const backup = '<backup><duration>4</duration></backup>';

const PARTWISE = `<?xml version="1.0"?>
<score-partwise>
  <part-list>
    <score-part id="P1"><part-name>Piano</part-name></score-part>
    <score-part id="P2"><part-name>Voice</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">${attrs}${note('C', 3)}${note('E', 3)}${note('G', 3)}${note('C', 3)}${backup}${note('C', 2, '2')}${note('C', 2, '2')}${note('C', 2, '2')}${note('C', 2, '2')}</measure>
  </part>
  <part id="P2">
    <measure number="1">${attrs}${note('E', 5, '1', 'la')}${note('D', 5, '1', 'la')}${note('C', 5, '1', 'li')}${note('D', 5, '1', 'lo')}</measure>
  </part>
</score-partwise>`;

const pitches = (r: ReturnType<typeof parseMusicXml>) => r.doc.lines.flatMap((l) => l.events).filter((e): e is NoteEvent => e.kind === 'note').map((e) => (e.sounds[0].type === 'pitch' ? e.sounds[0].midi : 0));

describe('MusicXML: which part, which voice', () => {
  it('every part, and each voice of a part with several, offered; the melody (the sung part) taken', () => {
    const r = parseMusicXml(PARTWISE);
    expect(r.parts).toEqual([
      { id: '0:1', label: 'Piano · voice 1' },
      { id: '0:2', label: 'Piano · voice 2' },
      { id: '1', label: 'Voice' },
    ]);
    expect(r.part).toBe('1');
    expect(pitches(r)).toEqual([76, 74, 72, 74]);
    expect(r.warnings[0]).toBe('Imported “Voice” as the melody (3 parts: pick another under Part).');
  });

  it('another picked: its notes, and only its voice’s (not the layer behind it)', () => {
    const r = parseMusicXml(PARTWISE);
    expect(pitches(r.choosePart!('0:1'))).toEqual([48, 52, 55, 48]);
    expect(pitches(r.choosePart!('0:2'))).toEqual([36, 36, 36, 36]);
    expect(r.choosePart!('0:2').warnings.some((w) => w.includes('top line'))).toBe(false);
  });

  it('one part, one voice: no choice', () => {
    const one = PARTWISE.replace(/<part id="P1">[^]*?<\/part>/, '').replace(/<score-part id="P1">.*?<\/score-part>/, '');
    const r = parseMusicXml(one);
    expect([r.parts, r.choosePart]).toEqual([undefined, undefined]);
  });
});

describe('MusicXML: timewise scores', () => {
  // The same music, measure by measure.
  const TIMEWISE = `<?xml version="1.0"?>
<score-timewise>
  <work><work-title>Turned around</work-title></work>
  <part-list>
    <score-part id="P1"><part-name>Piano</part-name></score-part>
    <score-part id="P2"><part-name>Voice</part-name></score-part>
  </part-list>
  <measure number="1">
    <part id="P1">${attrs}${note('C', 3)}${note('E', 3)}${note('G', 3)}${note('C', 3)}</part>
    <part id="P2">${attrs}${note('E', 5, '1', 'la')}${note('D', 5, '1', 'la')}${note('C', 5, '1', 'li')}${note('D', 5, '1', 'lo')}</part>
  </measure>
  <measure number="2">
    <part id="P1">${note('F', 3)}${note('A', 3)}${note('C', 4)}${note('F', 3)}</part>
    <part id="P2">${note('G', 5, '1', 'si')}${note('G', 5, '1', 'ni')}${note('G', 5, '1', 'se')}${note('E', 5, '1', 'nang')}</part>
  </measure>
</score-timewise>`;

  it('read as the partwise score it is: its title, both measures of the chosen part, words', () => {
    const r = parseMusicXml(TIMEWISE);
    expect(r.doc.meta.title).toBe('Turned around');
    expect(r.part).toBe('1');
    expect(pitches(r)).toEqual([76, 74, 72, 74, 79, 79, 79, 76]);
    const ns = r.doc.lines.flatMap((l) => l.events).filter((e): e is NoteEvent => e.kind === 'note');
    expect(ns.map((e) => lyricOf(e, 0))).toEqual(['la', 'la', 'li', 'lo', 'si', 'ni', 'se', 'nang']);
    expect(pitches(r.choosePart!('0'))).toEqual([48, 52, 55, 48, 53, 57, 60, 53]);
  });
});
