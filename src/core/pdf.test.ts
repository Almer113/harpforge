import { describe, expect, it } from 'vitest';
import { importText, sniffText } from './formats';
import { chordsOverLyricsToChordPro } from './formats/chordpro';
import { parseGuitarTab } from './formats/guitartab';
import { cleanOcrPage, fixChordToken, fixRareChords, itemsToPage, layoutPages, type PosLine, type PosPage } from './formats/pdfLayout';
import type { NoteEvent } from './htab/types';
import { midiToName } from './pitch';

// Builds an OCR-like line: monospaced lyrics start at x=152 with a 15.6px pitch;
// bold chords sit ~10px right of the letter they belong to.
const PITCH = 15.6;
const M = 152;
function lyric(y: number, text: string, conf = 95): PosLine {
  const words: PosLine['words'] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) words.push({ text: m[0], x0: M + m.index * PITCH, x1: M + (m.index + m[0].length) * PITCH - 3, conf });
  return { words, y0: y, y1: y + 22 };
}
function chords(y: number, list: [string, number, number?][]): PosLine {
  return { words: list.map(([text, col, conf]) => ({ text, x0: M + col * PITCH + 10, x1: M + col * PITCH + 10 + text.length * 14, conf: conf ?? 92 })), y0: y, y1: y + 30 };
}

const PAGE: PosPage = {
  width: 1588,
  lines: [
    { words: [{ text: 'Paper', x0: 155, x1: 300, conf: 96 }, { text: 'Lanterns', x0: 315, x1: 480, conf: 96 }, { text: 'Chords', x0: 495, x1: 620, conf: 96 }, { text: 'by', x0: 640, x1: 680, conf: 96 }, { text: 'The', x0: 700, x1: 770, conf: 96 }, { text: 'Night', x0: 785, x1: 880, conf: 96 }, { text: 'J', x0: 1442, x1: 1503, conf: 61 }], y0: 115, y1: 173 },
    { words: [{ text: 'Owls', x0: 154, x1: 300, conf: 96 }], y0: 181, y1: 215 },
    lyric(255, 'Difficulty: novice'),
    lyric(295, 'Key: G'),
    lyric(360, 'CHORDS'),
    chords(420, [['G', 2], ['Cc', 10, 50], ['D', 18]]),
    { words: [{ text: 'il', x0: 148, x1: 232, conf: 30 }, { text: 'LiilR', x0: 416, x1: 531, conf: 0 }], y0: 460, y1: 540 },
    lyric(560, ' 320003   x32010   xx0232'),
    lyric(640, '[Intro]'),
    chords(680, [['G', 0], ['Cc', 2, 50], ['D', 5], ['x4', 7]]),
    lyric(760, '[Verse 1]'),
    chords(800, [['G', 0], ['Cc', 13, 52], ['D', 28]]),
    lyric(840, 'The lanterns rise above the bay'),
    chords(880, [['G', 4], ['[4', 16, 51], ['FE', 22, 63]]),
    lyric(920, 'And every light is on its way'),
    chords(960, [['E', 0, 70], ['G', 6]]),
    lyric(1000, "We'11 follow them"),
    { words: [{ text: 'Page', x0: 1448, x1: 1483, conf: 91 }, { text: '1/1', x0: 1490, x1: 1510, conf: 91 }], y0: 2147, y1: 2166 },
  ],
};

describe('OCR clean-up', () => {
  it('fixes misread chord tokens', () => {
    expect(fixChordToken('Cc')).toBe('C');
    expect(fixChordToken('[4')).toBe('C');
    expect(fixChordToken('FE')).toBe('F');
    expect(fixChordToken('Am7')).toBe('Am7');
    expect(fixChordToken('the')).toBeNull();
  });

  it('turns a picture-of-a-chord-sheet into a clean chord sheet', () => {
    const page = cleanOcrPage(PAGE);
    const text = layoutPages(fixRareChords([page]));
    expect(text.split('\n')[0]).toBe('Paper Lanterns Chords by The Night Owls');
    expect(text).not.toMatch(/\bJ\b|Page 1|LiilR/);
    expect(text).toContain("We'll follow them");

    const cp = chordsOverLyricsToChordPro(text);
    expect(cp).toContain('{title: Paper Lanterns}');
    expect(cp).toContain('{artist: The Night Owls}');
    expect(cp).toContain('{key: G}');
    // Chord-diagram block is skipped; intro repeats 4×.
    expect(cp).toContain('{comment: Intro}\n' + Array(4).fill('[G] [C] [D]').join(' '));
    expect(cp).toContain('[G]The lanterns [C]rise above the [D]bay');
    expect(cp).toContain("[E]We'll [G]follow them");
    expect(cp).toContain('And [G]every light [C]is on [F]its way');

    const imp = importText(text, sniffText(text));
    const chordsUsed = imp.doc.lines.flatMap((l) => l.events).filter((e) => e.kind === 'rest' && e.chord).map((e: any) => e.chord);
    expect(new Set(chordsUsed)).toEqual(new Set(['G', 'C', 'D', 'F', 'E']));
  });

  it('corrects one-off look-alike chords from the song context', () => {
    const page: PosPage = {
      width: 1000,
      lines: [chords(0, [['F', 0], ['F', 4], ['F', 8], ['E', 12, 60], ['C', 16]])],
    };
    const fixed = fixRareChords([page]);
    expect(fixed[0].lines[0].words.map((w) => w.text)).toEqual(['F', 'F', 'F', 'F', 'C']);
  });
});

describe('PDF text layer', () => {
  it('groups items into lines and keeps chords over the right words', () => {
    // Proportional chord font: x positions, not character counts, decide placement.
    const H = 800;
    const page = itemsToPage(
      [
        { str: 'Am', x: 72 + 7.2 * 6, y: H - 100, w: 16, h: 10 },
        { str: 'F', x: 72 + 7.2 * 17, y: H - 100, w: 6, h: 10 },
        { str: 'Under the silver moon', x: 72, y: H - 112, w: 7.2 * 21, h: 10 },
        { str: 'G', x: 72, y: H - 130, w: 7, h: 10 },
        { str: 'We sing', x: 72, y: H - 142, w: 7.2 * 7, h: 10 },
        { str: 'along', x: 72 + 7.2 * 8, y: H - 142, w: 7.2 * 5, h: 10 },
      ],
      600,
      H,
    );
    expect(page.lines).toHaveLength(4);
    const cp = chordsOverLyricsToChordPro(layoutPages([page]));
    expect(cp).toContain('Under [Am]the silver [F]moon');
    expect(cp).toContain('[G]We sing along');
  });
});

describe('guitar tab', () => {
  const TAB = `Simple Riff tab by Someone

e|-----------------|-----------------|
B|-----1-----------|-----------------|
G|---------0-------|-----0-----------|
D|-2---------------|-2---------2-----|
A|-----------------|-----------------|
E|-----------------|-----------------|
`;
  it('detects and reads ASCII tab as a melody', () => {
    expect(sniffText(TAB)).toBe('guitartab');
    const { doc, warnings } = parseGuitarTab(TAB);
    expect(doc.meta.title).toBe('Simple Riff');
    expect(doc.meta.artist).toBe('Someone');
    expect(warnings[0]).toMatch(/estimated/);
    const notes = doc.lines.flatMap((l) => l.events).filter((e) => e.kind === 'note') as NoteEvent[];
    // Written pitch (an octave above sounding): D-string fret 2 = E3 sounding → E4.
    expect(notes.map((n) => midiToName((n.sounds[0] as any).midi))).toEqual(['E4', 'C5', 'G4', 'E4', 'G4', 'E4']);
    expect(doc.lines[0].events.some((e) => e.kind === 'bar')).toBe(true);
  });

  it('honours tunings like drop D', () => {
    const drop = TAB.replace('E|---', 'D|---').replace('D|-2---------------|', 'D|-2---------------|');
    const { doc } = parseGuitarTab(drop.replace(/E\|-----------------\|-----------------\|/, 'D|0----------------|-----------------|'));
    const first = doc.lines[0].events.find((e) => e.kind === 'note') as NoteEvent;
    expect(midiToName((first.sounds[0] as any).midi)).toBe('E4');
  });
});
