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
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...opts.headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
  } catch {
    throw new LibraryUnavailable('can’t reach the HarpForge server — is it running?');
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: string; saved?: SavedTab }) | null;
  if (res.status === 401) throw new LibraryUnavailable('you’re signed out — sign in again', true);
  if (res.status === 409 && data?.saved) throw new BackendClash(data.saved);
  if (res.status === 404 && method === 'GET') return undefined as T;
  if (!res.ok || data === null) throw new Error(data?.error ?? `the server answered ${res.status}`);
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
