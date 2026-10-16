// The HarpForge server: the built app and its API, on this computer and the local network.
// Started in the background by `npm run deploy`, stopped by `npm run undeploy`.

import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createApi } from './api.ts';
import { addresses, allowedHost } from './hosts.ts';
import { DATA_DIR, DIST_DIR, PID_FILE, PORT } from './config.ts';
import { portInUse } from './port.ts';
import { serveStatic } from './static.ts';

/** This run's token: in the pid file (this computer only), for undeploy to ask it to stop. */
const token = randomBytes(24).toString('hex');
const urls = addresses(PORT);

/** Requests being answered now; and whether it's stopping (new ones are turned away). */
let inFlight = 0;
let stopping = false;

/**
 * Stops: new requests are turned away; the ones under way — a save, a restore — finish (ten
 * seconds at most); then it goes. Its pid file goes too, if it's still its own.
 */
const quit = () => {
  if (stopping) return;
  stopping = true;
  server.close();
  server.closeIdleConnections();
  const since = Date.now();
  const bye = async () => {
    const mine = await readFile(PID_FILE, 'utf8').then((t) => t.includes(token), () => false);
    if (mine) await rm(PID_FILE, { force: true }).catch(() => undefined);
    process.exit(0);
  };
  const wait = setInterval(() => {
    if (inFlight > 0 && Date.now() - since < 10000) return;
    clearInterval(wait);
    server.closeAllConnections();
    void bye();
  }, 25);
};

const api = createApi({ dataDir: DATA_DIR, shutdown: { token, run: () => void setTimeout(quit, 50) } });

const server = createServer((req, res) => {
  if (stopping) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', Connection: 'close', 'Retry-After': '5' }).end('HarpForge is stopping.');
    return;
  }
  inFlight++;
  res.once('close', () => inFlight--);
  void (async () => {
    try {
      if (!allowedHost(req.headers.host)) {
        res.writeHead(421, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not this server’s name.');
        return;
      }
      // ("server": this deployed one, which deploy / undeploy may start and stop; not the dev server.)
      if (await api(req, res, { urls, mode: 'server' })) return;
      if (await serveStatic(req, res, DIST_DIR)) return;
      res.writeHead(405).end();
    } catch (e) {
      console.error(e);
      if (!res.headersSent) res.writeHead(500).end();
      else res.destroy();
    }
  })();
});

server.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EADDRINUSE') console.error(`Port ${PORT} is already in use by another program. Nothing was changed. (Choose another with HARPFORGE_PORT.)`);
  else console.error(e);
  process.exit(1);
});

/** Temporary files a crash left half-written (over a minute old: not another server's, being written now). */
async function sweepTemporary(dir: string, depth = 0): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && depth < 3 && !entry.name.startsWith('.lock')) await sweepTemporary(full, depth + 1);
    else if (entry.isFile() && entry.name.endsWith('.tmp')) {
      const age = Date.now() - ((await stat(full).catch(() => null))?.mtimeMs ?? Date.now());
      if (age > 60000) await rm(full, { force: true }).catch(() => undefined);
    }
  }
}

// Never a port something else uses (on any of this computer's addresses).
if (await portInUse(PORT)) {
  console.error(`Port ${PORT} is already in use by another program. Nothing was changed. (Choose another with HARPFORGE_PORT.)`);
  process.exit(1);
}

// (Every address: this computer's, and the network's, IPv4 and IPv6.)
server.listen(PORT, '::', async () => {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(PID_FILE, JSON.stringify({ pid: process.pid, token, startedAt: Date.now() }));
  console.log(`${new Date().toISOString()} HarpForge is running (process ${process.pid}):`);
  for (const u of urls) console.log(`  ${u}`);
  void sweepTemporary(DATA_DIR);
});

process.on('SIGINT', quit);
process.on('SIGTERM', quit);
