// @vitest-environment happy-dom
// Import/export problems found in the audit, one test per fix.
import { describe, expect, it } from 'vitest';
import { chordSheetToTab } from './convert';
import { parseAbc } from './formats/abc';
import { chordsOverLyricsToChordPro, parseChordPro, parseChordSheetText } from './formats/chordpro';
import { parseJianpu, writeJianpu } from './formats/jianpu';
import { parseMusicXml, writeMusicXml } from './formats/musicxml';
import { parseHtab } from './htab/parser';
import type { NoteEvent, RestEvent, TabDoc } from './htab/types';
import { getHarmonica } from './instruments';
import { midiToName } from './pitch';

const C = getHarmonica({ family: 'diatonic', tuning: 'richter', key: 'C' });
const notes = (doc: TabDoc) =>
  doc.lines.flatMap((l) => l.events).filter((e): e is NoteEvent => e.kind === 'note').map((e) => `${e.sounds.map((s) => (s.type === 'pitch' ? midiToName(s.midi) : '?')).join('+')}:${+e.beats.toFixed(3)}${e.tied ? '~' : ''}`);
const bars = (doc: TabDoc) => doc.lines.flatMap((l) => l.events).filter((e) => e.kind === 'bar').map((e) => (e.kind === 'bar' ? e.style : ''));
const lyrics = (doc: TabDoc) => doc.lines.flatMap((l) => l.events).filter((e) => e.kind === 'note' && e.lyric).map((e) => (e as NoteEvent).lyric);

describe('ABC import', () => {
  const abc = (body: string, head = 'X:1\nT:t\nM:4/4\nL:1/4\nK:C\n') => parseAbc(head + body);

  it('reads only the first voice, also when voices share a line', () => {
    expect(notes(abc('[V:1] CDEF | [V:2] C,D,E,F, |').doc)).toEqual(['C4:1', 'D4:1', 'E4:1', 'F4:1']);
  });

  it('keeps the first time signature and note lengths when M: changes', () => {
    const r = abc('CDEF |\nM:2/4\nCD |', 'X:1\nT:t\nM:4/4\nK:C\n');
    expect(r.doc.meta.time).toBe('4/4');
    expect(notes(r.doc)).toEqual(['C4:0.5', 'D4:0.5', 'E4:0.5', 'F4:0.5', 'C4:0.5', 'D4:0.5']);
    expect(r.warnings.join(' ')).toMatch(/time signature changes/);
  });

  it('reads "+:" as more lyrics, not music', () => {
    const r = abc('CDEF |\nw: a b\n+: c d');
    expect(notes(r.doc)).toHaveLength(4);
    expect(lyrics(r.doc)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('writes "::" as a repeat end and start, and reads the endings (Phase 11.5)', () => {
    const r = abc('|: CDEF :: GABc :| [1 C4 :| [2 E4 |]');
    expect(bars(r.doc).slice(0, 3)).toEqual(['repeat-start', 'repeat-end', 'repeat-start']);
    expect(r.warnings.join(' ')).not.toMatch(/endings/);
    const endings = r.doc.lines.flatMap((l) => l.events).filter((e) => e.kind === 'note' && e.ending);
    expect(endings.map((e) => (e.kind === 'note' ? e.ending : undefined))).toEqual([[1], [2]]);
  });

  it('keeps an accidental on a note tied over the bar line', () => {
    expect(notes(abc('C D E ^F- | F G A B |').doc).slice(3, 5)).toEqual(['F#4:1', 'F#4:1~']);
  });

  it('keeps the first key when K: changes', () => {
    expect(abc('CDEF |\nK:G\nGABc |').doc.meta.key).toBe('C');
  });
});

describe('Chord sheets', () => {
  it('skips {sot} tab blocks', () => {
    const r = parseChordPro('{sot}\ne|---3---|\n{eot}\n[G]Hello [C]world');
    expect(r.doc.lines.map((l) => l.section)).not.toContain('t');
    const chords = r.doc.lines.flatMap((l) => l.events).filter((e) => e.kind === 'rest' && e.chord).map((e) => (e as RestEvent).chord);
    expect(chords).toEqual(['G', 'C']);
  });

  it('keeps N.C. as a silent bar', () => {
    const r = parseChordPro('[G]Hello [N.C.]stop [C]go');
    const evs = r.doc.lines.flatMap((l) => l.events).filter((e): e is RestEvent => e.kind === 'rest' && !!e.chord);
    expect(evs.map((e) => e.chord)).toEqual(['G', 'N.C.', 'C']);
    const tab = chordSheetToTab(r.doc, C);
    expect(tab.missingChords).toEqual([]);
    expect(tab.doc.lines.flatMap((l) => l.events).some((e) => e.kind === 'rest' && e.chord === 'N.C.')).toBe(true);
  });

  it('does not sing the title and artist lines', () => {
    const cp = chordsOverLyricsToChordPro('My Song\n\nG       C\nHello there world\n');
    expect(cp).toContain('{title: My Song}');
    expect(cp.split('\n').filter((l) => l === 'My Song')).toEqual([]);
    const r = parseChordSheetText('Title: Song X\nArtist: Someone\n\nG       C\nHello there world\n');
    const words = r.doc.lines.flatMap((l) => l.events).map((e) => (e.kind !== 'bar' ? e.lyric ?? '' : '')).join(' ');
    expect(words).not.toMatch(/Song X|Someone/);
  });

  it('does not take an inline-chord lyric line as the title', () => {
    expect(chordsOverLyricsToChordPro('[C]Amazing [F]grace how [C]sweet the [G7]sound')).not.toContain('{title');
  });
});

describe('MusicXML', () => {
  it('exports the tab’s own bars: a pickup is an implicit measure 0', () => {
    const doc = parseHtab('---\ntime: 4/4\n---\n4 | 5 6 6 6 | 7~~~ |]').doc;
    const xml = writeMusicXml(doc, C);
    expect(xml).toContain('<measure number="0" implicit="yes">');
    const back = parseMusicXml(xml).doc;
    expect(notes(back)).toEqual(['C5:1', 'E5:1', 'G5:1', 'G5:1', 'G5:1', 'C6:4']);
    expect(bars(back)).toEqual(['single', 'single', 'final']);
  });

  it('writes note types for triplets and splits odd lengths', () => {
    const xml = writeMusicXml(parseHtab('---\n---\n{4 5 6} 4~ {5 .~~~} |').doc, C);
    expect(xml).toContain('<type>eighth</type><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>');
    expect(xml).not.toMatch(/<duration>\d+<\/duration>(<tie[^>]*>)*<note>/);
  });

  it('writes the mode of minor keys', () => {
    expect(writeMusicXml(parseHtab('---\nkey: Am\n---\n4 |').doc, C)).toContain('<fifths>0</fifths><mode>minor</mode>');
  });

  it('reads <backup> layers and <forward> rests properly, and keeps the first time signature', () => {
    const xml = `<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"/></part-list><part id="P1">
      <measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
        <note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration></note>
        <backup><duration>4</duration></backup>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration></note>
        <note><pitch><step>G</step><octave>4</octave></pitch><duration>2</duration></note></measure>
      <measure number="2"><attributes><time><beats>3</beats><beat-type>4</beat-type></time></attributes>
        <forward><duration>1</duration></forward>
        <harmony><root><root-step>C</root-step></root><kind>none</kind></harmony>
        <note><pitch><step>D</step><octave>5</octave></pitch><duration>2</duration></note></measure>
    </part></score-partwise>`;
    const r = parseMusicXml(xml);
    expect(r.doc.meta.time).toBe('4/4');
    expect(notes(r.doc)).toEqual(['C5:4', 'D5:2']);
    const evs = r.doc.lines.flatMap((l) => l.events).filter((e) => e.kind !== 'bar');
    expect(evs[1]).toMatchObject({ kind: 'rest', beats: 1 });
    expect(evs[2]).toMatchObject({ chord: 'N.C.' });
  });
});

describe('Numbered notation', () => {
  it('round-trips minor keys', () => {
    const doc = parseHtab('---\nkey: Am\ntime: 4/4\n---\n-4 5 -5 6 |').doc;
    const text = writeJianpu(doc, C);
    expect(text).toMatch(/^1=C /m);
    const back = parseJianpu(text).doc;
    expect(back.meta.key).toBe('Am');
    expect(notes(back)).toEqual(['D5:1', 'E5:1', 'F5:1', 'G5:1']);
  });
});
