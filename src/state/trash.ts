// Deleting goes to the trash, with Undo right there in the message; so do duplicating and
// restoring a backup. Only emptying the trash (or a tab's month there running out) is for good.

import { copyText, deleteTab, emptyTrash, importLibrary, isTrashed, saveTab, tabStatus, trashTab, undoImport, untrashTab, type SavedTab } from '../storage/library';
import { useApp } from './store';

const fail = (what: string, e: unknown) => useApp.getState().notify(`Couldn’t ${what}: ${(e as Error)?.message || 'storage unavailable'}`);

/** The library page reads the library again. */
export function libraryChanged() {
  useApp.setState((s) => ({ libraryRev: s.libraryRev + 1 }));
}

/** Moves a tab to the trash (Undo in the message). The open tab stays open, marked as in the trash. */
export async function moveToTrash(t: SavedTab): Promise<void> {
  try {
    await trashTab(t.id);
  } catch (e) {
    return fail('delete', e);
  }
  if (useApp.getState().docId === t.id) useApp.setState({ inTrash: true });
  libraryChanged();
  useApp.getState().notify(`Moved “${t.title}” to the trash`, { label: 'Undo', run: () => void restoreFromTrash(t) });
}

/** Takes a tab out of the trash. */
export async function restoreFromTrash(t: SavedTab): Promise<void> {
  try {
    await untrashTab(t.id);
  } catch (e) {
    return fail('restore it', e);
  }
  if (useApp.getState().docId === t.id) useApp.setState({ inTrash: false });
  libraryChanged();
  useApp.getState().notify(`Put “${t.title}” back in your library ✓`);
}

/**
 * Brings the open tab's marks up to date with the library (another window may have deleted
 * it, put it back, or the trash's month may have run out): "In trash", or, if it's gone for
 * good, a new unsaved tab. (Not when it's just missing: a library the browser cleared can be
 * recovered, under the open tab's id.)
 */
export async function checkOpenTab(): Promise<void> {
  const id = useApp.getState().docId;
  if (!id) return;
  const status = await tabStatus(id).catch(() => null);
  if (useApp.getState().docId !== id || !status) return;
  if (status === 'deleted') forget(id);
  else if (status !== 'missing') useApp.setState({ inTrash: status === 'trash' });
}

// Checked when another tab opens, and when the library changes.
let checked = '';
useApp.subscribe((s) => {
  const key = `${s.docId}:${s.libraryRev}`;
  if (key === checked) return;
  checked = key;
  void checkOpenTab();
});

/** The open tab (if it's this one) is no longer in the library: it's a new, unsaved tab. */
function forget(id: string) {
  if (useApp.getState().docId === id) useApp.setState({ docId: null, savedText: null, inTrash: false });
}

/** Deletes a tab in the trash for good (after asking). */
export async function deleteForever(t: SavedTab): Promise<void> {
  if (!window.confirm(`Delete “${t.title}” for good, with its history? This can’t be undone.`)) return;
  try {
    // (Put back meanwhile, in another window: it's not in the trash to delete.)
    if (!(await isTrashed(t.id))) {
      libraryChanged();
      return useApp.getState().notify(`“${t.title}” isn’t in the trash any more.`);
    }
    await deleteTab(t.id);
  } catch (e) {
    return fail('delete', e);
  }
  forget(t.id);
  libraryChanged();
}

/** Empties the trash (after asking). */
export async function emptyTheTrash(tabs: SavedTab[]): Promise<void> {
  if (!window.confirm(`Delete the ${tabs.length === 1 ? 'tab' : `${tabs.length} tabs`} in the trash for good, with their history? This can’t be undone.`)) return;
  try {
    await emptyTrash();
  } catch (e) {
    return fail('empty the trash', e);
  }
  for (const t of tabs) forget(t.id);
  libraryChanged();
}

/** A copy of a tab, "… (copy)" (Undo in the message). */
export async function duplicateTab(t: SavedTab): Promise<void> {
  let id: string;
  try {
    id = await saveTab(copyText(t));
  } catch (e) {
    return fail('duplicate', e);
  }
  libraryChanged();
  useApp.getState().notify(`Made a copy of “${t.title}”`, {
    label: 'Undo',
    run: () =>
      void deleteTab(id, { remember: false })
        .then(() => {
          forget(id);
          libraryChanged();
        })
        .catch((e) => fail('undo', e)),
  });
}

/** Adds a backup's tabs (Undo in the message takes them out again). */
export async function restoreBackup(files: Record<string, Uint8Array>): Promise<boolean> {
  try {
    const r = await importLibrary(files);
    const open = () => r.untrashed.some((u) => u.id === useApp.getState().docId);
    if (open()) useApp.setState({ inTrash: false });
    libraryChanged();
    const notes = [r.toTrash ? `${r.toTrash} of them into the trash` : '', r.skipped ? `${r.skipped} already in your library` : ''].filter(Boolean).join('; ');
    const history = r.versions ? `, with ${r.versions} saved version${r.versions === 1 ? '' : 's'}` : '';
    const message = `Restored ${r.added} tab${r.added === 1 ? '' : 's'}${history}${notes ? ` (${notes})` : ''} ✓`;
    useApp.getState().notify(
      message,
      r.added || r.versions
        ? {
            label: 'Undo',
            run: () =>
              void undoImport(r)
                .then(() => {
                  r.addedIds.forEach(forget);
                  if (open()) useApp.setState({ inTrash: true });
                  libraryChanged();
                })
                .catch((e) => fail('undo', e)),
          }
        : undefined,
    );
    return true;
  } catch (e) {
    useApp.getState().notify(`Couldn’t save the restored tabs: ${(e as Error).message}. Nothing was added.`);
    return false;
  }
}
