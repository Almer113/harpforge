import { describe, expect, it } from 'vitest';
import { importText, sniffText } from './formats';
import { degreeToMidi, doPitchClass, midiToDegree, parseJianpu, writeJianpu } from './formats/jianpu';
import { notesToTab } from './convert';
import { serializeHtab } from './htab/serializer';
import { parseHtab } from './htab/parser';
import type { NoteEvent, TabDoc } from './htab/types';
import { getHarmonica } from './instruments';
import { midiToName } from './pitch';

const flat = (doc: TabDoc) =>
  doc.lines.flatMap((l) => l.events).filter((e) => e.kind !== 'bar').map((e) =>
    e.kind === 'rest' ? `0:${+e.beats.toFixed(3)}` : `${(e as NoteEvent).sounds.map((s) => (s.type === 'pitch' ? midiToName(s.midi) : '?')).join('+')}:${+e.beats.toFixed(3)}`,
  );

describe('numbered notation (jianpu)', () => {
  it('maps degrees to pitches relative to the key', () => {
    expect(doPitchClass('G')).toBe(7);
    expect(doPitchClass('Am')).toBe(0); // la-based minor: do is C
    expect(degreeToMidi({ degree: 1, accidental: 0, octave: 0 }, 0)).toBe(60);
    expect(degreeToMidi({ degree: 5, accidental: 0, octave: 1 }, 7)).toBe(67 + 12 + 7);
    expect(midiToDegree(61, 0)).toEqual({ degree: 1, accidental: 1, octave: 0 });
    expect(midiToDegree(59, 0)).toEqual({ degree: 7, accidental: 0, octave: -1 });
  });

  it('reads key, rhythm, octaves, rests, lyrics and chords', () => {
    const text = `title: Twinkle
1=C 4/4 ♩=96
[C] 1 1 5 5 | 6 6 5 - | 4_ 4_ 3. 3_ 2' 2, | 0 #4 b7 1̇ |
w: twin-kle twin-kle lit-tle star`;
    expect(sniffText(text)).toBe('jianpu');
    const { doc, warnings } = parseJianpu(text);
    expect(warnings).toEqual([]);
    expect(doc.meta).toMatchObject({ title: 'Twinkle', key: 'C', time: '4/4', tempo: 96 });
    expect(flat(doc)).toEqual([
      'C4:1', 'C4:1', 'G4:1', 'G4:1', 'A4:1', 'A4:1', 'G4:2',
      'F4:0.5', 'F4:0.5', 'E4:1.5', 'E4:0.5', 'D5:1', 'D3:1',
      '0:1', 'F#4:1', 'Bb4:1', 'C5:1',
    ].map((x) => x.replace('Bb4', 'A#4')));
    const notes = doc.lines[0].events.filter((e) => e.kind === 'note') as NoteEvent[];
    expect(notes[0].chord).toBe('C');
    expect(notes[0].lyric).toBe('twin-');
  });

  it('handles 1=G, "1=bB" spellings and triplet groups', () => {
    expect(flat(parseJianpu('1=G\n1 3 5 1\'').doc)).toEqual(['G4:1', 'B4:1', 'D5:1', 'G5:1']);
    expect(parseJianpu('1=bB\n1').doc.meta.key).toBe('Bb');
    expect(flat(parseJianpu('1=C\n{1 2 3} 5~').doc)).toEqual(['C4:0.333', 'D4:0.333', 'E4:0.333', 'G4:2']);
  });

  it('does not mistake hole tabs for numbers', () => {
    expect(sniffText('4 4 6 6 | -6 -6 6~')).toBe('htab');
  });

  it('round-trips a harmonica tab through numbered notation', () => {
    const C = getHarmonica({ key: 'C' });
    const tab = parseHtab(`---
title: Mixed
harp-key: C
time: 3/4
---
[C] 4 -4~ {5 6 5} | 6~~ |
w: one two- three four five six`).doc;
    const text = writeJianpu(tab, C);
    expect(text).toContain('1=C 3/4');
    expect(text).toContain("[C]1' 2' - {3' 5' 3'} | 5' - - |");
    const back = importText(text).doc;
    expect(flat(back)).toEqual(['C5:1', 'D5:2', 'E5:0.333', 'G5:0.333', 'E5:0.333', 'G5:3']);
    expect(serializeHtab(notesToTab(back, C).doc)).toContain('[C] 4 -4~ {5 6 5} | 6~~ |');
  });
});
