// Phase 11 review: an edit that puts a line's music after a later line's doesn't write its comments twice.

import { expect, it } from 'vitest';
import { parseHtab } from '../htab/parser';
import { deleteNotes, fromDoc } from './model';
import { spliceBody } from './splice';

it('a line whose music moves after another keeps its comments once', () => {
  const text = '---\ntitle: S\n---\n4~ | # t0\n6 # t1\n4~ 6 . . | # t2\n';
  const out = spliceBody(text, deleteNotes(fromDoc(parseHtab(text).doc), [{ m: 0, start: 0 }], true));
  for (const c of ['# t0', '# t1', '# t2']) expect(out.split(c).length - 1).toBe(1);
});
