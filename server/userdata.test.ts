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
    expect(mergePractice(a, b)).toEqual({ song2: [{ at: 5 }], song1: [{ at: 1 }, { at: 2 }, { at: 3 }] });
    const many = { s: Array.from({ length: 30 }, (_, i) => ({ at: i })) };
    expect(mergePractice(null, many).s).toHaveLength(20);
    expect(mergePractice(null, many).s[0].at).toBe(10);
    // (Anything else in it is left out.)
    expect(mergePractice({ x: 'no' }, { y: [{ at: 'no' }, 7, { at: 1 }] })).toEqual({ y: [{ at: 1 }] });
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
    const r = await fetch(`${base}/api/account/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Almer', password: 'harmonica' }) });
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
    expect(JSON.parse(await readFile(path.join(dir, 'users', 'almer', 'practice.json'), 'utf8')).s).toHaveLength(2);
  });

  it('only practice and syllables; signed in only', async () => {
    expect((await put('secrets', {})).status).toBe(404);
    expect((await fetch(`${base}/api/library/data`)).status).toBe(401);
  });
});
