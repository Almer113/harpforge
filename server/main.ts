// The HarpForge server: the built app and its API, on this computer and the local network.
// Started in the background by `npm run deploy`, stopped by `npm run undeploy`.

import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createApi } from './api.ts';
import { DATA_DIR, DIST_DIR, PID_FILE, PORT } from './config.ts';
import { portInUse } from './port.ts';
import { serveStatic } from './static.ts';

/** The addresses the app can be opened at: this computer, then the local network. */
export function addresses(port: number): string[] {
  const out = [`http://localhost:${port}`];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) out.push(`http://${a.address}:${port}`);
  }
  return out;
}

const api = createApi({ dataDir: DATA_DIR });
const urls = addresses(PORT);

const server = createServer((req, res) => {
  void (async () => {
    try {
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
  await writeFile(PID_FILE, String(process.pid));
  console.log(`${new Date().toISOString()} HarpForge is running (process ${process.pid}):`);
  for (const u of urls) console.log(`  ${u}`);
});

const quit = () => {
  server.close();
  void rm(PID_FILE, { force: true }).finally(() => process.exit(0));
};
process.on('SIGINT', quit);
process.on('SIGTERM', quit);
