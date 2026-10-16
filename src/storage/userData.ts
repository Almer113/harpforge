// Your own small data — practice history, syllable fixes — kept where your library is: in
// this browser for a guest; in the account when signed in (on the server, in
// data/users/<name>/practice.json and syllables.json). Read at once from memory (an
// account's are fetched on signing in, and again on coming back to the window); each change
// goes to the server, which merges it with what's there, so two devices add to the same
// history rather than overwrite it.

import { signedOutSeen } from './remote';

/** The keys, as this browser keeps them, and their names on the server. */
const NAMES: Record<string, string> = { 'harpforge:practice-log': 'practice', 'harpforge:syllable-fixes': 'syllables' };
/** Changes to these are just the words changed (merged word by word); the others' are the whole value. */
const BY_WORD = new Set(['harpforge:syllable-fixes']);

let account: Map<string, string> | null = null;
/** Whose (sent with each request: another account signed in here since is refused, not mixed in). */
let accountName: string | null = null;
/** Changes the server hasn't taken yet (it wasn't reachable, or the session had ended): sent again later. */
const unsent = new Map<string, { key: string; change: string; keep: boolean }>();
/** Each key's latest change, so an older answer doesn't overwrite a newer value. */
const writes = new Map<string, number>();
/** Changes on their way: a re-read of the whole doesn't land over them. */
let sending = 0;

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

/** Two word-by-word changes as one (the later's form wins). */
function combine(a: string, b: string): string {
  try {
    const x = JSON.parse(a) as Record<string, Record<string, string>>;
    const y = JSON.parse(b) as Record<string, Record<string, string>>;
    const out: Record<string, Record<string, string>> = { ...x };
    for (const [lang, words] of Object.entries(y)) out[lang] = { ...out[lang], ...words };
    return JSON.stringify(out);
  } catch {
    return b;
  }
}

function keepUnsent(key: string, change: string, keep: boolean) {
  const slot = `${key}|${keep}`;
  const had = unsent.get(slot);
  // (Word by word: what's waiting and this, together. A whole value: this one, the latest.)
  unsent.set(slot, { key, keep, change: had && BY_WORD.has(key) ? combine(had.change, change) : change });
}

async function send(key: string, change: string, keep: boolean) {
  const name = NAMES[key];
  if (!name) return;
  const map = account;
  const n = (writes.get(key) ?? 0) + 1;
  writes.set(key, n);
  sending++;
  try {
    const res = await fetch(`/api/library/data/${name}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...(accountName ? { 'X-HarpForge-Account': encodeURIComponent(accountName) } : {}) },
      body: JSON.stringify({ value: change, keep }),
      credentials: 'same-origin',
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 401) signedOutSeen();
    if (!res.ok) throw new Error(String(res.status));
    const merged = ((await res.json()) as { value?: string }).value;
    // (What the server has now — this change and any other device's — unless there's a newer
    // change of ours, or it's another account's by now.)
    if (map && account === map && merged && writes.get(key) === n) map.set(key, merged);
  } catch {
    if (account === map) keepUnsent(key, change, keep);
  } finally {
    sending--;
  }
}

/** Sends what's waiting (each once: a failure puts it back). */
function resend() {
  const waiting = [...unsent.values()];
  unsent.clear();
  for (const u of waiting) void send(u.key, u.change, u.keep);
}

/** The account's data, as the server has it now. */
async function fetchAll(): Promise<Map<string, string> | null> {
  try {
    const res = await fetch('/api/library/data', {
      credentials: 'same-origin',
      headers: accountName ? { 'X-HarpForge-Account': encodeURIComponent(accountName) } : undefined,
      signal: AbortSignal.timeout(15000),
    });
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
    if (unsent.size) return resend();
    const before = new Map(writes);
    void fetchAll().then((next) => {
      // (Not over a change of ours made — or still on its way — since it was asked.)
      const changed = [...writes].some(([k, n]) => before.get(k) !== n);
      if (next && account === map && !unsent.size && !sending && !changed) for (const [k, v] of next) map.set(k, v);
    });
  });
}

/**
 * Signed in: the account's data from now on (fetched now). `same`: signed back in as the one
 * whose session had ended — what wasn't sent meanwhile is kept, and sent now.
 */
export async function accountData(name: string, same = false): Promise<void> {
  const pending = same && accountName?.toLowerCase() === name.toLowerCase() ? [...unsent.values()] : [];
  const local = same ? account : null;
  accountName = name;
  const fresh = await fetchAll();
  account = fresh ?? local ?? new Map();
  // (Kept changes show at once, until the server's merged answer comes back.)
  if (local && fresh) for (const u of pending) if (!BY_WORD.has(u.key) && local.has(u.key)) account.set(u.key, local.get(u.key)!);
  unsent.clear();
  writes.clear();
  for (const u of pending) keepUnsent(u.key, u.change, u.keep);
  if (unsent.size) resend();
}

/** A guest: this browser's data from now on. */
export function browserData() {
  account = null;
  accountName = null;
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
