// A guest's library: in this browser's database (IndexedDB, "harpforge").

import Dexie, { type Table } from 'dexie';
import type { LibraryBackend, SavedTab, TabVersion } from './types';

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
        await tx.table('versions').bulkAdd(tabs.map((t) => ({ id: crypto.randomUUID ? crypto.randomUUID() : `${t.id}-1`, tabId: t.id, at: t.updatedAt, text: t.text, title: t.title, kind: 'save' })));
      });
  }
}

/** Which demos the library has had: kept beside it in this browser. */
const metaKey = (key: string) => `harpforge:${key}`;

export function browserBackend(): LibraryBackend {
  const db = new LibraryDB();
  return {
    kind: 'browser',
    owner: 'browser',
    tabs: {
      get: (id) => db.tabs.get(id),
      all: () => db.tabs.toArray(),
      put: async (tab) => void (await db.tabs.put(tab)),
      delete: (id) => db.tabs.delete(id),
    },
    versions: {
      get: (id) => db.versions.get(id),
      ofTab: (tabId) => db.versions.where('tabId').equals(tabId).toArray(),
      all: () => db.versions.toArray(),
      add: async (vs) => void (await db.versions.bulkAdd(vs)),
      put: async (v) => void (await db.versions.put(v)),
      delete: (ids) => db.versions.bulkDelete(ids),
      deleteOfTab: async (tabId) => void (await db.versions.where('tabId').equals(tabId).delete()),
    },
    meta: {
      get: async (key) => {
        try {
          return localStorage.getItem(metaKey(key));
        } catch {
          return null;
        }
      },
      set: async (key, value) => {
        try {
          if (value === null) localStorage.removeItem(metaKey(key));
          else localStorage.setItem(metaKey(key), value);
        } catch {
          /* storage unavailable */
        }
      },
    },
    // (The browser database: one change, all or nothing; the other storage's own transactions nest in it.)
    transaction: (fn) => db.transaction('rw', db.tabs, db.versions, fn),
  };
}
