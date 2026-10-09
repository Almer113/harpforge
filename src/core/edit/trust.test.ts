// Phase 5a: nothing you wrote is lost when a line is rewritten (by an edit, a re-tab or
// a transposition), and imports put lyrics where they belong.

import { describe, expect, it } from 'vitest';
import { retab } from '../convert';
import { parseAbc, writeAbc } from '../formats/abc';
import { setMetaFields } from '../htab/meta';
import { parseHtab } from '../htab/parser';
import { serializeHtab } from '../htab/serializer';
import { getHarmonica } from '../instruments';
import { holeSound } from '../types';
import { fromDoc, updateItem, type Song } from './model';
import { keptMessage, replaceLines, spliceBody, type SpliceReport } from './splice';

const C = getHarmonica({ family: 'diatonic', tuning: 'richter', key: 'C' });
const doc = (body: string) => `---\ntime: 4/4\n---\n${body}\n`;
const edit = (text: string, f: (s: Song) => Song, report?: SpliceReport) => spliceBody(text, f(fromDoc(parseHtab(text).doc)), report);
const setSound = (m: number, start: number, hole: number) => (s: Song) => updateItem(s, { m, start }, { sounds: [holeSound(hole, 'blow')] });
const lyricsOf = (text: string) => parseHtab(text).doc.lines.map((l) => l.events.flatMap((e) => (e.kind === 'note' && e.lyric ? [e.lyric] : [])));

describe('extra verses', () => {
  const text = doc('4 5 6 7 |\nw: a b c d\nw: e f g h');

  it('are read as verses 2, 3… of their line', () => {
    const { doc: d, issues } = parseHtab(text);
    expect(lyricsOf(text)).toEqual([['a', 'b', 'c', 'd']]);
    expect(d.lines).toHaveLength(1);
    expect(d.lines[0].events.map((e) => (e.kind === 'bar' ? null : e.verses?.[0])).filter(Boolean)).toEqual(['e', 'f', 'g', 'h']);
    expect(issues).toEqual([]);
  });

  it('stay under their line when it is edited', () => {
    expect(edit(text, setSound(0, 0, 3))).toBe('3 5 6 7 |\nw: a b c d\nw: e f g h');
  });

  it('keep their place when verse 1 is cleared', () => {
    const cleared = (s: Song) => ({ ...s, measures: s.measures.map((m) => ({ ...m, items: m.items.map((it) => ({ ...it, lyric: undefined })) })) });
    expect(edit(text, cleared)).toBe('4 5 6 7 |\nw:\nw: e f g h');
  });

  it('survive a re-tab', () => {
    const G = getHarmonica({ family: 'diatonic', tuning: 'richter', key: 'G' });
    const r = retab(parseHtab(text).doc, C, G);
    expect(replaceLines(text, r.doc.lines).split('\n').slice(-2)).toEqual(['w: a b c d', 'w: e f g h']);
  });
});

describe('lines of only chord symbols', () => {
  const text = doc('[G]\n4 5 6 7 |\n-4 -5 -6 -7 |');

  it('are kept when nothing (or another line) changes', () => {
    expect(edit(text, (s) => s)).toBe('[G]\n4 5 6 7 |\n-4 -5 -6 -7 |');
    expect(edit(text, setSound(1, 0, 3))).toBe('[G]\n4 5 6 7 |\n3 -5 -6 -7 |');
  });

  it('move into the next line when it is rewritten, without doubling the chord', () => {
    expect(edit(text, setSound(0, 1, 3))).toBe('[G] 4 3 6 7 |\n-4 -5 -6 -7 |');
  });

  it('after the last line, are kept unless that line is rewritten', () => {
    const tail = doc('4 5 6 7 |\n[G]');
    expect(edit(tail, (s) => s)).toBe('4 5 6 7 |\n[G]');
    const out = edit(tail, setSound(0, 0, 3));
    expect(out.match(/\[G\]/g)).toHaveLength(1);
  });
});

describe('a rewritten line keeps its comment and what couldn’t be read', () => {
  it('keeps its own comment', () => {
    expect(edit(doc('4 5 6 7 | # breathe here'), setSound(0, 0, 3))).toBe('3 5 6 7 | # breathe here');
  });

  it('keeps unreadable tokens in a comment and reports them', () => {
    const report: SpliceReport = { kept: [] };
    expect(edit(doc('4 5 x 6 | # breathe'), setSound(0, 0, 3), report)).toBe('3 5 6 | # kept: x · breathe');
    expect(report.kept).toEqual(['x']);
    expect(keptMessage(report)).toContain('“x”');
  });

  it('reports nothing when only other lines change', () => {
    const report: SpliceReport = { kept: [] };
    edit(doc('4 5 x 6 |\n7 7 7 7 |'), setSound(1, 0, 3), report);
    expect(report.kept).toEqual([]);
  });

  it('keeps the comment of a line that was deleted', () => {
    const text = doc('4 5 6 7 | # first\n-4 -5 -6 -7 |');
    const dropFirst = (s: Song) => ({ ...s, measures: s.measures.slice(1).map((m, i) => (i === 0 ? { ...m, lineBreak: true } : m)) });
    expect(edit(text, dropFirst)).toContain('# first');
  });

  it('keeps them through a re-tab too', () => {
    const text = doc('4 5 6 7 | # breathe');
    const G = getHarmonica({ family: 'diatonic', tuning: 'richter', key: 'G' });
    expect(replaceLines(text, retab(parseHtab(text).doc, C, G).doc.lines)).toMatch(/ # breathe$/);
  });
});

describe('holes the harmonica doesn’t have', () => {
  it('are kept as written and counted when re-tabbing', () => {
    const chromatic = getHarmonica({ family: 'chromatic', tuning: 'solo-12', key: 'C' });
    const r = retab(parseHtab(doc('4 11 5 |')).doc, C, chromatic);
    const notes = r.doc.lines[0].events.filter((e) => e.kind === 'note');
    expect(notes).toHaveLength(3);
    expect(notes[1]).toMatchObject({ sounds: [holeSound(11, 'blow')] });
    expect(r.stats.unplayable).toBe(1);
    expect(r.warnings[0]).toContain('hole 11');
  });
});

describe('ABC lyrics', () => {
  it('belong to the music line just before them', () => {
    const abc = 'X:1\nT:t\nM:4/4\nL:1/4\nK:C\nC D E F |\nG A B c |\nw: la li lo lu\n';
    expect(lyricsOf(serializeHtab(parseAbc(abc).doc))).toEqual([[], ['la', 'li', 'lo', 'lu']]);
  });

  it('come back on the same line after our own export', () => {
    const text = doc('4 5 6 7 |\n-4 -5 -6 -7 |\nw: la li lo lu');
    const back = parseAbc(writeAbc(parseHtab(text).doc, C, { tabLine: true }).text).doc;
    const sung = back.lines.map((l) => l.events.some((e) => e.kind === 'note' && e.lyric));
    expect(sung.indexOf(true)).toBe(sung.length - 1);
  });
});

describe('header values', () => {
  it('keep a "#" that isn’t a comment', () => {
    expect(parseHtab('---\ntitle: Song #2\ntempo: 96 # fast\n---\n4 |\n').doc.meta).toMatchObject({ title: 'Song #2', tempo: 96 });
  });

  it('round-trip a " # " through the writers', () => {
    const t = setMetaFields(doc('4 |'), { title: 'Op. # 5' });
    expect(parseHtab(t).doc.meta.title).toBe('Op. # 5');
    const s = serializeHtab(parseHtab(t).doc);
    expect(parseHtab(s).doc.meta.title).toBe('Op. # 5');
  });
});

describe('lyrics', () => {
  it('keep a syllable that is just a hyphen', () => {
    const text = doc('4 5 6 |\nw: la x di');
    const withHyphen = (s: Song) => updateItem(s, { m: 0, start: 1 }, { lyric: '-' });
    const out = edit(text, withHyphen);
    expect(lyricsOf(doc(out))).toEqual([['la', '-', 'di']]);
  });
});

describe('review fixes', () => {
  it('a chord-only line passes on its comment and unreadable text', () => {
    const report: SpliceReport = { kept: [] };
    expect(edit(doc('[G] # intro\n4 5 6 7 |'), setSound(0, 0, 3))).toBe('# intro\n[G] 3 5 6 7 |');
    expect(edit(doc('[G] xyz\n4 5 6 7 |'), setSound(0, 0, 3), report)).toBe('# kept: xyz\n[G] 3 5 6 7 |');
    expect(report.kept).toEqual(['xyz']);
  });

  it('a line merged into the one before keeps its extra verses', () => {
    const text = doc('4 5 6 7 |\nw: a b c d\n-4 -5 -6 -7 |\nw: e f g h\nw: E F G H');
    const merge = (s: Song) => ({ ...s, measures: s.measures.map((m, i) => (i === 1 ? { ...m, lineBreak: false } : m)) });
    // (Verse 2 was only on the second line: it starts there.)
    expect(edit(text, merge)).toBe('4 5 6 7 | -4 -5 -6 -7 |\nw: a b c d e f g h\nw: * * * * E F G H');
  });

  it('reports kept text once, not again on later edits', () => {
    const first: SpliceReport = { kept: [] };
    const once = edit(doc('4 5 x 6 |'), setSound(0, 0, 3), first);
    const again: SpliceReport = { kept: [] };
    edit(doc(once), setSound(0, 1, 4), again);
    expect(first.kept).toEqual(['x']);
    expect(again.kept).toEqual([]);
  });

  it('leaves a line it read no music from as written', () => {
    const text = doc('(4 5 6 7 |\n4 5 6 7 |');
    const report: SpliceReport = { kept: [] };
    expect(edit(text, (s) => updateItem(s, { m: s.measures.length - 1, start: 0 }, { sounds: [holeSound(3, 'blow')] }), report)).toBe('(4 5 6 7 |\n3 5 6 7 |');
    expect(report.kept).toEqual([]);
  });

  it('keeps comments among the verses in their order', () => {
    const text = doc('4 5 6 7 |\n# breathe\nw: a b c d\n\n# verse 2:\nw: e f g h');
    expect(edit(text, setSound(0, 0, 3))).toBe('3 5 6 7 |\n# breathe\nw: a b c d\n\n# verse 2:\nw: e f g h');
  });

  it('keeps a stray lyrics line after a heading', () => {
    expect(edit(doc('@ Chorus\nw: la la\n4 5 6 7 |'), setSound(0, 0, 3))).toContain('w: la la');
  });

  it('keeps sharps in a tab written with sharps, whatever the key', () => {
    const text = '---\nkey: Dm\n---\nA#4 A4 |\nA#4 A4 G4 F4 |\n';
    const out = edit(text, (s) => updateItem(s, { m: 1, start: 3 }, { sounds: [{ type: 'pitch', midi: 64 }] }));
    expect(out.split('\n')[1]).toBe('A#4 A4 G4 E4 |');
  });

  it('re-tabs the playable notes of a chord with a missing hole, and says so once', () => {
    const G = getHarmonica({ family: 'diatonic', tuning: 'richter', key: 'G' });
    const r = retab(parseHtab(doc('(4 5 11) 11 4 |')).doc, C, G);
    const [chord] = r.doc.lines[0].events.filter((e) => e.kind === 'note');
    expect(chord.kind === 'note' && chord.sounds).toContainEqual(holeSound(11, 'blow'));
    expect(chord.kind === 'note' && chord.sounds).not.toContainEqual(holeSound(4, 'blow'));
    expect(r.warnings.filter((w) => w.includes('11'))).toHaveLength(1);
  });
});

describe('header comments', () => {
  it('a line starting with # is a comment; "#" before a word starts one, before a digit doesn’t', () => {
    const meta = parseHtab('---\n#note: x\ntitle: Song #2\nkey: G #from the LP\n---\n4 |\n').doc.meta;
    expect(meta.extra).toEqual({});
    expect(meta).toMatchObject({ title: 'Song #2', key: 'G' });
  });

  it('round-trips a backslash before "#" and a "#" before a word', () => {
    for (const title of ['a\\#b', 'Op. #five', 'C# minor']) {
      const t = setMetaFields(doc('4 |'), { title });
      expect(parseHtab(t).doc.meta.title).toBe(title);
    }
  });
});
