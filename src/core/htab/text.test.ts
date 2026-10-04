// Phase 7b: the tab text says what you meant. Rhythms are written beat by beat, timing
// survives every spelling, sung rests keep their syllables, and the parser reads the
// common spellings it used to reject.

import { describe, expect, it } from 'vitest';
import { fromDoc, toDoc } from '../edit/model';
import { setMetaFields } from './meta';
import { parseHtab } from './parser';
import { bodyText } from './serializer';
import type { TabDoc } from './types';

const doc = (body: string, time = '4/4') => parseHtab(`---\ntime: ${time}\n---\n${body}`).doc;
/** What the editor writes for a line it touches (text → editor → text). */
const edited = (body: string, time = '4/4') => bodyText(toDoc(fromDoc(doc(body, time))).lines);
/** Every sounding note as [start, length, sound], ties joined: what you hear. */
function music(d: TabDoc): [number, number, string][] {
  const out: [number, number, string][] = [];
  let t = 0;
  for (const line of d.lines) {
    for (const e of line.events) {
      if (e.kind === 'bar') continue;
      if (e.kind === 'note' && e.tied && out.length) out[out.length - 1][1] += e.beats;
      else if (e.kind === 'note') out.push([t, e.beats, JSON.stringify(e.sounds)]);
      t += e.beats;
    }
  }
  return out.map(([a, b, c]) => [+a.toFixed(6), +b.toFixed(6), c]);
}

describe('B15: rhythms written beat by beat', () => {
  const cases: [string, string, string][] = [
    ['syncopation: eighth, three quarters, eighth', '{4 5~ 6~ 7~ 8}~~~ |', '{4 5} {~ 6} {~ 7} {~ 8} |'],
    ['eighth, quarter, eighth, half', '{4 5~ 6}~ 7~ |', '{4 5} {~ 6} 7~ |'],
    ['dotted quarter and eighth', '{4~~ 5}~ 6~ |', '4 {~ 5} 6~ |'],
    ['dotted eighth and sixteenth (unchanged)', '{4~~ 5} {6~~ 7} .~ |', '{4~~ 5} {6~~ 7} .~ |'],
    ['quarter-note triplet (unchanged)', '{4 5 6}~ 7~ |', '{4 5 6}~ 7~ |'],
    ['straight eighths and sixteenths (unchanged)', '{4 5} {6 7 8 9} 4~ |', '{4 5} {6 7 8 9} 4~ |'],
  ];
  for (const [name, before, after] of cases) {
    it(name, () => {
      expect(edited(before)).toBe(after);
      // Same music, and the new spelling is stable.
      expect(music(doc(after))).toEqual(music(doc(before)));
      expect(edited(after)).toBe(after);
    });
  }

  it('a pickup is counted from its end: an eighth and a quarter before the bar', () => {
    const text = edited('{4 5~}~~/2 | 6 6 6 6 |');
    expect(text).toBe('{4}/2 5 | 6 6 6 6 |');
    expect(music(doc(text))).toEqual(music(doc('{4 5~}~~/2 | 6 6 6 6 |')));
  });

  it('quintuplets and septuplets keep exact timing', () => {
    for (const body of ['{4~ 5~~} 6 6 6 |', '{4 5 6 7 8}/2 {4}/2 6 6 6 |', '{4 5 6 7 8 9 10} 6 6 6 |', '{4~ 5 6~ 7 8}~ 6 6 |']) {
      const text = edited(body);
      expect(music(doc(text))).toEqual(music(doc(body)));
    }
    expect(edited('{4 5 6 7 8 9 10} 6 6 6 |')).toBe('{4 5 6 7 8 9 10} 6 6 6 |');
  });

  it('a chord symbol after a fractional group stays a chord symbol, before the bar line', () => {
    expect(bodyText(doc('4 4 4 {5 6 7}/2 [G]').lines)).toBe('4 4 4 {5 6 7}/2 [G]');
    expect(bodyText(doc('{5 6 7}/2 [G] | 4 4 4 4 |').lines)).toBe('{5 6 7}/2 [G] | 4 4 4 4 |');
    expect(music(doc(bodyText(doc('4 4 4 {5 6 7}/2 [G]').lines)))).toEqual(music(doc('4 4 4 {5 6 7}/2 [G]')));
  });
});

describe('beat-by-beat text, whole notes in the views', () => {
  it('a tie inside a bar is part of its note (one card, one staff note); over a bar line it stays a tie', () => {
    const ev = doc('{4 5} {~ 6} 7~ | ~ 4 4 4 |').lines[0].events;
    const notes = ev.filter((e) => e.kind === 'note').map((e) => (e.kind === 'note' ? `${e.tied ? '~' : ''}${e.beats}` : ''));
    expect(notes).toEqual(['0.5', '1', '0.5', '2', '~1', '1', '1', '1']);
  });
});

describe('B16: sung rests ("_")', () => {
  const SONG = '[N.C.] _ 4 5 6 |\nw: Oh la la la';

  it('a "_" rest takes a syllable from the w: line; "." does not', () => {
    const d = doc(SONG);
    const [rest, a] = d.lines[0].events;
    expect(rest).toMatchObject({ kind: 'rest', lyric: 'Oh', chord: 'N.C.' });
    expect(a).toMatchObject({ kind: 'note', lyric: 'la' });
    expect(doc('. 4 5 6 |\nw: la la la').lines[0].events[1]).toMatchObject({ lyric: 'la' });
  });

  it('survives the editor and saving', () => {
    expect(edited(SONG)).toBe('[N.C.] _ 4 5 6 |\nw: Oh la la la');
  });

  it('a rest that got a lyric in the editor is written "_"', () => {
    const s = fromDoc(doc('[G] . 4 5 6 |'));
    s.measures[0].items[0].lyric = 'Hey';
    expect(bodyText(toDoc(s).lines)).toBe('[G] _ 4 5 6 |\nw: Hey');
  });
});

describe('parser gaps', () => {
  const bars = (body: string) => doc(body).lines.flatMap((l) => l.events.filter((e) => e.kind === 'bar').map((e) => (e.kind === 'bar' ? e.style : '')));
  const errors = (body: string) => parseHtab(`---\n---\n${body}`).issues.filter((i) => i.severity === 'error');

  it('reads ":|:", "||:" and a repeat sign right after a note', () => {
    expect(bars('|: 4 4 4 4 :|: 5 5 5 5 :|')).toEqual(['repeat-start', 'repeat-end', 'repeat-start', 'repeat-end']);
    expect(bars('||: 4 4 4 4 :|')).toEqual(['repeat-start', 'repeat-end']);
    expect(bars('|: 4 4 4 4:|')).toEqual(['repeat-start', 'repeat-end']);
    expect(errors('|: 4 4 4 4:| ||: 5 5 5 5 :|: 6 6 6 6 :|')).toEqual([]);
    // Both repeat signs survive the editor.
    expect(edited('|: 4 4 4 4 :|: 5 5 5 5 :|')).toBe('|: 4 4 4 4 :| |: 5 5 5 5 :|');
  });

  it('reads lowercase note names', () => {
    const ev = doc('c4 bb4 f#5').lines[0].events;
    expect(ev.map((e) => (e.kind === 'note' && e.sounds[0].type === 'pitch' ? e.sounds[0].midi : null))).toEqual([60, 70, 78]);
  });

  it('an unterminated header ends where the tab starts, with a warning', () => {
    const r = parseHtab('---\ntitle: Lost\ntempo: 90\n4 5 6 7 |\n');
    expect(r.doc.meta.title).toBe('Lost');
    expect(r.doc.meta.tempo).toBe(90);
    expect(r.doc.lines).toHaveLength(1);
    expect(r.issues.some((i) => i.severity === 'warning' && /closing "---"/.test(i.message))).toBe(true);
  });

  it('a tempo edit updates "tempo:" and "bpm:" alike', () => {
    const text = setMetaFields('---\ntempo: 120\nbpm: 120\n---\n4 |\n', { tempo: 60 });
    expect(parseHtab(text).doc.meta.tempo).toBe(60);
  });

  it('reads a lowercase harp key ("bb") as "Bb"', () => {
    expect(parseHtab('---\nharmonica: chromatic\nharp-key: bb\n---\n4 |\n').doc.meta.harpKey).toBe('Bb');
    expect(parseHtab('---\nharp-key: low f\n---\n4 |\n').doc.meta.harpKey).toBe('Low F');
  });
});
