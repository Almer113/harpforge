// Where this server can be opened, and the names it answers to.

import { execFileSync } from 'node:child_process';
import { hostname, networkInterfaces } from 'node:os';

/** A Tailscale address (100.64.0.0/10). */
const isTailscale = (ip: string) => /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip);

/**
 * The addresses the app can be opened at: this computer, then the local network. With
 * Tailscale Serve handing https on the tailnet to this server (`serveUrl`), that address,
 * in place of the plain http one on the Tailscale address when Serve has taken its port.
 */
export function addresses(port: number, serveUrl: string | null = tailscaleServeUrl(port)): string[] {
  const out = [`http://localhost:${port}`];
  const servePort = serveUrl ? Number(new URL(serveUrl).port || 443) : 0;
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (servePort === port && isTailscale(a.address)) continue;
      out.push(`http://${a.address}:${port}`);
    }
  }
  if (serveUrl) out.push(serveUrl);
  return out;
}

/**
 * Tailscale Serve's https address that hands requests on to this port of this computer, from
 * `tailscale serve status --json` (its "Web" part: "<name>.ts.net:<port>" → handlers). Null if none.
 */
export function serveUrlFrom(status: unknown, port: number): string | null {
  const web = (status as { Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }> } | null)?.Web ?? {};
  const target = new RegExp(`^(https?://)?(127\\.0\\.0\\.1|localhost):${port}/?$`);
  for (const [where, site] of Object.entries(web)) {
    const m = /^([a-z0-9.-]+\.ts\.net):(\d+)$/i.exec(where);
    if (m && target.test(site?.Handlers?.['/']?.Proxy ?? '')) return `https://${m[1].toLowerCase()}${m[2] === '443' ? '' : `:${m[2]}`}`;
  }
  return null;
}

/** This computer's Tailscale Serve address for the port (asked of Tailscale; none if it isn't there). */
export function tailscaleServeUrl(port: number): string | null {
  try {
    const out = execFileSync('tailscale', ['serve', 'status', '--json'], { encoding: 'utf8', timeout: 3000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    return serveUrlFrom(JSON.parse(out), port);
  } catch {
    return null;
  }
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
  // Its Tailscale name (MagicDNS): this computer's name in a tailnet, "<name>.<tailnet>.ts.net".
  if (name.startsWith(`${me}.`) && /^[a-z0-9-]+\.ts\.net$/.test(name.slice(me.length + 1))) return true;
  for (const list of Object.values(networkInterfaces())) for (const a of list ?? []) if (a.address.toLowerCase() === name) return true;
  return false;
}
