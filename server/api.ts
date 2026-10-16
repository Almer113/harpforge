// The server's API, under /api: used by the deployed server and, in development, by Vite's
// dev server (the same code, the same data folder).

import type { IncomingMessage, ServerResponse } from 'node:http';

export interface ApiOptions {
  dataDir: string;
}

const startedAt = Date.now();

export function sendJson(res: ServerResponse, status: number, body: unknown) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(text) });
  res.end(text);
}

/** A request's JSON body (at most `limit` bytes); throws on anything else. */
export async function readBody<T>(req: IncomingMessage, limit = 5 * 1024 * 1024): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('too large'), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null') as T;
  } catch {
    throw Object.assign(new Error('not JSON'), { status: 400 });
  }
}

/** Handles a request if it's for the API (true), else leaves it (false). */
export function createApi(opts: ApiOptions) {
  void opts;
  return async (req: IncomingMessage, res: ServerResponse, extra: Record<string, unknown> = {}): Promise<boolean> => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (!url.pathname.startsWith('/api/') && url.pathname !== '/api') return false;
    try {
      if (url.pathname === '/api/health' && req.method === 'GET') {
        sendJson(res, 200, { app: 'HarpForge', pid: process.pid, startedAt, ...extra });
        return true;
      }
      sendJson(res, 404, { error: 'no such API' });
    } catch (e) {
      const status = (e as { status?: number }).status ?? 500;
      if (status === 500) console.error(e);
      sendJson(res, status, { error: status === 500 ? 'server error' : (e as Error).message });
    }
    return true;
  };
}
