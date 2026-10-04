// The working copy: the open tab, kept in this browser so a reload or a crash loses
// nothing. Each browser tab keeps its own copy (two open tabs don't overwrite each
// other); a new browser tab starts from the most recently used one.

export interface WorkingCopy {
  text: string;
  docId: string | null;
  savedText: string | null;
}

const PREFIX = 'harpforge:working:';
/** Before working copies were per tab: one shared copy, still read once by a new tab. */
const LEGACY = 'harpforge:working';
const SESSION = 'harpforge:session';
/** Copies kept from tabs that were closed (the newest ones). */
const KEEP = 8;

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

export function newSessionId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

/** This browser tab's id: kept across reloads of the tab (sessionStorage), new for a new tab. */
export function sessionId(session: Pick<Storage, 'getItem' | 'setItem'> | null): string {
  try {
    const have = session?.getItem(SESSION);
    if (have) return have;
    const id = newSessionId();
    session?.setItem(SESSION, id);
    return id;
  } catch {
    return newSessionId();
  }
}

export function setSessionId(session: Pick<Storage, 'setItem'> | null, id: string) {
  try {
    session?.setItem(SESSION, id);
  } catch {
    /* storage unavailable */
  }
}

function parse(raw: string | null): (WorkingCopy & { at: number }) | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v.text !== 'string') return null;
    return { text: v.text, docId: typeof v.docId === 'string' ? v.docId : null, savedText: typeof v.savedText === 'string' ? v.savedText : null, at: typeof v.at === 'number' ? v.at : 0 };
  } catch {
    return null;
  }
}

function keys(store: Store): string[] {
  const out: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (k?.startsWith(PREFIX)) out.push(k);
  }
  return out;
}

/** This tab's working copy; for a new tab, the most recent one (or null if there's none). */
export function readWorking(store: Store, id: string): WorkingCopy | null {
  try {
    const own = parse(store.getItem(PREFIX + id));
    if (own) return own;
    let best: (WorkingCopy & { at: number }) | null = parse(store.getItem(LEGACY));
    for (const k of keys(store)) {
      const c = parse(store.getItem(k));
      if (c && (!best || c.at > best.at)) best = c;
    }
    return best;
  } catch {
    return null;
  }
}

/** Writes this tab's working copy and forgets the oldest copies of closed tabs. Throws if storage is full. */
export function writeWorking(store: Store, id: string, copy: WorkingCopy, now = Date.now()) {
  store.setItem(PREFIX + id, JSON.stringify({ ...copy, at: now }));
  const all = keys(store)
    .map((k) => ({ k, at: parse(store.getItem(k))?.at ?? 0 }))
    .sort((a, b) => b.at - a.at);
  for (const { k } of all.slice(KEEP)) if (k !== PREFIX + id) store.removeItem(k);
  store.removeItem(LEGACY);
}

/**
 * Notices another open tab using the same id (a duplicated browser tab copies its
 * session) and calls `onClash` so this one can take a new id.
 */
export function watchForClash(getId: () => string, onClash: () => void): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => {};
  const channel = new BroadcastChannel('harpforge-tabs');
  channel.onmessage = (e: MessageEvent<{ type: string; id: string }>) => {
    if (e.data?.id !== getId()) return;
    // Someone just opened with our id: tell them, so the newcomer moves on.
    if (e.data.type === 'hello') channel.postMessage({ type: 'mine', id: getId() });
    else if (e.data.type === 'mine') onClash();
  };
  channel.postMessage({ type: 'hello', id: getId() });
  return () => channel.close();
}
