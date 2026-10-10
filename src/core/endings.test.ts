// Phase 11.5a: 1st/2nd endings ("[1.]", "[2.]", "[1.2.]") and repeats played more than twice
// (":|x3") — written, read, kept by the editor, and played in order.

import { describe, expect, it } from 'vitest';
import { fromDoc, toDoc } from './edit/model';
import { parseHtab } from './htab/parser';
import { serializeHtab } from './htab/serializer';
import { playbackScore } from './repeats';
import { buildScore, harmonicaFromMeta } from './score';

const HEAD = '---\ntitle: E\n---\n';
const parse = (body: string) => {
  const r = parseHtab(HEAD + body + '\n');
  return { ...r, score: buildScore(r.doc, harmonicaFromMeta(r.doc.meta)).score };
};
/** The holes in the order played. */
const played = (body: string) => {
  const { doc, score } = parse(body);
  return playbackScore(doc, score).score.events.map((ev) => (ev.rest ? '.' : ev.sounds.map((s) => (s.type === 'hole' ? `${s.breath === 'draw' ? '-' : ''}${s.hole}` : '?')).join(''))).join(' ');
};
const tabLines = (text: string) => text.split('\n').filter((l) => l.includes('|'));

describe('written and read', () => {
  it('an ending goes on the first note of its bar, and is written back as it was', () => {
    const { doc, issues } = parse('|: 4 4 | [1.] 5 5 :| [2.] 6 6 |');
    expect(issues).toEqual([]);
    const notes = doc.lines[0].events.filter((e) => e.kind === 'note');
    expect(notes.map((e) => (e.kind === 'note' ? e.ending : undefined))).toEqual([undefined, undefined, [1], undefined, [2], undefined]);
    expect(tabLines(serializeHtab(doc))).toEqual(['|: 4 4 | [1.] 5 5 :| [2.] 6 6 |']);
  });

  it('"[1.2.]", ":|x3", and an ending starting a line', () => {
    const { doc, issues } = parse('|: 4 4 |\n[1.2.] 5 5 :|x3\n[3.] 6 6 ||');
    expect(issues).toEqual([]);
    expect(tabLines(serializeHtab(doc))).toEqual(['|: 4 4 |', '[1.2.] 5 5 :|x3', '[3.] 6 6 ||']);
  });

  it('the visual editor keeps them through an edit', () => {
    const { doc } = parse('|: 4 4 | [1.] 5 5 :|x3 [2.] . 6 |');
    const song = fromDoc(doc);
    expect(song.measures.map((m) => m.ending)).toEqual([undefined, [1], [2]]);
    expect(song.measures[1].endTimes).toBe(3);
    // (A bar starting with a rest: the ending goes on the rest.)
    expect(tabLines(serializeHtab(toDoc(song)))).toEqual(['|: 4 4 | [1.] 5 5 :|x3 [2.] . 6 |']);
  });

  it('an ending anywhere but the start of a bar, or with nothing after it, is left out and said', () => {
    const mid = parse('|: 4 [1.] 5 :|');
    expect(mid.issues.map((i) => i.message).join(' ')).toMatch(/starts a bar/);
    const empty = parse('|: 4 5 :| [2.] |');
    expect(empty.issues.map((i) => i.message).join(' ')).toMatch(/needs music after it/);
  });

  it('warns about a 1st ending with no ":|", and a 2nd with no 1st', () => {
    expect(parse('|: 4 | [1.] 5 | 6 |').issues.map((i) => i.message).join(' ')).toMatch(/end it with ":\|"/);
    expect(parse('|: 4 5 :| [2.] 6 |').issues.map((i) => i.message).join(' ')).toMatch(/2nd ending with no 1st/);
    // A "[1.]" isn't a chord symbol; "[G7]" still is.
    expect(parse('[G7] 4 4 |').doc.lines[0].events[0]).toMatchObject({ chord: 'G7' });
  });
});

describe('played in order', () => {
  it('the 1st ending, back, then the 2nd ending and on', () => {
    expect(played('|: 4 | [1.] 5 :| [2.] 6 | 7 |')).toBe('4 5 4 6 7');
  });

  it('a 1st ending of two bars', () => {
    expect(played('|: 4 | [1.] 5 | 6 :| [2.] 7 |')).toBe('4 5 6 4 7');
  });

  it('with no 2nd ending, the second time goes on after the 1st', () => {
    expect(played('|: 4 | [1.] 5 :| 6 |')).toBe('4 5 4 6');
  });

  it('three times through: "[1.2.]" twice, then "[3.]"', () => {
    expect(played('|: 4 | [1.2.] 5 :| [3.] 6 |')).toBe('4 5 4 5 4 6');
  });

  it('":|x3" plays the section three times', () => {
    expect(played('|: 4 5 :|x3 6 |')).toBe('4 5 4 5 4 5 6');
    expect(played('4 :|x3 5')).toBe('4 4 4 5');
  });

  it('endings on lines of their own; an ending stops at the end of its line', () => {
    expect(played('|: 4 4 |\n[1.] 5 5 :|\n[2.] 6 6 |\n7 7 |')).toBe('4 4 5 5 4 4 6 6 7 7');
  });

  it('an ending stops at a double bar: what follows plays as the first time through', () => {
    const { doc, score } = parse('|: 4 | [1.] 5 :| [2.] 6 || 7 |');
    const p = playbackScore(doc, score);
    expect(p.pass).toEqual([1, 1, 2, 2, 1]);
  });

  it('the second time through sings verse 2 — in the 2nd ending too, on the same line', () => {
    const { doc, score } = parse('|: 4 | [1.] 5 :| [2.] 6 |\nw: a b c\nw: d e f');
    const p = playbackScore(doc, score);
    expect(p.orig).toEqual([0, 1, 0, 2]);
    expect(p.pass).toEqual([1, 1, 2, 2]);
    expect(p.verse).toEqual([0, 0, 1, 1]);
  });

  it('a song without endings plays as before', () => {
    expect(played('4 | 5 |: 6 | -6 :| 7 |')).toBe('4 5 6 -6 6 -6 7');
    expect(played('4 :| 5 :| 6')).toBe('4 4 5 5 6');
  });
});
