// Your own small data — practice history, syllable fixes — kept where your library is: in
// this browser for a guest; in the account when signed in (on the server, in
// data/users/<name>/practice.json and syllables.json). Read at once from memory (an
// account's are fetched on signing in); each change goes to the server, which merges it
// with what's there, so two devices add to the same history rather than overwrite it.

/** The keys, as this browser keeps them, and their names on the server. */
const NAMES: Record<string, string> = { 'harpforge:practice-log': 'practice', 'harpforge:syllable-fixes': 'syllables' };

let account: Map<string, string> | null = null;
/** Changes the server hasn't taken yet (it wasn't reachable): sent again with the next one. */
const unsent = new Set<string>();
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

export function writeData(key: string, value: string) {
  if (!account) {
    localStorage.setItem(key, value);
    return;
  }
  account.set(key, value);
  void send(key);
}

async function send(key: string) {
  const name = NAMES[key];
  const value = account?.get(key);
  if (!name || value === undefined) return;
  const n = (writes.get(key) ?? 0) + 1;
  writes.set(key, n);
  try {
    const res = await fetch(`/api/library/data/${name}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value }), credentials: 'same-origin' });
    if (!res.ok) throw new Error(String(res.status));
    const merged = ((await res.json()) as { value?: string }).value;
    unsent.delete(key);
    // (What the server has now — this change and any other device's — unless there's a newer one of ours.)
    if (account && merged && writes.get(key) === n) account.set(key, merged);
  } catch {
    unsent.add(key);
  }
}

// Unsent changes go again when the window's used again.
if (typeof window !== 'undefined') {
  window.addEventListener('focus', () => {
    for (const key of unsent) void send(key);
  });
}

/** Signed in: the account's data from now on (fetched now). */
export async function accountData(): Promise<void> {
  const next = new Map<string, string>();
  try {
    const res = await fetch('/api/library/data', { credentials: 'same-origin' });
    const body = res.ok ? ((await res.json()) as Record<string, string | null>) : {};
    for (const [key, name] of Object.entries(NAMES)) if (typeof body[name] === 'string') next.set(key, body[name]!);
  } catch {
    /* not reachable now: empty until it is (changes are merged in when they're sent) */
  }
  account = next;
  unsent.clear();
}

/** A guest: this browser's data from now on. */
export function browserData() {
  account = null;
  unsent.clear();
}

/** This browser's practice history and syllable fixes, merged into the account's. */
export async function bringBrowserData(): Promise<void> {
  if (!account) return;
  for (const key of Object.keys(NAMES)) {
    let mine: string | null = null;
    try {
      mine = localStorage.getItem(key);
    } catch {
      mine = null;
    }
    if (!mine) continue;
    // (Sent as a change: the server merges it with the account's.)
    account.set(key, mine);
    await send(key);
  }
}
