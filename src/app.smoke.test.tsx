// @vitest-environment happy-dom
// Smoke tests: the whole app renders every page, view and dialog without crashing or
// logging an error. They catch "blank page after a change" before it reaches the browser.

import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// No Web Audio and no IndexedDB here: the audio engine is faked, the library lives in memory.
vi.mock('./audio/engine', async () => (await import('./test/fakeEngine')).fakeEngine());
vi.mock('./storage/library', async (importOriginal) => {
  const real = await importOriginal<typeof import('./storage/library')>();
  const { DEMOS } = await import('./demo/songs');
  const tabs = DEMOS.map((d, i) => ({ id: `demo${i}`, text: d.text, title: /title: (.*)/.exec(d.text)?.[1] ?? 'Untitled', updated: 1_700_000_000_000 + i }));
  return {
    ...real,
    listTabs: async () => tabs.map((t) => ({ ...t })),
    saveTab: async (_text: string, id?: string | null) => id ?? 'new',
    deleteTab: async () => undefined,
    persistStorage: async () => true,
    seedDemos: async () => undefined,
  };
});

import { App } from './App';
import { DEMOS } from './demo/songs';
import { openPasteImport } from './state/actions';
import { useApp, type EditorMode, type Page, type SheetView } from './state/store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
const errors: unknown[][] = [];
const settle = async (ms = 0) => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
};
const set = async (patch: Partial<ReturnType<typeof useApp.getState>>) => {
  await act(async () => useApp.setState(patch));
  await settle();
};
const page = async (p: Page) => {
  await act(async () => useApp.getState().setPage(p));
  await settle(20);
};
const text = () => document.body.textContent ?? '';
/** Waits (up to 3 s) for something to appear: a page whose code loads on first visit. */
async function until(selector: string) {
  for (let i = 0; i < 60 && !document.querySelector(selector); i++) await settle(50);
  expect(document.querySelector(selector)).not.toBeNull();
}
/** The page drew, and no error screen is showing. */
function healthy(expected: string | RegExp) {
  expect(document.querySelector('.crash')?.textContent ?? null).toBeNull();
  expect(text()).toMatch(expected);
}

beforeAll(async () => {
  vi.spyOn(console, 'error').mockImplementation((...a) => void errors.push(a));
  const host = document.createElement('div');
  host.id = 'root';
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
  await act(async () => useApp.getState().loadText(DEMOS[0].text));
  await settle(20);
});

afterAll(async () => {
  await act(async () => root.unmount());
});

describe('the app renders every page and view', () => {
  it('Library', async () => {
    await page('library');
    healthy(/Twinkle/);
  });

  it('Play, in every view and harmonica size', async () => {
    await page('play');
    healthy(/Twinkle/);
    for (const view of ['simple', 'tab', 'numbers', 'staff'] as SheetView[]) {
      await set({ sheetView: view });
      healthy(/Twinkle/);
    }
    for (const harpSize of ['slim', 'hidden', 'full'] as const) {
      await set({ harpSize });
      healthy(/Twinkle/);
    }
    await set({ readAs: 'notes' });
    healthy(/C5/);
    await set({ readAs: 'holes', sheetView: 'tab' });
  });

  it('Edit, in every mode, with a note selected and step entry on', async () => {
    await page('editor');
    await until('.edit-sticky');
    for (const mode of ['visual', 'text', 'split', 'visual'] as EditorMode[]) {
      await set({ editorMode: mode });
      healthy(/Twinkle/);
    }
    await until('.ve-item');
    expect(document.querySelectorAll('.ve-item').length).toBeGreaterThan(20);
    await act(async () => useApp.getState().setVe({ selection: [{ m: 0, start: 0 }], anchor: { m: 0, start: 0 } }));
    await settle();
    healthy(/Note/);
    await act(async () => useApp.getState().setVe({ step: true, selection: [] }));
    await settle();
    healthy(/Step entry/);
    await act(async () => useApp.getState().setVe({ step: false, zoom: 32 }));
    await settle();
    await act(async () => useApp.getState().setVe({ zoom: 64 }));
    healthy(/Twinkle/);
  });

  it('Print', async () => {
    await page('print');
    await until('.print-page, .print-sheet, .print-view');
    healthy(/Twinkle/);
  });
});

describe('dialogs open without errors', () => {
  it('Import (paste), with a pasted tab', async () => {
    await page('play');
    await act(async () => openPasteImport());
    // (The dialog loads the first time it opens.)
    await until('.import-modal');
    healthy(/Import or convert/);
    await set({ importDraft: null });
  });

  it('Plain text', async () => {
    await set({ plainTextOpen: true });
    healthy(/Twinkle/);
    await set({ plainTextOpen: false });
  });

  it('Keyboard shortcuts', async () => {
    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }));
    });
    await settle();
    healthy(/shortcut/i);
  });
});

it('logged no errors along the way', () => {
  expect(errors.map((a) => a.map(String).join(' ').slice(0, 300))).toEqual([]);
});
