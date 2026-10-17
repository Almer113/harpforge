// The format guide (docs/htab-format.md) stays true: every example in it reads without a
// problem, and the syntax it shows does what it says.

import { describe, expect, it } from 'vitest';
import GUIDE from '../../docs/htab-format.md?raw';
import { parseHtab } from './htab/parser';
import { isHeld, lyricOf } from './verses';
import type { NoteEvent } from './htab/types';

/** The guide's code examples (the text between ``` fences). */
const examples = [...GUIDE.matchAll(/```[a-z]*\n([^]*?)```/g)].map((m) => m[1]);

describe('the format guide', () => {
  it('has its examples (and every fence is closed)', () => {
    expect(examples.length).toBeGreaterThanOrEqual(5);
    expect((GUIDE.match(/```/g) ?? []).length % 2).toBe(0);
  });

  it.each(examples.map((e, k) => [k + 1, e] as const))('example %i reads without a problem', (_k, example) => {
    // (A header on its own gets a note to go with it; a body gets a header.)
    const text = example.startsWith('---') ? `${example}4 |\n` : `---\ntitle: Example\n---\n${example}`;
    const { issues } = parseHtab(text);
    expect(issues.filter((i) => i.severity !== 'info').map((i) => i.message)).toEqual([]);
  });

  it('the lyrics example: verses, a sung rest, a hold', () => {
    const lyrics = examples.find((e) => e.includes('w: Oh la la'))!;
    const { doc } = parseHtab(`---\ntitle: L\n---\n${lyrics}`);
    const first = doc.lines[0].events.find((e): e is NoteEvent => e.kind === 'note')!;
    expect([lyricOf(first, 0), lyricOf(first, 1)]).toEqual(['Twin-', 'How']);
    const second = doc.lines[1].events.filter((e) => e.kind !== 'bar');
    expect(second[0]).toMatchObject({ kind: 'rest', sung: true, lyric: 'Oh' });
    expect(isHeld(second[4] as NoteEvent, 0)).toBe(true);
  });
});
