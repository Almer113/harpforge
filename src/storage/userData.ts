// Your own small data — practice history, syllable fixes — kept where your library is: in
// this browser for a guest; in the account when signed in (on the server, in
// data/users/<name>/practice.json and syllables.json). Read at once from memory (an
// account's are fetched on signing in, and again on coming back to the window); each change
// goes to the server, which merges it with what's there, so two devices add to the same
// history rather than overwrite it.

import { signedOutSeen } from './remote';

/** The keys, as this browser keeps them, and their names on the server. */
const NAMES: Record<string, string> = { 'harpforge:practice-log': 'practice', 'harpforge:syllable-fixes': 'syllables' };

let account: Map<string, string> | null = null;
/** Changes the server hasn't taken yet (it wasn't reachable): sent again with the next one, or on focus. */
const unsent = new Map<string, { change: string; keep: boolean }>();
/** Each key's latest change, so an older answer doesn't overwrite a newer value. */
const writes = new Map<string, number>();

export function readData(key: string): string | null {
  if (account) return account.get(key) ?? null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Keeps `value` (the whole of it). `change`: just what changed, for the server to merge in —
 * a syllable fix's one word, say, so an older list on another device doesn't undo a newer
 * fix (without it, the whole value is the change).
 */
export function writeData(key: string, value: string, change = value) {
  if (!account) {
    localStorage.setItem(key, value);
    return;
  }
  account.set(key, value);
  void send(key, change, false);
}

async function send(key: string, change: string, keep: boolean) {
  const name = NAMES[key];
  if (!name) return;
  const map = account;
  const n = (writes.get(key) ?? 0) + 1;
  writes.set(key, n);
  try {
    const res = await fetch(`/api/library/data/${name}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: change, keep }),
      credentials: 'same-origin',
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 401) signedOutSeen();
    if (!res.ok) throw new Error(String(res.status));
    const merged = ((await res.json()) as { value?: string }).value;
    if (unsent.get(key)?.change === change) unsent.delete(key);
    // (What the server has now — this change and any other device's — unless there's a newer
    // change of ours, or it's another account's by now.)
    if (map && account === map && merged && writes.get(key) === n) map.set(key, merged);
  } catch {
    // (Sent again later: all of it — or, bringing a browser's in, that as it was.)
    if (account === map) unsent.set(key, { change: keep ? change : (account?.get(key) ?? change), keep });
  }
}

/** The account's data, as the server has it now. */
async function fetchAll(): Promise<Map<string, string> | null> {
  try {
    const res = await fetch('/api/library/data', { credentials: 'same-origin', signal: AbortSignal.timeout(15000) });
    if (res.status === 401) signedOutSeen();
    if (!res.ok) return null;
    const body = (await res.json()) as Record<string, string | null>;
    const next = new Map<string, string>();
    for (const [key, name] of Object.entries(NAMES)) if (typeof body[name] === 'string') next.set(key, body[name]!);
    return next;
  } catch {
    return null;
  }
}

// Back to the window: unsent changes go again, and another device's are read in.
if (typeof window !== 'undefined') {
  window.addEventListener('focus', () => {
    if (!account) return;
    const map = account;
    if (unsent.size) {
      for (const [key, u] of unsent) void send(key, u.change, u.keep);
      return;
    }
    void fetchAll().then((next) => {
      if (next && account === map && !unsent.size) for (const [k, v] of next) map.set(k, v);
    });
  });
}

/** Signed in: the account's data from now on (fetched now). */
export async function accountData(): Promise<void> {
  // (Not reachable now: empty until it is — changes are merged in when they're sent.)
  account = (await fetchAll()) ?? new Map();
  unsent.clear();
  writes.clear();
}

/** A guest: this browser's data from now on. */
export function browserData() {
  account = null;
  unsent.clear();
  writes.clear();
}

/** This browser's practice history and syllable fixes, merged into the account's (the account's own fixes stay). */
export async function bringBrowserData(): Promise<void> {
  if (!account) return;
  for (const key of Object.keys(NAMES)) {
    let mine: string | null = null;
    try {
      mine = localStorage.getItem(key);
    } catch {
      mine = null;
    }
    if (mine) await send(key, mine, true);
  }
}
