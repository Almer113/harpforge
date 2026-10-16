// The HarpForge server: the built app and its API, on this computer and the local network.
// Started in the background by `npm run deploy`, stopped by `npm run undeploy`.

import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createApi } from './api.ts';
import { addresses, allowedHost } from './hosts.ts';
import { DATA_DIR, DIST_DIR, PID_FILE, PORT } from './config.ts';
import { portInUse } from './port.ts';
import { serveStatic } from './static.ts';

/** This run's token: in the pid file (this computer only), for undeploy to ask it to stop. */
const token = randomBytes(24).toString('hex');
const urls = addresses(PORT);

const quit = () => {
  server.close();
  // (Open connections don't hold it up for long.)
  setTimeout(() => process.exit(0), 1500).unref();
  void rm(PID_FILE, { force: true }).finally(() => process.exit(0));
};

const api = createApi({ dataDir: DATA_DIR, shutdown: { token, run: () => void setTimeout(quit, 50) } });

const server = createServer((req, res) => {
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
});

process.on('SIGINT', quit);
process.on('SIGTERM', quit);
