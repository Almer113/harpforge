// Phase 14b: accounts — signing up on the page, signing in and out, staying signed in,
// wrong passwords slowed, and only this site's pages may ask.

import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkName, createLimits } from './accounts.ts';
import { createApi } from './api.ts';

let dir: string;
let server: Server;
let base: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'harpforge-acc-'));
  const api = createApi({ dataDir: dir });
  server = createServer((req, res) => {
    void api(req, res).then((handled) => handled || res.writeHead(404).end());
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  await rm(dir, { recursive: true, force: true });
});

type Answer = { user?: { name: string } | null; error?: string; retryAfter?: number };

/** A browser of sorts: keeps the session cookie between requests. */
function browser() {
  let session = '';
  const call = async (p: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(`${base}${p}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(session ? { Cookie: `hf_session=${session}` } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    const m = set && /hf_session=([^;]*)/.exec(set);
    if (m) session = m[1];
    return { status: res.status, body: (await res.json()) as Answer, cookie: set };
  };
  return { call, token: () => session, setToken: (t: string) => (session = t) };
}

describe('signing up', () => {
  it('makes the account, signed in at once; the password is kept only as a hash', async () => {
    const b = browser();
    const r = await b.call('/api/account/signup', { name: '  Ayu  Lestari ', password: 'harmonica1' });
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ user: { name: 'Ayu Lestari' } });
    expect(r.cookie).toMatch(/HttpOnly/);
    expect(r.cookie).toMatch(/SameSite=Lax/);
    expect(r.cookie).toMatch(/Max-Age=2592000/);
    expect((await b.call('/api/account')).body).toEqual({ user: { name: 'Ayu Lestari' } });
    const file = await readFile(path.join(dir, 'accounts', 'ayu-lestari.json'), 'utf8');
    expect(file).not.toContain('harmonica1');
    expect(JSON.parse(file)).toMatchObject({ name: 'Ayu Lestari', key: 'ayu-lestari' });
    expect((await stat(path.join(dir, 'users', 'ayu-lestari'))).isDirectory()).toBe(true);
    // (The session's token isn't on disk either: only its hash.)
    const sessions = await readdir(path.join(dir, 'sessions'));
    expect(sessions.some((f) => f.includes(b.token()))).toBe(false);
  });

  it('a name already taken (whatever the capitals) is refused', async () => {
    await browser().call('/api/account/signup', { name: 'Budi', password: 'secret1' });
    const r = await browser().call('/api/account/signup', { name: 'BUDI', password: 'secret2' });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/taken/);
  });

  it('two sign-ups with one name at the same moment: one of them gets it', async () => {
    const both = await Promise.all([browser().call('/api/account/signup', { name: 'Twin', password: 'secret1' }), browser().call('/api/account/signup', { name: 'twin', password: 'secret2' })]);
    expect(both.map((r) => r.status).sort()).toEqual([201, 409]);
  });

  it('names and passwords that can’t be used say why', async () => {
    const r = async (name: unknown, password: unknown) => (await browser().call('/api/account/signup', { name, password })).body.error;
    expect(await r('A', 'secret1')).toMatch(/2 to 32/);
    expect(await r('../etc', 'secret1')).toMatch(/letters, numbers/);
    expect(await r('con', 'secret1')).toMatch(/can’t be used/);
    expect(await r('Siti', '12345')).toMatch(/at least 6/);
    expect(await r(42, 'secret1')).toMatch(/2 to 32/);
    expect(checkName('Ñoño Ünal').key).toBe('ñoño-ünal');
  });
});

describe('signing in and out', () => {
  it('right password: signed in; wrong one, or no such account: the same answer', async () => {
    await browser().call('/api/account/signup', { name: 'Citra', password: 'melodica' });
    const b = browser();
    expect((await b.call('/api/account')).body).toEqual({ user: null });
    const wrong = await b.call('/api/account/signin', { name: 'Citra', password: 'nope-nope' });
    const nobody = await b.call('/api/account/signin', { name: 'Nobody', password: 'nope-nope' });
    expect([wrong.status, nobody.status]).toEqual([401, 401]);
    expect(wrong.body.error).toBe(nobody.body.error);
    const ok = await b.call('/api/account/signin', { name: 'citra', password: 'melodica' });
    expect(ok.body).toEqual({ user: { name: 'Citra' } });
    expect((await b.call('/api/account')).body.user?.name).toBe('Citra');
  });

  it('signing out ends the session (its token no longer works anywhere)', async () => {
    const b = browser();
    await b.call('/api/account/signup', { name: 'Dewi', password: 'secret1' });
    const token = b.token();
    const out = await b.call('/api/account/signout', {});
    expect(out.cookie).toMatch(/Max-Age=0/);
    const other = browser();
    other.setToken(token);
    expect((await other.call('/api/account')).body).toEqual({ user: null });
  });

  it('a session past its 30 days has ended; one used again is renewed', async () => {
    const b = browser();
    await b.call('/api/account/signup', { name: 'Eko', password: 'secret1' });
    const files = await readdir(path.join(dir, 'sessions'));
    // (Its file: the newest session there.)
    const stats = await Promise.all(files.map(async (f) => ({ f, t: (await stat(path.join(dir, 'sessions', f))).mtimeMs })));
    const file = path.join(dir, 'sessions', stats.sort((a, b2) => b2.t - a.t)[0].f);
    await writeFile(file, JSON.stringify({ user: 'eko', expires: Date.now() + 2 * 86400000 }));
    const renewed = await b.call('/api/account');
    expect(renewed.body.user?.name).toBe('Eko');
    expect(renewed.cookie).toMatch(/Max-Age=2592000/);
    expect(JSON.parse(await readFile(file, 'utf8')).expires).toBeGreaterThan(Date.now() + 29 * 86400000);
    await writeFile(file, JSON.stringify({ user: 'eko', expires: Date.now() - 1000 }));
    expect((await b.call('/api/account')).body).toEqual({ user: null });
  });

  it('a made-up or odd cookie is no one', async () => {
    const b = browser();
    for (const t of ['abc', 'x'.repeat(43), '../../accounts/eko']) {
      b.setToken(t);
      expect((await b.call('/api/account')).body).toEqual({ user: null });
    }
  });
});

describe('protection', () => {
  it('another site’s page can’t sign anyone up or in', async () => {
    const r = await browser().call('/api/account/signup', { name: 'Evil', password: 'secret1' }, { Origin: 'http://evil.example' });
    expect(r.status).toBe(403);
    const same = await browser().call('/api/account/signup', { name: 'Fajar', password: 'secret1' }, { Origin: base });
    expect(same.status).toBe(201);
  });

  it('wrong passwords: after 5, each try waits longer (1 s, 2 s…, a minute at most); a right one forgets them', () => {
    let t = 0;
    const lim = createLimits(() => t);
    for (let i = 0; i < 5; i++) {
      lim.checkSignIn('a');
      lim.failed('a');
    }
    expect(() => lim.checkSignIn('a')).toThrow(/1 s/);
    t += 1000;
    lim.checkSignIn('a');
    lim.failed('a');
    expect(() => lim.checkSignIn('a')).toThrow(/2 s/);
    // Another address isn't held up.
    lim.checkSignIn('b');
    for (let i = 0; i < 20; i++) lim.failed('a');
    expect(() => lim.checkSignIn('a')).toThrow(/60 s/);
    lim.succeeded('a');
    lim.checkSignIn('a');
    // 15 minutes without one: forgotten.
    for (let i = 0; i < 6; i++) lim.failed('c');
    t += 16 * 60000;
    lim.checkSignIn('c');
  });

  it('too many wrong passwords over HTTP: 429, with when to try again', async () => {
    const b = browser();
    let last = 0;
    for (let i = 0; i < 6; i++) last = (await b.call('/api/account/signin', { name: 'Citra', password: 'wrong-one' })).status;
    expect(last).toBe(429);
    const r = await b.call('/api/account/signin', { name: 'Citra', password: 'melodica' });
    expect(r.status).toBe(429);
    expect(r.body.retryAfter).toBeGreaterThan(0);
  });
});
