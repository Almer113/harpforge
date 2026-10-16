// An account's library on disk, in data/users/<name>/:
//
//   library.json         the index: each tab's id, title, dates, trash mark and file
//   tabs/<Title>.htab    each song as a plain .htab file (renamed when its title changes)
//   trash/<Title>.htab   songs in the trash
//   history/<id>.json    each song's saved versions
//
// Changes take the folder's lock (which also holds across the deployed server and the dev
// server), and files are written whole. A tab written "over the text it had" is refused if
// something else saved it in between (another window, another device).

import { mkdir, readdir, readFile, rm, rmdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { SavedTab, TabVersion, VersionKind } from '../src/storage/types.ts';
import { UserError } from './accounts.ts';
import { readJson, writeFileAtomic, writeJson } from './files.ts';

interface IndexEntry extends Omit<SavedTab, 'text'> {
  /** Where its text is, inside the account's folder ("tabs/Ode to Joy.htab"). */
  file: string;
}

interface Index {
  app: 'HarpForge';
  version: 1;
  meta: Record<string, string>;
  tabs: IndexEntry[];
}

const EMPTY: Index = { app: 'HarpForge', version: 1, meta: {}, tabs: [] };
const KINDS: VersionKind[] = ['save', 'demo', 'import', 'recover'];
const MAX_TEXT = 2 * 1024 * 1024;

/** A tab's or version's id: letters, digits, dashes, underscores (never a path). */
export const isId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(v);

/** The record a client sent, if it's a sound tab. */
export function cleanTab(v: unknown): SavedTab {
  const t = v as Partial<SavedTab> | null;
  const num = (n: unknown) => typeof n === 'number' && Number.isFinite(n);
  if (!t || !isId(t.id) || typeof t.title !== 'string' || typeof t.harmonica !== 'string' || typeof t.text !== 'string' || !num(t.createdAt) || !num(t.updatedAt))
    throw new UserError(400, 'That isn’t a tab.');
  if (t.text.length > MAX_TEXT) throw new UserError(413, 'That tab is too large.');
  if (t.deletedAt !== undefined && !num(t.deletedAt)) throw new UserError(400, 'That isn’t a tab.');
  return {
    id: t.id,
    title: t.title.slice(0, 300),
    harmonica: t.harmonica.slice(0, 200),
    text: t.text,
    createdAt: t.createdAt!,
    updatedAt: t.updatedAt!,
    ...(t.deletedAt !== undefined ? { deletedAt: t.deletedAt } : {}),
  };
}

/** The record a client sent, if it's a sound version. */
export function cleanVersion(v: unknown): TabVersion {
  const x = v as Partial<TabVersion> | null;
  if (!x || !isId(x.id) || !isId(x.tabId) || typeof x.text !== 'string' || typeof x.title !== 'string' || typeof x.at !== 'number' || !Number.isFinite(x.at) || !KINDS.includes(x.kind as VersionKind))
    throw new UserError(400, 'That isn’t a saved version.');
  if (x.text.length > MAX_TEXT) throw new UserError(413, 'That version is too large.');
  if (x.name !== undefined && typeof x.name !== 'string') throw new UserError(400, 'That isn’t a saved version.');
  return { id: x.id, tabId: x.tabId, at: x.at, text: x.text, title: x.title.slice(0, 300), kind: x.kind as VersionKind, ...(x.name ? { name: x.name.slice(0, 80) } : {}) };
}

const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

/** A title as a file name Windows (and everyone else) accepts. */
export function fileTitle(title: string): string {
  // eslint-disable-next-line no-control-regex
  let s = title.normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80);
  s = s.replace(/[. ]+$/, '');
  if (!s) s = 'Untitled';
  if (RESERVED.test(s)) s = `_${s}`;
  return s;
}

// ---- The folder's lock ----------------------------------------------------------------

const chains = new Map<string, Promise<unknown>>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs `fn` holding the folder's lock: one change at a time in this server (a queue), and
 * across servers (a .lock folder: making a folder either succeeds or finds one there; one
 * left by a crash is taken over after 15 s).
 */
export async function withLock<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const before = chains.get(dir) ?? Promise.resolve();
  const run = before.then(async () => {
    const lock = path.join(dir, '.lock');
    await mkdir(dir, { recursive: true });
    for (let i = 0; ; i++) {
      try {
        await mkdir(lock);
        break;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
        const age = Date.now() - ((await stat(lock).catch(() => null))?.mtimeMs ?? Date.now());
        if (age > 15000) await rmdir(lock).catch(() => undefined);
        else if (i > 500) throw new Error('the library is busy', { cause: e });
        else await sleep(10);
      }
    }
    try {
      return await fn();
    } finally {
      await rmdir(lock).catch(() => undefined);
    }
  });
  chains.set(
    dir,
    run.catch(() => undefined),
  );
  return run;
}

// ---- The library ------------------------------------------------------------------------

export function userLibrary(dataDir: string, key: string) {
  const dir = path.join(dataDir, 'users', key);
  const indexFile = path.join(dir, 'library.json');
  const historyFile = (tabId: string) => path.join(dir, 'history', `${tabId}.json`);

  const readIndex = async (): Promise<Index> => {
    const i = await readJson<Index>(indexFile, EMPTY);
    return { ...EMPTY, ...i, meta: i.meta ?? {}, tabs: Array.isArray(i.tabs) ? i.tabs : [] };
  };
  const writeIndex = (i: Index) => writeJson(indexFile, i);
  const textOf = (e: IndexEntry) => readFile(path.join(dir, e.file), 'utf8');
  const withText = async (e: IndexEntry): Promise<SavedTab | null> => {
    const text = await textOf(e).catch(() => null);
    if (text === null) return null;
    const { file: _file, ...rest } = e;
    void _file;
    return { ...rest, text };
  };

  /** A file name for a tab: its title, in tabs/ or trash/, not used by another tab. */
  function placeFor(i: Index, tab: SavedTab, keep?: IndexEntry): string {
    const folder = tab.deletedAt ? 'trash' : 'tabs';
    const base = fileTitle(tab.title);
    const own = keep?.file;
    // (Its file already fits: the same title, the same folder.)
    if (own && own.startsWith(`${folder}/`) && (own === `${folder}/${base}.htab` || new RegExp(`^${folder}/${escape(base)} \\(\\d+\\)\\.htab$`).test(own))) return own;
    const taken = new Set(i.tabs.filter((t) => t.id !== tab.id).map((t) => t.file.toLowerCase()));
    let name = `${folder}/${base}.htab`;
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${folder}/${base} (${n}).htab`;
    return name;
  }

  async function readVersions(tabId: string): Promise<TabVersion[]> {
    const list = await readJson<TabVersion[]>(historyFile(tabId), []).catch(() => []);
    return Array.isArray(list) ? list : [];
  }

  async function allVersions(): Promise<TabVersion[]> {
    const files = await readdir(path.join(dir, 'history')).catch(() => [] as string[]);
    const lists = await Promise.all(files.filter((f) => f.endsWith('.json')).map((f) => readVersions(f.slice(0, -5))));
    return lists.flat();
  }

  return {
    async allTabs(): Promise<SavedTab[]> {
      const i = await readIndex();
      return (await Promise.all(i.tabs.map(withText))).filter((t): t is SavedTab => t !== null);
    },

    async getTab(id: string): Promise<SavedTab | null> {
      const e = (await readIndex()).tabs.find((t) => t.id === id);
      return e ? withText(e) : null;
    },

    /** Writes a tab; with `expectText`, only if its text there is still that (else the tab as it is: a clash). */
    putTab(tab: SavedTab, expectText?: string): Promise<{ clash: SavedTab } | null> {
      return withLock(dir, async () => {
        const i = await readIndex();
        const old = i.tabs.find((t) => t.id === tab.id);
        if (old && expectText !== undefined) {
          const now = await withText(old);
          if (now && now.text !== expectText) return { clash: now };
        }
        const file = placeFor(i, tab, old);
        // The text first, then the index (never an index pointing at a file not there yet).
        await writeFileAtomic(path.join(dir, file), tab.text);
        const { text: _text, ...meta } = tab;
        void _text;
        const entry: IndexEntry = { ...meta, file };
        i.tabs = old ? i.tabs.map((t) => (t.id === tab.id ? entry : t)) : [...i.tabs, entry];
        await writeIndex(i);
        if (old && old.file !== file) await rm(path.join(dir, old.file), { force: true });
        return null;
      });
    },

    deleteTab(id: string): Promise<void> {
      return withLock(dir, async () => {
        const i = await readIndex();
        const old = i.tabs.find((t) => t.id === id);
        if (!old) return;
        i.tabs = i.tabs.filter((t) => t.id !== id);
        await writeIndex(i);
        await rm(path.join(dir, old.file), { force: true });
      });
    },

    versionsOf: readVersions,
    allVersions,

    async getVersion(id: string): Promise<TabVersion | null> {
      return (await allVersions()).find((v) => v.id === id) ?? null;
    },

    /** Adds versions (or replaces ones with the same id). */
    addVersions(versions: TabVersion[]): Promise<void> {
      return withLock(dir, async () => {
        const byTab = new Map<string, TabVersion[]>();
        for (const v of versions) byTab.set(v.tabId, [...(byTab.get(v.tabId) ?? []), v]);
        for (const [tabId, vs] of byTab) {
          const ids = new Set(vs.map((v) => v.id));
          const list = [...(await readVersions(tabId)).filter((v) => !ids.has(v.id)), ...vs].sort((a, b) => a.at - b.at);
          await writeJson(historyFile(tabId), list);
        }
      });
    },

    deleteVersions(ids: string[]): Promise<void> {
      const gone = new Set(ids);
      return withLock(dir, async () => {
        const files = await readdir(path.join(dir, 'history')).catch(() => [] as string[]);
        for (const f of files.filter((n) => n.endsWith('.json'))) {
          const tabId = f.slice(0, -5);
          const list = await readVersions(tabId);
          const kept = list.filter((v) => !gone.has(v.id));
          if (kept.length !== list.length) await writeJson(historyFile(tabId), kept);
        }
      });
    },

    deleteVersionsOf(tabId: string): Promise<void> {
      return withLock(dir, () => rm(historyFile(tabId), { force: true }));
    },

    async getMeta(name: string): Promise<string | null> {
      return (await readIndex()).meta[name] ?? null;
    },

    setMeta(name: string, value: string | null): Promise<void> {
      return withLock(dir, async () => {
        const i = await readIndex();
        if (value === null) delete i.meta[name];
        else i.meta[name] = value;
        await writeIndex(i);
      });
    },
  };
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
