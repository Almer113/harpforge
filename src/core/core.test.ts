import { describe, expect, it } from 'vitest';
import { getHarmonica, maxBend, soundPitch, canOver } from './instruments';
import { parseHtab, parseSound } from './htab/parser';
import { serializeHtab } from './htab/serializer';
import { setMetaFields } from './htab/meta';
import { buildScore, harmonicaFromMeta } from './score';
import { notesToTab, positionFor, retab, suggestHarmonicas, tabToNotes } from './convert';
import { midiToName, parseNoteName } from './pitch';
import { holeSound, type HoleSound } from './types';

const C = getHarmonica({ family: 'diatonic', tuning: 'richter', key: 'C' });

describe('pitch', () => {
  it('round-trips note names', () => {
    expect(parseNoteName('C4')).toBe(60);
    expect(parseNoteName('Bb3')).toBe(58);
    expect(parseNoteName('F#5')).toBe(78);
    expect(midiToName(61)).toBe('C#4');
    expect(midiToName(61, true)).toBe('Db4');
  });
});

describe('instruments', () => {
  it('builds a C Richter diatonic', () => {
    expect(C.holes.map((h) => midiToName(h.blow))).toEqual(['C4', 'E4', 'G4', 'C5', 'E5', 'G5', 'C6', 'E6', 'G6', 'C7']);
    expect(C.holes.map((h) => midiToName(h.draw))).toEqual(['D4', 'G4', 'B4', 'D5', 'F5', 'A5', 'B5', 'D6', 'F6', 'A6']);
  });
  it('knows diatonic bends and overblows', () => {
    expect(maxBend(C, 3, 'draw')).toBe(3);
    expect(maxBend(C, 2, 'draw')).toBe(2);
    expect(maxBend(C, 10, 'blow')).toBe(2);
    expect(maxBend(C, 5, 'blow')).toBe(0);
    expect(soundPitch(C, holeSound(3, 'draw', { bend: 2 }))).toBe(parseNoteName('A4'));
    expect(soundPitch(C, holeSound(6, 'blow', { over: true }))).toBe(parseNoteName('A#5'));
    expect(canOver(C, 7, 'draw')).toBe(true);
    expect(soundPitch(C, holeSound(4, 'draw', { bend: 2 }))).toBeNull();
  });
  it('builds a chromatic with slide', () => {
    const chrom = getHarmonica({ family: 'chromatic', tuning: 'solo-12', key: 'C' });
    expect(chrom.holes).toHaveLength(12);
    expect(soundPitch(chrom, holeSound(1, 'blow', { slide: true }))).toBe(61);
    expect(soundPitch(chrom, holeSound(4, 'draw'))).toBe(71);
  });
  it('places other keys in the standard range', () => {
    expect(getHarmonica({ key: 'G' }).holes[0].blow).toBe(55);
    expect(getHarmonica({ key: 'F#' }).holes[0].blow).toBe(66);
    expect(getHarmonica({ key: 'Low D' }).holes[0].blow).toBe(50);
  });
});

describe('htab parser', () => {
  it('parses sound spellings', () => {
    const s = (w: string) => parseSound(w) as HoleSound;
    expect(s('-4')).toMatchObject({ hole: 4, breath: 'draw', bend: 0 });
    expect(s('+4')).toMatchObject({ hole: 4, breath: 'blow' });
    expect(s('4D')).toMatchObject({ hole: 4, breath: 'draw' });
    expect(s("-3''")).toMatchObject({ hole: 3, breath: 'draw', bend: 2 });
    expect(s('-3b')).toMatchObject({ bend: 1 });
    expect(s('6o')).toMatchObject({ hole: 6, breath: 'blow', over: true });
    expect(s('<5')).toMatchObject({ hole: 5, slide: true });
    expect(parseSound('C#4')).toEqual({ type: 'pitch', midi: 61 });
    expect(typeof parseSound('x4')).toBe('string');
  });

  it('parses header, rhythm, chords, lyrics, sections', () => {
    const text = `---
title: Test
harmonica: diatonic
harp-key: G
tempo: 90
---
@ Verse
[C] 4 -4~ {5 6} | (4 5 6)~ . -(1 2 3) ||
w: twin-kle twin kle
`;
    const { doc, issues } = parseHtab(text);
    expect(issues).toEqual([]);
    expect(doc.meta).toMatchObject({ title: 'Test', harpKey: 'G', tempo: 90 });
    const line = doc.lines[0];
    expect(line.section).toBe('Verse');
    const kinds = line.events.map((e) => e.kind);
    expect(kinds).toEqual(['note', 'note', 'note', 'note', 'bar', 'note', 'rest', 'note', 'bar']);
    const notes = line.events.filter((e) => e.kind === 'note') as any[];
    expect(notes[0].chord).toBe('C');
    expect(notes.map((n) => n.beats)).toEqual([1, 2, 0.5, 0.5, 2, 1]);
    expect(notes[0].lyric).toBe('twin-');
    expect(notes[1].lyric).toBe('kle');
    expect(notes[4].sounds).toHaveLength(3);
    expect(notes[5].sounds.every((s: HoleSound) => s.breath === 'draw')).toBe(true);
  });

  it('reports errors with spans', () => {
    const { issues } = parseHtab('4 -4 zz 5');
    expect(issues).toHaveLength(1);
    expect(issues[0].span).toEqual({ start: 5, end: 7 });
  });

  it('round-trips through the serializer', () => {
    const text = `---
title: Round trip
harmonica: diatonic
harp-key: C
tempo: 120
time: 3/4
---
@ A
[G7] -2 {-3' -3} -4~ | {4~ 5} {. 6 -6} -(1 2 3 4)~ |]
w: one two- three four
`;
    const a = parseHtab(text).doc;
    const out = serializeHtab(a);
    const b = parseHtab(out).doc;
    const strip = (d: typeof a) => JSON.parse(JSON.stringify(d, (k, v) => (k === 'src' ? undefined : v)));
    expect(strip(b)).toEqual(strip(a));
  });
});

describe('meta editing', () => {
  it('replaces and adds fields, keeping the body', () => {
    const text = '---\ntitle: X\nkey: C\n---\n4 5 6\n';
    const out = setMetaFields(text, { harpKey: 'A', title: 'Y' });
    expect(out).toBe('---\ntitle: Y\nkey: C\nharp-key: A\n---\n4 5 6\n');
    expect(setMetaFields('4 5', { tempo: 80 })).toBe('---\ntempo: 80\n---\n4 5');
  });
});

describe('score + conversion', () => {
  const twinkle = parseHtab('4 4 6 6 -6 -6 6~ | -5 -5 5 5 -4 -4 4~').doc;

  it('builds a timed score', () => {
    const { score, issues } = buildScore(twinkle, harmonicaFromMeta(twinkle.meta));
    expect(issues).toEqual([]);
    expect(score.totalBeats).toBe(16);
    expect(score.events[6]).toMatchObject({ start: 6, beats: 2, midis: [79] });
  });

  it('converts tab → notes → tab losslessly for simple melodies', () => {
    const notes = tabToNotes(twinkle, C).doc;
    const first = notes.lines[0].events[0] as any;
    expect(first.sounds[0]).toEqual({ type: 'pitch', midi: 72 });
    const back = notesToTab(notes, C);
    expect(back.warnings).toEqual([]);
    expect(serializeHtab(back.doc)).toContain('4 4 6 6 -6 -6 6~ | -5 -5 5 5 -4 -4 4~');
  });

  it('uses bends only when needed, and flags unplayable notes', () => {
    const doc = parseHtab('B4 Bb4 A4 G4').doc; // -3, -3', -3'', -2 (or 3)
    const r = notesToTab(doc, C);
    expect(r.stats.bends).toBe(2);
    const bad = notesToTab(parseHtab('B3').doc, C);
    expect(bad.stats.unplayable).toBe(1);
  });

  it('places chords on adjacent holes', () => {
    const r = notesToTab(parseHtab('(C4 E4 G4) (D4 G4 B4)').doc, C);
    expect(serializeHtab(r.doc)).toContain('(1 2 3) -(1 2 3)');
  });

  it('re-tabs a diatonic melody for chromatic', () => {
    const chrom = getHarmonica({ family: 'chromatic', tuning: 'solo-12', key: 'C' });
    const r = retab(twinkle, C, chrom);
    expect(r.stats.unplayable).toBe(0);
  });

  it('suggests a fitting harmonica and position', () => {
    // A G-major melody with F#: a C diatonic can't play it without overblows, a G one can.
    const doc = parseHtab('---\nkey: G\n---\nG4 A4 B4 C5 D5 E5 F#5 G5').doc;
    const best = suggestHarmonicas(doc, { families: ['diatonic'] })[0];
    expect(best.stats.unplayable).toBe(0);
    expect(positionFor('C', 7)).toBe(2);
    expect(positionFor('G', 7)).toBe(1);
  });
});

describe('suggestion ranking', () => {
  it('prefers a standard diatonic in a common position for a simple G melody', () => {
    const doc = parseHtab(`---
key: G
time: 3/4
---
D4 | G4~ {B4 G4} | B4~ A4 | G4~ E4 | D4~ D4 | G4~ {B4 G4} | B4~ A4 | D5~~ | D5~ |]`).doc;
    const top = suggestHarmonicas(doc, { limit: 3 });
    expect(top[0].spec.family).toBe('diatonic');
    expect(top[0].spec.tuning).toBe('richter');
    expect([1, 2]).toContain(top[0].position);
    expect(top[0].stats.bends).toBe(0);
  });
});

describe('tremolo & octave harmonicas', () => {
  it('builds Hohner layouts in C', () => {
    const ocean = getHarmonica({ family: 'tremolo', tuning: 'asian-24', key: 'C' });
    expect(ocean.holes).toHaveLength(12);
    expect(ocean.voicing).toBe('tremolo');
    expect(midiToName(ocean.holes[0].blow)).toBe('G3');
    expect(midiToName(ocean.holes[11].draw)).toBe('B6');
    const comet = getHarmonica({ family: 'octave', tuning: 'comet-20', key: 'C' });
    expect(comet.voicing).toBe('octave');
    expect(midiToName(comet.holes[0].blow)).toBe('E4');
  });
  it('transposes to other keys and has no bends', () => {
    const g = getHarmonica({ family: 'tremolo', tuning: 'richter-20', key: 'G' });
    expect(midiToName(g.holes[0].blow)).toBe('G3');
    expect(maxBend(g, 3, 'draw')).toBe(0);
    expect(soundPitch(g, holeSound(3, 'draw', { bend: 1 }))).toBeNull();
  });
  it('plays Frère Jacques on an Asian tremolo without missing notes', () => {
    const doc = parseHtab('---\nharmonica: tremolo\ntuning: asian-24\n---\n2 -1 3 2 | 3 -2 4~ | {4 -3} {4 -2} 3 2 | 2 1 2~').doc;
    const { issues } = buildScore(doc, harmonicaFromMeta(doc.meta));
    expect(issues).toEqual([]);
  });
});

describe('octave shifting', () => {
  it('offers octaves that fit and blocks ones that do not', async () => {
    const { octaveOptions } = await import('./convert');
    const doc = parseHtab('4 4 6 6 -6 -6 6~').doc;
    const [up, down] = octaveOptions(doc, C);
    expect(down.possible).toBe(true);
    // An octave down, A4 is only reachable as the bent -3''.
    expect(serializeHtab(down.result!.doc)).toMatch(/1 1 (-2|3) (-2|3) -3'' -3'' (-2|3)~/);
    expect(down.note).toMatch(/2 bends/);
    expect(up.possible).toBe(true);
    // Hole 1 can't go lower.
    const low = octaveOptions(parseHtab('1 -1 2').doc, C);
    expect(low[1].possible).toBe(false);
  });
});
