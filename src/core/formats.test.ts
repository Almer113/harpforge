// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { findHarmonicaChord, isChordSymbol, parseChord } from './chords';
import { chordSheetToTab, isChordSheet, notesToTab, suggestForChordSheet } from './convert';
import { parseAbc, writeAbc } from './formats/abc';
import { chordsOverLyricsToChordPro, isChordLine, parseChordPro, writeChordPro } from './formats/chordpro';
import { importText, sniffText } from './formats';
import { parseMidi, writeMidi } from './formats/midi';
import { parseMusicXml, writeMusicXml } from './formats/musicxml';
import { parseHtab } from './htab/parser';
import { serializeHtab } from './htab/serializer';
import type { NoteEvent, TabDoc } from './htab/types';
import { getHarmonica } from './instruments';
import { midiToName } from './pitch';

const C = getHarmonica({ family: 'diatonic', tuning: 'richter', key: 'C' });

/** Flattens a doc to "pitch:beats" tokens (rests as r:beats) for comparisons. */
function flat(doc: TabDoc): string[] {
  const out: string[] = [];
  for (const l of doc.lines) {
    for (const e of l.events) {
      if (e.kind === 'bar') continue;
      if (e.kind === 'rest') {
        if (e.beats > 0) out.push(`r:${+e.beats.toFixed(3)}`);
        continue;
      }
      const names = (e as NoteEvent).sounds.map((s) => (s.type === 'pitch' ? midiToName(s.midi) : '?')).join('+');
      out.push(`${names}:${+e.beats.toFixed(3)}`);
    }
  }
  return out;
}

const TWINKLE_TAB = parseHtab(`---
title: Twinkle
harp-key: C
tempo: 96
---
[C] 4 4 6 6 | [F] -6 -6 [C] 6~ |
w: Twin-kle twin-kle lit-tle star
`).doc;

describe('chords', () => {
  it('parses chord symbols', () => {
    expect(parseChord('G7')!.tones).toEqual([7, 11, 2, 5]);
    expect(parseChord('F#m7b5')!.intervals).toEqual([0, 3, 6, 10]);
    expect(parseChord('C/E')!.bass).toBe(4);
    expect(parseChord('Bbmaj7')!.root).toBe(10);
    expect(parseChord('Hello')).toBeNull();
    expect(isChordSymbol('Am7')).toBe(true);
    expect(isChordSymbol('Amazing')).toBe(false);
  });
  it('finds harmonica chords on a C diatonic', () => {
    const c = findHarmonicaChord(C, parseChord('C')!)!;
    expect(c.sounds.every((s) => s.breath === 'blow')).toBe(true);
    expect(c.coverage).toBe(1);
    const g7 = findHarmonicaChord(C, parseChord('G7')!)!;
    expect(g7.sounds.every((s) => s.breath === 'draw')).toBe(true);
    const dm = findHarmonicaChord(C, parseChord('Dm')!)!;
    expect(dm.sounds.map((s) => s.hole)).toEqual([4, 5, 6]);
    // F# major isn't on a C harp: a single chord tone at best.
    const fs = findHarmonicaChord(C, parseChord('F#')!);
    expect(!fs || fs.sounds.length <= 1).toBe(true);
  });
});

describe('ABC', () => {
  it('reads keys, accidentals, lengths, rhythm and lyrics', () => {
    const abc = `X:1
T:Test
C:Someone
M:3/4
L:1/8
Q:1/4=90
K:G
"G"G2 A2 B2 | F2 =F2 F2 | c>B A/G/ (3ABc | d6- | d2 z4 |]
w: one two three four five six se-ven
`;
    const { doc, warnings } = parseAbc(abc);
    expect(warnings).toEqual([]);
    expect(doc.meta).toMatchObject({ title: 'Test', artist: 'Someone', time: '3/4', tempo: 90, key: 'G' });
    expect(flat(doc)).toEqual([
      'G4:1', 'A4:1', 'B4:1',
      'F#4:1', 'F4:1', 'F4:1', // natural lasts until the bar
      'C5:0.75', 'B4:0.25', 'A4:0.25', 'G4:0.25', 'A4:0.333', 'B4:0.333', 'C5:0.333',
      'D5:3', 'D5:1', // a tie across the bar line stays a tie
      'r:2',
    ]);
    const notes = doc.lines[0].events.filter((e) => e.kind === 'note') as NoteEvent[];
    expect(notes[0].chord).toBe('G');
    expect(notes.slice(0, 3).map((n) => n.lyric)).toEqual(['one', 'two', 'three']);
    expect(notes[6].lyric).toBe('se-');
    expect(notes[7].lyric).toBe('ven');
  });

  it('round-trips a tab through ABC', () => {
    const { text } = writeAbc(TWINKLE_TAB, C, { tabLine: false });
    expect(text).toContain('K:C');
    const back = parseAbc(text).doc;
    const notes = notesToTab(back, C).doc;
    expect(flat(back)).toEqual(['C5:1', 'C5:1', 'G5:1', 'G5:1', 'A5:1', 'A5:1', 'G5:2']);
    expect(serializeHtab(notes)).toContain('4 4 6 6 | [F] -6 -6 [C] 6~ |');
    const n0 = back.lines[0].events[0] as NoteEvent;
    expect(n0.lyric).toBe('Twin-');
  });

  it('writes the tab as a lyric line and handles triplets', () => {
    const doc = parseHtab('{4 5 6} -4~ |').doc;
    const { text } = writeAbc(doc, C, { tabLine: true });
    expect(text).toMatch(/\(3c e g d'?4?/);
    expect(text).toContain('w: 4 5 6 \\-4');
    expect(flat(parseAbc(text).doc)).toEqual(['C5:0.333', 'E5:0.333', 'G5:0.333', 'D5:2']);
  });
});

describe('chord sheets', () => {
  it('parses ChordPro with capo and sections', () => {
    const { doc, warnings } = parseChordPro(`{title: Song}
{artist: Band}
{capo: 2}
{soc}
[G]Hello my [C]friend
just words
[D]Bye`);
    expect(doc.meta.title).toBe('Song');
    expect(warnings[0]).toMatch(/Capo 2/);
    const evs = doc.lines.flatMap((l) => l.events).filter((e) => e.kind === 'rest') as any[];
    expect(evs.map((e) => e.chord)).toEqual(['A', 'D', undefined, 'E']);
    expect(evs[0].lyric).toBe('Hello my');
    expect(evs[1].lyric).toBe('friend');
    // A line without chords keeps its own place, continuing the previous chord.
    expect(evs[2].lyric).toBe('just words');
    expect(doc.lines[0].section).toBe('Chorus');
    expect(isChordSheet(doc)).toBe(true);
  });

  it('converts chords-over-lyrics text', () => {
    const ug = `Amazing Song chords by Some Artist
Capo: 1st fret

[Verse 1]
G           C        G
Here comes a line of words
     D7
And another

[Chorus]
Em   C   G   D`;
    expect(isChordLine('G           C        G')).toBe(true);
    expect(isChordLine('Here comes a line of words')).toBe(false);
    const cp = chordsOverLyricsToChordPro(ug);
    expect(cp).toContain('{title: Amazing Song}');
    expect(cp).toContain('{artist: Some Artist}');
    expect(cp).toContain('{capo: 1}');
    expect(cp).toContain('[G]Here comes a [C]line of [G]words');
    expect(cp).toContain('{comment: Chorus}');
    expect(sniffText(ug)).toBe('chordsheet');
    const imp = importText(ug, 'chordsheet');
    const chords = imp.doc.lines.flatMap((l) => l.events).filter((e) => e.kind === 'rest' && e.chord).map((e: any) => e.chord);
    expect(chords).toEqual(['G#', 'C#', 'G#', 'D#7', 'Fm', 'C#', 'G#', 'D#']);
  });

  it('turns a chord sheet into harmonica chords and suggests a harp', () => {
    const { doc } = parseChordPro('[C]one [F]two [G7]three [C]four');
    const r = chordSheetToTab(doc, C, 'halves');
    expect(r.missingChords).toEqual([]);
    const notes = r.doc.lines[0].events.filter((e) => e.kind === 'note') as NoteEvent[];
    expect(notes).toHaveLength(8);
    expect(notes[0].lyric).toBe('one');
    expect(notes[1].chord).toBeUndefined();
    const best = suggestForChordSheet(doc, { families: ['diatonic'] })[0];
    expect(best.spec.key).toBe('C');
    expect(writeChordPro(r.doc)).toContain('[C]one [F]two [G7]three [C]four');
  });
});

describe('MIDI', () => {
  it('round-trips a melody', () => {
    const bytes = writeMidi(TWINKLE_TAB, C);
    const { doc } = parseMidi(bytes);
    expect(doc.meta.tempo).toBe(96);
    expect(flat(doc)).toEqual(['C5:1', 'C5:1', 'G5:1', 'G5:1', 'A5:1', 'A5:1', 'G5:2']);
  });

  it('skips SysEx messages without losing the timing', () => {
    const bytes = writeMidi(TWINKLE_TAB, C);
    // Insert a GM-reset SysEx (delta 0) at the start of the first track and fix its length.
    const at = bytes.findIndex((_, i) => String.fromCharCode(...bytes.slice(i, i + 4)) === 'MTrk');
    const sysex = [0x00, 0xf0, 0x05, 0x7e, 0x7f, 0x09, 0x01, 0xf7];
    const len = new DataView(bytes.buffer, bytes.byteOffset).getUint32(at + 4) + sysex.length;
    const out = new Uint8Array([...bytes.slice(0, at + 4), len >>> 24, (len >> 16) & 255, (len >> 8) & 255, len & 255, ...sysex, ...bytes.slice(at + 8)]);
    expect(flat(parseMidi(out).doc)).toEqual(['C5:1', 'C5:1', 'G5:1', 'G5:1', 'A5:1', 'A5:1', 'G5:2']);
  });
});

describe('MusicXML', () => {
  it('round-trips notes, chords symbols, lyrics and ties', () => {
    const doc = parseHtab('---\ntitle: X\nkey: F\ntime: 3/4\n---\n[F] 4 -4~~ 5 {6 -6} 6~~~ |\nw: a b- c d e f').doc;
    const xml = writeMusicXml(doc, C);
    expect(xml).toContain('<fifths>-1</fifths>');
    expect(xml).toContain('<lyric number="2" name="tab">');
    const back = parseMusicXml(xml).doc;
    expect(back.meta.time).toBe('3/4');
    expect(back.meta.key).toBe('F');
    // Notes crossing a 3/4 bar line come back as ties.
    expect(flat(back)).toEqual(['C5:1', 'D5:2', 'D5:1', 'E5:1', 'G5:0.5', 'A5:0.5', 'G5:3', 'G5:1']);
    const tiedFlags = back.lines.flatMap((l) => l.events).filter((e) => e.kind === 'note').map((e) => !!(e as NoteEvent).tied);
    expect(tiedFlags).toEqual([false, false, true, false, false, false, false, true]);
    const notes = back.lines.flatMap((l) => l.events).filter((e) => e.kind === 'note' && !e.tied) as NoteEvent[];
    expect(notes[0].chord).toBe('F');
    expect(notes.map((n) => n.lyric)).toEqual(['a', 'b-', 'c', 'd', 'e', 'f']);
  });
});

describe('chord placement', () => {
  it('keeps words whole when a chord sits mid-word', () => {
    const cp = chordsOverLyricsToChordPro('G                 C\nWalking down the sunny road');
    expect(cp).toContain('[G]Walking down the [C]sunny road');
  });
});

describe('chord sheets keep their lines', () => {
  const SHEET = `[Verse 1]
 C
Let me sing you something, there's a long road,
                         D7         G7
over the hill-side, when the morning glows.

[Chorus]
        G                   F        C
Yippee ki-yi-yay, when the round-up ends.`;

  it('keeps lead-in words on their own line, sizes chords by lyrics, and keeps hyphens', () => {
    const { doc } = importText('```\n' + SHEET + '\n```', 'chordsheet');
    expect(doc.meta.title).toBeUndefined();
    const verse = doc.lines[1].events.filter((e) => e.kind === 'rest') as any[];
    expect(verse[0]).toMatchObject({ lyric: 'over the hill-side, when' });
    expect(verse[0].chord).toBeUndefined();
    expect(verse.map((e) => e.chord)).toEqual([undefined, 'D7', 'G7']);
    const total = verse.reduce((a, e) => a + e.beats, 0);
    expect(total).toBe(8); // a typical lyric line ≈ 2 bars
    expect(verse[0].beats).toBeGreaterThan(verse[1].beats);

    const r = chordSheetToTab(doc, C, 'hold');
    const text = serializeHtab(r.doc);
    // Lead-in plays on the previous chord (C); hyphenated words survive a round trip.
    expect(text).toContain(String.raw`w: Yippee ki\-yi\-yay,~when~the round\-up ends.`);
    const back = parseHtab(text).doc;
    const chorus = back.lines[2].events.filter((e) => e.kind === 'note') as NoteEvent[];
    expect(chorus.map((n) => n.lyric)).toEqual(['Yippee', 'ki-yi-yay, when the', 'round-up', 'ends.']);
    expect((back.lines[1].events[0] as NoteEvent).sounds).toEqual((back.lines[0].events[0] as NoteEvent).sounds);
  });
});

describe('chord-sheet detection', () => {
  const SONG = `[Verse 1]
 C
Let me tell you buddy, there's a faster gun,
                         D7         G7
comin' over yonder, when tomorrow comes.

[Chorus]
        G                   F        C
Yippee ki-yi-yay, when the round-up ends.

[Chorus]
        G                   F       G
Yippee ki-yi-yay, and the campfire dims.

[Chorus]
       G            F     C
Yippee ki-yi-yay, (I'm glory bound).`;

  it('does not mistake section headings for chords', () => {
    expect(parseChord('Chorus')).toBeNull();
    expect(parseChord('Cmaj7(#11)')).not.toBeNull();
    expect(parseChord('Bridge')).toBeNull();
  });

  it('reads the same with or without code fences, and with non-breaking spaces', () => {
    const variants = [SONG, '```\n' + SONG + '\n```', SONG.replace(/ /g, ' '), SONG.replace(/\n/g, '\r\n')];
    const results = variants.map((v) => {
      expect(sniffText(v)).toBe('chordsheet');
      const { doc } = importText(v);
      return doc.lines.flatMap((l) => l.events).filter((e) => e.kind === 'rest').map((e: any) => `${e.chord ?? '-'}:${e.lyric ?? ''}`);
    });
    for (const r of results) expect(r).toEqual(results[0]);
    expect(results[0].slice(0, 4)).toEqual([
      "C:Let me tell you buddy, there's a faster gun,",
      "-:comin' over yonder, when",
      'D7:tomorrow',
      'G7:comes.',
    ]);
    const { doc } = importText(SONG);
    expect(doc.lines.map((l) => l.section).filter(Boolean)).toEqual(['Verse 1', 'Chorus', 'Chorus', 'Chorus']);
  });
});
