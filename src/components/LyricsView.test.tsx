// @vitest-environment happy-dom
// Phase 10c: the lyrics view.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../audio/engine', async () => (await import('../test/fakeEngine')).fakeEngine());

import { PlayPage } from '../pages/PlayPage';
import { stop } from '../state/playback';
import { useApp } from '../state/store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TAB = '---\ntitle: Words\n---\n@ Intro\n4 5 |\n@ Verse\n[C] 4 4 6 6 |\nw: Twin-kle twin-kle\n';
const s = () => useApp.getState();
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(async () => {
  stop();
  s().loadText(TAB, null);
  useApp.setState({ page: 'play', performing: false, sheetView: 'lyrics', readAs: 'holes', selectedEvent: null, passage: null, activeEvents: [] });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<PlayPage />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

it('shows the words as words, with the holes and chords above, and the headings', () => {
  const texts = [...host.querySelectorAll('.ly-word')].map((w) => [...w.querySelectorAll('.ly-text')].map((t) => t.textContent).join(''));
  expect(texts.filter(Boolean)).toEqual(['Twinkle', 'twinkle']);
  expect([...host.querySelectorAll('.ly-section')].map((h) => h.textContent)).toEqual(['Intro', 'Verse']);
  // The intro has no words: a compact line of holes.
  expect(host.querySelector('.ly-line.ly-fills')?.textContent).toBe('45');
  expect(host.querySelector('.ly-chord')?.textContent).toBe('C');
  expect(host.querySelector('.ly-none')).toBeNull();
});

it('clicking a word selects its note; Shift+click chooses a passage', async () => {
  const word = (t: string) => [...host.querySelectorAll<HTMLElement>('.ly-text')].filter((x) => x.textContent === t);
  await act(async () => word('kle')[0].click());
  // (The intro's 4 and 5 are notes 0 and 1, then Twin 2, kle 3.)
  expect(s().selectedEvent).toBe(3);
  await act(async () => word('kle')[1].dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })));
  expect(s().passage).toEqual({ start: 3, end: 6 });
});

it('the playing note lights its syllable', async () => {
  const note = host.querySelectorAll<HTMLElement>('.ly-syl:not(.fill) .ly-note')[1];
  await act(async () => useApp.setState({ activeEvents: [Number(note.dataset.index)] }));
  expect(host.querySelector('.ly-syl.active .ly-text')?.textContent).toBe('kle');
  expect(note.classList.contains('active')).toBe(true);
});

it('Show → Holes off leaves the words and chords', async () => {
  await act(async () => useApp.setState((st) => ({ sheetShow: { ...st.sheetShow, lyrics: { holes: false, chords: true } } })));
  expect(host.querySelector('.lyricsview.no-holes')).not.toBeNull();
  // The words take the keyboard (and the notes' states) instead of the hidden holes.
  const kle = [...host.querySelectorAll<HTMLElement>('.ly-text')].find((t) => t.textContent === 'kle')!;
  expect(kle.getAttribute('role')).toBe('button');
  expect(kle.tabIndex).toBe(0);
  expect(host.querySelector<HTMLElement>('.ly-syl:not(.fill) .ly-note')!.tabIndex).toBe(-1);
  await act(async () => kle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  expect(s().selectedEvent).toBe(3);
  expect(kle.classList.contains('selected')).toBe(true);
});

it('notes are named for screen readers', () => {
  expect(host.querySelector('.ly-syl:not(.fill) .ly-note')?.getAttribute('aria-label')).toBe('C5');
});
