// @vitest-environment happy-dom
// Phase 11c: the lyrics box in the visual editor.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../../audio/engine', async () => (await import('../../test/fakeEngine')).fakeEngine());

import { LyricInput, startLyrics, stopLyrics } from './LyricEntry';
import { useApp } from '../../state/store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const s = () => useApp.getState();
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

/** The box wherever lyrics mode is (as the editor draws it on that note). */
function Box() {
  const at = useApp((st) => st.ve.lyricAt);
  const verse = useApp((st) => st.ve.verse);
  return at ? <LyricInput key={`${at.m}:${at.start}`} pos={at} verse={verse} /> : null;
}

const box = () => host.querySelector<HTMLInputElement>('.ve-lyric-input')!;
const lyrics = () => s().text.split('\n').filter((l) => l.startsWith('w:'));
/** Types into the box the way a paste (or very quick typing) arrives: as a change. */
async function change(value: string) {
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    set.call(box(), value);
    box().dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function key(k: string, shiftKey = false) {
  await act(async () => box().dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey, bubbles: true, cancelable: true })));
}

beforeEach(async () => {
  s().loadText('---\ntitle: T\n---\n4 4 6 6 | -6 -6 6~ |\n', null);
  useApp.setState({ page: 'editor', editorMode: 'visual' });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Box />));
});
afterEach(async () => {
  await act(async () => stopLyrics());
  await act(async () => root.unmount());
  host.remove();
});

it('a pasted line goes on note by note', async () => {
  await act(async () => startLyrics());
  await change('Twin-kle twin-kle lit-tle star');
  await key('Enter');
  expect(lyrics()).toEqual(['w: Twin-kle twin-kle lit-tle star']);
  expect(s().ve.lyricAt).toBeUndefined();
});

it('keys: "-" joins, Space ends a word, Shift+Space goes back, Esc leaves without the syllable', async () => {
  await act(async () => startLyrics());
  await change('Hel');
  await key('-');
  await change('lo');
  await key(' ');
  await change('x');
  await key(' ', true);
  expect(s().ve.lyricAt).toEqual({ m: 0, start: 1 });
  await change('LO');
  await key('Escape');
  expect(lyrics()).toEqual(['w: Hel-lo x']);
});

it('Backspace in an empty box goes back a note', async () => {
  await act(async () => startLyrics({ m: 0, start: 2 }));
  await change('');
  await key('Backspace');
  expect(s().ve.lyricAt).toEqual({ m: 0, start: 1 });
});

it('types into the verse chosen', async () => {
  useApp.setState((st) => ({ ve: { ...st.ve, verse: 1 } }));
  await act(async () => startLyrics());
  await change('one two');
  await key('Enter');
  expect(lyrics()).toEqual(['w:', 'w: one two']);
  useApp.setState((st) => ({ ve: { ...st.ve, verse: 0 } }));
});
