// Saved tabs, stored locally in IndexedDB.

import Dexie, { type Table } from 'dexie';
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

const SEEDED_KEY = 'harpforge:seeded';

/** Adds demo songs on first launch, and any demos added since the last visit. */
export async function seedDemos(): Promise<void> {
  let seen = 0;
  try {
    seen = parseInt(localStorage.getItem(SEEDED_KEY) ?? '0', 10) || 0;
    if (seen >= DEMO_VERSION) return;
    localStorage.setItem(SEEDED_KEY, String(DEMO_VERSION));
  } catch {
    return;
  }
  const fresh = DEMOS.filter((d) => d.since > seen);
  for (const d of [...fresh].reverse()) await saveTab(d.text);
}
