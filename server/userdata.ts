// An account's small data beside its library: practice.json (each song's practice
// sessions) and syllables.json (your syllable fixes, per language). A change is merged with
// what's there — sessions by when they were, fixes word by word (the change's form wins) —
// so two devices add to them instead of overwriting each other.

import path from 'node:path';
import { UserError } from './accounts.ts';
import { readJson, writeJson } from './files.ts';
import { withLock } from './library.ts';

export const DATA_NAMES = ['practice', 'syllables'] as const;
export type DataName = (typeof DATA_NAMES)[number];

type Practice = Record<string, { at: number }[]>;
type Syllables = Record<string, Record<string, string>>;

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** A practice session as kept: its fields (and nothing else, nor anything nested). */
function entry(e: Record<string, unknown> & { at: number }) {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    at: e.at,
    mode: typeof e.mode === 'string' ? e.mode.slice(0, 20) : 'practice',
    accuracy: num(e.accuracy),
    passes: num(e.passes),
    clean: num(e.clean),
    holes: Array.isArray(e.holes) ? e.holes.filter((h): h is string => typeof h === 'string').slice(0, 5).map((h) => h.slice(0, 12)) : [],
  };
}

/** Practice: each song's sessions, both sides', once each (by time), the last 20; the 200 songs practised latest. */
export function mergePractice(had: unknown, change: unknown): Practice {
  // (No inherited keys: a song called "constructor" is just a song.)
  const out: Practice = Object.create(null);
  for (const side of [had, change]) {
    if (!isObject(side)) continue;
    for (const [song, list] of Object.entries(side)) {
      if (!Array.isArray(list)) continue;
      const entries = list.filter((e): e is Record<string, unknown> & { at: number } => isObject(e) && typeof e.at === 'number' && Number.isFinite(e.at)).map(entry);
      const byTime = new Map((out[song] ?? []).map((e) => [e.at, e]));
      for (const e of entries) byTime.set(e.at, e);
      out[song] = [...byTime.values()].sort((a, b) => a.at - b.at).slice(-20);
    }
  }
  const songs = Object.entries(out)
    .sort((a, b) => (b[1].at(-1)?.at ?? 0) - (a[1].at(-1)?.at ?? 0))
    .slice(0, 200);
  return Object.fromEntries(songs);
}

/** Syllable fixes: both sides', a word's form from the change when both have it; the last 3000 a language. */
export function mergeSyllables(had: unknown, change: unknown, prefer: 'change' | 'had' = 'change'): Syllables {
  const out: Syllables = Object.create(null);
  for (const side of [had, change]) {
    if (!isObject(side)) continue;
    for (const [lang, words] of Object.entries(side)) {
      if (!isObject(words)) continue;
      const list: Record<string, string> = Object.assign(Object.create(null), out[lang]);
      for (const [word, form] of Object.entries(words)) {
        if (typeof form !== 'string') continue;
        // (Bringing a browser's fixes in: the account's own, newer ones stay.)
        if (prefer === 'had' && side === change && Object.hasOwn(list, word)) continue;
        delete list[word];
        list[word] = form;
      }
      out[lang] = Object.fromEntries(Object.entries(list).slice(-3000));
    }
  }
  return out;
}

export function userData(dataDir: string, key: string) {
  const file = (name: DataName) => path.join(dataDir, 'users', key, `${name}.json`);
  return {
    /** Both, as JSON text (null: none yet). */
    async all(): Promise<Record<DataName, string | null>> {
      const read = async (name: DataName) => {
        const v = await readJson<unknown>(file(name), null).catch(() => null);
        return v === null ? null : JSON.stringify(v);
      };
      return { practice: await read('practice'), syllables: await read('syllables') };
    },
    /** Merges a change in; what's there now, as JSON text. */
    async merge(name: DataName, value: string, prefer: 'change' | 'had' = 'change'): Promise<string> {
      let change: unknown;
      try {
        change = JSON.parse(value);
      } catch {
        throw new UserError(400, 'Not JSON.');
      }
      // (Under the library's lock: two devices' changes at once are both kept.)
      return withLock(path.join(dataDir, 'users', key), async () => {
        const had = await readJson<unknown>(file(name), null).catch(() => null);
        const merged = name === 'practice' ? mergePractice(had, change) : mergeSyllables(had, change, prefer);
        await writeJson(file(name), merged);
        return JSON.stringify(merged);
      });
    },
  };
}
