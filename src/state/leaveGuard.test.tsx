// @vitest-environment happy-dom
// Phase 15a: closing the page asks first when work would be lost — unsaved changes, a save on
// its way, practice not yet in the account — and not otherwise.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/engine', async () => (await import('../test/fakeEngine')).fakeEngine());

// A library whose saves finish when the test says so.
const pending: (() => void)[] = [];
vi.mock('../storage/library', () => ({
  libraryNow: async () => ({ owner: 'browser' }),
  saveTab: () => new Promise<string>((resolve) => pending.push(() => resolve('saved-id'))),
  persistStorage: async () => undefined,
  seedDemos: async () => undefined,
  SaveClash: class extends Error {},
}));

import { BLANK } from '../demo/songs';
import { saveCurrent } from './actions';
import { useDraft, wouldLose } from './leaveGuard';
import { useApp } from './store';

const s = () => useApp.getState();
const settle = () => new Promise((r) => setTimeout(r, 0));
/** Whether leaving now would ask (the browser's beforeunload, as it sends it). */
const asks = () => {
  const e = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
};

beforeEach(() => {
  s().loadText('---\ntitle: A\n---\n4 |\n', 'id-a', true);
});

describe('leaving the page', () => {
  it('an unchanged song: closes without asking', () => {
    expect(wouldLose(s(), 0)).toBeNull();
    expect(asks()).toBe(false);
  });

  it('unsaved changes: asks; saved again: doesn’t', async () => {
    s().setText('---\ntitle: A\n---\n5 |\n');
    expect(wouldLose(s(), 0)).toBe('changes');
    expect(asks()).toBe(true);
    s().markSaved('id-a');
    expect(asks()).toBe(false);
  });

  it('an empty new song, never touched: doesn’t ask', () => {
    s().loadText(BLANK);
    expect(isEmptyNew()).toBe(true);
    expect(asks()).toBe(false);
  });

  it('a save still on its way: asks until it’s done', async () => {
    s().setText('---\ntitle: A\n---\n6 |\n');
    const saving = saveCurrent();
    await settle();
    // (The text now matches nothing saved yet, but even once marked saved, the write isn't done.)
    s().markSaved('id-a');
    expect(wouldLose(s(), 0)).toBe('saving');
    expect(asks()).toBe(true);
    pending.shift()!();
    await saving;
    expect(asks()).toBe(false);
  });

  it('practice not yet in the account: asks', () => {
    expect(wouldLose(s(), 1)).toBe('practice');
  });

  it('moving between the app’s pages doesn’t ask (the song stays open, nothing is left)', () => {
    s().setPage('library');
    s().setPage('editor');
    expect(asks()).toBe(false);
  });

  it('a recording under way: asks (its notes go into the song when it stops)', () => {
    useApp.setState({ recording: { mode: 'free' } as never });
    expect(asks()).toBe(true);
    useApp.setState({ recording: null });
    expect(asks()).toBe(false);
  });

  it('words typed in “Fill lyrics” and not put on yet: asks', () => {
    useApp.setState({ fillLyricsOpen: true, fillDraft: 'Twin-kle twin-kle' });
    expect(asks()).toBe(true);
    useApp.setState({ fillLyricsOpen: false, fillDraft: '' });
    expect(asks()).toBe(false);
  });

  it('a field typed in but not set yet (useDraft): asks while it is', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div');
    const root = createRoot(host);
    const Field = ({ pending }: { pending: boolean }) => {
      useDraft(pending);
      return null;
    };
    await act(async () => root.render(<Field pending />));
    expect(asks()).toBe(true);
    await act(async () => root.render(<Field pending={false} />));
    expect(asks()).toBe(false);
    await act(async () => root.render(<Field pending />));
    await act(async () => root.unmount());
    expect(asks()).toBe(false);
  });
});

function isEmptyNew() {
  return s().text.trim() === BLANK.trim();
}
