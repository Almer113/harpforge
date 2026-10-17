// Phase 20c: MIDI — words, tempo changes, repeats played out, the backing on its own track.

import { describe, expect, it } from 'vitest';
import { parseHtab } from '../htab/parser';
import type { NoteEvent } from '../htab/types';
import { harmonicaFromMeta } from '../score';
import { parseMidi, writeMidi } from './midi';

const docOf = (body: string, head = '') => parseHtab(`---\ntitle: M\ntempo: 100\n${head}---\n${body}\n`).doc;
const notes = (r: ReturnType<typeof parseMidi>) => r.doc.lines.flatMap((l) => l.events).filter((e): e is NoteEvent => e.kind === 'note');

/** The lyric (FF 05) and text (FF 01) events of a file, in order. */
function metaTexts(bytes: Uint8Array, type: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < bytes.length - 3; i++) {
    if (bytes[i] !== 0xff || bytes[i + 1] !== type) continue;
    const len = bytes[i + 2];
    out.push(new TextDecoder().decode(bytes.slice(i + 3, i + 3 + len)));
    i += 2 + len;
  }
  return out;
}

/** A small MIDI file: one track of `events` ([delta ticks, bytes…]), 480 ticks a beat. */
function midiFile(events: number[][]): Uint8Array {
  const track = [...events.flat(), 0, 0xff, 0x2f, 0];
  const len = track.length;
  return new Uint8Array([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0, 0x4d, 0x54, 0x72, 0x6b, (len >>> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff, ...track]);
}
const text = (type: number, s: string) => [0xff, type, s.length, ...new TextEncoder().encode(s)];
const tempo = (bpm: number) => {
  const us = Math.round(60_000_000 / bpm);
  return [0xff, 0x51, 3, (us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff];
};
// (A quarter note: 480 ticks — 0x83 0x60 as a variable-length number.)
const QUARTER = [0x83, 0x60];
const note = (midi: number) => [[0, 0x90, midi, 90], [...QUARTER, 0x80, midi, 0]];

describe('MIDI export', () => {
  it('repeats played out, each time through singing its verse; a word’s last syllable followed by a space', () => {
    const doc = docOf('|: 4 5 6 -4 :|\nw: Twin-kle lit-tle\nw: How I won-der');
    const data = writeMidi(doc, harmonicaFromMeta(doc.meta));
    expect(metaTexts(data, 0x05)).toEqual(['Twin-', 'kle ', 'lit-', 'tle ', 'How ', 'I ', 'won-', 'der ']);
    expect(parseMidi(data).doc.lines.flatMap((l) => l.events).filter((e) => e.kind === 'note')).toHaveLength(8);
  });

  it('a song with chords: the backing on a second track and channel (format 1), in the style chosen', () => {
    const doc = docOf('[C] 4 5 6 4 | [G] -4 -5 -4 -4 |');
    const pad = writeMidi(doc, harmonicaFromMeta(doc.meta));
    expect([pad[9], pad[11]]).toEqual([1, 2]);
    expect(metaTexts(pad, 0x03)).toEqual(['M', 'Backing (Pad)']);
    expect(metaTexts(pad, 0x01)).toEqual(['C', 'G']);
    const strum = writeMidi(doc, harmonicaFromMeta(doc.meta), { backing: 'strum' });
    expect(metaTexts(strum, 0x03)[1]).toBe('Backing (Strum)');
    // (Read back, the tune is still the melody: a harmonica isn't a pad.)
    expect(notes(parseMidi(pad)).map((e) => e.sounds.length)).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
  });

  it('a song without chords: one track (format 0), no backing', () => {
    const doc = docOf('4 5 6 4 |');
    const data = writeMidi(doc, harmonicaFromMeta(doc.meta));
    expect([data[9], data[11]]).toEqual([0, 1]);
  });
});

describe('MIDI import', () => {
  it('its words (lyric events) on the notes, a syllable without a space before it going on the word before', () => {
    const r = parseMidi(midiFile([[0, ...text(0x05, 'Twin')], ...note(72).slice(0, 1), ...note(72).slice(1), [0, ...text(0x05, 'kle ')], ...note(74), [0, ...text(0x05, 'star ')], ...note(76)]));
    expect(notes(r).map((e) => e.lyric)).toEqual(['Twin-', 'kle', 'star']);
    expect(r.warnings.some((w) => w.startsWith('Put the file’s words on the notes (3 syllables'))).toBe(true);
  });

  it('a karaoke file’s words as text ("/" a new line, "@" its title and such)', () => {
    const r = parseMidi(midiFile([[0, ...text(0x01, '@TSong')], [0, ...text(0x01, '/Di ')], ...note(72), [0, ...text(0x01, 'si')], ...note(74), [0, ...text(0x01, 'ni ')], ...note(76)]));
    expect(notes(r).map((e) => e.lyric)).toEqual(['Di', 'si-', 'ni']);
  });

  it('chord symbols written as text go on the notes (as our export writes them)', () => {
    const r = parseMidi(midiFile([[0, ...text(0x01, 'G7')], ...note(67), ...note(71)]));
    expect(notes(r)[0].chord).toBe('G7');
  });

  it('the tempo changing: the one it’s played at longest is kept, and that’s said', () => {
    // 90 bpm for one beat, 120 for three.
    const r = parseMidi(midiFile([[0, ...tempo(90)], ...note(72), [0, ...tempo(120)], ...note(74), ...note(76), ...note(77)]));
    expect(r.doc.meta.tempo).toBe(120);
    expect(r.warnings).toContain('The tempo changes during the song (90–120 bpm): the tab keeps 120 bpm, the tempo it’s played at longest.');
    expect(parseMidi(midiFile([[0, ...tempo(90)], ...note(72)])).warnings.some((w) => w.includes('tempo changes'))).toBe(false);
  });
});
