// @vitest-environment happy-dom
// Phase 15b: the harmonica keeps its own look — every reed labelled with its note, whatever
// the Tab view's "Note names" switch says.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../audio/engine', async () => (await import('../test/fakeEngine')).fakeEngine());

import { useApp } from '../state/store';
import { Harmonica } from './Harmonica';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const names = () => [...host.querySelectorAll('.note')].map((n) => n.textContent);

it('a 10-hole diatonic: every blow and draw reed named, with the Tab view’s note names off', async () => {
  useApp.getState().loadText('---\ntitle: H\nharmonica: diatonic\nharp-key: C\n---\n4 |\n');
  useApp.setState({ showNoteNames: false, readAs: 'holes' });
  await act(async () => root.render(<Harmonica />));
  expect(names()).toHaveLength(20);
  expect(names().slice(0, 2)).toEqual(['C4', 'E4']);
  // Switched on: the same (the switch is the tab's).
  await act(async () => useApp.setState({ showNoteNames: true }));
  expect(names()).toHaveLength(20);
});

it('a 16-hole chromatic: named too', async () => {
  useApp.getState().loadText('---\ntitle: H\nharmonica: chromatic\ntuning: solo-16\nharp-key: C\n---\n4 |\n');
  useApp.setState({ showNoteNames: false, readAs: 'holes' });
  await act(async () => root.render(<Harmonica />));
  expect(names()).toHaveLength(32);
});
