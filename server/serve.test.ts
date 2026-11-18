// Tailscale Serve in front of the server: https on the tailnet, handed on from this computer.
// Such a request isn't "this computer"; its sender is the tailnet device; its cookie is Secure.

import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, request, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { hostname, tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi, ipOf, isLocal, viaServe } from './api.ts';
import { addresses, isTailscale, serveUrlFrom } from './hosts.ts';

const TS_HOST = `${hostname().toLowerCase()}.tail734df4.ts.net:5280`;
/** What Serve sends on: its own headers, under the computer's Tailscale name. */
const SERVE = { host: TS_HOST, 'x-forwarded-proto': 'https', 'x-forwarded-for': '100.99.11.65', 'tailscale-user-login': 'someone@example.com' };

const fake = (remoteAddress: string, headers: Record<string, string>) => ({ socket: { remoteAddress }, headers }) as unknown as IncomingMessage;

describe('who is asking', () => {
  it('this computer: loopback, by its own name', () => {
    const req = fake('127.0.0.1', { host: 'localhost:5280' });
    expect([isLocal(req), viaServe(req), ipOf(req)]).toEqual([true, false, '127.0.0.1']);
  });

  it('through Serve: not this computer; the tailnet device that sent it', () => {
    const req = fake('127.0.0.1', SERVE);
    expect([isLocal(req), viaServe(req), ipOf(req)]).toEqual([false, true, '100.99.11.65']);
  });

  it('the address Serve added counts (the last one), not one the sender made up', () => {
    expect(ipOf(fake('127.0.0.1', { ...SERVE, 'x-forwarded-for': '1.2.3.4, 100.99.11.65' }))).toBe('100.99.11.65');
    expect(ipOf(fake('127.0.0.1', { ...SERVE, 'x-forwarded-for': 'nonsense' }))).toBe('tailnet');
  });

  it('from the network, Serve’s headers mean nothing', () => {
    const req = fake('192.168.1.20', SERVE);
    expect([isLocal(req), viaServe(req), ipOf(req)]).toEqual([false, false, '192.168.1.20']);
  });
});

describe('Serve’s address', () => {
  // (As `tailscale serve status --json` puts it: other apps' ports too.)
  const status = {
    TCP: { '443': { HTTPS: true }, '4100': { HTTPS: true }, '5280': { HTTPS: true } },
    Web: {
      'pc.tail734df4.ts.net:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:4173' } } },
      'pc.tail734df4.ts.net:4100': { Handlers: { '/': { Proxy: 'http://127.0.0.1:4100' } } },
      'pc.tail734df4.ts.net:5280': { Handlers: { '/': { Proxy: 'http://127.0.0.1:5280' } } },
    },
  };

  it('the one that hands on to this port; none if there isn’t one', () => {
    expect(serveUrlFrom(status, 5280)).toBe('https://pc.tail734df4.ts.net:5280');
    expect(serveUrlFrom(status, 4173)).toBe('https://pc.tail734df4.ts.net');
    expect(serveUrlFrom(status, 5281)).toBeNull();
    expect(serveUrlFrom(null, 5280)).toBeNull();
    expect(serveUrlFrom({ Web: { 'pc.tail734df4.ts.net:5280': { Handlers: { '/': { Proxy: 'http://192.168.1.5:5280' } } } } }, 5280)).toBeNull();
  });

  it('Tailscale’s addresses, IPv4 and IPv6 (Serve answers on both: not "another program")', () => {
    for (const ip of ['100.64.0.1', '100.85.105.99', '100.127.255.254', 'fd7a:115c:a1e0::a438:6963']) expect(isTailscale(ip)).toBe(true);
    for (const ip of ['100.63.255.255', '100.128.0.1', '192.168.1.10', '127.0.0.1', 'fd7a:115c:a1e1::1', '::1']) expect(isTailscale(ip)).toBe(false);
  });

  it('is listed, in place of the plain http Tailscale address on the same port', () => {
    const list = addresses(5280, 'https://pc.tail734df4.ts.net:5280');
    expect(list[0]).toBe('http://localhost:5280');
    expect(list.at(-1)).toBe('https://pc.tail734df4.ts.net:5280');
    expect(list.filter((u) => /^http:\/\/100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(u))).toEqual([]);
    expect(addresses(5280, null).some((u) => u.startsWith('https://'))).toBe(false);
  });
});

describe('through Serve, against the API', () => {
  let dir: string;
  let server: Server;
  let port: number;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'harpforge-serve-'));
    const api = createApi({ dataDir: dir });
    server = createServer((req, res) => void api(req, res, { mode: 'server' }).then((h) => h || res.writeHead(404).end()));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise((r) => server.close(r));
    await rm(dir, { recursive: true, force: true });
  });

  /** A request with its own Host header (fetch won't set one). */
  const send = (method: string, p: string, headers: Record<string, string>, body?: string) =>
    new Promise<{ status: number; headers: IncomingMessage['headers']; json: Record<string, unknown> }>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, method, path: p, headers: { ...headers, ...(body ? { 'content-type': 'application/json' } : {}) } }, (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, json: text ? JSON.parse(text) : {} }));
      });
      req.on('error', reject);
      req.end(body);
    });

  it('health: the process only to this computer, not to the tailnet', async () => {
    expect((await send('GET', '/api/health', { host: 'localhost:5280' })).json.pid).toBe(process.pid);
    const viaTailnet = await send('GET', '/api/health', SERVE);
    expect(viaTailnet.json).toEqual({ app: 'HarpForge', mode: 'server' });
  });

  it('the session cookie: Secure over https (through Serve), as before on plain http', async () => {
    const body = (name: string) => JSON.stringify({ name, password: 'harmonica' });
    const tailnet = await send('POST', '/api/account/signup', { ...SERVE, origin: `https://${TS_HOST}` }, body('Ayu'));
    expect(tailnet.status).toBe(201);
    expect(String(tailnet.headers['set-cookie'])).toMatch(/HttpOnly; SameSite=Lax; Path=\/; Max-Age=\d+; Secure$/);
    const here = await send('POST', '/api/account/signup', { host: 'localhost:5280', origin: 'http://localhost:5280' }, body('Lestari'));
    expect(here.status).toBe(201);
    expect(String(here.headers['set-cookie'])).not.toContain('Secure');
  });

  it('shutting down isn’t for the tailnet, even with the right header name', async () => {
    expect((await send('POST', '/api/shutdown', { ...SERVE, 'x-harpforge-shutdown': 'x' })).status).toBe(403);
  });
});
