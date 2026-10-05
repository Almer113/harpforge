// @vitest-environment happy-dom
// Quick typing makes one undo step, but only within one field: typing the title, then the
// artist, makes two steps.

import { expect, it, vi } from 'vitest';

vi.mock('../audio/engine', async () => (await import('../test/fakeEngine')).fakeEngine());

import { useApp } from './store';

it('typing in two fields makes two undo steps', () => {
  const s = () => useApp.getState();
  s().loadText('---\n---\n4 5 6 |\n', null);
  s().setText('---\ntitle: A\n---\n4 5 6 |\n', { kind: 'typing:title' });
  s().setText('---\ntitle: Ab\n---\n4 5 6 |\n', { kind: 'typing:title' });
  s().setText('---\ntitle: Ab\nartist: C\n---\n4 5 6 |\n', { kind: 'typing:artist' });
  s().undo();
  expect(s().text).toBe('---\ntitle: Ab\n---\n4 5 6 |\n');
  s().undo();
  expect(s().text).toBe('---\n---\n4 5 6 |\n');
});
