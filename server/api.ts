// The server's API, under /api: used by the deployed server and, in development, by Vite's
// dev server (the same code, the same data folder).
//
//   GET  /api/health           it's HarpForge (and where it can be opened)
//   GET  /api/account          who's signed in here ({ user: { name } } or { user: null })
//   POST /api/account/signup   { name, password }: a new account, signed in
//   POST /api/account/signin   { name, password }
//   POST /api/account/signout

import type { IncomingMessage, ServerResponse } from 'node:http';
import { createAccounts, createLimits, SESSION_DAYS, UserError, type User } from './accounts.ts';

export interface ApiOptions {
  dataDir: string;
}

const startedAt = Date.now();
const COOKIE = 'hf_session';

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string | string[]> = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(text), ...headers });
  res.end(text);
}

/** A request's JSON body (at most `limit` bytes); throws on anything else. */
export async function readBody<T>(req: IncomingMessage, limit = 5 * 1024 * 1024): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) throw new UserError(413, 'That’s too large.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null') as T;
  } catch {
    throw new UserError(400, 'Not JSON.');
  }
}

export function cookie(req: IncomingMessage, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

/** The session cookie: scripts can't read it, other sites' forms don't send it. (Plain http: not Secure.) */
const sessionCookie = (token: string) => `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}`;
const clearCookie = `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;

/**
 * A change asked from another site's page is refused: its Origin must be this server's.
 * (Requests without one — not from a browser page — are let through.)
 */
function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

const ipOf = (req: IncomingMessage) => req.socket.remoteAddress ?? '?';

/** Handles a request if it's for the API (true), else leaves it (false). */
export function createApi(opts: ApiOptions) {
  const accounts = createAccounts(opts.dataDir);
  const limits = createLimits();

  /** Who's signed in on this request (renewing the cookie when the session was renewed). */
  async function whoIs(req: IncomingMessage, headers: Record<string, string>): Promise<User | null> {
    const token = cookie(req, COOKIE);
    const found = await accounts.sessionUser(token);
    if (found?.renewed && token) headers['Set-Cookie'] = sessionCookie(token);
    return found?.user ?? null;
  }

  const route = async (req: IncomingMessage, res: ServerResponse, url: URL, extra: Record<string, unknown>) => {
    const { pathname } = url;
    const method = req.method ?? 'GET';
    if (pathname === '/api/health' && method === 'GET') return sendJson(res, 200, { app: 'HarpForge', pid: process.pid, startedAt, ...extra });

    if (pathname.startsWith('/api/account')) {
      if (method === 'POST' && !sameOrigin(req)) throw new UserError(403, 'Refused: asked from another site.');
      const headers: Record<string, string> = {};
      if (pathname === '/api/account' && method === 'GET') {
        const user = await whoIs(req, headers);
        return sendJson(res, 200, { user: user && { name: user.name } }, headers);
      }
      if (pathname === '/api/account/signup' && method === 'POST') {
        const body = (await readBody<{ name?: unknown; password?: unknown }>(req, 10000)) ?? {};
        limits.checkSignUp(ipOf(req));
        const user = await accounts.signUp(body.name, body.password);
        const token = await accounts.startSession(user);
        return sendJson(res, 201, { user: { name: user.name } }, { 'Set-Cookie': sessionCookie(token) });
      }
      if (pathname === '/api/account/signin' && method === 'POST') {
        const body = (await readBody<{ name?: unknown; password?: unknown }>(req, 10000)) ?? {};
        const ip = ipOf(req);
        limits.checkSignIn(ip);
        const user = await accounts.verify(body.name, body.password);
        if (!user) {
          limits.failed(ip);
          throw new UserError(401, 'That name and password don’t match an account.');
        }
        limits.succeeded(ip);
        const token = await accounts.startSession(user);
        return sendJson(res, 200, { user: { name: user.name } }, { 'Set-Cookie': sessionCookie(token) });
      }
      if (pathname === '/api/account/signout' && method === 'POST') {
        await accounts.endSession(cookie(req, COOKIE));
        return sendJson(res, 200, { user: null }, { 'Set-Cookie': clearCookie });
      }
    }
    sendJson(res, 404, { error: 'no such API' });
  };

  return async (req: IncomingMessage, res: ServerResponse, extra: Record<string, unknown> = {}): Promise<boolean> => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (!url.pathname.startsWith('/api/') && url.pathname !== '/api') return false;
    try {
      await route(req, res, url, extra);
    } catch (e) {
      if (e instanceof UserError) {
        const headers: Record<string, string> = e.extra.retryAfter ? { 'Retry-After': String(e.extra.retryAfter) } : {};
        sendJson(res, e.status, { error: e.message, ...e.extra }, headers);
      } else {
        console.error(e);
        if (!res.headersSent) sendJson(res, 500, { error: 'Something went wrong on the server.' });
      }
    }
    return true;
  };
}
