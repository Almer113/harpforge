// Saved tabs, stored locally in IndexedDB.

import Dexie, { type Table } from 'dexie';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { setMetaFields } from '../core/htab/meta';
import { parseHtab } from '../core/htab/parser';
import { harmonicaName } from '../core/instruments';
import { specFromMeta } from '../core/score';
import { DEMOS, DEMO_VERSION } from '../demo/songs';

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

export async function getTab(id: string): Promise<SavedTab | undefined> {
  return db.tabs.get(id);
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

/**
 * Restores a library backup (or any zip of .htab files). Tabs already in the library
 * (same id or same text) are skipped. Returns how many were added.
 */
export async function importLibrary(zip: Uint8Array): Promise<{ added: number; skipped: number }> {
  const files = unzipSync(zip);
  const byFile = new Map<string, BackupInfo>();
  try {
    if (files['library.json']) for (const t of JSON.parse(strFromU8(files['library.json'])).tabs ?? []) byFile.set(t.file, t);
  } catch {
    /* a plain zip of tabs */
  }
  const names = Object.keys(files).filter((n) => /\.htab$/i.test(n));
  if (!names.length) throw new Error('no .htab files in it');
  const existing = await listTabs();
  const texts = new Set(existing.map((t) => t.text));
  const ids = new Set(existing.map((t) => t.id));
  let added = 0;
  let skipped = 0;
  for (const name of names) {
    const text = strFromU8(files[name]);
    const info = byFile.get(name);
    if (texts.has(text) || (info && ids.has(info.id))) {
      skipped++;
      continue;
    }
    const now = Date.now();
    await db.tabs.add({ id: info?.id ?? newId(), ...describe(text), text, createdAt: info?.createdAt ?? now, updatedAt: info?.updatedAt ?? now });
    texts.add(text);
    added++;
  }
  return { added, skipped };
}

const SEEDED_KEY = 'harpforge:seeded';

/** Adds demo songs on first launch, and any demos added since the last visit. */
export async function seedDemos(): Promise<void> {
  let seen = 0;
  try {
    seen = parseInt(localStorage.getItem(SEEDED_KEY) ?? '0', 10) || 0;
    if (seen >= DEMO_VERSION) return;
  } catch {
    return;
  }
  const fresh = DEMOS.filter((d) => d.since > seen);
  const have = new Set((await listTabs()).map((t) => t.text));
  for (const d of [...fresh].reverse()) if (!have.has(d.text)) await saveTab(d.text);
  // Only remember the demos once they're really in the library.
  try {
    localStorage.setItem(SEEDED_KEY, String(DEMO_VERSION));
  } catch {
    /* storage unavailable */
  }
}
