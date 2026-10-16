// An account's library: on the HarpForge server, in data/users/<name>/ (songs as .htab
// files, their history beside them). Every change goes straight to the server.

import { BackendClash, type LibraryBackend, type SavedTab, type TabVersion } from './types';

/** The server couldn't be reached, or the account isn't signed in here any more. */
export class LibraryUnavailable extends Error {
  signedOut: boolean;
  constructor(message: string, signedOut = false) {
    super(message);
    this.signedOut = signedOut;
  }
}

const enc = encodeURIComponent;

let signedOutHandler: (() => void) | null = null;
/** Told when the server says the account isn't signed in here any more (its session ended). */
export function onSignedOut(fn: (() => void) | null) {
  signedOutHandler = fn;
}

/** The server answered "not signed in" (to anything of the account's). */
export function signedOutSeen() {
  signedOutHandler?.();
}

/** Where the server is (this page's own, unless a test says otherwise), and any extra headers. */
export interface RemoteOptions {
  base?: string;
  headers?: Record<string, string>;
}

async function callWith<T>(opts: RemoteOptions, method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${opts.base ?? ''}/api/library${path}`, {
      method,
      // (A server that never answers doesn't hang the library: reads give up after 20 s, big writes after 2 min.)
      signal: AbortSignal.timeout(method === 'GET' ? 20000 : 120000),
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...opts.headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
  } catch {
    throw new LibraryUnavailable('can’t reach the HarpForge server — is it running?');
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: string; saved?: SavedTab }) | null;
  if (res.status === 401) {
    signedOutHandler?.();
    throw new LibraryUnavailable('you’re signed out — sign in again', true);
  }
  if (res.status === 409 && data?.saved) throw new BackendClash(data.saved);
  // (One tab or version not there: none. A whole list not there: this isn't a HarpForge server that has accounts.)
  if (res.status === 404 && method === 'GET' && /^\/(tabs|versions)\/[^/]+$/.test(path)) return undefined as T;
  if (data === null) throw new LibraryUnavailable('something other than the HarpForge server answered — is it running here?');
  if (!res.ok) throw new Error(data.error ?? `the server answered ${res.status}`);
  return data;
}

export function accountBackend(opts: RemoteOptions = {}): LibraryBackend {
  const call = <T>(method: string, path: string, body?: unknown) => callWith<T>(opts, method, path, body);
  return {
    kind: 'account',
    tabs: {
      get: (id) => call<SavedTab | undefined>('GET', `/tabs/${enc(id)}`),
      all: () => call<SavedTab[]>('GET', '/tabs'),
      put: async (tab, expectText) => void (await call('PUT', `/tabs/${enc(tab.id)}`, { tab, expectText })),
      delete: async (id) => void (await call('DELETE', `/tabs/${enc(id)}`)),
    },
    versions: {
      get: (id) => call<TabVersion | undefined>('GET', `/versions/${enc(id)}`),
      ofTab: (tabId) => call<TabVersion[]>('GET', `/versions?tab=${enc(tabId)}`),
      all: () => call<TabVersion[]>('GET', '/versions'),
      add: async (vs) => void (vs.length && (await call('POST', '/versions', { versions: vs }))),
      put: async (v) => void (await call('PUT', `/versions/${enc(v.id)}`, { version: v })),
      delete: async (ids) => void (ids.length && (await call('POST', '/versions/delete', { ids }))),
      deleteOfTab: async (tabId) => void (await call('DELETE', `/versions?tab=${enc(tabId)}`)),
    },
    meta: {
      get: async (key) => (await call<{ value: string | null }>('GET', `/meta/${enc(key)}`))?.value ?? null,
      set: async (key, value) => void (await call('PUT', `/meta/${enc(key)}`, { value })),
    },
    // (Each change goes on its own: the server keeps each one whole.)
    transaction: (fn) => fn(),
  };
}
