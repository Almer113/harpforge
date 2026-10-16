// The built app's files. Only what's inside dist/ is ever served; the app's own pages are
// all index.html (it routes with #/library, #/play…).

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

/** The file under `root` a URL path names, or null if it would be outside it. */
export function resolveInside(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const file = path.resolve(root, `.${path.posix.normalize(`/${decoded}`)}`);
  const inside = path.relative(root, file);
  return inside.startsWith('..') || path.isAbsolute(inside) ? null : file;
}

/** Serves a file from `root` (index.html for the app's own pages). True if it answered. */
export async function serveStatic(req: IncomingMessage, res: ServerResponse, root: string): Promise<boolean> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  let file = resolveInside(root, req.url ?? '/');
  if (!file) {
    res.writeHead(400).end();
    return true;
  }
  let info = await stat(file).catch(() => null);
  if (info?.isDirectory()) {
    file = path.join(file, 'index.html');
    info = await stat(file).catch(() => null);
  }
  if (!info?.isFile()) {
    // A page of the app (no file extension): the app itself. A missing file: not found.
    if (path.extname(file)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      return true;
    }
    file = path.join(root, 'index.html');
    info = await stat(file).catch(() => null);
    if (!info?.isFile()) {
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' }).end('HarpForge isn’t built yet: run npm run deploy.');
      return true;
    }
  }
  const hashed = /[\\/]assets[\\/]/.test(file);
  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': info.size,
    // (Built files have their content's hash in their names: kept for good. The page itself: always asked again.)
    'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  if (req.method === 'HEAD') res.end();
  else createReadStream(file).pipe(res);
  return true;
}
