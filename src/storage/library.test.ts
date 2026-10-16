// @vitest-environment happy-dom
// Phase 13a: each save keeps a version; old ones are thinned; a save over another window's
// is noticed; a library from before history gets its first versions.

import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { strToU8 } from 'fflate';
import { beforeAll, describe, expect, it } from 'vitest';
import { versionsToDrop } from './history';

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const tab = (title: string, body = '4 5 6 |') => `---\ntitle: ${title}\n---\n${body}\n`;

let lib: typeof import('./library');

beforeAll(async () => {
  // A library as it was before version history (database version 1), with one tab in it.
  const old = new Dexie('harpforge');
  old.version(1).stores({ tabs: 'id, updatedAt, title' });
  await old.table('tabs').add({ id: 'old1', title: 'Old', harmonica: 'C diatonic', text: tab('Old'), createdAt: 5, updatedAt: 7 });
  old.close();
  lib = await import('./library');
});

describe('versions', () => {
  it('a library from before history: each tab’s text is its first version', async () => {
    const v = await lib.listVersions('old1');
    expect(v.map((x) => [x.text, x.at, x.kind])).toEqual([[tab('Old'), 7, 'save']]);
  });

  it('each save with new text is a version, newest first (the same text again isn’t)', async () => {
    const id = await lib.saveTab(tab('A', '4 |'));
    await lib.saveTab(tab('A', '4 |'), id);
    await lib.saveTab(tab('A', '5 |'), id);
    const v = await lib.listVersions(id);
    expect(v.map((x) => x.text)).toEqual([tab('A', '5 |'), tab('A', '4 |')]);
    expect(v[0].title).toBe('A');
  });

  it('a version can be named (and unnamed)', async () => {
    const id = await lib.saveTab(tab('N'));
    const [v] = await lib.listVersions(id);
    await lib.nameVersion(v.id, '  before the chorus ');
    expect((await lib.listVersions(id))[0].name).toBe('before the chorus');
    await lib.nameVersion(v.id, '');
    expect((await lib.listVersions(id))[0].name).toBeUndefined();
  });

  it('deleting a tab deletes its versions', async () => {
    const id = await lib.saveTab(tab('D'));
    await lib.deleteTab(id);
    expect(await lib.listVersions(id)).toEqual([]);
  });

  it('a restored backup’s tabs start with an “import” version', async () => {
    await lib.importLibrary({ 'B.htab': strToU8(tab('Backed up')) });
    const t = (await lib.listTabs()).find((x) => x.title === 'Backed up')!;
    expect((await lib.listVersions(t.id))[0].kind).toBe('import');
  });
});

describe('saving over another window’s save', () => {
  it('noticed when the library has other text than this window last had', async () => {
    const id = await lib.saveTab(tab('W', '4 |'));
    // Another window saves…
    await lib.saveTab(tab('W', '6 |'), id);
    // …and this one, which still had "4 |", saves its own.
    await expect(lib.saveTab(tab('W', '5 |'), id, { expect: tab('W', '4 |') })).rejects.toBeInstanceOf(lib.SaveClash);
    expect((await lib.listTabs()).find((t) => t.id === id)?.text).toBe(tab('W', '6 |'));
    // Saved over it anyway: the other window's text stays in the history.
    await lib.saveTab(tab('W', '5 |'), id);
    expect((await lib.listVersions(id)).map((v) => v.text)).toEqual([tab('W', '5 |'), tab('W', '6 |'), tab('W', '4 |')]);
  });

  it('no clash when nothing else saved it (or it already has the same text)', async () => {
    const id = await lib.saveTab(tab('X', '4 |'));
    await lib.saveTab(tab('X', '5 |'), id, { expect: tab('X', '4 |') });
    await lib.saveTab(tab('X', '5 |'), id, { expect: tab('X', '4 |') });
    expect((await lib.listVersions(id)).length).toBe(2);
  });
});

describe('thinning', () => {
  const now = new Date(2026, 9, 16, 12).getTime();
  const v = (id: string, ago: number, name?: string) => ({ id, at: now - ago, name });

  it('keeps every save from the last day', () => {
    expect(versionsToDrop([v('a', 1 * HOUR), v('b', 2 * HOUR), v('c', 20 * HOUR)], now)).toEqual([]);
  });

  it('then the last of each day for a month, then the last of each week', () => {
    const drop = versionsToDrop(
      [
        v('new', 0),
        // Three days ago: two saves, the later kept.
        v('d3late', 3 * DAY),
        v('d3early', 3 * DAY + 2 * HOUR),
        // Two months ago, the same week (a Friday and the Sunday after): one kept, the latest.
        v('wWed', 61 * DAY),
        v('wMon', 63 * DAY),
      ],
      now,
    );
    expect(drop.sort()).toEqual(['d3early', 'wMon']);
  });

  it('never drops a named version, or the newest', () => {
    expect(versionsToDrop([v('only', 90 * DAY)], now)).toEqual([]);
    expect(versionsToDrop([v('new', 0), v('a', 3 * DAY), v('b', 3 * DAY + HOUR, 'mine')], now)).toEqual([]);
  });
});

describe('the trash', () => {
  it('a deleted tab leaves the library for the trash, with its history; it can be put back', async () => {
    const id = await lib.saveTab(tab('T', '4 |'));
    await lib.saveTab(tab('T', '5 |'), id);
    await lib.trashTab(id);
    expect((await lib.listTabs()).some((t) => t.id === id)).toBe(false);
    expect((await lib.listTrash()).map((t) => t.id)).toContain(id);
    expect(await lib.isTrashed(id)).toBe(true);
    expect(await lib.listVersions(id)).toHaveLength(2);
    await lib.untrashTab(id);
    expect((await lib.listTabs()).some((t) => t.id === id)).toBe(true);
    expect(await lib.isTrashed(id)).toBe(false);
  });

  it('saving a tab that’s in the trash puts it back', async () => {
    const id = await lib.saveTab(tab('S', '4 |'));
    await lib.trashTab(id);
    await lib.saveTab(tab('S', '5 |'), id);
    expect(await lib.isTrashed(id)).toBe(false);
  });

  it('after a month there it goes for good (history too); emptying the trash too', async () => {
    const old = await lib.saveTab(tab('Old one'));
    const recent = await lib.saveTab(tab('Recent one'));
    await lib.trashTab(old, Date.now() - 31 * DAY);
    await lib.trashTab(recent);
    const left = (await lib.listTrash()).map((t) => t.id);
    expect(left).toContain(recent);
    expect(left).not.toContain(old);
    expect(await lib.listVersions(old)).toEqual([]);
    await lib.emptyTrash();
    expect(await lib.listTrash()).toEqual([]);
    expect(await lib.isTrashed(recent)).toBe(false);
  });

  it('a backup with a tab that’s in the trash brings it back; undoing the restore puts things as they were', async () => {
    const inTrash = await lib.saveTab(tab('Binned'));
    const when = Date.now() - 5 * DAY;
    await lib.trashTab(inTrash, when);
    const r = await lib.importLibrary({ 'a.htab': strToU8(tab('Binned')), 'b.htab': strToU8(tab('Brand new')) });
    expect([r.added, r.skipped]).toEqual([2, 0]);
    expect(await lib.isTrashed(inTrash)).toBe(false);
    await lib.undoImport(r);
    expect(await lib.isTrashed(inTrash)).toBe(true);
    expect((await lib.listTrash()).find((t) => t.id === inTrash)?.deletedAt).toBe(when);
    expect((await lib.listTabs()).some((t) => t.title === 'Brand new')).toBe(false);
  });
});
