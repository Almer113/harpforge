// Phase 17b: find and replace holes.

import { describe, expect, it } from 'vitest';
import { parseHtab, splitHeader } from '../htab/parser';
import { fromDoc } from './model';
import { findHoles, parseHole, replaceHoles, type FindScope } from './replace';
import { spliceBody } from './splice';

const HEAD = '---\ntitle: R\n---\n';
const text = (body: string) => `${HEAD}${body}\n`;
const songOf = (t: string) => fromDoc(parseHtab(t).doc);
const SONG: FindScope = { kind: 'song' };
/** Find `a` and replace it by `b` everywhere; the text after. */
function swap(body: string, a: string, b: string, opts: { chords?: boolean; scope?: FindScope } = {}) {
  const t = text(body);
  const song = songOf(t);
  const found = findHoles(song, parseHole(a)!, { chords: !!opts.chords, scope: opts.scope ?? SONG });
  const r = replaceHoles(song, found, parseHole(a)!, parseHole(b)!);
  return { body: spliceBody(t, r.song).slice(splitHeader(t).bodyStart - splitHeader(t).bodyStart), ...r, found: found.length };
}

describe('the hole to find', () => {
  it('one hole as the tab writes it', () => {
    expect(parseHole('-4')).toMatchObject({ hole: 4, breath: 'draw', bend: 0, over: false });
    expect(parseHole("-3''")).toMatchObject({ hole: 3, breath: 'draw', bend: 2 });
    expect(parseHole('6o')).toMatchObject({ hole: 6, breath: 'blow', over: true });
    expect(parseHole(' 5 ')).toMatchObject({ hole: 5, breath: 'blow' });
  });

  it('a minus sign or dash pasted from a web page is the draw’s "-"', () => {
    expect(parseHole('−4')).toMatchObject({ hole: 4, breath: 'draw' });
    expect(parseHole('–6')).toMatchObject({ hole: 6, breath: 'draw' });
  });

  it('not a hole: nothing', () => {
    expect([parseHole(''), parseHole('4 5'), parseHole('(4 5)'), parseHole('C5'), parseHole('x')]).toEqual([null, null, null, null, null]);
  });
});

describe('finding', () => {
  it('exactly that hole: -3 isn’t -3’', () => {
    const song = songOf(text("-3 -3' 4 -3 |"));
    expect(findHoles(song, parseHole('-3')!, { chords: false, scope: SONG }).map((f) => f.at.start)).toEqual([0, 3]);
  });

  it('a note tied over a bar line is found once, with its parts', () => {
    const song = songOf(text('4 4 4 -4~ | ~ 5 5 5 |'));
    const found = findHoles(song, parseHole('-4')!, { chords: false, scope: SONG });
    expect(found).toHaveLength(1);
    expect(found[0].chain).toEqual([{ m: 0, start: 3 }, { m: 1, start: 0 }]);
  });

  it('within bars: a note tied in from before them counts (it sounds there)', () => {
    const song = songOf(text('@ A\n4 4 4 -4 |\n@ B\n~ 4 4 4 |'));
    const found = findHoles(song, parseHole('-4')!, { chords: false, scope: { kind: 'bars', from: 1, to: 2 } });
    expect(found.map((f) => f.chain)).toEqual([[{ m: 0, start: 3 }, { m: 1, start: 0 }]]);
  });

  it('in chords only when asked', () => {
    const song = songOf(text('(4 5 6) 5 |'));
    expect(findHoles(song, parseHole('5')!, { chords: false, scope: SONG })).toHaveLength(1);
    expect(findHoles(song, parseHole('5')!, { chords: true, scope: SONG }).map((f) => f.chord)).toEqual([true, false]);
  });

  it('within bars, or within chosen notes', () => {
    const song = songOf(text('4 4 | 4 4 | 4 4 |'));
    const h = parseHole('4')!;
    expect(findHoles(song, h, { chords: false, scope: { kind: 'bars', from: 1, to: 2 } }).map((f) => f.at.m)).toEqual([1, 1]);
    expect(findHoles(song, h, { chords: false, scope: { kind: 'notes', at: [{ m: 2, start: 1 }] } }).map((f) => f.at)).toEqual([{ m: 2, start: 1 }]);
  });
});

describe('replacing', () => {
  it('every one, lengths and words as they were', () => {
    const r = swap('-2 4 -2~ 5 |\nw: one two three four', '-2', '3');
    expect(r.replaced).toBe(2);
    expect(r.body).toContain('3 4 3~ 5 |');
    expect(r.body).toContain('w: one two three four');
  });

  it('a tied note changes in every part', () => {
    const r = swap('4 4 4 -4~ | ~ 5 5 5 |', '-4', '6');
    expect(r.body).toContain('4 4 4 6~ | ~ 5 5 5 |');
  });

  it('in a chord: the one hole; a chord that would mix blow and draw, or hold a hole twice, is skipped', () => {
    expect(swap('(4 5 6) |', '5', '7', { chords: true }).body).toContain('(4 6 7)');
    const mixed = swap('(4 5 6) 5 |', '5', '-5', { chords: true });
    expect([mixed.replaced, mixed.skipped]).toEqual([1, 1]);
    expect(mixed.body).toContain('(4 5 6) -5');
    const twice = swap('(4 5 6) |', '5', '6', { chords: true });
    expect([twice.replaced, twice.skipped]).toEqual([0, 1]);
  });

  it('bends and overblows are holes like any other', () => {
    expect(swap("-3'' 6o |", "-3''", '4').body).toContain('4 6o');
    expect(swap("-3'' 6o |", '6o', "-6'").body).toContain("-3'' -6'");
  });
});
