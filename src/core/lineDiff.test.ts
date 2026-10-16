// Phase 13b: comparing two versions of a tab line by line.

import { describe, expect, it } from 'vitest';
import { describeChange, diffLines } from './lineDiff';

const show = (a: string, b: string) => diffLines(a, b).map((l) => `${l.op === 'same' ? ' ' : l.op === 'add' ? '+' : '-'}${l.text}`);

describe('line diff', () => {
  it('a line changed in the middle: removed, then added; the rest the same', () => {
    expect(show('a\nb\nc\n', 'a\nB\nc\n')).toEqual([' a', '-b', '+B', ' c']);
  });

  it('lines added and removed, the shared ones kept in order', () => {
    expect(show('x\na\nb\nc', 'a\nc\nd')).toEqual(['-x', ' a', '-b', ' c', '+d']);
  });

  it('the same text: all the same; from nothing: all added', () => {
    expect(show('a\nb', 'a\nb')).toEqual([' a', ' b']);
    expect(show('', 'a')).toEqual(['-', '+a']);
  });

  it('says what changed', () => {
    expect(describeChange('a\nb\n', 'a\nB\nc\n')).toBe('2 lines added, 1 removed');
    expect(describeChange('a\n', 'a\nb\n')).toBe('1 line added');
    expect(describeChange('a\nb\n', 'a\n')).toBe('1 line removed');
    expect(describeChange('a\n', 'a\n')).toBe('No changes');
  });
});
