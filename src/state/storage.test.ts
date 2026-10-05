// @vitest-environment happy-dom
// Phase 5b: saving, the working copy, settings and share links can't lose or break your work.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/engine', async () => (await import('../test/fakeEngine')).fakeEngine());

// A library that answers when the test says so.
const pending: { text: string; id: string | null | undefined; resolve: (id: string) => void }[] = [];
let nextId = 0;
vi.mock('../storage/library', () => ({
  saveTab: (text: string, id?: string | null) => new Promise<string>((resolve) => pending.push({ text, id, resolve })),
  persistStorage: async () => undefined,
  seedDemos: async () => undefined,
}));

import { pruneWorking, readWorking, savedCopies, writeWorking } from './working';
import { decodeTab, encodeTab, MAX_SHARED_BYTES, SharedTooLarge } from './share';
import { saveCurrent } from './actions';
import { useApp } from './store';

const settle = () => new Promise((r) => setTimeout(r, 0));
/** Lets the oldest waiting save finish, as a new entry (or the id it was given). */
async function finishSave() {
  await settle();
  const p = pending.shift()!;
  p.resolve(p.id ?? `id${++nextId}`);
  await settle();
}

describe('saving', () => {
  beforeEach(() => {
    pending.length = 0;
    useApp.getState().loadText('---\ntitle: A\n---\n4 |\n');
  });

  it('two quick saves of a new tab make one library entry', async () => {
    void saveCurrent();
    void saveCurrent();
    await finishSave();
    const created = useApp.getState().docId;
    expect(created).toBeTruthy();
    // The second save waited, and goes to the entry the first one made.
    await settle();
    expect(pending[0].id).toBe(created);
    await finishSave();
    expect(pending).toHaveLength(0);
    expect(useApp.getState().docId).toBe(created);
  });

  it('a save that finishes after another tab was opened leaves that tab alone', async () => {
    void saveCurrent();
    await settle();
    useApp.getState().loadText('---\ntitle: B\n---\n5 |\n', null);
    await finishSave();
    const s = useApp.getState();
    expect(s.docId).toBeNull();
    expect(s.savedText).toBeNull();
    expect(s.toast?.message).toContain('“A”');
  });

  it('a save queued behind it still goes to the first tab’s entry', async () => {
    void saveCurrent();
    await settle();
    useApp.getState().setText('---\ntitle: A\n---\n4 5 |\n');
    void saveCurrent();
    useApp.getState().loadText('---\ntitle: B\n---\n5 |\n', null);
    await finishSave();
    const firstId = `id${nextId}`;
    await settle();
    expect(pending[0].id).toBe(firstId);
    await finishSave();
  });
});

describe('working copies', () => {
  const memory = () => {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
      key: (i: number) => [...m.keys()][i] ?? null,
      get length() {
        return m.size;
      },
    };
  };
  const copy = (text: string) => ({ text, docId: null, savedText: null });

  it('hold the last saved text of each library tab (to recover a cleared library)', () => {
    const store = memory();
    writeWorking(store, 'a', { text: 'edited', docId: 'd1', savedText: 'saved 1' }, 1000);
    writeWorking(store, 'b', { text: 'x', docId: 'd1', savedText: 'saved 1 later' }, 2000);
    writeWorking(store, 'c', { text: 'draft', docId: null, savedText: null }, 3000);
    writeWorking(store, 'd', { text: 'y', docId: 'd2', savedText: 'saved 2' }, 1500);
    expect(savedCopies(store).sort((x, y) => x.docId.localeCompare(y.docId))).toEqual([
      { docId: 'd1', text: 'saved 1 later', at: 2000 },
      { docId: 'd2', text: 'saved 2', at: 1500 },
    ]);
  });

  it('each tab keeps its own copy', () => {
    const store = memory();
    writeWorking(store, 'a', copy('A'), 1);
    writeWorking(store, 'b', copy('B'), 2);
    expect(readWorking(store, 'a')?.text).toBe('A');
    expect(readWorking(store, 'b')?.text).toBe('B');
  });

  it('a new tab starts from the most recent copy (or the old shared one)', () => {
    const store = memory();
    store.setItem('harpforge:working', JSON.stringify(copy('old')));
    expect(readWorking(store, 'new')?.text).toBe('old');
    writeWorking(store, 'a', copy('A'), 5);
    writeWorking(store, 'b', copy('B'), 3);
    expect(readWorking(store, 'new')?.text).toBe('A');
  });

  it('forgets only copies unused for a month, however many tabs there are', () => {
    const store = memory();
    const day = 24 * 3600 * 1000;
    const now = 100 * day;
    writeWorking(store, 'old', copy('old'), now - 40 * day);
    // An idle tab with unsaved work, and a dozen busier ones.
    writeWorking(store, 'idle', copy('idle'), now - 2 * day);
    for (let i = 0; i < 12; i++) writeWorking(store, `t${i}`, copy(String(i)), now - i);
    pruneWorking(store, 't0', now);
    expect(store.getItem('harpforge:working:old')).toBeNull();
    expect(readWorking(store, 'idle')?.text).toBe('idle');
    expect(store.length).toBe(13);
  });
});

describe('share links', () => {
  it('round-trip a tab', () => {
    const text = '---\ntitle: Ünïcode\n---\n4 -4 5 |\n';
    expect(decodeTab(encodeTab(text))).toBe(text);
  });

  it('refuse to unpack more than the limit', () => {
    const huge = encodeTab('4 '.repeat(MAX_SHARED_BYTES));
    expect(() => decodeTab(huge)).toThrow(SharedTooLarge);
  });
});

describe('settings', () => {
  it('a corrupted settings entry falls back to the defaults', async () => {
    for (const bad of ['null', '"text"', '[1,2]', '{"sheetShow":"x","printPrefs":{"view":"nope","size":7},"ownedHarps":[null,{"family":"diatonic","key":"C"}]}']) {
      localStorage.setItem('harpforge:prefs', bad);
      vi.resetModules();
      const { useApp: fresh } = await import('./store');
      const s = fresh.getState();
      expect(s.showNoteNames).toBe(true);
      expect(s.sheetShow.tab.lyrics).toBe(true);
      expect(s.printPrefs.view).toBe('tab');
      expect(s.ownedHarps.every((h) => typeof h.key === 'string')).toBe(true);
    }
    localStorage.removeItem('harpforge:prefs');
  });
});

describe('harmonica size setting', () => {
  it('carries over the old "hidden" choice', async () => {
    localStorage.setItem('harpforge:prefs', JSON.stringify({ harpHidden: true }));
    vi.resetModules();
    expect((await import('./store')).useApp.getState().harpSize).toBe('hidden');
    localStorage.setItem('harpforge:prefs', JSON.stringify({ harpSize: 'slim', harpHidden: true }));
    vi.resetModules();
    expect((await import('./store')).useApp.getState().harpSize).toBe('slim');
    localStorage.removeItem('harpforge:prefs');
  });
});
