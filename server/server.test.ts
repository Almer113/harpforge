// Phase 14a: the server — the built app's files (and nothing outside them), the API's health
// answer, files written whole.

import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from './api.ts';
import { readJson, writeFileAtomic, writeJson } from './files.ts';
import { resolveInside, serveStatic } from './static.ts';

let dir: string;
let dist: string;
let server: Server;
let base: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'harpforge-'));
  dist = path.join(dir, 'dist');
  await mkdir(path.join(dist, 'assets'), { recursive: true });
  await writeFile(path.join(dist, 'index.html'), '<!doctype html><title>HarpForge</title>');
  await writeFile(path.join(dist, 'assets', 'app-1234.js'), 'console.log(1)');
  await writeFile(path.join(dir, 'secret.txt'), 'not for the web');
  const api = createApi({ dataDir: path.join(dir, 'data') });
  server = createServer((req, res) => {
    void (async () => {
      if (await api(req, res, { urls: ['http://localhost:1'] })) return;
      if (!(await serveStatic(req, res, dist))) res.writeHead(405).end();
    })();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  await rm(dir, { recursive: true, force: true });
});

describe('the app’s files', () => {
  it('the page, and the built files (kept for good: their names change with them)', async () => {
    const page = await fetch(`${base}/`);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(page.headers.get('cache-control')).toBe('no-cache');
    const js = await fetch(`${base}/assets/app-1234.js`);
    expect(js.headers.get('content-type')).toContain('text/javascript');
    expect(js.headers.get('cache-control')).toContain('immutable');
    expect(await js.text()).toBe('console.log(1)');
  });

  it('a page of the app is the app; a missing file is not found', async () => {
    expect(await (await fetch(`${base}/library`)).text()).toContain('HarpForge');
    expect((await fetch(`${base}/assets/gone.js`)).status).toBe(404);
  });

  it('nothing outside the built app, however the path is written', async () => {
    for (const p of ['/../secret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt', '/assets/..%5c..%5csecret.txt']) {
      const res = await fetch(`${base}${p}`);
      expect(await res.text()).not.toContain('not for the web');
    }
    expect(resolveInside(dist, '/../secret.txt')).toBe(path.join(dist, 'secret.txt'));
    expect(resolveInside(dist, '/%E0%A4%A')).toBeNull();
    expect(resolveInside(dist, '/a%00b')).toBeNull();
  });

  it('only GET and HEAD', async () => {
    expect((await fetch(`${base}/`, { method: 'POST' })).status).toBe(405);
  });
});

describe('the API', () => {
  it('answers that it’s HarpForge (its process, where it can be opened)', async () => {
    const body = await (await fetch(`${base}/api/health`)).json();
    expect(body).toMatchObject({ app: 'HarpForge', pid: process.pid, urls: ['http://localhost:1'] });
  });

  it('unknown API paths: not found (not the app’s page)', async () => {
    const res = await fetch(`${base}/api/nothing`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no such API' });
  });
});

describe('files written whole', () => {
  it('replaces the old file; no temporary files left behind', async () => {
    const file = path.join(dir, 'data', 'x', 'a.json');
    await writeJson(file, { a: 1 });
    await writeJson(file, { a: 2 });
    expect(await readJson(file, null)).toEqual({ a: 2 });
    expect(await readdir(path.dirname(file))).toEqual(['a.json']);
  });

  it('a file that isn’t there: the fallback; text and bytes as given', async () => {
    expect(await readJson(path.join(dir, 'nope.json'), 'none')).toBe('none');
    const file = path.join(dir, 'song.htab');
    await writeFileAtomic(file, 'Ünïcode 4 -4 |\n');
    expect(await readFile(file, 'utf8')).toBe('Ünïcode 4 -4 |\n');
  });
});

describe('ports', () => {
  it('a port something listens on (on any one address) is in use; free once it lets go', async () => {
    const { portInUse } = await import('./port.ts');
    const other = createServer();
    await new Promise<void>((r) => other.listen(0, '127.0.0.1', r));
    const port = (other.address() as AddressInfo).port;
    expect(await portInUse(port)).toBe(true);
    await new Promise((r) => other.close(r));
    expect(await portInUse(port)).toBe(false);
  });
});
