// Where the HarpForge server listens and keeps its files. (Overridable for tests, or if the
// port is ever wanted by something else: HARPFORGE_PORT, HARPFORGE_DATA.)

import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The project folder. */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The app as built (npm run build). */
export const DIST_DIR = path.join(ROOT, 'dist');

/** Accounts and their libraries (left out of git). */
export const DATA_DIR = process.env.HARPFORGE_DATA ? path.resolve(process.env.HARPFORGE_DATA) : path.join(ROOT, 'data');

/** 5280: free on this computer (5173 is the dev server, 4173 Vite's preview). */
export const PORT = Number(process.env.HARPFORGE_PORT) || 5280;

/** The running server's process id and its output, for deploy / undeploy / status. */
export const PID_FILE = path.join(DATA_DIR, 'server.pid');
export const LOG_FILE = path.join(DATA_DIR, 'server.log');
