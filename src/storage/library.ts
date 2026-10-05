// Saved tabs, stored locally in IndexedDB.

import Dexie, { type Table } from 'dexie';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { setMetaFields } from '../core/htab/meta';
import { parseHtab } from '../core/htab/parser';
import { harmonicaName } from '../core/instruments';
import { specFromMeta } from '../core/score';
import { DEMOS, DEMO_VERSION } from '../demo/songs';
import { savedCopies } from '../state/working';

export interface SavedTab {
  id: string;
  title: string;
  harmonica: string;
  text: string;
  createdAt: number;
  updatedAt: number;
}

class LibraryDB extends Dexie {
  tabs!: Table<SavedTab, string>;
  constructor() {
    super('harpforge');
    this.version(1).stores({ tabs: 'id, updatedAt, title' });
  }
}

const db = new LibraryDB();

function describe(text: string): { title: string; harmonica: string } {
  const { meta } = parseHtab(text).doc;
  return { title: meta.title?.trim() || 'Untitled', harmonica: harmonicaName(specFromMeta(meta)) };
}

function newId(): string {
  return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2);
}

export async function listTabs(): Promise<SavedTab[]> {
  return db.tabs.orderBy('updatedAt').reverse().toArray();
}

/** Saves text; updates the existing entry when `id` is given and still exists. */
export async function saveTab(text: string, id?: string | null): Promise<string> {
  const now = Date.now();
  const info = describe(text);
  const existing = id ? await db.tabs.get(id) : undefined;
  if (existing) {
    await db.tabs.put({ ...existing, ...info, text, updatedAt: now });
    return existing.id;
  }
  const tab: SavedTab = { id: newId(), ...info, text, createdAt: now, updatedAt: now };
  await db.tabs.add(tab);
  return tab.id;
}

export async function deleteTab(id: string): Promise<void> {
  await db.tabs.delete(id);
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
  await db.transaction('rw', db.tabs, async () => {
    for (const c of found) await db.tabs.put({ id: c.docId, ...describe(c.text), text: c.text, createdAt: c.at, updatedAt: c.at });
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
export async function importLibrary(files: Record<string, Uint8Array>): Promise<{ added: number; skipped: number }> {
  const byFile = new Map<string, BackupInfo>();
  try {
    if (files['library.json']) for (const t of JSON.parse(strFromU8(files['library.json'])).tabs ?? []) byFile.set(t.file, t);
  } catch {
    /* a plain zip of tabs */
  }
  const names = Object.keys(files).filter((n) => /\.htab$/i.test(n));
  let added = 0;
  let skipped = 0;
  await db.transaction('rw', db.tabs, async () => {
    const existing = await db.tabs.toArray();
    const texts = new Set(existing.map((t) => t.text));
    const ids = new Set(existing.map((t) => t.id));
    for (const name of names) {
      const text = strFromU8(files[name]);
      if (texts.has(text)) {
        skipped++;
        continue;
      }
      const info = byFile.get(name);
      const now = Date.now();
      const id = info && !ids.has(info.id) ? info.id : newId();
      await db.tabs.add({ id, ...describe(text), text, createdAt: info?.createdAt ?? now, updatedAt: info?.updatedAt ?? now });
      texts.add(text);
      ids.add(id);
      added++;
    }
  });
  return { added, skipped };
}

const SEEDED_KEY = 'harpforge:seeded';

let seeding: Promise<void> | null = null;

/** Adds demo songs on first launch, and any demos added since the last visit (once, even if called twice). */
export function seedDemos(): Promise<void> {
  // A failure (storage blocked) is forgotten, so a later call can try again.
  seeding ??= seedOnce().catch((e) => {
    seeding = null;
    throw e;
  });
  return seeding;
}

async function seedOnce(): Promise<void> {
  let seen = 0;
  try {
    seen = parseInt(localStorage.getItem(SEEDED_KEY) ?? '0', 10) || 0;
    if (seen >= DEMO_VERSION) return;
  } catch {
    return;
  }
  const fresh = DEMOS.filter((d) => d.since > seen);
  await db.transaction('rw', db.tabs, async () => {
    const have = new Set((await db.tabs.toArray()).map((t) => t.text));
    for (const d of [...fresh].reverse()) if (!have.has(d.text)) await saveTab(d.text);
  });
  // Only remember the demos once they're really in the library.
  try {
    localStorage.setItem(SEEDED_KEY, String(DEMO_VERSION));
  } catch {
    /* storage unavailable */
  }
}
