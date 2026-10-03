// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { notesToTab, tabToNotes } from './convert';
import { parseAbc, writeAbc } from './formats/abc';
import { parseJianpu, writeJianpu } from './formats/jianpu';
import { parseMidi, writeMidi } from './formats/midi';
import { parseMusicXml, writeMusicXml } from './formats/musicxml';
import { parseHtab } from './htab/parser';
import { bodyText, serializeHtab } from './htab/serializer';
import type { NoteEvent, TabDoc } from './htab/types';
import { getHarmonica } from './instruments';
import { midiToName } from './pitch';
import { buildScore } from './score';

const C = getHarmonica({ key: 'C' });
const TAB = `---
time: 4/4
---
[C] 4 5 6~ | ~~ -6 6 |
w: one two three four five`;

/** Notes as "pitch:beats", ties marked with "~". */
function notes(doc: TabDoc, harp = C): string[] {
  return doc.lines.flatMap((l) => l.events).filter((e) => e.kind === 'note').map((e) => {
    const n = e as NoteEvent;
    const p = n.sounds.map((s) => (s.type === 'pitch' ? midiToName(s.midi) : midiToName(buildScore({ meta: doc.meta, lines: [{ events: [n] }] }, harp).score.events[0].midis[0] ?? 0))).join('+');
    return `${n.tied ? '~' : ''}${p}:${+n.beats.toFixed(3)}`;
  });
}

describe('tie syntax', () => {
  it('parses a bare ~ as a tie to the previous note, across bar lines and lines', () => {
    const { doc, issues } = parseHtab(TAB + '\n~ 4 |');
    expect(issues).toEqual([]);
    expect(notes(doc)).toEqual(['C5:1', 'E5:1', 'G5:2', '~G5:2', 'A5:1', 'G5:1', '~G5:1', 'C5:1']);
    // Lyrics skip tied notes: "four" is on -6, not on the tie.
    const evs = doc.lines[0].events.filter((e) => e.kind === 'note') as NoteEvent[];
    expect(evs.map((e) => e.lyric)).toEqual(['one', 'two', 'three', undefined, 'four', 'five']);
  });

  it('round-trips through the writer', () => {
    const doc = parseHtab(TAB + '\n-(1 2 3)~~~ | ~ {~ 5} .~ |').doc;
    const text = serializeHtab(doc);
    expect(text).toContain('[C] 4 5 6~ | ~~ -6 6 |');
    expect(text).toContain('-(1 2 3)~~~ | ~ {~ 5} .~ |');
    expect(text).toContain('w: one two three four five');
    expect(serializeHtab(parseHtab(text).doc)).toBe(text);
  });

  it('turns a tie after a rest into rest, and reports a tie with nothing before it', () => {
    expect(bodyText(parseHtab('4 . ~ 5').doc.lines)).toBe('4 . . 5');
    expect(parseHtab('~ 4').issues[0].message).toMatch(/needs a note/);
  });

  it('plays a tied chain as one note', () => {
    const doc = parseHtab(TAB).doc;
    const { score } = buildScore(doc, C);
    const g = score.events[2];
    expect(g).toMatchObject({ beats: 2, soundBeats: 4, tied: false });
    expect(score.events[3]).toMatchObject({ tied: true, start: 4, beats: 2 });
  });
});

describe('ties in conversions', () => {
  it('keeps ties through tab → notes → tab and re-tabbing', () => {
    const doc = parseHtab(TAB).doc;
    const asNotes = tabToNotes(doc, C).doc;
    expect(notes(asNotes)).toEqual(['C5:1', 'E5:1', 'G5:2', '~G5:2', 'A5:1', 'G5:1']);
    expect(serializeHtab(notesToTab(asNotes, C).doc)).toContain('[C] 4 5 6~ | ~~ -6 6 |');
    const chrom = getHarmonica({ family: 'chromatic', tuning: 'solo-12', key: 'C' });
    const re = notesToTab(asNotes, chrom, { shift: -12 }).doc;
    const ev = re.lines[0].events.filter((e) => e.kind === 'note') as NoteEvent[];
    expect(ev[3].tied).toBe(true);
    expect(ev[3].sounds).toEqual(ev[2].sounds);
  });
});

describe('ties in formats', () => {
  it('ABC: writes "-" and reads it back as a tie across the bar', () => {
    const doc = parseHtab(TAB).doc;
    const { text } = writeAbc(doc, C);
    expect(text).toMatch(/g4- \| g4/);
    expect(notes(parseAbc(text).doc)).toEqual(['C5:1', 'E5:1', 'G5:2', '~G5:2', 'A5:1', 'G5:1']);
  });

  it('ABC: tied notes keep a lyric/tab slot (as under the staff), both ways', () => {
    const { text } = writeAbc(parseHtab(TAB).doc, C, { tabLine: true });
    expect(text).toContain('w: 4 5 6 * \\-6 6');
    expect(text).toContain('w: one two three * four five');
    const back = parseAbc(text).doc;
    const ev = back.lines[0].events.filter((e) => e.kind === 'note') as NoteEvent[];
    expect(ev.map((e) => e.lyric ?? '')).toEqual(['one', 'two', 'three', '', 'four', 'five']);
    // A tie inside a bar merges the notes, but the second head still takes a slot.
    const inBar = parseAbc('X:1\nL:1/4\nK:C\nc-c d e |\nw: a b c d').doc;
    const n = inBar.lines[0].events.filter((e) => e.kind === 'note') as NoteEvent[];
    expect(n.map((e) => `${midiToName((e.sounds[0] as any).midi)}:${e.beats}:${e.lyric}`)).toEqual(['C5:2:a', 'D5:1:c', 'E5:1:d']);
  });

  it('MusicXML: <tie> across measures', () => {
    const doc = parseHtab(TAB).doc;
    const xml = writeMusicXml(doc, C);
    expect(xml).toContain('<tie type="start"/>');
    expect(xml).toContain('<tie type="stop"/>');
    expect(notes(parseMusicXml(xml).doc)).toEqual(['C5:1', 'E5:1', 'G5:2', '~G5:2', 'A5:1', 'G5:1']);
  });

  it('MIDI: one long note, split back into a tie at the bar line', () => {
    const back = parseMidi(writeMidi(parseHtab(TAB).doc, C)).doc;
    expect(notes(back)).toEqual(['C5:1', 'E5:1', 'G5:2', '~G5:2', 'A5:1', 'G5:1']);
  });

  it('numbered notation: a dash after the bar line is a tie', () => {
    const doc = parseJianpu('1=C\n1 3 5 - | - - 6 5 |').doc;
    expect(notes(doc)).toEqual(['C4:1', 'E4:1', 'G4:2', '~G4:2', 'A4:1', 'G4:1']);
    expect(writeJianpu(doc)).toContain('1 3 5 - | - - 6 5 |');
  });
});
