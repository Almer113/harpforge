// Saved tabs, stored locally in IndexedDB.

import Dexie, { type Table } from 'dexie';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { setMetaFields } from '../core/htab/meta';
import { parseHtab } from '../core/htab/parser';
import { harmonicaName } from '../core/instruments';
import { specFromMeta } from '../core/score';
import { DEMOS, DEMO_VERSION } from '../demo/songs';
import { savedCopies } from '../state/working';
import { versionsToDrop } from './history';

export interface SavedTab {
  id: string;
  title: string;
  harmonica: string;
  text: string;
  createdAt: number;
  updatedAt: number;
  /** When it was moved to the trash (not there: undefined). */
  deletedAt?: number;
}

/** What made a version: a save of yours, a demo brought up to date, a backup restored, a recovery. */
export type VersionKind = 'save' | 'demo' | 'import' | 'recover';

/** A tab as it was saved once (the newest is the tab as it is now). */
export interface TabVersion {
  id: string;
  tabId: string;
  at: number;
  text: string;
  title: string;
  kind: VersionKind;
  /** Named by you ("before the new chorus"): never thinned out. */
  name?: string;
}

class LibraryDB extends Dexie {
  tabs!: Table<SavedTab, string>;
  versions!: Table<TabVersion, string>;
  constructor() {
    super('harpforge');
    this.version(1).stores({ tabs: 'id, updatedAt, title' });
    // Version history: each tab's text as it is now starts its history.
    this.version(2)
      .stores({ tabs: 'id, updatedAt, title', versions: 'id, tabId, at' })
      .upgrade(async (tx) => {
        const tabs = (await tx.table('tabs').toArray()) as SavedTab[];
        await tx.table('versions').bulkAdd(tabs.map((t) => versionOf(t, 'save')));
      });
  }
}

function versionOf(t: SavedTab, kind: VersionKind): TabVersion {
  return { id: newId(), tabId: t.id, at: t.updatedAt, text: t.text, title: t.title, kind };
}

const db = new LibraryDB();

function describe(text: string): { title: string; harmonica: string } {
  const { meta } = parseHtab(text).doc;
  return { title: meta.title?.trim() || 'Untitled', harmonica: harmonicaName(specFromMeta(meta)) };
}

function newId(): string {
  return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2);
}

/** The library's tabs (not the ones in the trash), most recently changed first. */
export async function listTabs(): Promise<SavedTab[]> {
  return (await db.tabs.orderBy('updatedAt').reverse().toArray()).filter((t) => !t.deletedAt);
}

// ---- The trash ----------------------------------------------------------------------
// A deleted tab waits in the trash (with its history) for a month, then goes for good.

export const TRASH_DAYS = 30;

/** The tabs in the trash, most recently deleted first. Ones there over a month go for good first. */
export async function listTrash(now = Date.now()): Promise<SavedTab[]> {
  const all = (await db.tabs.toArray()).filter((t) => t.deletedAt);
  const old = all.filter((t) => now - t.deletedAt! > TRASH_DAYS * 86400000);
  for (const t of old) await deleteTab(t.id);
  return all.filter((t) => !old.includes(t)).sort((a, b) => b.deletedAt! - a.deletedAt!);
}

/** Moves a tab to the trash. */
export async function trashTab(id: string, at = Date.now()): Promise<void> {
  await db.tabs.update(id, { deletedAt: at });
}

/** Takes a tab out of the trash. */
export async function untrashTab(id: string): Promise<void> {
  await db.tabs.update(id, { deletedAt: undefined });
}

/** Whether a tab is in the trash (false if it's not in the library at all). */
export async function isTrashed(id: string): Promise<boolean> {
  return !!(await db.tabs.get(id))?.deletedAt;
}

/** Everything in the trash, gone for good. */
export async function emptyTrash(): Promise<void> {
  for (const t of await listTrash()) await deleteTab(t.id);
}

/** The tab was saved elsewhere (another window, a demo update) since this window last had it. */
export class SaveClash extends Error {
  constructor(public saved: SavedTab) {
    super('changed since it was opened');
  }
}

export interface SaveOptions {
  /** What made it (its version's kind). */
  kind?: VersionKind;
  /** The text this window last saved or opened: another text in the library is a SaveClash. */
  expect?: string | null;
}

/** Saves text; updates the existing entry when `id` is given and still exists. Each new text is a version. */
export async function saveTab(text: string, id?: string | null, opts: SaveOptions = {}): Promise<string> {
  return db.transaction('rw', db.tabs, db.versions, async () => {
    const now = Date.now();
    const info = describe(text);
    const existing = id ? await db.tabs.get(id) : undefined;
    if (existing) {
      if (opts.expect != null && existing.text !== opts.expect && existing.text !== text) throw new SaveClash(existing);
      // (Saving a tab that's in the trash brings it back.)
      const tab = { ...existing, ...info, text, updatedAt: now, deletedAt: undefined };
      await db.tabs.put(tab);
      if (existing.text !== text) await addVersion(tab, opts.kind ?? 'save');
      return existing.id;
    }
    const tab: SavedTab = { id: newId(), ...info, text, createdAt: now, updatedAt: now };
    await db.tabs.add(tab);
    await addVersion(tab, opts.kind ?? 'save');
    return tab.id;
  });
}

/** A tab's text now as a new version, and its old ones thinned. */
async function addVersion(tab: SavedTab, kind: VersionKind) {
  await db.versions.add(versionOf(tab, kind));
  const drop = versionsToDrop(await db.versions.where('tabId').equals(tab.id).toArray());
  if (drop.length) await db.versions.bulkDelete(drop);
}

/** A tab's versions, newest first (the first is the tab as saved now). */
export async function listVersions(tabId: string): Promise<TabVersion[]> {
  const all = await db.versions.where('tabId').equals(tabId).toArray();
  return all.sort((a, b) => b.at - a.at);
}

/** Names a version ('' unnames it). A named version is kept for good. */
export async function nameVersion(id: string, name: string): Promise<void> {
  await db.versions.update(id, { name: name.trim() || undefined });
}

/** Deletes a tab and its history for good. */
export async function deleteTab(id: string): Promise<void> {
  await db.transaction('rw', db.tabs, db.versions, async () => {
    await db.tabs.delete(id);
    await db.versions.where('tabId').equals(id).delete();
  });
  // Remembered, so recovering from working copies doesn't bring it back.
  try {
    const gone = deletedIds();
    gone.add(id);
    localStorage.setItem(DELETED_KEY, JSON.stringify([...gone].slice(-500)));
  } catch {
    /* storage unavailable */
  }
}

// ---- Recovering after the browser cleared the library ------------------------------
// Browsers may clear a site's database (low disk space) while keeping its smaller saved
// data, where each opened tab's working copy holds its last saved text.

const DELETED_KEY = 'harpforge:deleted';

function deletedIds(): Set<string> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(DELETED_KEY) ?? '[]');
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

/** Saved tabs the working copies still hold that aren't in the library (and weren't deleted). */
export async function recoverableTabs(): Promise<{ docId: string; text: string; at: number }[]> {
  let copies: { docId: string; text: string; at: number }[];
  try {
    copies = savedCopies(localStorage);
  } catch {
    return [];
  }
  const gone = deletedIds();
  const have = await db.tabs.toArray();
  const ids = new Set(have.map((t) => t.id));
  const texts = new Set(have.map((t) => t.text));
  return copies.filter((c) => !gone.has(c.docId) && !ids.has(c.docId) && !texts.has(c.text));
}

/** Puts those tabs back under their own ids (so an open one saves to the same entry), and the demos. */
export async function recoverTabs(): Promise<number> {
  const found = await recoverableTabs();
  await db.transaction('rw', db.tabs, db.versions, async () => {
    for (const c of found) {
      const tab: SavedTab = { id: c.docId, ...describe(c.text), text: c.text, createdAt: c.at, updatedAt: c.at };
      await db.tabs.put(tab);
      await db.versions.add(versionOf(tab, 'recover'));
    }
  });
  try {
    localStorage.removeItem(SEEDED_KEY);
  } catch {
    /* storage unavailable */
  }
  seeding = null;
  await seedDemos().catch(() => undefined);
  return found.length;
}

/** Asks the browser not to clear the library when space runs low (granted silently or not at all). */
export async function persistStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    return (await navigator.storage.persisted()) || (await navigator.storage.persist());
  } catch {
    return false;
  }
}

/** A copy of a tab under a new title ("… (copy)"), for duplicating. */
export function copyText(t: SavedTab): string {
  return setMetaFields(t.text, { title: `${t.title} (copy)` });
}

// eslint-disable-next-line no-control-regex
const safeName = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'tab';

interface BackupInfo {
  file: string;
  id: string;
  createdAt: number;
  updatedAt: number;
}

/** Every saved tab as .htab files in one zip, plus their ids and dates. */
export async function exportLibrary(): Promise<Uint8Array> {
  const tabs = await listTabs();
  const files: Record<string, Uint8Array> = {};
  const index: BackupInfo[] = [];
  const used = new Set<string>();
  for (const t of tabs) {
    let name = `${safeName(t.title)}.htab`;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${safeName(t.title)} (${n}).htab`;
    used.add(name.toLowerCase());
    files[name] = strToU8(t.text);
    index.push({ file: name, id: t.id, createdAt: t.createdAt, updatedAt: t.updatedAt });
  }
  files['library.json'] = strToU8(JSON.stringify({ app: 'HarpForge', version: 1, exportedAt: new Date().toISOString(), tabs: index }, null, 2));
  return zipSync(files, { level: 6 });
}

/** The .htab files (and index) in a backup zip; throws if it isn't one. macOS "__MACOSX" extras are left out. */
export function readBackup(zip: Uint8Array): Record<string, Uint8Array> {
  const files = unzipSync(zip, { filter: (f) => !f.name.startsWith('__MACOSX/') && !/(^|\/)\._/.test(f.name) });
  if (!Object.keys(files).some((n) => /\.htab$/i.test(n))) throw new Error('no .htab files in it');
  return files;
}

/**
 * Restores a library backup (the files from `readBackup`). Tabs whose text is already
 * in the library are skipped; one with a known id but other text is added as a new
 * tab. All or nothing: a storage error adds none. Returns how many were added.
 */
export interface Restored {
  added: number;
  skipped: number;
  /** The tabs it added, and the ones it took out of the trash (with when they'd been deleted): for an undo. */
  addedIds: string[];
  untrashed: { id: string; deletedAt: number }[];
}

export async function importLibrary(files: Record<string, Uint8Array>): Promise<Restored> {
  const byFile = new Map<string, BackupInfo>();
  try {
    if (files['library.json']) for (const t of JSON.parse(strFromU8(files['library.json'])).tabs ?? []) byFile.set(t.file, t);
  } catch {
    /* a plain zip of tabs */
  }
  const names = Object.keys(files).filter((n) => /\.htab$/i.test(n));
  let added = 0;
  let skipped = 0;
  const addedIds: string[] = [];
  const untrashed: Restored['untrashed'] = [];
  await db.transaction('rw', db.tabs, db.versions, async () => {
    const existing = await db.tabs.toArray();
    const texts = new Set(existing.map((t) => t.text));
    const ids = new Set(existing.map((t) => t.id));
    for (const name of names) {
      const text = strFromU8(files[name]);
      if (texts.has(text)) {
        // In the trash: the backup brings it back.
        const trashed = existing.find((t) => t.text === text && t.deletedAt && !untrashed.some((u) => u.id === t.id));
        if (trashed) {
          await db.tabs.update(trashed.id, { deletedAt: undefined });
          untrashed.push({ id: trashed.id, deletedAt: trashed.deletedAt! });
          added++;
        } else skipped++;
        continue;
      }
      const info = byFile.get(name);
      const now = Date.now();
      const id = info && !ids.has(info.id) ? info.id : newId();
      const tab: SavedTab = { id, ...describe(text), text, createdAt: info?.createdAt ?? now, updatedAt: info?.updatedAt ?? now };
      await db.tabs.add(tab);
      await db.versions.add(versionOf(tab, 'import'));
      texts.add(text);
      ids.add(id);
      addedIds.push(id);
      added++;
    }
  });
  return { added, skipped, addedIds, untrashed };
}

/** Undoes a restored backup: the tabs it added go, the ones it took out of the trash go back. */
export async function undoImport(r: Restored): Promise<void> {
  for (const id of r.addedIds) await deleteTab(id);
  for (const u of r.untrashed) await trashTab(u.id, u.deletedAt);
}

const SEEDED_KEY = 'harpforge:seeded';

let seeding: Promise<Map<string, string>> | null = null;

/** Adds demo songs on first launch, and any demos added since the last visit (once, even if called twice). */
/** Adds the demos new since last time; resolves to the tabs brought up to date (id → new text). */
export function seedDemos(): Promise<Map<string, string>> {
  // A failure (storage blocked) is forgotten, so a later call can try again.
  seeding ??= seedOnce().catch((e) => {
    seeding = null;
    throw e;
  });
  return seeding;
}

async function seedOnce(): Promise<Map<string, string>> {
  const updated = new Map<string, string>();
  let seen = 0;
  try {
    seen = parseInt(localStorage.getItem(SEEDED_KEY) ?? '0', 10) || 0;
    if (seen >= DEMO_VERSION) return updated;
  } catch {
    return updated;
  }
  const fresh = DEMOS.filter((d) => d.since > seen);
  await db.transaction('rw', db.tabs, db.versions, async () => {
    const tabs = await db.tabs.toArray();
    const have = new Set(tabs.map((t) => t.text));
    for (const d of [...fresh].reverse()) {
      if (have.has(d.text)) continue;
      // A demo brought up to date: an unchanged copy of its old version is updated in place
      // (one you've changed is yours, and stays as it is beside the new one).
      const old = tabs.find((t) => d.replaces?.includes(t.text));
      // (Had before, and not there as it was: deleted, or changed — yours, so it isn't added again.)
      if (!old && d.first !== undefined && seen >= d.first) continue;
      await saveTab(d.text, old?.id, { kind: 'demo' });
      if (old) {
        // (Not a change of yours: it keeps its place in "Recently changed".)
        await db.tabs.update(old.id, { updatedAt: old.updatedAt });
        updated.set(old.id, d.text);
      }
    }
  });
  // Only remember the demos once they're really in the library.
  try {
    localStorage.setItem(SEEDED_KEY, String(DEMO_VERSION));
  } catch {
    /* storage unavailable */
  }
  return updated;
}
