import { describe, expect, it } from 'vitest';
import { TWINKLE } from '../demo/songs';
import { decodeTab, encodeTab } from './share';

describe('share links', () => {
  it('round-trips a tab, including non-ASCII text, compactly', () => {
    const text = TWINKLE.replace('Traditional', 'Trad. — Frère Jacques ♪');
    const code = encodeTab(text);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(code.length).toBeLessThan(text.length);
    expect(decodeTab(code)).toBe(text);
  });
});
