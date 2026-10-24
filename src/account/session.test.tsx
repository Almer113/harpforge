// @vitest-environment happy-dom
// Phase 14d: whose library — the start screen at startup, signing in and out (the open
// song kept, unlinked), the offer to bring this browser's songs, a session that ended.

import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/engine', async () => (await import('../test/fakeEngine')).fakeEngine());

import { AccountGate } from '../components/Account';
import { useApp } from '../state/store';
import { libraryKind, saveTab, setLibraryBackend } from '../storage/library';
import { accountBackend } from '../storage/remote';
import { continueAsGuest, signInAs, signOutNow, startAccount } from './session';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const s = () => useApp.getState();
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
/** A pretend server: who's signed in, and answers to sign-in. */
let signedIn: string | null = null;
function server() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      if (url === '/api/account') return json(200, { user: signedIn && { name: signedIn } });
      if (url === '/api/account/signin') {
        if (body.password !== 'right-one') return json(401, { error: 'That name and password don’t match an account.' });
        signedIn = body.name;
        return json(200, { user: { name: body.name } });
      }
      if (url === '/api/account/signout') {
        signedIn = null;
        return json(200, { user: null });
      }
      if (url.startsWith('/api/library/')) return signedIn ? json(200, []) : json(401, { error: 'Not signed in.' });
      return json(404, { error: 'no such API' });
    }),
  );
}

beforeEach(() => {
  signedIn = null;
  localStorage.clear();
  server();
  setLibraryBackend(null);
  useApp.setState({ accountGate: null, bringOffer: null, toast: null });
});
afterEach(() => vi.unstubAllGlobals());

describe('at startup', () => {
  it('no one signed in: a guest, and the start screen (until “continue as guest” is chosen here)', async () => {
    await startAccount();
    expect(s().account.status).toBe('guest');
    expect(s().accountGate).toBe('signin');
    continueAsGuest();
    expect(s().accountGate).toBeNull();
    await startAccount();
    expect(s().accountGate).toBeNull();
  });

  it('signed in: the account’s library, no start screen', async () => {
    signedIn = 'Ayu';
    await startAccount();
    expect(s().account).toEqual({ status: 'signed-in', name: 'Ayu' });
    expect(s().accountGate).toBeNull();
    expect(await libraryKind()).toBe('account');
  });

  it('no server: this browser’s library, no start screen', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    await startAccount();
    expect(s().account.status).toBe('offline');
    expect(s().accountGate).toBeNull();
    expect(await libraryKind()).toBe('browser');
  });
});

describe('signing in and out', () => {
  it('signing in: the account’s library; the open song stays open, unlinked (unchanged: not “unsaved”)', async () => {
    await startAccount();
    const id = await saveTab('---\ntitle: Mine\n---\n4 |\n');
    s().loadText('---\ntitle: Mine\n---\n4 |\n', id, true);
    const a = await signInAs('Ayu', 'right-one');
    expect(a.ok).toBe(true);
    expect(await libraryKind()).toBe('account');
    expect(s().docId).toBeNull();
    expect(s().savedText).toBe(s().text);
    expect(s().accountGate).toBeNull();
    // This browser has a song of yours: the offer to bring it.
    expect(s().bringOffer).toEqual({ name: 'Ayu', songs: 1, trashed: 0 });
  });

  it('a wrong password: still a guest, the reason to show', async () => {
    await startAccount();
    const a = await signInAs('Ayu', 'nope');
    expect(a).toMatchObject({ ok: false, message: 'That name and password don’t match an account.' });
    expect(s().account.status).toBe('guest');
    expect(await libraryKind()).toBe('browser');
  });

  it('signing out: this browser’s library and the start screen; an edited open song stays, unsaved', async () => {
    signedIn = 'Ayu';
    await startAccount();
    s().loadText('---\ntitle: A\n---\n4 |\n', 'remote-id', true);
    s().setText('---\ntitle: A\n---\n5 |\n');
    await signOutNow();
    expect(s().account.status).toBe('guest');
    expect(s().accountGate).toBe('signin');
    expect(await libraryKind()).toBe('browser');
    expect(s().docId).toBeNull();
    expect(s().savedText).toBeNull();
    expect(s().text).toContain('5 |');
  });

  it('the session ended (the server says so): signed out, asked to sign in again; back in as the same one, the song stays linked', async () => {
    signedIn = 'Ayu';
    await startAccount();
    s().loadText('---\ntitle: A\n---\n4 |\n', 'remote-id', true);
    signedIn = null;
    await expect(accountBackend().tabs.all()).rejects.toThrow(/signed out/);
    expect(s().account).toEqual({ status: 'signed-out', name: 'Ayu' });
    expect(s().accountGate).toBe('signin');
    await signInAs('Ayu', 'right-one');
    expect(s().docId).toBe('remote-id');
  });
});

describe('the start screen', () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  beforeEach(async () => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(<AccountGate />));
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  const type = async (el: HTMLInputElement, value: string) =>
    act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });

  it('signs in from the form; a refusal is shown', async () => {
    await act(async () => useApp.setState({ account: { status: 'guest' }, accountGate: 'signin' }));
    const [name, password] = [...host.querySelectorAll<HTMLInputElement>('.account-form input:not([type=checkbox])')];
    expect(name.autocomplete).toBe('username');
    expect(password.type).toBe('password');
    await type(name, 'Ayu');
    await type(password, 'nope');
    await act(async () => host.querySelector<HTMLFormElement>('.account-form')!.requestSubmit());
    await act(async () => new Promise((r) => setTimeout(r, 20)));
    expect(host.querySelector('.account-error')?.textContent).toMatch(/don’t match/);
    await type(password, 'right-one');
    await act(async () => host.querySelector<HTMLFormElement>('.account-form')!.requestSubmit());
    await act(async () => new Promise((r) => setTimeout(r, 20)));
    expect(s().account).toEqual({ status: 'signed-in', name: 'Ayu' });
    expect(host.querySelector('.account-form')).toBeNull();
  });

  it('“Create account” switches the form (a new password, the rules shown)', async () => {
    await act(async () => useApp.setState({ account: { status: 'guest' }, accountGate: 'signin' }));
    await act(async () => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Create account')!.click());
    const password = host.querySelectorAll<HTMLInputElement>('.account-form input')[1];
    expect(password.autocomplete).toBe('new-password');
    expect(password.placeholder).toMatch(/6 characters/);
  });
});

describe('a song left open from the other library', () => {
  it('reopened signed in, a guest’s song left open isn’t linked to the account’s library (nor the other way)', async () => {
    signedIn = 'Ayu';
    useApp.setState({ libraryOwner: 'browser' });
    s().loadText('---\ntitle: G\n---\n4 |\n', 'guest-id', true);
    await startAccount();
    expect(s().docId).toBeNull();
    expect(s().libraryOwner).toBe('account:ayu');
    // Same account again: its song stays linked.
    s().loadText('---\ntitle: A\n---\n4 |\n', 'account-id', true);
    await startAccount();
    expect(s().docId).toBe('account-id');
    // Signed out since (elsewhere): a guest now, the account's song unlinked.
    signedIn = null;
    await startAccount();
    expect(s().docId).toBeNull();
    expect(s().libraryOwner).toBe('browser');
  });
});

describe('the review’s cases', () => {
  it('Undo of songs brought into the account, after signing out: the account’s go, this browser’s stay', async () => {
    const { importLibrary, undoImport, getTab } = await import('../storage/library');
    const { strToU8 } = await import('fflate');
    // (The account: a pretend one that takes anything.)
    const deleted: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'DELETE' && url.startsWith('/api/library/tabs/')) deleted.push(decodeURIComponent(url.split('/').pop()!));
        if (url.startsWith('/api/library/tabs') && init?.method === 'GET') return json(200, []);
        if (url.startsWith('/api/library/versions') && init?.method === 'GET') return json(200, []);
        return json(200, { ok: true });
      }),
    );
    setLibraryBackend(null);
    const id = await saveTab('---\ntitle: Kept here\n---\n4 |\n');
    const r = await importLibrary(
      { 'k.htab': strToU8('---\ntitle: Kept here\n---\n4 |\n'), 'library.json': strToU8(JSON.stringify({ tabs: [{ file: 'k.htab', id, createdAt: 1, updatedAt: 1 }] })) },
      { into: accountBackend() },
    );
    expect(r.addedIds).toEqual([id]);
    // Signed out: this browser's library in use. Undo acts on the account.
    setLibraryBackend(null);
    await undoImport(r);
    expect(deleted).toEqual([id]);
    expect((await getTab(id))?.title).toBe('Kept here');
  });

  it('signing out with the server unreachable: still signed in (said so)', async () => {
    signedIn = 'Ayu';
    await startAccount();
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    await signOutNow();
    expect(s().account).toEqual({ status: 'signed-in', name: 'Ayu' });
    expect(s().toast?.message).toMatch(/Couldn’t sign out/);
  });

  it('a library switch clears an Undo meant for the old one', async () => {
    signedIn = 'Ayu';
    await startAccount();
    s().notify('Moved “X” to the trash', { label: 'Undo', run: () => undefined });
    await signOutNow();
    expect(s().toast).toBeNull();
  });

  it('while it’s still asked whose library it is, the open song isn’t checked against this browser’s', async () => {
    const { checkOpenTab } = await import('../state/trash');
    localStorage.setItem('harpforge:deleted', JSON.stringify(['shared-id']));
    useApp.setState({ account: { status: 'checking' }, libraryOwner: 'account:ayu' });
    s().loadText('---\ntitle: A\n---\n4 |\n', 'shared-id', true);
    await checkOpenTab();
    expect(s().docId).toBe('shared-id');
  });
});

describe('practice and syllables per account', () => {
  it('an answer for one account arriving after switching to another isn’t taken in', async () => {
    const data = await import('../storage/userData');
    let release!: () => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === '/api/library/data' && !init?.method) return json(200, { practice: null, syllables: null });
        await new Promise<void>((r) => (release = r));
        return json(200, { value: JSON.stringify({ songA: [{ at: 1 }] }) });
      }),
    );
    await data.accountData('Ayu');
    data.writeData('harpforge:practice-log', JSON.stringify({ songA: [{ at: 1 }] }));
    await data.accountData('Ayu');
    release();
    await new Promise((r) => setTimeout(r, 10));
    expect(data.readData('harpforge:practice-log')).toBeNull();
    data.browserData();
  });

  it('a syllable fix tells the server only its word', async () => {
    const data = await import('../storage/userData');
    const { saveSyllableFix } = await import('../storage/syllableFixes');
    const sent: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'PUT') sent.push(JSON.parse(String(init.body)).value);
        return json(200, url === '/api/library/data' ? { practice: null, syllables: JSON.stringify({ en: { river: 'riv-er' } }) } : { value: '{}' });
      }),
    );
    await data.accountData('Ayu');
    saveSyllableFix('en', 'ev-er-y');
    expect(JSON.parse(sent[0])).toEqual({ en: { every: 'ev-er-y' } });
    data.browserData();
  });
});

describe('the second review’s cases', () => {
  /** A pretend server with a real (in-memory) library for the signed-in account. */
  function serverWithLibrary(delayAccount = 0) {
    const tabs = new Map<string, unknown>();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        if (url === '/api/account') {
          await new Promise((r) => setTimeout(r, delayAccount));
          return json(200, { user: signedIn && { name: signedIn } });
        }
        if (url === '/api/library/data') return json(200, { practice: null, syllables: null });
        if (url === '/api/library/tabs' && method === 'GET') return json(200, [...tabs.values()]);
        const m = /^\/api\/library\/tabs\/([^/?]+)$/.exec(url);
        if (m && method === 'GET') return tabs.has(m[1]) ? json(200, tabs.get(m[1])) : json(404, { error: 'none' });
        if (m && method === 'PUT') {
          tabs.set(m[1], JSON.parse(String(init!.body)).tab);
          return json(200, { ok: true });
        }
        if (url.startsWith('/api/library/versions') && method === 'GET') return json(200, []);
        if (url.startsWith('/api/library/meta/')) return json(200, method === 'GET' ? { value: '99' } : { ok: true });
        return json(200, { ok: true });
      }),
    );
    return tabs;
  }

  it('a save made while it’s still being asked whose library it is: into the account’s, linked (no duplicate on the next)', async () => {
    signedIn = 'Ayu';
    const tabs = serverWithLibrary(30);
    const { saveCurrent } = await import('../state/actions');
    useApp.setState({ libraryOwner: 'browser' });
    s().loadText('---\ntitle: Early\n---\n4 |\n', null);
    const started = startAccount();
    const saved = saveCurrent();
    await started;
    await saved;
    expect(tabs.size).toBe(1);
    expect(s().docId).toBe([...tabs.keys()][0]);
    expect(s().libraryOwner).toBe('account:ayu');
    s().setText('---\ntitle: Early\n---\n5 |\n');
    await saveCurrent();
    expect(tabs.size).toBe(1);
  });

  it('a song opened from the library is that library’s (even while the account’s server is away)', () => {
    useApp.setState({ account: { status: 'offline' }, libraryOwner: 'account:ayu' });
    s().loadText('---\ntitle: B\n---\n4 |\n', 'browser-id', true);
    expect(s().libraryOwner).toBe('browser');
  });

  it('practice kept while the session had ended goes to the account on signing back in as the same one', async () => {
    const data = await import('../storage/userData');
    const puts: string[] = [];
    let allowed = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === '/api/library/data' && !init?.method) return json(200, { practice: null, syllables: null });
        if (!allowed) return json(401, { error: 'Not signed in.' });
        puts.push(JSON.parse(String(init!.body)).value);
        return json(200, { value: JSON.parse(String(init!.body)).value });
      }),
    );
    await data.accountData('Ayu');
    allowed = false;
    data.writeData('harpforge:practice-log', JSON.stringify({ s: [{ at: 5 }] }));
    await new Promise((r) => setTimeout(r, 10));
    expect(puts).toEqual([]);
    allowed = true;
    await data.accountData('Ayu', true);
    await new Promise((r) => setTimeout(r, 10));
    expect(puts).toEqual([JSON.stringify({ s: [{ at: 5 }] })]);
    data.browserData();
  });
});
