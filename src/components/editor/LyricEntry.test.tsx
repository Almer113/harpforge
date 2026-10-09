// @vitest-environment happy-dom
// Phase 11c: the lyrics box in the visual editor.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/engine', async () => (await import('../../test/fakeEngine')).fakeEngine());

import { LyricInput, openRestBlock, RestChordInput, startLyrics, stopLyrics } from './LyricEntry';
import { useApp } from '../../state/store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const s = () => useApp.getState();
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

/** The box wherever lyrics mode is (as the editor draws it on that note). */
function Box() {
  const at = useApp((st) => st.ve.lyricAt);
  const verse = useApp((st) => st.ve.verse);
  // (A rest block being made has its own box, drawn by Draft.)
  const drafting = useApp((st) => !!st.ve.restDraft);
  return at && !drafting ? <LyricInput key={`${at.m}:${at.start}`} pos={at} verse={verse} /> : null;
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
async function key(k: string, shiftKey = false, altKey = false, ctrlKey = false) {
  const code = k === ' ' ? 'Space' : undefined;
  await act(async () => box().dispatchEvent(new KeyboardEvent('keydown', { key: k, code, shiftKey, altKey, ctrlKey, bubbles: true, cancelable: true })));
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
  await act(async () => useApp.setState((st) => ({ ve: { ...st.ve, verse: 1 } })));
  await act(async () => startLyrics());
  await change('one two');
  await key('Enter');
  expect(lyrics()).toEqual(['w:', 'w: one two']);
  await act(async () => useApp.setState((st) => ({ ve: { ...st.ve, verse: 0 } })));
});

describe('words and chords on rests (empty space)', () => {
  const lineOf = () => s().text.split('\n').filter((l) => /\|/.test(l) || l.startsWith('w:'));
  /** The draft rest block as the editor draws it: its box. */
  function Draft() {
    const draft = useApp((st) => st.ve.restDraft);
    const verse = useApp((st) => st.ve.verse);
    if (!draft) return null;
    return draft.field === 'lyric' ? <LyricInput key={`d${draft.pos.start}`} pos={draft.pos} verse={verse} draft={draft.dur} /> : <RestChordInput pos={draft.pos} dur={draft.dur} />;
  }
  beforeEach(async () => {
    await act(async () => root.render(<><Box /><Draft /></>));
    await act(async () => s().loadText('---\ntitle: T\n---\n4 . 5 6 |\nw: Hey there you\n', null));
  });

  it('a syllable typed under empty space makes a sung rest ("_")', async () => {
    await act(async () => openRestBlock({ m: 0, start: 1 }, 1, 'lyric'));
    await change('oh');
    await key('Enter');
    expect(lineOf()).toEqual(['4 _ 5 6 |', 'w: Hey oh there you']);
    expect(s().ve.restDraft).toBeUndefined();
  });

  it('left empty (or Esc), nothing changes', async () => {
    const before = s().text;
    await act(async () => openRestBlock({ m: 0, start: 1 }, 1, 'lyric'));
    await key('Enter');
    expect(s().text).toBe(before);
    await act(async () => openRestBlock({ m: 0, start: 1 }, 1, 'lyric'));
    await change('oh');
    await key('Escape');
    expect(s().text).toBe(before);
  });

  it('a chord typed above empty space puts it on the rest', async () => {
    await act(async () => openRestBlock({ m: 0, start: 1 }, 1, 'chord'));
    await act(async () => {
      const el = host.querySelector<HTMLInputElement>('.ve-chord-input')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, 'G7');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });
    expect(lineOf()[0]).toBe('4 [G7] . 5 6 |');
  });

  it('Alt+Space steps onto the rest after a note; Space skips it', async () => {
    await act(async () => startLyrics());
    await key(' ', false, true);
    expect(s().ve.restDraft?.pos).toEqual({ m: 0, start: 1 });
    await key('Escape');
    await act(async () => startLyrics());
    await key(' ');
    expect(s().ve.lyricAt).toEqual({ m: 0, start: 2 });
  });

  it('Alt+Space over empty beats left empty goes on beat by beat (Ctrl+→ too)', async () => {
    await act(async () => s().loadText('---\ntitle: T\n---\n4 . . 6 |\n', null));
    await act(async () => startLyrics());
    await key(' ', false, true);
    expect(s().ve.restDraft?.pos).toEqual({ m: 0, start: 1 });
    await key('ArrowRight', false, false, true);
    expect(s().ve.restDraft?.pos).toEqual({ m: 0, start: 2 });
    await key(' ', false, true);
    expect(s().ve.lyricAt).toEqual({ m: 0, start: 3 });
    expect(s().ve.restDraft).toBeUndefined();
  });

  it('a chord typed above a rest is kept when something else takes over', async () => {
    await act(async () => openRestBlock({ m: 0, start: 1 }, 1, 'chord'));
    await act(async () => {
      const el = host.querySelector<HTMLInputElement>('.ve-chord-input')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, 'Am');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => startLyrics({ m: 0, start: 0 }));
    expect(lineOf()[0]).toBe('4 [Am] . 5 6 |');
  });
});
