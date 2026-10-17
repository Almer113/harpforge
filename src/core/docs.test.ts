// The format guide (docs/htab-format.md) stays true: every example in it reads without a
// problem, and what its examples and a few of its table rows say they do, they do.

import { describe, expect, it } from 'vitest';
import GUIDE from '../../docs/htab-format.md?raw';
import { parseHtab } from './htab/parser';
import { playbackScore } from './repeats';
import { buildScore, harmonicaFromMeta } from './score';
import { isHeld, lyricOf } from './verses';
import type { NoteEvent } from './htab/types';

/** The guide's code examples (the text between ``` fences). */
const examples = [...GUIDE.matchAll(/```[a-z]*\n([^]*?)```/g)].map((m) => m[1]);
const song = (body: string) => `---\ntitle: Example\n---\n${body}\n`;
const scoreOf = (body: string) => {
  const { doc } = parseHtab(song(body));
  return { doc, score: buildScore(doc, harmonicaFromMeta(doc.meta)).score };
};
/** The holes as they're played (repeats and endings followed). */
const played = (body: string) => {
  const { doc, score } = scoreOf(body);
  return playbackScore(doc, score).score.events.filter((e) => !e.rest).map((e) => e.sounds.map((s) => (s.type === 'hole' ? `${s.breath === 'draw' ? '-' : ''}${s.hole}` : '?')).join(''));
};
const beats = (body: string) => scoreOf(body).score.events.map((e) => +e.beats.toFixed(3));

describe('the format guide', () => {
  it('has its examples (and every fence is closed)', () => {
    expect(examples.length).toBeGreaterThanOrEqual(5);
    expect((GUIDE.match(/```/g) ?? []).length % 2).toBe(0);
  });

  it.each(examples.map((e, k) => [k + 1, e] as const))('example %i reads without a problem', (_k, example) => {
    // (A header on its own gets a note to go with it; a body gets a header.)
    const text = example.startsWith('---') ? `${example}4 |\n` : song(example);
    const { issues } = parseHtab(text);
    expect(issues.filter((i) => i.severity !== 'info').map((i) => i.message)).toEqual([]);
  });

  it('the endings example plays as it says', () => {
    const ex = examples.find((e) => e.includes('[1.]'))!;
    expect(played(ex).join(' ')).toBe('4 4 5 6 6 5 4 5 4 4 5 6 -4');
    expect(GUIDE).toContain('plays `4 4 5 6 6 5 4 5`, back, `4 4 5 6`, then the 2nd ending `-4`');
  });

  it('the ties example: 6 held for 4 beats over the bar line', () => {
    const { score } = scoreOf('6~ | ~~ 5 6 |');
    // (A tie is one unbroken note: the first sounds for all 4 beats, the tied part isn't played again.)
    expect([score.events[0].soundBeats, score.events[1].tied]).toEqual([4, true]);
  });

  it('the table: fractions of a beat, a repeat three times, a chord with one breath', () => {
    expect(beats('{7}/2')).toEqual([0.5]);
    expect(beats('{6~ 7}~~/2')).toEqual([1, 0.5]);
    expect(beats('{4~ 5}')).toEqual([0.667, 0.333]);
    expect(played('|: 4 5 :|x3').join(' ')).toBe('4 5 4 5 4 5');
    const chord = parseHtab(song('-(1 2 3)')).doc.lines[0].events[0] as NoteEvent;
    expect(chord.sounds.map((s) => (s.type === 'hole' ? s.breath : '?'))).toEqual(['draw', 'draw', 'draw']);
  });

  it('the lyrics example: verses, a sung rest, a hold', () => {
    const lyrics = examples.find((e) => e.includes('w: Oh la la'))!;
    const { doc } = parseHtab(song(lyrics));
    const first = doc.lines[0].events.find((e): e is NoteEvent => e.kind === 'note')!;
    expect([lyricOf(first, 0), lyricOf(first, 1)]).toEqual(['Twin-', 'How']);
    const second = doc.lines[1].events.filter((e) => e.kind !== 'bar');
    expect(second[0]).toMatchObject({ kind: 'rest', sung: true, lyric: 'Oh' });
    expect(isHeld(second[4] as NoteEvent, 0)).toBe(true);
  });
});
