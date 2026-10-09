// Phase 9d: checking notes played along with the song.

import { describe, expect, it } from 'vitest';
import { parseHtab } from './htab/parser';
import { AlongChecker, expectedNotes, latencyFrom, windows } from './playAlong';
import { buildScore, harmonicaFromMeta } from './score';

const score = (body: string) => {
  const doc = parseHtab(`---\n---\n${body}`).doc;
  return buildScore(doc, harmonicaFromMeta(doc.meta)).score;
};
// C harp: 4 = C5 (72), 5 = E5 (76), 6 = G5 (79).
const S = score('4 5 6 . | 4~ 5 5 |');

it('expects the notes to start (not rests or ties), inside the passage if there is one', () => {
  expect(expectedNotes(S).map((e) => e.start)).toEqual([0, 1, 2, 4, 6, 7]);
  expect(expectedNotes(S, { start: 4, end: 8 }).map((e) => e.start)).toEqual([4, 6, 7]);
});

it('the window is at least 150 ms, a quarter beat at slow tempos', () => {
  expect(windows(60)).toEqual({ ok: 0.25, good: 0.125 });
  expect(windows(120).ok).toBeCloseTo(0.3);
});

describe('a pass', () => {
  const win = { ok: 0.25, good: 0.125 };
  it('marks notes in time, early and late, and wrong notes as strays', () => {
    const c = new AlongChecker(expectedNotes(S));
    expect(c.attack(0.05, 72, win)).toEqual({ index: 0, mark: 'hit' });
    expect(c.attack(0.8, 76, win)).toEqual({ index: 1, mark: 'early' });
    expect(c.attack(2.2, 79, win)).toEqual({ index: 2, mark: 'late' });
    // The wrong pitch, or far from any note.
    expect(c.attack(4, 79, win)).toBeNull();
    expect(c.attack(5, 72, win)).toBeNull();
    expect(c.strays).toBe(2);
  });

  it('two notes of the same pitch in a row are matched one each', () => {
    const c = new AlongChecker(expectedNotes(S));
    expect(c.attack(6.1, 76, win)?.index).toBe(5);
    expect(c.attack(6.9, 76, win)?.index).toBe(6);
  });

  it('a note whose window has gone by is missed; the result counts what was left unplayed', () => {
    const c = new AlongChecker(expectedNotes(S));
    c.attack(0, 72, win);
    expect(c.missedBy(1.5, win)).toEqual([1]);
    const r = c.result();
    expect(r).toMatchObject({ hit: 1, missed: 5, total: 6, clean: false });
    expect(r.missedAt).toEqual([1, 2, 4, 5, 6]);
  });

  it('every note played (early or late too) is a clean pass; reset starts the next', () => {
    const c = new AlongChecker(expectedNotes(S, { start: 4, end: 8 }));
    c.attack(4, 72, win);
    c.attack(6.2, 76, win);
    c.attack(7, 76, win);
    expect(c.result()).toMatchObject({ clean: true, late: 1, hit: 2, offAt: [5] });
    c.reset();
    expect(c.result().clean).toBe(false);
  });
});

it('the microphone delay is the median offset from the clicks', () => {
  // At 60 bpm a beat is a second: offsets of about 0.12 beat are 120 ms.
  expect(latencyFrom([0.1, 0.12, 0.13, 0.11, 0.9, 0.12], 60)).toBe(120);
  expect(latencyFrom([0.1, 0.12], 60)).toBeNull();
});

it('stopped part way, only the notes up to there count', () => {
  const c = new AlongChecker(expectedNotes(S));
  c.attack(0, 72, { ok: 0.25, good: 0.125 });
  expect(c.result(1.5)).toMatchObject({ total: 2, hit: 1, missed: 1, missedAt: [1] });
});

describe('review fixes', () => {
  const win = { ok: 0.3, good: 0.15 };
  it("a chord's other notes, played one by one, aren't wrong notes", () => {
    const c = new AlongChecker(expectedNotes(score('(4 5) 6 |')));
    expect(c.attack(0, 72, win)?.mark).toBe('hit');
    expect(c.attack(0.02, 76, win)).toBeNull();
    expect(c.strays).toBe(0);
  });

  it('playing steadily a little late keeps each note on its own note', () => {
    // Quarter-beat notes of the same pitch, each played 0.13 beat late.
    const c = new AlongChecker(expectedNotes(score('{4 4 4 4} {4 4 4 4} 5 |')));
    for (let k = 0; k < 8; k++) {
      c.missedBy(k * 0.25 + 0.13, win);
      expect(c.attack(k * 0.25 + 0.13, 72, win)?.index).toBe(k);
    }
    expect(c.result()).toMatchObject({ missed: 1, strays: 0, missedAt: [8] });
  });
});
