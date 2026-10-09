import { expect, it } from 'vitest';
import { parseHtab } from './htab/parser';
import { buildScore, harmonicaFromMeta } from './score';
import { playbackIndexOf, playbackScore, playOrder } from './repeats';

const parse = (tab: string) => {
  const { doc } = parseHtab(`---\ntitle: R\n---\n${tab}\n`);
  return { doc, score: buildScore(doc, harmonicaFromMeta(doc.meta)).score };
};
const order = (tab: string) => {
  const { doc, score } = parse(tab);
  return playOrder(doc, score.totalBeats).map((s) => `${s.from}-${s.to}`).join(' ');
};
/** The holes in the order played. */
const played = (tab: string) => {
  const { doc, score } = parse(tab);
  return playbackScore(doc, score).score.events.map((ev) => (ev.rest ? '.' : ev.sounds.map((s) => (s.type === 'hole' ? `${s.breath === 'draw' ? '-' : ''}${s.hole}` : '?')).join(''))).join(' ');
};

it('plays a |: … :| section twice', () => {
  expect(order('4 4 | 5 5 |: 6 6 | -6 -6 :| 7 7 |')).toBe('0-8 4-8 8-10');
  expect(played('4 | 5 |: 6 | -6 :| 7 |')).toBe('4 5 6 -6 6 -6 7');
});

it('a :| with no |: goes back to the start, or to the last repeat', () => {
  expect(played('4 | 5 :| 6 |')).toBe('4 5 4 5 6');
  expect(played('4 :| 5 :| 6')).toBe('4 4 5 5 6');
});

it(':|: ends one repeat and starts the next', () => {
  expect(played('|: 4 :|: 5 :| 6')).toBe('4 4 5 5 6');
});

it('without a :| it plays as written', () => {
  const { doc, score } = parse('|: 4 5 | 6 |');
  const p = playbackScore(doc, score);
  expect(p.repeats).toBe(false);
  expect(p.score).toBe(score);
});

it('knows each played note’s written note and whether it’s the repeat; bars follow', () => {
  const { doc, score } = parse('4 |: 5 6 :| 7');
  const p = playbackScore(doc, score);
  expect(p.orig).toEqual([0, 1, 2, 1, 2, 3]);
  expect(p.pass).toEqual([1, 1, 1, 2, 2, 1]);
  expect(p.score.events.map((e) => e.start)).toEqual([0, 1, 2, 3, 4, 5]);
  expect(p.score.events.map((e) => e.index)).toEqual([0, 1, 2, 3, 4, 5]);
  expect(p.score.totalBeats).toBe(6);
  expect([...p.score.bars].sort((a, b) => a - b)).toEqual([1, 3, 5]);
  expect(playbackIndexOf(p, 1)).toBe(1);
  expect(playbackIndexOf(p, 1, 2)).toBe(3);
  expect(playbackIndexOf(p, 3, 2)).toBe(5);
});

it('a note tied over the :| doesn’t hold through the jump back', () => {
  const { doc, score } = parse('|: 4 5~ :| ~ 6');
  const p = playbackScore(doc, score);
  // Written: the 5 (2 beats) sounds 3, tied into the next bar.
  expect(score.events[1].soundBeats).toBe(3);
  // Played: the first 5 is followed by the jump back, the second by its tie.
  expect(p.score.events.map((e) => e.soundBeats)).toEqual([1, 2, 1, 3, 1, 1]);
});

it('a tie at the start of a repeat is played afresh the second time', () => {
  const { doc, score } = parse('4 |: ~ 5 :|');
  const p = playbackScore(doc, score);
  // Played: 4 ~ 5 | (~) 5 — the second time, the tie follows the 5: it sounds its own 4.
  expect(p.score.events.map((e) => e.tied)).toEqual([false, true, false, false, false]);
  expect(p.score.events.map((e) => e.soundBeats)).toEqual([2, 1, 1, 1, 1]);
  // After a rest too.
  const r = parse('4 |: ~ 5 . :|');
  expect(playbackScore(r.doc, r.score).score.events.map((e) => e.tied)).toEqual([false, true, false, false, false, false, false]);
});

it('an empty |: :| repeats nothing', () => {
  expect(played('4 5 |: :|')).toBe('4 5');
  expect(played('4 5 |:\n:| 6')).toBe('4 5 6');
});

it('the verse sung: verse 2 the second time through a repeat (if the line has one)', () => {
  const { doc, score } = parse('4 |: 5 6 :|\nw: a b c\nw: _ d e');
  const p = playbackScore(doc, score);
  // 4 (verse 1) | 5 6 (verse 1) | 5 6 (verse 2)
  expect(p.verse).toEqual([0, 0, 0, 1, 1]);
  // A line with one verse sings it again.
  const one = parse('4 |: 5 6 :|\nw: a b c');
  expect(playbackScore(one.doc, one.score).verse).toEqual([0, 0, 0, 0, 0]);
});

it('all verses: once through the song for each, verse by verse', () => {
  const { doc, score } = parse('4 5 |\nw: a b\nw: c d\nw: e f');
  const p = playbackScore(doc, score, { allVerses: true });
  expect(p.orig).toEqual([0, 1, 0, 1, 0, 1]);
  expect(p.round).toEqual([0, 0, 1, 1, 2, 2]);
  expect(p.verse).toEqual([0, 0, 1, 1, 2, 2]);
  expect(p.score.events.map((e) => e.start)).toEqual([0, 1, 2, 3, 4, 5]);
  expect(playbackIndexOf(p, 1, 1, 2)).toBe(5);
  // One verse, or repeats off with no verses: as written (the very same).
  const w = parse('4 5 |\nw: a b');
  expect(playbackScore(w.doc, w.score, { allVerses: true }).score).toBe(w.score);
  expect(playbackScore(w.doc, w.score, { repeats: false })).toBe(playbackScore(w.doc, w.score, { repeats: false }));
});
