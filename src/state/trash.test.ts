// @vitest-environment happy-dom
// Phase 13c: deleting to the trash with Undo in the message; the open tab marked as in the
// trash until it's put back or saved; Undo after duplicating and after restoring a backup.

import 'fake-indexeddb/auto';
import { strToU8 } from 'fflate';
import { expect, it, vi } from 'vitest';

vi.mock('../audio/engine', async () => (await import('../test/fakeEngine')).fakeEngine());

import { isTrashed, listTabs, saveTab } from '../storage/library';
import { saveCurrent } from './actions';
import { useApp } from './store';
import { deleteForever, duplicateTab, moveToTrash, restoreBackup } from './trash';

const tab = (title: string, body = '4 5 |') => `---\ntitle: ${title}\n---\n${body}\n`;
const s = () => useApp.getState();
const find = async (id: string) => (await listTabs()).find((t) => t.id === id)!;
const undo = async () => {
  s().toast!.action!.run();
  await new Promise((r) => setTimeout(r, 30));
};

it('deleting the open tab: to the trash, the tab stays open marked “in trash”; Undo puts it back', async () => {
  const id = await saveTab(tab('Open one'));
  s().loadText(tab('Open one'), id, true);
  const rev = s().libraryRev;
  await moveToTrash(await find(id));
  expect(await isTrashed(id)).toBe(true);
  expect(s().inTrash).toBe(true);
  expect(s().docId).toBe(id);
  expect(s().libraryRev).toBeGreaterThan(rev);
  expect(s().toast?.message).toBe('Moved “Open one” to the trash');
  expect(s().toast?.action?.label).toBe('Undo');
  await undo();
  expect(await isTrashed(id)).toBe(false);
  expect(s().inTrash).toBe(false);
});

it('saving the open tab that’s in the trash puts it back', async () => {
  const id = await saveTab(tab('Saved back'));
  s().loadText(tab('Saved back'), id, true);
  await moveToTrash(await find(id));
  s().setText(tab('Saved back', '6 |'));
  await saveCurrent();
  expect(await isTrashed(id)).toBe(false);
  expect(s().inTrash).toBe(false);
});

it('deleted for good (after asking): the open tab becomes a new, unsaved one', async () => {
  const id = await saveTab(tab('Gone'));
  s().loadText(tab('Gone'), id, true);
  await moveToTrash(await find(id));
  window.confirm = vi.fn(() => true);
  const t = { id, title: 'Gone', harmonica: '', text: '', createdAt: 0, updatedAt: 0 };
  await deleteForever(t);
  expect(s().docId).toBeNull();
  expect(s().inTrash).toBe(false);
  expect(await isTrashed(id)).toBe(false);
});

it('Undo after duplicating takes the copy away', async () => {
  const id = await saveTab(tab('Dup'));
  await duplicateTab(await find(id));
  expect((await listTabs()).some((t) => t.title === 'Dup (copy)')).toBe(true);
  await undo();
  expect((await listTabs()).some((t) => t.title === 'Dup (copy)')).toBe(false);
});

it('Undo after restoring a backup takes its tabs away again', async () => {
  await restoreBackup({ 'x.htab': strToU8(tab('From backup')) });
  expect(s().toast?.message).toBe('Restored 1 tab ✓');
  expect((await listTabs()).some((t) => t.title === 'From backup')).toBe(true);
  await undo();
  expect((await listTabs()).some((t) => t.title === 'From backup')).toBe(false);
});
