// Whether a port is already used by something. (Windows lets a new server take a port on
// "all addresses" while another program holds it on one — 5173 on ::1, say — so trying to
// listen isn't enough: anything answering on any of this computer's addresses counts.)

import { connect, createServer } from 'node:net';
import { networkInterfaces } from 'node:os';
import { isTailscale, tailscaleServeUrl } from './hosts.ts';

function answers(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const done = (used: boolean) => {
      socket.destroy();
      resolve(used);
    };
    socket.setTimeout(700, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

function canListen(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', (e: NodeJS.ErrnoException) => resolve(e.code === 'EAFNOSUPPORT' || e.code === 'EADDRNOTAVAIL'));
    probe.listen({ port, host, exclusive: true }, () => probe.close(() => resolve(true)));
  });
}

/** This computer's addresses: loopback (IPv4 and IPv6) and the network's. */
export function localHosts(): string[] {
  const hosts = ['127.0.0.1', '::1'];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (!a.internal && !hosts.includes(a.address) && !a.address.startsWith('fe80')) hosts.push(a.address);
  }
  return hosts;
}

/**
 * True if anything uses the port (nothing is touched: it's only asked, and let go). Tailscale
 * Serve answering it on this computer's Tailscale address, handing on to this same port here
 * (`serveUrl`), doesn't count: that's this server's own https front, not another program.
 */
export async function portInUse(port: number, serveUrl: string | null = tailscaleServeUrl(port)): Promise<boolean> {
  const servePort = serveUrl ? Number(new URL(serveUrl).port || 443) : 0;
  const hosts = localHosts().filter((h) => !(servePort === port && isTailscale(h)));
  const answered = await Promise.all(hosts.map((h) => answers(h, port)));
  if (answered.some(Boolean)) return true;
  return !(await canListen('::', port)) || !(await canListen('0.0.0.0', port));
}
