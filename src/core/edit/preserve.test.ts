// Visual edits must not change anything the user didn't touch.

import { describe, expect, it } from 'vitest';
import { DEMOS } from '../../demo/songs';
import { setMetaFields } from '../htab/meta';
import { parseHtab, splitHeader } from '../htab/parser';
import { buildScore, harmonicaFromMeta } from '../score';
import { holeSound } from '../types';
import { retab } from '../convert';
import { getHarmonica } from '../instruments';
import { deleteMeasure, duplicateMeasure, findItem, fromDoc, setLengths, setTimeSignature, toDoc, updateItem, type Song } from './model';
import { replaceLines, spliceBody } from './splice';

const doc = (body: string, time = '4/4') => `---\ntime: ${time}\n---\n${body}\n`;
/** Applies an edit the way the editor does and returns the new body. */
const edit = (text: string, f: (s: Song) => Song = (s) => s) => spliceBody(text, f(fromDoc(parseHtab(text).doc)));
const bodyOf = (text: string) => text.slice(splitHeader(text).bodyStart).replace(/\n$/, '');
/** Timing and pitches of every sounding note. */
const music = (text: string) => {
  const d = parseHtab(text).doc;
  // Tied pieces count as one long note, so re-barring (which splits notes into ties) can be compared.
  return buildScore(d, harmonicaFromMeta(d.meta)).score.events.filter((e) => !e.rest && !e.tied).map((e) => [+e.start.toFixed(4), +e.soundBeats.toFixed(4), e.midis]);
};
const setSound = (m: number, start: number, hole: number) => (s: Song) => updateItem(s, { m, start }, { sounds: [holeSound(hole, 'blow')] });

describe('visual edits keep the text', () => {
  it('leaves every demo exactly as written when nothing changes', () => {
    for (const { text } of DEMOS) expect(edit(text)).toBe(bodyOf(text));
  });

  it('keeps comments, blank lines and spellings of lines that were not edited', () => {
    const text = doc('# intro riff\n+4 -3b 5 6 |\n\n# verse\n4 5 6 7 |  # end');
    expect(edit(text, setSound(1, 0, 6))).toBe('# intro riff\n+4 -3b 5 6 |\n\n# verse\n6 5 6 7 |');
  });

  it('keeps pickups, short bars and bars that run on to the next line', () => {
    for (const body of ['4 | 5 6 7 8 | 9~~ |]', '4 5 6\n7 | 8 9 10 10 |', '6~ | ~ 7 8 9 |', '4 5 6 7 [G] |\n[C] 4 5 6 7 |']) {
      const text = doc(body);
      expect(edit(text)).toBe(body);
      // Rewriting every line from the model (not just keeping it) gives the same music.
      const rewritten = doc(edit(text, (s) => ({ ...s, measures: s.measures.map((m) => ({ ...m, src: undefined })) })));
      expect(music(rewritten)).toEqual(music(text));
    }
    expect(edit(doc('4 | 5 6 7 8 |'), setSound(1, 0, 6))).toBe('4 | 6 6 7 8 |');
  });

  it('keeps a chord symbol at the end of an edited line', () => {
    expect(edit(doc('4 5 6 7 [G] |\n[C] 4 5 6 7 |'), setSound(0, 0, 5))).toBe('5 5 6 7 [G] |\n[C] 4 5 6 7 |');
  });

  it('keeps flats and two headings in a row', () => {
    const text = doc('@ Intro\n@ Verse\nBb4 Eb5 4 5 |\n@ Outro');
    expect(edit(text, setSound(0, 2, 6))).toBe('@ Intro\n@ Verse\nBb4 Eb5 6 5 |\n@ Outro');
  });

  it('writes odd meters exactly: half beats stay half beats', () => {
    const text = doc('4 5 6 {7}/2 |\n{4 5} 6 {7~ 8}~~/2 |', '7/8');
    expect(music(text).map((e) => e[1])).toEqual([1, 1, 1, 0.5, 0.5, 0.5, 1, 1, 0.5]);
    const rewritten = doc(edit(text, (s) => ({ ...s, measures: s.measures.map((m) => ({ ...m, src: undefined })) })), '7/8');
    expect(music(rewritten)).toEqual(music(text));
  });

  it('moves a renamed section heading in place and drops a removed one', () => {
    const text = doc('# c\n@ Verse\n4 5 6 7 |');
    expect(edit(text, (s) => ({ ...s, measures: s.measures.map((m) => ({ ...m, section: 'Chorus' })) }))).toBe('# c\n@ Chorus\n4 5 6 7 |');
    expect(edit(text, (s) => ({ ...s, measures: s.measures.map((m) => ({ ...m, section: undefined })) }))).toBe('# c\n4 5 6 7 |');
  });

  it('keeps comments of a deleted line', () => {
    expect(edit(doc('# one\n4 4 4 4 |\n# two\n5 5 5 5 |'), (s) => deleteMeasure(s, 0))).toBe('# one\n# two\n5 5 5 5 |');
  });

  it('keeps the end bar when the last measure is deleted or duplicated', () => {
    const text = doc('4 4 4 4 | 5 5 5 5 |]');
    expect(edit(text, (s) => deleteMeasure(s, 1))).toBe('4 4 4 4 |]');
    expect(edit(text, (s) => duplicateMeasure(s, 1))).toBe('4 4 4 4 | 5 5 5 5 | 5 5 5 5 |]');
  });
});

describe('changing the time signature', () => {
  const TIMES = ['2/4', '3/4', '4/4', '5/4', '6/8', '7/8', '9/8', '12/8', '2/2', '3/8', '5/8'];

  it('keeps the music of every demo through any time signature and back', () => {
    for (const { text } of DEMOS) {
      for (const time of TIMES) {
        const there = setTimeSignature(fromDoc(parseHtab(text).doc), time, true);
        const head = setMetaFields(text, { time });
        const mid = head.slice(0, splitHeader(head).bodyStart) + spliceBody(text, there) + '\n';
        expect(music(mid), `${time}`).toEqual(music(text));
      }
    }
  });

  it('keeps repeat signs and the pickup', () => {
    const s = setTimeSignature(fromDoc(parseHtab(doc('|: 4 4 4 4 | 5 5 5 5 :| 6 6 6 6 |]')).doc), '2/4', true);
    expect(toDoc(s).lines[0].events.filter((e) => e.kind === 'bar').map((e) => (e.kind === 'bar' ? e.style : ''))).toEqual([
      'repeat-start',
      'single',
      'single',
      'single',
      'repeat-end',
      'single',
      'final',
    ]);
    const p = setTimeSignature(fromDoc(parseHtab(doc('4 | 5 6 7 8 | 9 9 9 9 |')).doc), '3/4', true);
    expect(p.measures[0].len).toBe(1);
    expect(findItem(p, { m: 1, start: 0 })?.sounds).toEqual([holeSound(5, 'blow')]);
  });
});

describe('changing several note lengths at once', () => {
  it('lays a run of notes out again instead of overwriting', () => {
    const s = fromDoc(parseHtab(doc('{4 5} {6 7} 8 9 |')).doc);
    const sel = [0, 0.5, 1, 1.5].map((start) => ({ m: 0, start }));
    const { song, selection } = setLengths(s, sel, 1);
    expect(spliceBody(doc('{4 5} {6 7} 8 9 |'), song)).toBe('4 5 6 7 |');
    expect(selection.map((p) => p.start)).toEqual([0, 1, 2, 3]);
    // Shorter: the run shrinks and a rest fills the gap; the notes after it stay.
    const shorter = setLengths(fromDoc(parseHtab(doc('4 5 6 7 |')).doc), [0, 1].map((start) => ({ m: 0, start })), 0.5).song;
    expect(spliceBody(doc('4 5 6 7 |'), shorter)).toBe('{4 5} . 6 7 |');
  });
});

describe('re-tabbing keeps the text and the notes', () => {
  it('rewrites only the notes, keeping comments, and keeps unplayable notes as note names', () => {
    const text = '---\nharmonica: diatonic\nharp-key: C\n---\n# riff\n4 -4 5 -5 |\n\n# end\n6 -6 7 -7 |\n';
    const from = getHarmonica({ family: 'diatonic', tuning: 'richter', key: 'C' });
    const to = getHarmonica({ family: 'tremolo', tuning: 'asian-24', key: 'C' });
    const r = retab(parseHtab(text).doc, from, to);
    const body = replaceLines(text, r.doc.lines);
    expect(body.split('\n').filter((l) => l.startsWith('#') || l === '')).toEqual(['# riff', '', '# end']);
    // No note turns into a rest.
    const notes = (t: string) => parseHtab(t).doc.lines.flatMap((l) => l.events).filter((e) => e.kind === 'note').length;
    expect(notes(`---\n---\n${body}`)).toBe(8);
    const odd = retab(parseHtab('---\n---\n-3\' |\n').doc, from, to); // A#4: not on this tremolo
    expect(odd.stats.unplayable).toBe(1);
    expect(odd.doc.lines[0].events[0]).toMatchObject({ kind: 'note', sounds: [{ type: 'pitch', midi: 70 }] });
  });
});
