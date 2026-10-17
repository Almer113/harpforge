// @vitest-environment happy-dom
// Phase 17b: the find and replace bar (Ctrl+H) in the visual editor.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/engine', async () => (await import('../../test/fakeEngine')).fakeEngine());

import { useApp } from '../../state/store';
import { closeFind, FindBar, openFind } from './FindBar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TEXT = `---
title: Find
---
@ Verse
-2 4 -2 5 | (4 5 6) 5 -2~ | ~ 4 4 4 |
w: one two three four

@ Chorus
-2 -2 6 6 |]
`;
const s = () => useApp.getState();
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(async () => {
  s().loadText(TEXT, null);
  useApp.setState({ page: 'editor', editorMode: 'visual' });
  closeFind();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.stubGlobal('requestAnimationFrame', (fn: () => void) => setTimeout(fn, 0));
  await act(async () => root.render(<FindBar />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const input = (name: string) => host.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
const type = (name: string, v: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(name), v);
    input(name).dispatchEvent(new Event('input', { bubbles: true }));
  });
const button = (t: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === t || b.getAttribute('aria-label') === t)!;
/** The count (without the note about the replacement). */
const status = () => host.querySelector('.find-status')!.textContent!.split(' · ')[0];
const press = (name: string, key: string, shiftKey = false) => act(async () => input(name).dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true })));

describe('find and replace holes', () => {
  it('opens on the bar; what it finds is counted, a tied note once', async () => {
    await act(async () => openFind());
    expect(host.querySelector('.find-bar')).not.toBeNull();
    await type('find', '-2');
    expect(status()).toBe('5 found');
  });

  it('Enter goes to the next (selecting all of a tied note), Shift+Enter back', async () => {
    await act(async () => openFind());
    await type('find', '-2');
    await press('find', 'Enter');
    expect(s().ve.selection).toEqual([{ m: 0, start: 0 }]);
    expect(status()).toBe('1 of 5 found');
    await press('find', 'Enter');
    await press('find', 'Enter');
    expect(s().ve.selection).toEqual([{ m: 1, start: 2 }, { m: 2, start: 0 }]);
    await press('find', 'Enter', true);
    expect(s().ve.selection).toEqual([{ m: 0, start: 2 }]);
  });

  it('says whether the replacement keeps the tune', async () => {
    await act(async () => openFind());
    await type('find', '-2');
    await type('by', '3');
    expect(host.querySelector('.find-change')!.textContent).toContain('same note (G4)');
    await type('by', '4');
    expect(host.querySelector('.find-change')!.textContent).toContain('a different note: G4 → C5');
    await type('by', '11');
    expect(host.querySelector('.find-change')!.textContent).toContain('isn’t on this harmonica');
    expect(button('Replace all').disabled).toBe(true);
  });

  it('Replace all: every one, one undo, said with Undo', async () => {
    await act(async () => openFind());
    await type('find', '-2');
    await type('by', '3');
    await act(async () => button('Replace all').click());
    expect(s().text).toContain('3 4 3 5 | (4 5 6) 5 3~ | ~ 4 4 4 |');
    expect(s().text).toContain('3 3 6 6 |]');
    expect(s().toast!.message).toBe('Replaced 5 × -2 with 3');
    await act(async () => s().toast!.action!.run());
    expect(s().text).toBe(TEXT);
  });

  it('in a section only (the one with the caret); in chords too', async () => {
    await act(async () => s().setVe({ caret: { m: 3, start: 0 } }));
    await act(async () => openFind());
    await type('find', '5');
    expect(status()).toBe('2 found');
    await act(async () => host.querySelector<HTMLInputElement>('.find-chords input')!.click());
    expect(status()).toBe('3 found');
    expect(button('Verse')).toBeUndefined();
    await type('find', '-2');
    await act(async () => button('Chorus').click());
    expect(status()).toBe('2 found in “Chorus”');
  });

  it('Replace: the selected one, then on to the next', async () => {
    await act(async () => openFind());
    await type('find', '-2');
    await type('by', '3');
    await press('find', 'Enter');
    await press('by', 'Enter');
    expect(s().text).toContain('3 4 -2 5 |');
    expect(s().ve.selection).toEqual([{ m: 0, start: 2 }]);
  });

  it('Esc closes it; it opens again with what was asked', async () => {
    await act(async () => openFind());
    await type('find', '-2');
    await press('find', 'Escape');
    expect(host.querySelector('.find-bar')).toBeNull();
    await act(async () => openFind());
    expect(input('find').value).toBe('-2');
  });

  it('with notes selected: it looks in them; one note selected: its hole to find', async () => {
    await act(async () => s().setVe({ selection: [{ m: 3, start: 0 }, { m: 3, start: 1 }] }));
    await act(async () => openFind());
    expect(s().ve.find!.scope).toBe('selection');
    await type('find', '-2');
    expect(status()).toBe('2 found in the selection');
    await act(async () => closeFind());
    await act(async () => s().setVe({ selection: [{ m: 0, start: 3 }] }));
    await act(async () => openFind());
    expect(input('find').value).toBe('5');
  });

  it('the same hole in both boxes: nothing to replace (and no Undo to take back something else)', async () => {
    await act(async () => openFind());
    await type('find', '-2');
    await type('by', '-2');
    expect(host.querySelector('.find-change')!.textContent).toContain('same hole');
    expect(button('Replace all').disabled).toBe(true);
    expect(button('Replace').disabled).toBe(true);
  });

  it('another song: the bar closes (its section and selection were the old song’s)', async () => {
    await act(async () => s().setVe({ selection: [{ m: 3, start: 0 }, { m: 3, start: 1 }] }));
    await act(async () => openFind());
    await act(async () => s().loadText('---\ntitle: Other\n---\n-2 -2 -2 -2 |\n', null));
    expect(host.querySelector('.find-bar')).toBeNull();
  });

  it('only Enter and Esc are the bar’s: Ctrl+S in its box still reaches the app', async () => {
    await act(async () => openFind());
    const heard: string[] = [];
    const listen = (e: KeyboardEvent) => heard.push(e.key);
    window.addEventListener('keydown', listen);
    await act(async () => input('find').dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true })));
    await press('find', 'Enter');
    window.removeEventListener('keydown', listen);
    expect(heard).toEqual(['s']);
  });

  it('a tied note selected (all of it, from either end): its hole to find', async () => {
    await act(async () => s().setVe({ selection: [{ m: 2, start: 0 }, { m: 1, start: 2 }] }));
    await act(async () => openFind());
    expect(input('find').value).toBe('-2');
    expect(s().ve.find!.scope).toBe('song');
    // (It's found as the one selected, whichever end was clicked first.)
    expect(status()).toBe('3 of 5 found');
    await press('find', 'Enter');
    expect(status()).toBe('4 of 5 found');
  });

  it('a tab written as notes has no holes to find', async () => {
    await act(async () => s().loadText('---\ntitle: N\nnotation: notes\n---\nC5 D5 E5 |\n', null));
    await act(async () => openFind());
    await type('find', '4');
    expect(status()).toMatch(/written as notes/);
  });
});
