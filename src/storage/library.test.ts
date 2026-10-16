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

describe('backups with history and the trash', () => {
  it('a full backup has the trash (in a Trash folder) and the history; a plain one neither', async () => {
    const id = await lib.saveTab(tab('Full', '4 |'));
    await lib.saveTab(tab('Full', '5 |'), id);
    const binned = await lib.saveTab(tab('Binned full'));
    await lib.trashTab(binned);
    const plain = lib.readBackup(await lib.exportLibrary());
    expect(Object.keys(plain).some((n) => n.startsWith('Trash/'))).toBe(false);
    expect(plain['history.json']).toBeUndefined();
    const full = lib.readBackup(await lib.exportLibrary({ full: true }));
    expect(Object.keys(full)).toContain('Trash/Binned full.htab');
    const versions = JSON.parse(new TextDecoder().decode(full['history.json'])).versions as { tabId: string; text: string }[];
    expect(versions.filter((v) => v.tabId === id).map((v) => v.text)).toEqual([tab('Full', '4 |'), tab('Full', '5 |')]);
  });

  it('restored into an empty library: the tabs, the trash and the history come back; again, nothing doubles', async () => {
    const id = await lib.saveTab(tab('Round trip', '4 |'));
    await lib.saveTab(tab('Round trip', '5 |'), id);
    const binned = await lib.saveTab(tab('Round trip binned'));
    await lib.trashTab(binned);
    const zip = lib.readBackup(await lib.exportLibrary({ full: true }));
    // (As if on another computer: those tabs gone.)
    await lib.deleteTab(id);
    await lib.deleteTab(binned);
    const r = await lib.importLibrary(zip);
    expect(r.toTrash).toBe(1);
    expect(await lib.isTrashed(binned)).toBe(true);
    expect((await lib.listVersions(id)).map((v) => [v.text, v.kind])).toEqual([
      [tab('Round trip', '5 |'), 'save'],
      [tab('Round trip', '4 |'), 'save'],
    ]);
    const again = await lib.importLibrary(zip);
    expect([again.added, again.versions]).toEqual([0, 0]);
    expect(await lib.listVersions(id)).toHaveLength(2);
  });

  it('history for a tab already in the library joins its history; undo takes it out again', async () => {
    const id = await lib.saveTab(tab('Joined', '4 |'));
    await lib.saveTab(tab('Joined', '5 |'), id);
    const zip = lib.readBackup(await lib.exportLibrary({ full: true }));
    // Here, the tab's history was lost (only its text now).
    const here = await lib.saveTab(tab('Joined', '5 |'));
    await lib.deleteTab(id);
    const r = await lib.importLibrary(zip);
    expect(r.added).toBe(0);
    expect((await lib.listVersions(here)).length).toBe(3);
    await lib.undoImport(r);
    expect((await lib.listVersions(here)).length).toBe(1);
  });

  it('says how big the library is', async () => {
    const s = await lib.libraryStats();
    expect(s.tabs).toBe((await lib.listTabs()).length);
    expect(s.trashed).toBe((await lib.listTrash()).length);
    expect(s.versions).toBeGreaterThan(s.tabs);
    expect(s.bytes).toBeGreaterThan(0);
  });
});

describe('the review’s cases', () => {
  const full = async () => lib.readBackup(await lib.exportLibrary({ full: true }));
  const json = (o: unknown) => strToU8(JSON.stringify(o));

  it('a backup restored after its tab changed: the old copy comes back with its history', async () => {
    const id = await lib.saveTab(tab('Changed since', '4 |'));
    await lib.saveTab(tab('Changed since', '5 |'), id);
    const zip = await full();
    await lib.saveTab(tab('Changed since', '6 |'), id);
    await lib.importLibrary(zip);
    const copy = (await lib.listTabs()).find((t) => t.text === tab('Changed since', '5 |'))!;
    expect(copy.id).not.toBe(id);
    expect((await lib.listVersions(copy.id)).map((v) => v.text)).toEqual([tab('Changed since', '5 |'), tab('Changed since', '4 |')]);
    // (The original keeps its own.)
    expect(await lib.listVersions(id)).toHaveLength(3);
  });

  it('a backup’s trash comes back with a month to go (not purged at once)', async () => {
    const r = await lib.importLibrary({
      'Trash/Old bin.htab': strToU8(tab('Old bin')),
      'library.json': json({ tabs: [{ file: 'Trash/Old bin.htab', id: 'oldbin', createdAt: 1, updatedAt: 2, deletedAt: Date.now() - 40 * DAY }] }),
    });
    expect(r.toTrash).toBe(1);
    expect((await lib.listTrash()).map((t) => t.id)).toContain('oldbin');
  });

  it('a backup’s odd entries: one without an id is still restored; bad history is made sound', async () => {
    const r = await lib.importLibrary({
      'Odd.htab': strToU8(tab('Odd', '7 |')),
      'library.json': json({ tabs: [{ file: 'Odd.htab', createdAt: 'x' }, { file: 'Other.htab', id: 'h1' }] }),
      'History2.htab': strToU8(tab('With history', '8 |')),
      'history.json': json({ versions: [{ id: 'bad1', tabId: 'h2', at: 5, text: tab('With history', '8 |'), name: { x: 1 }, kind: 'weird' }] }),
    });
    expect(r.added).toBe(2);
    const odd = (await lib.listTabs()).find((t) => t.title === 'Odd')!;
    expect(typeof odd.createdAt).toBe('number');
    // (history.json's tab isn't in library.json: its versions aren't anyone's.)
    expect(r.versions).toBe(0);
  });

  it('a restored version with no usable title or kind, or an object for a name, gets sound ones', async () => {
    await lib.importLibrary({
      'S.htab': strToU8(tab('Sound', '4 |')),
      'library.json': json({ tabs: [{ file: 'S.htab', id: 'sound1', createdAt: 1, updatedAt: 1 }] }),
      'history.json': json({ versions: [{ id: 'sv1', tabId: 'sound1', at: 1, text: tab('Sound', '4 |'), name: { x: 1 }, kind: 'weird' }] }),
    });
    const [v] = await lib.listVersions('sound1');
    expect([v.title, v.kind, v.name]).toEqual(['Sound', 'import', undefined]);
  });

  it('a backup with only older history of a tab: its own text is still its newest version', async () => {
    await lib.importLibrary({
      'P.htab': strToU8(tab('Partial', '9 |')),
      'library.json': json({ tabs: [{ file: 'P.htab', id: 'part1', createdAt: 1, updatedAt: 10 }] }),
      'history.json': json({ versions: [{ id: 'pv1', tabId: 'part1', at: 5, title: 'Partial', kind: 'save', text: tab('Partial', '8 |') }] }),
    });
    const v = await lib.listVersions('part1');
    expect(v.map((x) => x.text)).toEqual([tab('Partial', '9 |'), tab('Partial', '8 |')]);
  });

  it('a backup’s tab that’s in the library and also in the trash: the trashed copy stays there', async () => {
    const active = await lib.saveTab(tab('Twice'));
    const binned = await lib.saveTab(tab('Twice'));
    await lib.trashTab(binned);
    const r = await lib.importLibrary({ 't.htab': strToU8(tab('Twice')) });
    expect(r.skipped).toBe(1);
    expect(await lib.isTrashed(binned)).toBe(true);
    expect(await lib.isTrashed(active)).toBe(false);
  });

  it('where a tab is: library, trash, deleted for good, or just missing', async () => {
    const id = await lib.saveTab(tab('Where'));
    expect(await lib.tabStatus(id)).toBe('library');
    await lib.trashTab(id);
    expect(await lib.tabStatus(id)).toBe('trash');
    await lib.deleteTab(id);
    expect(await lib.tabStatus(id)).toBe('deleted');
    expect(await lib.tabStatus('never-here')).toBe('missing');
    // An undo's delete isn't remembered as yours.
    const undone = await lib.saveTab(tab('Undone'));
    await lib.deleteTab(undone, { remember: false });
    expect(await lib.tabStatus(undone)).toBe('missing');
  });

  it('a demo update leaves a demo you put in the trash there', async () => {
    const { RIVER_SONG } = await import('../demo/songs');
    // (An old tour, as version 5 had it, in the trash; then the update to version 6.)
    const v5 = RIVER_SONG.replace(/# Save a change[^\n]*\n# back;[^\n]*\n/, '');
    const id = await lib.saveTab(v5);
    await lib.trashTab(id);
    localStorage.setItem('harpforge:seeded', '5');
    await lib.seedDemos();
    expect(await lib.isTrashed(id)).toBe(true);
    expect((await lib.listTabs()).some((t) => t.text === RIVER_SONG)).toBe(false);
  });
});
