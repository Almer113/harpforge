// Phase 14e: an account's practice history and syllable fixes — kept beside its library,
// two devices' changes merged, not overwritten.

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from './api.ts';
import { mergePractice, mergeSyllables } from './userdata.ts';

describe('merging', () => {
  it('practice: both devices’ sessions, once each, in order (the last 20 a song)', () => {
    const a = { song1: [{ at: 1 }, { at: 3 }] };
    const b = { song1: [{ at: 2 }, { at: 3 }], song2: [{ at: 5 }] };
    const ats = (p: Record<string, { at: number }[]>) => Object.fromEntries(Object.entries(p).map(([k, l]) => [k, l.map((e) => e.at)]));
    expect(ats(mergePractice(a, b))).toEqual({ song2: [5], song1: [1, 2, 3] });
    const many = { s: Array.from({ length: 30 }, (_, i) => ({ at: i })) };
    expect(mergePractice(null, many).s).toHaveLength(20);
    expect(mergePractice(null, many).s[0].at).toBe(10);
    // (Anything else in it is left out.)
    expect(ats(mergePractice({ x: 'no' }, { y: [{ at: 'no' }, 7, { at: 1 }] }))).toEqual({ y: [1] });
    // A session keeps only a session's fields: nothing else, nothing nested.
    const [kept] = mergePractice(null, { s: [{ at: 1, accuracy: 80, junk: 'x'.repeat(1000), holes: ['-4', { deep: [] }] }] }).s;
    expect(kept).toEqual({ at: 1, mode: 'practice', accuracy: 80, passes: 0, clean: 0, holes: ['-4'] });
  });

  it('syllables: both sides’ words; the change’s form wins', () => {
    expect(mergeSyllables({ en: { every: 'ev-ery', river: 'riv-er' } }, { en: { every: 'ev-er-y' }, id: { sayang: 'sa-yang' } })).toEqual({
      en: { river: 'riv-er', every: 'ev-er-y' },
      id: { sayang: 'sa-yang' },
    });
  });
});

describe('over HTTP', () => {
  let dir: string;
  let server: Server;
  let base: string;
  let cookie: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'harpforge-data-'));
    const api = createApi({ dataDir: dir });
    server = createServer((req, res) => void api(req, res).then((h) => h || res.writeHead(404).end()));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const r = await fetch(`${base}/api/account/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Ayu', password: 'harmonica' }) });
    cookie = /hf_session=[^;]+/.exec(r.headers.get('set-cookie') ?? '')![0];
  });
  afterAll(async () => {
    await new Promise((r) => server.close(r));
    await rm(dir, { recursive: true, force: true });
  });

  const put = (name: string, value: unknown) =>
    fetch(`${base}/api/library/data/${name}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ value: JSON.stringify(value) }) });

  it('none yet; then each device’s change merged in, kept in practice.json', async () => {
    expect(await (await fetch(`${base}/api/library/data`, { headers: { Cookie: cookie } })).json()).toEqual({ practice: null, syllables: null });
    await put('practice', { s: [{ at: 1, accuracy: 80 }] });
    const second = (await (await put('practice', { s: [{ at: 2, accuracy: 90 }] })).json()) as { value: string };
    expect(JSON.parse(second.value).s.map((e: { at: number }) => e.at)).toEqual([1, 2]);
    expect(JSON.parse(await readFile(path.join(dir, 'users', 'ayu', 'practice.json'), 'utf8')).s).toHaveLength(2);
  });

  it('only practice and syllables; signed in only', async () => {
    expect((await put('secrets', {})).status).toBe(404);
    expect((await fetch(`${base}/api/library/data`)).status).toBe(401);
  });
});

describe('two tabs, one sign-in', () => {
  let dir: string;
  let server: Server;
  let base: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'harpforge-who-'));
    const api = createApi({ dataDir: dir });
    server = createServer((req, res) => void api(req, res).then((h) => h || res.writeHead(404).end()));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise((r) => server.close(r));
    await rm(dir, { recursive: true, force: true });
  });

  it('a page meaning one account, the browser signed in as another since: refused (not mixed up)', async () => {
    const r = await fetch(`${base}/api/account/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Siti Nur', password: 'harmonica' }) });
    const cookie = /hf_session=[^;]+/.exec(r.headers.get('set-cookie') ?? '')![0];
    const ask = (account?: string) => fetch(`${base}/api/library/tabs`, { headers: { Cookie: cookie, ...(account ? { 'X-HarpForge-Account': encodeURIComponent(account) } : {}) } });
    expect((await ask('Siti Nur')).status).toBe(200);
    expect((await ask('siti nur')).status).toBe(200);
    expect((await ask('Ayu')).status).toBe(401);
    expect((await ask()).status).toBe(200);
  });
});
