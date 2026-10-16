// Where this server can be opened, and the names it answers to.

import { hostname, networkInterfaces } from 'node:os';

/** The addresses the app can be opened at: this computer, then the local network. */
export function addresses(port: number): string[] {
  const out = [`http://localhost:${port}`];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) out.push(`http://${a.address}:${port}`);
  }
  return out;
}

/**
 * The names this server answers to: localhost, this computer's addresses and its name. A
 * web page elsewhere whose own name was pointed at this computer ("DNS rebinding") arrives
 * with its own name, and is turned away.
 */
export function allowedHost(host: string | undefined): boolean {
  if (!host) return false;
  const name = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase();
  const me = hostname().toLowerCase();
  if (['localhost', '127.0.0.1', '::1', me, `${me}.local`, `${me}.lan`].includes(name)) return true;
  for (const list of Object.values(networkInterfaces())) for (const a of list ?? []) if (a.address.toLowerCase() === name) return true;
  return false;
}
