import { describe, expect, it } from 'vitest';
import { DEFAULT_PLAIN_TEXT, holeToken, writePlainText } from './formats/plaintext';
import { parseHtab } from './htab/parser';
import { getHarmonica } from './instruments';
import { holeSound } from './types';

const C = getHarmonica({ family: 'diatonic', tuning: 'richter', key: 'C' });
const body = (text: string, o = {}) => writePlainText(parseHtab(`---\ntitle: T\n---\n${text}`).doc, C, { ...DEFAULT_PLAIN_TEXT, title: false, ...o });

describe('plain-text tab', () => {
  it('spells holes in each style', () => {
    const d = holeSound(3, 'draw', { bend: 2 });
    expect(holeToken(d, DEFAULT_PLAIN_TEXT)).toBe("-3''");
    expect(holeToken(d, { ...DEFAULT_PLAIN_TEXT, style: 'letters', bend: 'b' })).toBe('3Dbb');
    expect(holeToken(holeSound(4, 'blow'), { ...DEFAULT_PLAIN_TEXT, style: 'plusminus' })).toBe('+4');
    expect(holeToken(holeSound(6, 'blow', { over: true }), { ...DEFAULT_PLAIN_TEXT, over: 'ob' })).toBe('6ob');
  });

  it('writes notes instead of holes when asked', () => {
    expect(body("4 -4 (4 5) -3' |", { spelling: 'notes' })).toBe("C5 D5 (C5 E5) Bb4 |\n");
  });

  it('lines chords up above and lyrics below the notes', () => {
    expect(body('[C] 4 -4 [G] 5~ |\nw: hel-lo there')).toBe(['C       G', '4    -4 5 |', 'hel- lo there'].join('\n') + '\n');
  });

  it('leaves out rests and held notes, and sections when asked', () => {
    expect(body('@ Intro\n4 . 5~ | ~ 6 |')).toBe('[Intro]\n4 5 | 6 |\n');
    expect(body('@ Intro\n4 5 |', { sections: false, bars: false })).toBe('4 5\n');
  });

  it('breaks long lines between bars', () => {
    const out = body('4 4 4 4 | 5 5 5 5 | 6 6 6 6 |', { width: 20 });
    expect(out.split('\n').filter(Boolean)).toEqual(['4 4 4 4 | 5 5 5 5 |', '6 6 6 6 |']);
  });

  it('starts with the title and how to read it', () => {
    const out = writePlainText(parseHtab('---\ntitle: Song\nartist: Me\n---\n4 |').doc, C, DEFAULT_PLAIN_TEXT);
    expect(out.split('\n').slice(0, 3)).toEqual(['Song — Me', 'C Diatonic harmonica, 1st position', "(plain number = blow, - = draw, ' = bend)"]);
  });
});
