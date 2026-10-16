// npm run deploy / undeploy / deploy:status — the HarpForge server in the background.
//
//   deploy     builds the app, starts the server (if it isn't running), and says where to open it
//              (--no-build: start it with the build that's there)
//   undeploy   stops it
//   status     says whether it's running, and where
//
// The server runs on its own: closing this terminal doesn't stop it (restarting the computer does).

import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { portInUse } from '../server/port.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = process.env.HARPFORGE_DATA ? path.resolve(process.env.HARPFORGE_DATA) : path.join(ROOT, 'data');
const PORT = Number(process.env.HARPFORGE_PORT) || 5280;
const PID_FILE = path.join(DATA_DIR, 'server.pid');
const LOG_FILE = path.join(DATA_DIR, 'server.log');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The deployed server's answer ({ pid, urls }), or null. (Not the dev server, which answers too.) */
async function health() {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/health`, { signal: AbortSignal.timeout(1500) });
    const body = await res.json();
    return body?.app === 'HarpForge' && body.mode === 'server' ? body : null;
  } catch {
    return null;
  }
}

function savedPid() {
  try {
    return Number(readFileSync(PID_FILE, 'utf8').trim()) || null;
  } catch {
    return null;
  }
}

/** Whether a process with this id is a Node process (so it can be ours). */
function isNode(pid) {
  if (process.platform === 'win32') {
    const r = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' });
    return /"node(\.exe)?"/i.test(r.stdout ?? '');
  }
  try {
    process.kill(pid, 0);
    return readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes('node');
  } catch {
    return false;
  }
}


function show(h) {
  console.log(`HarpForge is running (process ${h.pid}). Open it at:`);
  for (const u of h.urls ?? [`http://localhost:${PORT}`]) console.log(`  ${u}`);
}

async function deploy() {
  const running = await health();
  if (running) {
    console.log('Already running — nothing to start. (To start it again with a new build: npm run undeploy, then npm run deploy.)');
    show(running);
    return;
  }
  if (await portInUse(PORT)) {
    console.error(`Port ${PORT} is in use by another program, so HarpForge wasn't started (nothing was changed).`);
    console.error('To use another port: set HARPFORGE_PORT, e.g.  HARPFORGE_PORT=5281 npm run deploy');
    process.exit(1);
  }
  if (!process.argv.includes('--no-build')) {
    console.log('Building the app…');
    const build = spawnSync('npm run build', { cwd: ROOT, stdio: 'inherit', shell: true });
    if (build.status !== 0) {
      console.error('The build failed, so HarpForge wasn’t started.');
      process.exit(1);
    }
  } else if (!existsSync(path.join(ROOT, 'dist', 'index.html'))) {
    console.error('There’s no build yet: run npm run deploy (without --no-build).');
    process.exit(1);
  }
  mkdirSync(DATA_DIR, { recursive: true });
  const log = openSync(LOG_FILE, 'a');
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(ROOT, 'server', 'main.ts')], {
    cwd: ROOT,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', log, log],
    env: { ...process.env, NODE_ENV: 'production' },
  });
  child.unref();
  closeSync(log);
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    const h = await health();
    if (h) {
      show(h);
      console.log(`(Its log: ${path.relative(ROOT, LOG_FILE)}. Stop it with: npm run undeploy)`);
      console.log('Other devices: the first time, Windows may ask whether Node may use private networks — allow it for them to connect.');
      return;
    }
    if (child.exitCode !== null) break;
  }
  console.error(`HarpForge didn’t start. See ${path.relative(ROOT, LOG_FILE)}:`);
  console.error(readFileSync(LOG_FILE, 'utf8').split('\n').slice(-12).join('\n'));
  process.exit(1);
}

async function undeploy() {
  const h = await health();
  const pid = h?.pid ?? savedPid();
  // (Only ever our own server: the one answering as HarpForge, or the Node process it left its id for.)
  if (!pid || (!h && !isNode(pid))) {
    rmSync(PID_FILE, { force: true });
    console.log('HarpForge isn’t running.');
    return;
  }
  try {
    process.kill(pid);
  } catch {
    /* already gone */
  }
  for (let i = 0; i < 20 && (await health()); i++) await sleep(250);
  rmSync(PID_FILE, { force: true });
  console.log(`HarpForge stopped (process ${pid}).`);
}

async function status() {
  const h = await health();
  if (h) show(h);
  else console.log(`HarpForge isn’t running. (Start it with: npm run deploy)`);
}

const command = process.argv[2];
if (command === 'deploy') await deploy();
else if (command === 'undeploy') await undeploy();
else if (command === 'status') await status();
else {
  console.error('Usage: node scripts/server.mjs deploy [--no-build] | undeploy | status');
  process.exit(1);
}
