// @vitest-environment happy-dom
// Phase 13b: the History dialog — a tab's versions, compared, named, brought back.

import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../audio/engine', async () => (await import('../test/fakeEngine')).fakeEngine());

import { useApp } from '../state/store';
import { listVersions, saveTab } from '../storage/library';
import { HistoryDialog } from './HistoryDialog';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tab = (body: string) => `---\ntitle: H\n---\n${body}\n`;
const s = () => useApp.getState();
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let id: string;

const settle = () => act(async () => new Promise((r) => setTimeout(r, 30)));
const items = () => [...host.querySelectorAll('.history-item')];
const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(text))!;

beforeEach(async () => {
  id = await saveTab(tab('4 5 |'));
  await saveTab(tab('4 5 6 |'), id);
  s().loadText(tab('4 5 6 |'), id, true);
  s().setText(tab('4 5 6 7 |'));
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<HistoryDialog />));
  await act(async () => useApp.setState({ historyFor: id }));
  await settle();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  useApp.setState({ historyFor: null });
});

it('lists the versions newest first, the newest marked as the last saved (the tab has unsaved edits)', () => {
  expect(items().map((b) => b.querySelector('.hi-sub')?.textContent)).toEqual(['Last saved · 1 line added, 1 removed', 'Oldest kept']);
});

it('compares a version with the one before it, and with the tab now (its unsaved edits too)', async () => {
  await act(async () => button('What changed').click());
  expect([...host.querySelectorAll('.diff-line.del, .diff-line.add')].map((l) => l.textContent)).toEqual(['−4 5 |', '+4 5 6 |']);
  await act(async () => button('Compared with now').click());
  expect([...host.querySelectorAll('.diff-line.del, .diff-line.add')].map((l) => l.textContent)).toEqual(['−4 5 6 |', '+4 5 6 7 |']);
});

it('brings an old version back as an edit you can undo; the dialog closes', async () => {
  await act(async () => (items()[1] as HTMLButtonElement).click());
  await act(async () => button('Bring this version back').click());
  expect(s().text).toBe(tab('4 5 |'));
  expect(s().historyFor).toBeNull();
  s().undo();
  expect(s().text).toBe(tab('4 5 6 7 |'));
});

it('names a version (kept for good)', async () => {
  await act(async () => button('Name…').click());
  const input = host.querySelector<HTMLInputElement>('.history-name input')!;
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    set.call(input, 'before the bridge');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => button('Keep').click());
  await settle();
  expect(items()[0].querySelector('.hi-main')?.textContent).toBe('before the bridge');
  expect((await listVersions(id))[0].name).toBe('before the bridge');
});

it('a save while it’s open shows up at once (the newest “Current”, the one looked at kept)', async () => {
  await act(async () => (items()[1] as HTMLButtonElement).click());
  const { saveCurrent } = await import('../state/actions');
  await act(async () => saveCurrent());
  await settle();
  expect(items().map((b) => b.querySelector('.hi-sub')?.textContent?.split(' · ')[0])).toEqual(['Current', '1 line added, 1 removed', 'Oldest kept']);
  expect(items()[2].classList.contains('on')).toBe(true);
});

it('brought back from the Library page: the tab opens to play', async () => {
  window.confirm = () => true;
  await act(async () => {
    s().loadText(tab('other'), null);
    useApp.setState({ page: 'library', historyFor: id });
  });
  await settle();
  await act(async () => (items()[1] as HTMLButtonElement).click());
  await act(async () => button('Bring this version back').click());
  await settle();
  expect(s().docId).toBe(id);
  expect(s().text).toBe(tab('4 5 |'));
  expect(s().savedText).toBe(tab('4 5 6 |'));
  expect(s().page).toBe('play');
});

it('the name field closed: the keyboard is back on its button', async () => {
  await act(async () => button('Name…').click());
  const input = host.querySelector<HTMLInputElement>('.history-name input')!;
  await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  await settle();
  expect(document.activeElement?.textContent).toBe('Name…');
});
