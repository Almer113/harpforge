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
    signedIn = 'Almer';
    await startAccount();
    expect(s().account).toEqual({ status: 'signed-in', name: 'Almer' });
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
    const a = await signInAs('Almer', 'right-one');
    expect(a.ok).toBe(true);
    expect(await libraryKind()).toBe('account');
    expect(s().docId).toBeNull();
    expect(s().savedText).toBe(s().text);
    expect(s().accountGate).toBeNull();
    // This browser has a song of yours: the offer to bring it.
    expect(s().bringOffer).toEqual({ name: 'Almer', songs: 1 });
  });

  it('a wrong password: still a guest, the reason to show', async () => {
    await startAccount();
    const a = await signInAs('Almer', 'nope');
    expect(a).toMatchObject({ ok: false, message: 'That name and password don’t match an account.' });
    expect(s().account.status).toBe('guest');
    expect(await libraryKind()).toBe('browser');
  });

  it('signing out: this browser’s library and the start screen; an edited open song stays, unsaved', async () => {
    signedIn = 'Almer';
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
    signedIn = 'Almer';
    await startAccount();
    s().loadText('---\ntitle: A\n---\n4 |\n', 'remote-id', true);
    signedIn = null;
    await expect(accountBackend().tabs.all()).rejects.toThrow(/signed out/);
    expect(s().account).toEqual({ status: 'signed-out', name: 'Almer' });
    expect(s().accountGate).toBe('signin');
    await signInAs('Almer', 'right-one');
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
    await type(name, 'Almer');
    await type(password, 'nope');
    await act(async () => host.querySelector<HTMLFormElement>('.account-form')!.requestSubmit());
    await act(async () => new Promise((r) => setTimeout(r, 20)));
    expect(host.querySelector('.account-error')?.textContent).toMatch(/don’t match/);
    await type(password, 'right-one');
    await act(async () => host.querySelector<HTMLFormElement>('.account-form')!.requestSubmit());
    await act(async () => new Promise((r) => setTimeout(r, 20)));
    expect(s().account).toEqual({ status: 'signed-in', name: 'Almer' });
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
    signedIn = 'Almer';
    useApp.setState({ libraryOwner: 'browser' });
    s().loadText('---\ntitle: G\n---\n4 |\n', 'guest-id', true);
    await startAccount();
    expect(s().docId).toBeNull();
    expect(s().libraryOwner).toBe('account:almer');
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
