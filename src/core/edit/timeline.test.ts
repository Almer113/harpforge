// Phase 7a: one timeline for the editor. Pickups and other short bars keep their length
// through every edit; paste overwrites rests too; re-barring keeps repeat signs.

import { describe, expect, it } from 'vitest';
import { parseHtab } from '../htab/parser';
import { bodyText } from '../htab/serializer';
import { holeSound } from '../types';
import { copyText, pasteText } from './clipboard';
import { advance, fromDoc, makeRoom, moveItems, placeItem, setTimeSignature, toDoc, type RebarInfo, type Song } from './model';

const song = (body: string, time = '4/4') => fromDoc(parseHtab(`---\ntime: ${time}\n---\n${body}`).doc);
const body = (s: Song) => bodyText(toDoc(s).lines);
const PICKUP = '4 | 5 5 6 6 | 7 7 7 7 |';

describe('B13: pickups and short bars', () => {
  it('the caret steps from the end of a pickup into bar 2', () => {
    expect(advance(song(PICKUP), { m: 0, start: 0 }, 1)).toEqual({ m: 1, start: 0 });
  });

  it('copying across a pickup keeps its bar line, with no phantom beats', () => {
    expect(copyText(song(PICKUP), [{ m: 0, start: 0 }, { m: 1, start: 0 }])).toBe('4 | 5');
  });

  it('pasting at a pickup carries on into bar 2', () => {
    const r = pasteText(song(PICKUP), '1 2', { m: 0, start: 0 })!;
    expect(body(r.song)).toBe('1 | 2 5 6 6 | 7 7 7 7 |');
    expect(r.end).toEqual({ m: 1, start: 1 });
  });

  it('moving a note out of the pickup lands it in bar 2, and the pickup stays a pickup', () => {
    expect(body(moveItems(song(PICKUP), [{ m: 0, start: 0 }], 1).song)).toBe('. | 4 5 6 6 | 7 7 7 7 |');
    expect(body(moveItems(song(PICKUP), [{ m: 1, start: 0 }], -1).song)).toBe('5 | . 5 6 6 | 7 7 7 7 |');
  });

  it('a long note placed in a pickup ties over into bar 2', () => {
    const s = placeItem(song(PICKUP), 0, { start: 0, dur: 2, sounds: [holeSound(3, 'blow')] });
    expect(body(s)).toBe('3 | ~ 5 6 6 | 7 7 7 7 |');
  });

  it('a note placed past the pickup on purpose makes it longer (as before)', () => {
    const s = placeItem(song(PICKUP), 0, { start: 1, dur: 1, sounds: [holeSound(3, 'blow')] });
    expect(body(s)).toBe('4 3 | 5 5 6 6 | 7 7 7 7 |');
  });

  it('Insert mode in a pickup moves the music on through the bars, keeping the pickup', () => {
    const at = { m: 0, start: 0 };
    const s = placeItem(makeRoom(song(PICKUP), at, 1, true), 0, { start: 0, dur: 1, sounds: [holeSound(3, 'blow')] });
    expect(body(s)).toBe('3 | 4 5 5 6 | 6 7 7 7 | 7 .~~ |');
  });
});

describe('B14: paste overwrites rests too', () => {
  it('pasting "4 . 5" over four notes leaves the gap', () => {
    const r = pasteText(song('7 7 7 7 |'), '4 . 5', { m: 0, start: 0 })!;
    expect(body(r.song)).toBe('4 . 5 7 |');
  });
});

describe('B21: re-barring keeps repeat signs', () => {
  const REPEAT = '|: 4 5 6 7 | 4 5 6 7 :| 8 8 8 8 |';

  it('to 3/4: the bar before the repeat sign ends early, and says so', () => {
    const info: RebarInfo = { shortBars: 0 };
    const s = setTimeSignature(song(REPEAT), '3/4', true, info);
    expect(body(s)).toBe('|: 4 5 6 | 7 4 5 | 6 7 :| 8 8 8 | 8 |');
    expect(info.shortBars).toBe(1);
  });

  it('to 2/4: the bar lines already line up, nothing is shortened', () => {
    const info: RebarInfo = { shortBars: 0 };
    const s = setTimeSignature(song(REPEAT), '2/4', true, info);
    expect(body(s)).toBe('|: 4 5 | 6 7 | 4 5 | 6 7 :| 8 8 | 8 8 |');
    expect(info.shortBars).toBe(0);
  });
});
