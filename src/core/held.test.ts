// @vitest-environment happy-dom
// Phase 15c: held syllables — "_" in a "w:" line holds the syllable before over the note
// ("Oh___"), kept apart from "*" (no words): through edits, the lyrics tools, the Lyrics view,
// ABC and MusicXML.

import { describe, expect, it } from 'vitest';
import { fillLyrics, clearLyrics, shiftLyrics, typeLyric } from './edit/lyrics';
import { findItem, fromDoc, toDoc } from './edit/model';
import { parseAbc, writeAbc } from './formats/abc';
import { parseMusicXml, writeMusicXml } from './formats/musicxml';
import { parseHtab } from './htab/parser';
import { serializeHtab } from './htab/serializer';
import { lyricsLine } from './lyricsLayout';
import { harmonicaFromMeta } from './score';
import { isHeld, lyricOf, setLyricOf } from './verses';
import type { NoteEvent } from './htab/types';

const SONG = '---\ntitle: Hold\n---\n4 5 6 4 |\nw: Oh _ ri-ver\n';
const notes = (text: string) => parseHtab(text).doc.lines[0].events.filter((e): e is NoteEvent => e.kind === 'note');

describe('in the song', () => {
  it('"_" holds the syllable before; "*" is no words', () => {
    const [a, b, c] = notes(SONG);
    expect([lyricOf(a, 0), isHeld(b, 0), lyricOf(b, 0), lyricOf(c, 0)]).toEqual(['Oh', true, undefined, 'ri-']);
    const star = notes('---\ntitle: S\n---\n4 5 6 |\nw: Oh * ri\n');
    expect(isHeld(star[1], 0)).toBe(false);
  });

  it('written back as "_" — also after the line goes through the editor (it used to become "*")', () => {
    const doc = parseHtab(SONG).doc;
    expect(serializeHtab(toDoc(fromDoc(doc)))).toContain('w: Oh _ ri-ver');
    // Holds at the end of a line are kept too.
    const end = '---\ntitle: E\n---\n4 5 6 |\nw: Oh _ _\n';
    expect(serializeHtab(toDoc(fromDoc(parseHtab(end).doc)))).toContain('w: Oh _ _');
  });

  it('a syllable put on a held note replaces the hold', () => {
    const [, b] = notes(SONG);
    setLyricOf(b, 0, 'la');
    expect([lyricOf(b, 0), isHeld(b, 0)]).toEqual(['la', false]);
  });

  it('the Lyrics view: the syllable is marked held (its hold line), not a no-words note', () => {
    const words = lyricsLine(parseHtab(SONG).doc.lines[0]);
    expect(words[0].syllables[0]).toMatchObject({ text: 'Oh', held: true });
    expect(lyricsLine(parseHtab('---\ntitle: S\n---\n4 5 6 |\nw: Oh * ri\n').doc.lines[0])[0].syllables[0].held).toBeUndefined();
  });
});

describe('the lyrics tools', () => {
  const song = () => fromDoc(parseHtab('---\ntitle: T\n---\n4 5 6 4 |\n').doc);
  const at = (start: number) => ({ m: 0, start });

  it('typing "_" makes a real hold', () => {
    const { song: s } = typeLyric(song(), at(0), 0, 'Oh', { text: '', joined: false }, 'hold');
    expect(isHeld(findItem(s, at(1))!, 0)).toBe(true);
    expect(serializeHtab(toDoc(s))).toContain('w: Oh _');
  });

  it('“Fill lyrics from text”: "_" holds, "*" doesn’t', () => {
    const { song: s } = fillLyrics(song(), null, 0, 'Oh _ * la');
    expect([isHeld(findItem(s, at(1))!, 0), isHeld(findItem(s, at(2))!, 0)]).toEqual([true, false]);
  });

  it('moving the lyrics a note later takes the holds along; clearing them clears holds too', () => {
    const { song: filled } = fillLyrics(song(), null, 0, 'Oh _ la');
    const { song: moved } = shiftLyrics(filled, at(0), 0, 1);
    expect([lyricOf(findItem(moved, at(1))!, 0), isHeld(findItem(moved, at(2))!, 0), lyricOf(findItem(moved, at(3))!, 0)]).toEqual(['Oh', true, 'la']);
    const cleared = clearLyrics(moved, null, 0);
    expect(isHeld(findItem(cleared, at(2))!, 0)).toBe(false);
  });
});

describe('files', () => {
  it('ABC: written "_" (it was "*"), and read back as a hold', () => {
    const doc = parseHtab(SONG).doc;
    const abc = writeAbc(doc, harmonicaFromMeta(doc.meta)).text;
    expect(abc).toMatch(/w: Oh _ ri-ver/);
    const back = parseAbc(abc).doc.lines[0].events.filter((e): e is NoteEvent => e.kind === 'note');
    expect(isHeld(back[1], 0)).toBe(true);
  });

  it('MusicXML: an extender started on the syllable, continued on the held note; read back as a hold', () => {
    const doc = parseHtab(SONG).doc;
    const xml = writeMusicXml(doc, harmonicaFromMeta(doc.meta));
    expect(xml).toContain('<text>Oh</text><extend type="start"/>');
    expect(xml).toContain('<extend type="continue"/>');
    const back = parseMusicXml(xml).doc.lines.flatMap((l) => l.events).filter((e): e is NoteEvent => e.kind === 'note');
    expect([lyricOf(back[0], 0), isHeld(back[1], 0)]).toEqual(['Oh', true]);
  });

  it('MusicXML as most programs write it — the extend on the syllable only: the notes after are held', () => {
    const note = (step: string, lyric = '') => `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type>${lyric}</note>`;
    const xml = `<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"><part-name>M</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>${note('C', '<lyric number="1"><syllabic>single</syllabic><text>Oh</text><extend/></lyric>')}${note('D')}${note('E', '<lyric number="1"><syllabic>single</syllabic><text>la</text></lyric>')}${note('F')}</measure></part></score-partwise>`;
    const back = parseMusicXml(xml).doc.lines.flatMap((l) => l.events).filter((e): e is NoteEvent => e.kind === 'note');
    expect(back.map((e) => lyricOf(e, 0) ?? (isHeld(e, 0) ? '_' : '*'))).toEqual(['Oh', '_', 'la', '*']);
  });
});
