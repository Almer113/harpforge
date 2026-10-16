// Saved tabs: the library, with each tab's history and the trash. Kept in this browser (a
// guest) or on the HarpForge server (an account): see setLibraryBackend.

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { setMetaFields } from '../core/htab/meta';
import { parseHtab } from '../core/htab/parser';
import { harmonicaName } from '../core/instruments';
import { specFromMeta } from '../core/score';
import { DEMOS, DEMO_VERSION } from '../demo/songs';
import { savedCopies } from '../state/working';
import { versionsToDrop } from './history';
import { browserBackend } from './local';
import { BackendClash, type LibraryBackend, type SavedTab, type TabVersion, type VersionKind } from './types';

export type { SavedTab, TabVersion, VersionKind } from './types';

// ---- Where the library is kept ------------------------------------------------------

let browser: LibraryBackend | null = null;
let current: LibraryBackend | null = null;
let ready: Promise<unknown> = Promise.resolve();

/** The library in use (once it's been chosen; this browser's until then). */
async function lib(): Promise<LibraryBackend> {
  await ready;
  return (current ??= browser ??= browserBackend());
}

/** Uses this storage for the library from now on (null: this browser's). */
export function setLibraryBackend(b: LibraryBackend | null) {
  current = b ?? (browser ??= browserBackend());
  seeding = null;
}

/** The library waits for this before it's used (deciding whose it is: an account's, or this browser's). */
export function libraryWaitsFor(p: Promise<unknown>) {
  ready = p.catch(() => undefined);
}

/** This browser's library (a guest's), whichever is in use. */
export function browserLibrary(): LibraryBackend {
  return (browser ??= browserBackend());
}

/** Whose library is in use: this browser's (a guest) or an account's. */
export async function libraryKind(): Promise<LibraryBackend['kind']> {
  return (await lib()).kind;
}

function versionOf(t: SavedTab, kind: VersionKind): TabVersion {
  return { id: newId(), tabId: t.id, at: t.updatedAt, text: t.text, title: t.title, kind };
}

/** A tab without a field (its trash mark, say). */
function without<T extends object, K extends keyof T>(o: T, key: K): Omit<T, K> {
  const copy = { ...o };
  delete copy[key];
  return copy;
}

function describe(text: string): { title: string; harmonica: string } {
  const { meta } = parseHtab(text).doc;
  return { title: meta.title?.trim() || 'Untitled', harmonica: harmonicaName(specFromMeta(meta)) };
}

function newId(): string {
  return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2);
}

/** The library's tabs (not the ones in the trash), most recently changed first. */
export async function listTabs(): Promise<SavedTab[]> {
  return (await (await lib()).tabs.all()).filter((t) => !t.deletedAt).sort((a, b) => b.updatedAt - a.updatedAt);
}

// ---- The trash ----------------------------------------------------------------------
// A deleted tab waits in the trash (with its history) for a month, then goes for good.

export const TRASH_DAYS = 30;

/** The tabs in the trash, most recently deleted first. Ones there over a month go for good first. */
export async function listTrash(now = Date.now()): Promise<SavedTab[]> {
  const all = (await (await lib()).tabs.all()).filter((t) => t.deletedAt);
  const old = all.filter((t) => now - t.deletedAt! > TRASH_DAYS * 86400000);
  for (const t of old) await deleteTab(t.id);
  return all.filter((t) => !old.includes(t)).sort((a, b) => b.deletedAt! - a.deletedAt!);
}

/** Moves a tab to the trash. */
export async function trashTab(id: string, at = Date.now()): Promise<void> {
  await setDeleted(await lib(), id, at);
}

/** Takes a tab out of the trash. */
export async function untrashTab(id: string): Promise<void> {
  await setDeleted(await lib(), id, undefined);
}

async function setDeleted(b: LibraryBackend, id: string, deletedAt: number | undefined) {
  const t = await b.tabs.get(id);
  if (!t) return;
  const rest = without(t, 'deletedAt');
  await b.tabs.put(deletedAt === undefined ? rest : { ...rest, deletedAt });
}

/** Whether a tab is in the trash (false if it's not in the library at all). */
export async function isTrashed(id: string): Promise<boolean> {
  return !!(await (await lib()).tabs.get(id))?.deletedAt;
}

/**
 * Where a tab is: in the library, in the trash, deleted for good (here, or by the trash
 * running out), or simply not there (a library the browser cleared: recoverable).
 */
export async function tabStatus(id: string): Promise<'library' | 'trash' | 'deleted' | 'missing'> {
  const b = await lib();
  const t = await b.tabs.get(id);
  if (t) return t.deletedAt ? 'trash' : 'library';
  // (An account's library isn't cleared behind its back: not there is deleted.)
  return b.kind === 'account' || deletedIds().has(id) ? 'deleted' : 'missing';
}

/** One tab as it is in the library now (undefined if it isn't there). */
export async function getTab(id: string): Promise<SavedTab | undefined> {
  return (await lib()).tabs.get(id);
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
  const b = await lib();
  return b.transaction(() => saveIn(b, text, id, opts));
}

async function saveIn(b: LibraryBackend, text: string, id: string | null | undefined, opts: SaveOptions): Promise<string> {
  const now = Date.now();
  const info = describe(text);
  const existing = id ? await b.tabs.get(id) : undefined;
  if (existing) {
    if (opts.expect != null && existing.text !== opts.expect && existing.text !== text) throw new SaveClash(existing);
    // (Saving a tab that's in the trash brings it back.)
    const tab: SavedTab = { ...without(existing, 'deletedAt'), ...info, text, updatedAt: now };
    try {
      // (Only over the text just read: if something saved it in between — another device — that's a clash too.)
      await b.tabs.put(tab, existing.text);
    } catch (e) {
      if (e instanceof BackendClash) throw new SaveClash(e.saved);
      throw e;
    }
    if (existing.text !== text) await addVersion(b, tab, opts.kind ?? 'save');
    return existing.id;
  }
  const tab: SavedTab = { id: newId(), ...info, text, createdAt: now, updatedAt: now };
  await b.tabs.put(tab);
  await addVersion(b, tab, opts.kind ?? 'save');
  return tab.id;
}

/** A tab's text now as a new version, and its old ones thinned. */
async function addVersion(b: LibraryBackend, tab: SavedTab, kind: VersionKind) {
  const before = await b.versions.ofTab(tab.id);
  // (After the one before, even two saves in the same millisecond: newest first stays newest.)
  const at = Math.max(tab.updatedAt, ...before.map((v) => v.at + 1));
  const added = { ...versionOf(tab, kind), at };
  await b.versions.add([added]);
  const drop = versionsToDrop([...before, added]);
  if (drop.length) await b.versions.delete(drop);
}

/** A tab's versions, newest first (the first is the tab as saved now). */
export async function listVersions(tabId: string): Promise<TabVersion[]> {
  const all = await (await lib()).versions.ofTab(tabId);
  return all.sort((a, b) => b.at - a.at);
}

/** Names a version ('' unnames it). A named version is kept for good. */
export async function nameVersion(id: string, name: string): Promise<void> {
  const b = await lib();
  const v = await b.versions.get(id);
  if (!v) return;
  const named = name.trim();
  await b.versions.put(named ? { ...v, name: named } : without(v, 'name'));
}

/** Deletes a tab and its history for good. */
export async function deleteTab(id: string, opts: { remember?: boolean } = {}): Promise<void> {
  const b = await lib();
  await b.transaction(async () => {
    await b.tabs.delete(id);
    await b.versions.deleteOfTab(id);
  });
  // Remembered, so recovering from working copies doesn't bring it back. (Not when an undo
  // takes out a tab it had just added: that's as if it never was. Only this browser's
  // library is recovered so.)
  if (opts.remember === false || b.kind !== 'browser') return;
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
  const b = await lib();
  // (Only this browser's library can be cleared by the browser.)
  if (b.kind !== 'browser') return [];
  let copies: { docId: string; text: string; at: number }[];
  try {
    copies = savedCopies(localStorage);
  } catch {
    return [];
  }
  const gone = deletedIds();
  const have = await b.tabs.all();
  const ids = new Set(have.map((t) => t.id));
  const texts = new Set(have.map((t) => t.text));
  return copies.filter((c) => !gone.has(c.docId) && !ids.has(c.docId) && !texts.has(c.text));
}

/** Puts those tabs back under their own ids (so an open one saves to the same entry), and the demos. */
export async function recoverTabs(): Promise<number> {
  const found = await recoverableTabs();
  const b = await lib();
  await b.transaction(async () => {
    for (const c of found) {
      const tab: SavedTab = { id: c.docId, ...describe(c.text), text: c.text, createdAt: c.at, updatedAt: c.at };
      await b.tabs.put(tab);
      await b.versions.add([versionOf(tab, 'recover')]);
    }
  });
  await b.meta.set(SEEDED_KEY, null);
  seeding = null;
  await seedDemos().catch(() => undefined);
  return found.length;
}

/** Asks the browser not to clear the library when space runs low (granted silently or not at all). */
export async function persistStorage(): Promise<boolean> {
  try {
    if ((await lib()).kind !== 'browser' || !navigator.storage?.persist) return false;
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
  /** In the trash since then (a full backup's "Trash/" files). */
  deletedAt?: number;
}

/**
 * Every saved tab as .htab files in one zip, plus their ids and dates. A full backup also
 * has the trash (in a "Trash" folder) and every tab's history (history.json).
 */
export async function exportLibrary(opts: { full?: boolean; from?: LibraryBackend } = {}): Promise<Uint8Array> {
  const b = opts.from ?? (await lib());
  const all = await b.tabs.all();
  const tabs = all.filter((t) => opts.full || !t.deletedAt).sort((x, y) => (x.deletedAt ?? 0) - (y.deletedAt ?? 0) || y.updatedAt - x.updatedAt);
  const files: Record<string, Uint8Array> = {};
  const index: BackupInfo[] = [];
  const used = new Set<string>();
  for (const t of tabs) {
    const dir = t.deletedAt ? 'Trash/' : '';
    let name = `${dir}${safeName(t.title)}.htab`;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${dir}${safeName(t.title)} (${n}).htab`;
    used.add(name.toLowerCase());
    files[name] = strToU8(t.text);
    index.push({ file: name, id: t.id, createdAt: t.createdAt, updatedAt: t.updatedAt, ...(t.deletedAt ? { deletedAt: t.deletedAt } : {}) });
  }
  if (opts.full) {
    const ids = new Set(tabs.map((t) => t.id));
    const versions = (await b.versions.all()).filter((v) => ids.has(v.tabId)).sort((x, y) => x.at - y.at);
    files['history.json'] = strToU8(JSON.stringify({ versions }));
  }
  files['library.json'] = strToU8(JSON.stringify({ app: 'HarpForge', version: opts.full ? 2 : 1, exportedAt: new Date().toISOString(), tabs: index }, null, 2));
  return zipSync(files, { level: 6 });
}

/** How big the library is: its tabs, the trash, the saved versions, and roughly how many bytes. */
export async function libraryStats(): Promise<{ tabs: number; trashed: number; versions: number; bytes: number }> {
  const b = await lib();
  const tabs = await b.tabs.all();
  const versions = await b.versions.all();
  const size = (s: string) => strToU8(s).length;
  const bytes = tabs.reduce((n, t) => n + size(t.text), 0) + versions.reduce((n, v) => n + size(v.text), 0);
  const trashed = tabs.filter((t) => t.deletedAt).length;
  return { tabs: tabs.length - trashed, trashed, versions: versions.length, bytes };
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
 * tab. All or nothing in this browser's library (a storage error adds none). Returns how
 * many were added.
 */
export interface Restored {
  added: number;
  skipped: number;
  /** Of those added, how many went into the trash (a full backup's trash). */
  toTrash: number;
  /** Saved versions it brought (a full backup's history). */
  versions: number;
  /** Versions it added to tabs that were already in the library: for an undo. */
  addedVersionIds: string[];
  /** The tabs it added, and the ones it took out of the trash (with when they'd been deleted): for an undo. */
  addedIds: string[];
  untrashed: { id: string; deletedAt: number }[];
}

export async function importLibrary(files: Record<string, Uint8Array>, opts: { into?: LibraryBackend } = {}): Promise<Restored> {
  const byFile = new Map<string, BackupInfo>();
  try {
    if (files['library.json']) {
      for (const t of JSON.parse(strFromU8(files['library.json'])).tabs ?? []) {
        const info = cleanInfo(t);
        if (info) byFile.set(info.file, info);
      }
    }
  } catch {
    /* a plain zip of tabs */
  }
  // A full backup's history: each tab's saved versions (by the tab's id in the backup).
  let history: TabVersion[] = [];
  try {
    if (files['history.json']) history = ((JSON.parse(strFromU8(files['history.json'])).versions ?? []) as unknown[]).map(cleanVersion).filter((v) => v !== null);
  } catch {
    /* no history, or not readable: the tabs still come back */
  }
  const names = Object.keys(files).filter((n) => /\.htab$/i.test(n));
  let added = 0;
  let skipped = 0;
  let toTrash = 0;
  let versions = 0;
  const addedIds: string[] = [];
  const addedVersionIds: string[] = [];
  const untrashed: Restored['untrashed'] = [];
  /** The backup's tab ids → the library's (the tab added, or the one already there with its text). */
  const mapped = new Map<string, string>();
  const fresh = new Map<string, SavedTab>();
  const b = opts.into ?? (await lib());
  await b.transaction(async () => {
    const existing = await b.tabs.all();
    const texts = new Set(existing.map((t) => t.text));
    const ids = new Set(existing.map((t) => t.id));
    for (const name of names) {
      const text = strFromU8(files[name]);
      const info = byFile.get(name);
      // (In the backup's trash: into the trash, its month starting now.)
      const intoTrash = info?.deletedAt !== undefined || /^Trash\//i.test(name);
      if (texts.has(text)) {
        const active = existing.find((t) => t.text === text && !t.deletedAt);
        // Only in the trash here (and not in the backup's): the backup brings it back.
        const trashed =
          intoTrash || active ? undefined : existing.find((t) => t.text === text && t.deletedAt && !untrashed.some((u) => u.id === t.id));
        if (trashed) {
          await setDeleted(b, trashed.id, undefined);
          untrashed.push({ id: trashed.id, deletedAt: trashed.deletedAt! });
          added++;
        } else skipped++;
        const same = trashed ?? active ?? existing.find((t) => t.text === text);
        if (info && same) mapped.set(info.id, same.id);
        continue;
      }
      const now = Date.now();
      const id = info && !ids.has(info.id) ? info.id : newId();
      const tab: SavedTab = { id, ...describe(text), text, createdAt: info?.createdAt ?? now, updatedAt: info?.updatedAt ?? now, ...(intoTrash ? { deletedAt: now } : {}) };
      await b.tabs.put(tab);
      if (info) mapped.set(info.id, id);
      fresh.set(id, tab);
      texts.add(text);
      ids.add(id);
      addedIds.push(id);
      added++;
      if (intoTrash) toTrash++;
    }
    const have = new Map<string, TabVersion[]>();
    const versionsOf = async (tabId: string) => {
      if (!have.has(tabId)) have.set(tabId, fresh.has(tabId) ? [] : await b.versions.ofTab(tabId));
      return have.get(tabId)!;
    };
    // (Ids in use, to give a copy one of its own: read once, not asked about one by one.)
    const usedIds = history.length ? new Set((await b.versions.all()).map((v) => v.id)) : new Set<string>();
    const adding: TabVersion[] = [];
    for (const v of history) {
      const tabId = mapped.get(v.tabId);
      if (!tabId) continue;
      const own = await versionsOf(tabId);
      // (A version already here — the same backup restored twice — isn't added again.)
      if (own.some((x) => x.id === v.id || (x.at === v.at && x.text === v.text))) continue;
      // (Its id taken by another tab's version — the tab it came from is still here, changed
      // since: this copy gets an id of its own.)
      const version: TabVersion = { ...v, tabId, id: usedIds.has(v.id) ? newId() : v.id };
      usedIds.add(version.id);
      adding.push(version);
      own.push(version);
      versions++;
      if (!fresh.has(tabId)) addedVersionIds.push(version.id);
    }
    // Each new tab's newest version is its text (a backup without its history, or with only
    // part of it: the backup's text starts it, or ends it).
    for (const tab of fresh.values()) {
      const own = await versionsOf(tab.id);
      const newest = own.reduce<TabVersion | undefined>((a, c) => (!a || c.at > a.at ? c : a), undefined);
      if (newest?.text === tab.text) continue;
      const v = { ...versionOf(tab, 'import'), at: Math.max(tab.updatedAt, (newest?.at ?? 0) + 1) };
      adding.push(v);
      own.push(v);
    }
    // (All at once: one request to the server for a whole backup's history.)
    await b.versions.add(adding);
  });
  return { added, skipped, toTrash, versions, addedIds, addedVersionIds, untrashed };
}

/** A backup's index entry, if it's usable (a file and an id; dates as numbers). */
function cleanInfo(v: unknown): BackupInfo | null {
  const x = v as Partial<BackupInfo> | null;
  if (!x || typeof x.file !== 'string' || typeof x.id !== 'string' || !x.id) return null;
  const num = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? n : undefined);
  const now = Date.now();
  const deletedAt = num(x.deletedAt);
  return { file: x.file, id: x.id, createdAt: num(x.createdAt) ?? now, updatedAt: num(x.updatedAt) ?? now, ...(deletedAt !== undefined ? { deletedAt } : {}) };
}

const KINDS: VersionKind[] = ['save', 'demo', 'import', 'recover'];

/** A backup's saved version, if it's usable; its title, kind and name made sound. */
function cleanVersion(v: unknown): TabVersion | null {
  const x = v as Partial<TabVersion> | null;
  if (!x || typeof x.id !== 'string' || typeof x.tabId !== 'string' || typeof x.text !== 'string' || typeof x.at !== 'number' || !Number.isFinite(x.at)) return null;
  const title = typeof x.title === 'string' && x.title.trim() ? x.title : describe(x.text).title;
  const kind = KINDS.includes(x.kind as VersionKind) ? (x.kind as VersionKind) : 'import';
  const name = typeof x.name === 'string' && x.name.trim() ? x.name.trim().slice(0, 80) : undefined;
  return { id: x.id, tabId: x.tabId, at: x.at, text: x.text, title, kind, ...(name ? { name } : {}) };
}

/** Undoes a restored backup: the tabs and versions it added go, the ones it took out of the trash go back. */
export async function undoImport(r: Restored): Promise<void> {
  for (const id of r.addedIds) await deleteTab(id, { remember: false });
  if (r.addedVersionIds.length) await (await lib()).versions.delete(r.addedVersionIds);
  for (const u of r.untrashed) await trashTab(u.id, u.deletedAt);
}

/** A library's songs that are yours: not the demos as they came (in the trash or not). */
export async function ownSongs(b: LibraryBackend): Promise<number> {
  const demos = new Set(DEMOS.flatMap((d) => [d.text, ...(d.replaces ?? [])]));
  return (await b.tabs.all()).filter((t) => !demos.has(t.text)).length;
}

/** Which demos the library has had (kept with it: in this browser, or in the account). */
const SEEDED_KEY = 'seeded';

let seeding: Promise<Map<string, string>> | null = null;

/**
 * Adds demo songs on first launch, and any demos added since the last visit (once, even if
 * called twice); resolves to the tabs brought up to date (id → new text).
 */
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
  const b = await lib();
  const seen = parseInt((await b.meta.get(SEEDED_KEY)) ?? '0', 10) || 0;
  if (seen >= DEMO_VERSION) return updated;
  const fresh = DEMOS.filter((d) => d.since > seen);
  await b.transaction(async () => {
    const tabs = await b.tabs.all();
    const have = new Set(tabs.map((t) => t.text));
    for (const d of [...fresh].reverse()) {
      if (have.has(d.text)) continue;
      // A demo brought up to date: an unchanged copy of its old version is updated in place
      // (one you've changed is yours, and stays as it is beside the new one).
      // (Not one in the trash: updating it would take it out. It still counts as had, below.)
      const old = tabs.find((t) => !t.deletedAt && d.replaces?.includes(t.text));
      if (!old && tabs.some((t) => t.deletedAt && d.replaces?.includes(t.text))) continue;
      // (Had before, and not there as it was: deleted, or changed — yours, so it isn't added again.)
      if (!old && d.first !== undefined && seen >= d.first) continue;
      const id = await saveIn(b, d.text, old?.id, { kind: 'demo' });
      if (old) {
        // (Not a change of yours: it keeps its place in "Recently changed".)
        const now = await b.tabs.get(id);
        if (now) await b.tabs.put({ ...now, updatedAt: old.updatedAt });
        updated.set(old.id, d.text);
      }
    }
  });
  // Only remember the demos once they're really in the library.
  await b.meta.set(SEEDED_KEY, String(DEMO_VERSION));
  return updated;
}
