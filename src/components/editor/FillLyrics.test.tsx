// @vitest-environment happy-dom
// Phase 11d: filling lyrics from text, with the optional syllable suggestions.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../../audio/engine', async () => (await import('../../test/fakeEngine')).fakeEngine());

import { FillLyricsDialog } from './FillLyrics';
import { useApp } from '../../state/store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const s = () => useApp.getState();
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const q = <T extends Element>(sel: string) => host.querySelector<T>(sel)!;
const button = (label: RegExp) => [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => label.test(b.textContent ?? ''))!;
async function type(value: string) {
  await act(async () => {
    const ta = q<HTMLTextAreaElement>('textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(ta, value);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(async () => {
  localStorage.clear();
  s().loadText('---\ntitle: F\n---\n4 4 5 6 | 6 5 -4 4 |\n', null);
  useApp.setState({ page: 'editor', editorMode: 'visual', fillLyricsOpen: true, fillDraft: '' });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<FillLyricsDialog />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

it('shows where the words go, and puts them on the notes', async () => {
  await type('Twin-kle twin-kle lit-tle star and more');
  expect([...host.querySelectorAll('.fill-syl')].map((x) => x.textContent)).toEqual(['Twin-', 'kle', 'twin-', 'kle', 'lit-', 'tle', 'star', 'and']);
  expect(q('.fill-extra').textContent).toContain('1 syllable more');
  await act(async () => button(/Put on the notes/).click());
  expect(s().text).toContain('w: Twin-kle twin-kle lit-tle star and');
  expect(s().fillLyricsOpen).toBe(false);
  // (Without the suggestions, no language is written into the song.)
  expect(s().text).not.toContain('lang:');
});

it('suggests breaks (Indonesian, guessed), takes a correction, and keeps the language', async () => {
  await type('Kasih Tuhan selalu ada untuk kita');
  expect(q('.fill-tool select').textContent).toContain('guess (Indonesian)');
  await act(async () => button(/Suggest syllable breaks/).click());
  await vi.waitFor(() => expect(q<HTMLTextAreaElement>('textarea').value).toBe('Ka-sih Tu-han se-la-lu a-da un-tuk ki-ta'));
  // Join "ki-ta": the gap after "ki".
  const gap = [...host.querySelectorAll<HTMLButtonElement>('.fill-gap')].find((g) => g.getAttribute('aria-label') === 'kita: break after ki')!;
  await act(async () => gap.click());
  expect(q<HTMLTextAreaElement>('textarea').value).toBe('Ka-sih Tu-han se-la-lu a-da un-tuk kita');
  expect(JSON.parse(localStorage.getItem('harpforge:syllable-fixes')!)).toEqual({ id: { kita: 'kita' } });
  await act(async () => button(/Put on the notes/).click());
  expect(s().text).toContain('lang: id');
  expect(s().text).toContain('w: Ka-sih Tu-han se-la-');
});

it('a pasted song in blocks goes a block a verse; the words wait if the dialog closes', async () => {
  await type('one two three four\n\nfive six seven eight');
  expect(q('.fill-blocks').textContent).toContain('verses 1–2');
  // Closed by mistake: the words are still there.
  await act(async () => useApp.setState({ fillLyricsOpen: false }));
  await act(async () => useApp.setState({ fillLyricsOpen: true }));
  expect(q<HTMLTextAreaElement>('textarea').value).toContain('five six');
  await act(async () => button(/Put on the notes/).click());
  expect(s().text).toContain('w: one two three four\nw: five six seven eight');
  expect(s().fillDraft).toBe('');
});

it('Indonesian doubled words are split part by part', async () => {
  await type('anak-anak kupu-kupu');
  // (Two words don't say which language: chosen, and remembered for next time.)
  await act(async () => {
    const sel = q<HTMLSelectElement>('.fill-tool select');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(sel, 'id');
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(localStorage.getItem('harpforge:lyrics-lang')).toBe('id');
  await act(async () => button(/Suggest syllable breaks/).click());
  await vi.waitFor(() => expect(q<HTMLTextAreaElement>('textarea').value).toBe('a-nak-a-nak ku-pu-ku-pu'));
});
