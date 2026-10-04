import { describe, expect, it } from 'vitest';
import { retab } from '../convert';
import { getHarmonica } from '../instruments';
import { parseHtab } from '../htab/parser';
import { keyScale } from '../pitch';
import { holeSound } from '../types';
import { fromDoc } from './model';
import { chooseSound, chooseSounds, neighbours, offHarp, parseNotes, stepNotes, waysToPlay } from './notes';

const C = getHarmonica({ family: 'diatonic', tuning: 'richter', key: 'C' });
const CMAJ = keyScale('C')!;

describe('editing by note', () => {
  it('lists the ways to play a note, easiest first', () => {
    expect(waysToPlay(C, 67).map((o) => [o.sound.hole, o.sound.breath])).toEqual([[2, 'draw'], [3, 'blow']]);
    expect(waysToPlay(C, 70)[0].sound).toMatchObject({ hole: 3, breath: 'draw', bend: 1 });
    expect(waysToPlay(C, 50)).toEqual([]);
  });

  it('picks the hole closest to the notes around it', () => {
    expect(chooseSound(C, 67)).toMatchObject({ hole: 2, breath: 'draw' });
    expect(chooseSound(C, 67, { before: holeSound(4, 'blow') })).toMatchObject({ hole: 3, breath: 'blow' });
    expect(chooseSound(C, 67, { before: holeSound(1, 'draw') })).toMatchObject({ hole: 2, breath: 'draw' });
  });

  it('keeps notes the harp can’t play as note names', () => {
    const s = chooseSound(C, 50);
    expect(s).toEqual({ type: 'pitch', midi: 50 });
    expect(offHarp(C, s)).toBe(true);
    expect(offHarp(C, { type: 'pitch', midi: 72 })).toBe(false);
  });

  it('chooses neighbouring holes for a chord', () => {
    expect(chooseSounds(C, [76, 72, 79]).map((s) => s.type === 'hole' && `${s.breath === 'draw' ? '-' : ''}${s.hole}`)).toEqual(['4', '5', '6']);
  });

  it('reads typed notes', () => {
    expect(parseNotes('C5 Bb4')).toEqual([72, 70]);
    expect(parseNotes('(c#5)')).toEqual([73]);
    expect(parseNotes('E♭4')).toEqual([63]);
    expect(parseNotes('X5')).toBeNull();
    expect(parseNotes('4')).toBeNull();
    expect(parseNotes('')).toBeNull();
  });

  it('steps through the scale, or by semitone', () => {
    expect(stepNotes(C, [holeSound(4, 'blow')], 1, false, CMAJ)).toEqual([holeSound(4, 'draw')]);
    expect(stepNotes(C, [holeSound(4, 'blow')], -1, false, CMAJ)).toEqual([holeSound(3, 'draw')]);
    expect(stepNotes(C, [holeSound(4, 'blow')], 1, true, CMAJ)).toEqual([holeSound(4, 'draw', { bend: 1 })]);
    // Below the harp: a note name.
    expect(stepNotes(C, [holeSound(1, 'blow')], -1, false, CMAJ)).toEqual([{ type: 'pitch', midi: 59 }]);
    expect(keyScale('G')).toContain(6);
    expect(keyScale('Am')).toEqual(CMAJ);
  });

  it('keeps the octave on a key change when reading in notes', () => {
    const G = getHarmonica({ family: 'diatonic', tuning: 'richter', key: 'G' });
    const doc = parseHtab('---\n---\n4 4 6 6 -6 -6 6 | -5 -5 5 5 -4 -4 4 | 6 6 -5 -5 5 5 -4 | 6 6 -5 -5 5 5 -4 |').doc;
    const first = (r: ReturnType<typeof retab>) => {
      const e = r.doc.lines[0].events.find((x) => x.kind === 'note');
      return e && e.kind === 'note' ? e.sounds[0] : undefined;
    };
    // C5 on a G harp is -5; the free re-tab drops an octave to avoid the F5 overblows.
    expect(first(retab(doc, C, G, true))).toMatchObject({ hole: 5, breath: 'draw' });
    expect(first(retab(doc, C, G))).not.toMatchObject({ hole: 5, breath: 'draw' });
  });

  it('finds the holes before and after a spot', () => {
    const song = fromDoc(parseHtab('---\ntime: 4/4\n---\n4 -4 . 6 |').doc);
    const n = neighbours(song, { m: 0, start: 2 });
    expect(n.before).toMatchObject({ hole: 4, breath: 'draw' });
    expect(n.after).toMatchObject({ hole: 6, breath: 'blow' });
  });
});
