// Installing HarpForge as an app: the manifest and icons, the service worker's file list,
// and the Tailscale name the server answers to.

import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { allowedHost } from './hosts.ts';
import { precacheList, serviceWorkerSource } from './pwa.ts';

const root = path.join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(path.join(root, p));

/** A PNG's width and height, from its header. */
const pngSize = (p: string) => {
  const b = read(p);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
};

describe('the app as an installable app', () => {
  const manifest = JSON.parse(read('public/manifest.webmanifest').toString());

  it('has a name, a standalone window, and starts where it is served from', () => {
    expect(manifest).toMatchObject({ name: 'HarpForge', short_name: 'HarpForge', display: 'standalone', start_url: './', scope: './' });
  });

  it('every icon is there at its stated size; 192, 512 and a maskable one', () => {
    for (const icon of manifest.icons) {
      const [w, h] = pngSize(`public/${icon.src}`);
      expect(`${w}x${h}`).toBe(icon.sizes);
    }
    expect(manifest.icons.map((i: { sizes: string; purpose: string }) => `${i.sizes} ${i.purpose}`)).toEqual(['192x192 any', '512x512 any', '512x512 maskable']);
    expect(pngSize('public/icons/apple-touch-icon.png')).toEqual([180, 180]);
  });

  it('the page links the manifest and the iPhone icon', () => {
    const html = read('index.html').toString();
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    expect(html).toContain('<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />');
  });
});

describe('the service worker', () => {
  it('keeps the page, the built files and public’s, without notes or itself', () => {
    const list = precacheList(['assets/index-abc.js', 'index.html', 'sw.js'], ['favicon.svg', 'samples/harmonica/C4.wav', 'samples/harmonica/README.md']);
    expect(list).toEqual(['assets/index-abc.js', 'favicon.svg', 'index.html', 'samples/harmonica/C4.wav']);
  });

  it('gets this build’s files and a version that changes with them', () => {
    const template = read('src/pwa/sw.js').toString();
    const a = serviceWorkerSource(template, ['index.html', 'assets/a-1.js']);
    const b = serviceWorkerSource(template, ['index.html', 'assets/a-2.js']);
    expect(a).toContain('const FILES = ["index.html","assets/a-1.js"] || [];');
    expect(a).not.toContain('HF_BUILD_');
    const version = (s: string) => /const VERSION = '([0-9a-f]{12})'/.exec(s)?.[1];
    expect(version(a)).toBeDefined();
    expect(version(a)).not.toBe(version(b));
  });
});

describe('the Tailscale name', () => {
  const me = hostname().toLowerCase();

  it('this computer’s name in a tailnet is this server’s', () => {
    expect(allowedHost(`${me}.tail734df4.ts.net:5280`)).toBe(true);
    expect(allowedHost(`${me.toUpperCase()}.TAIL734DF4.TS.NET`)).toBe(true);
  });

  it('another computer’s, or a look-alike, is not', () => {
    expect(allowedHost('someone-else.tail734df4.ts.net:5280')).toBe(false);
    expect(allowedHost(`${me}.tail734df4.ts.net.evil.example`)).toBe(false);
    expect(allowedHost(`${me}.a.b.ts.net`)).toBe(false);
    expect(allowedHost(`x${me}.tail734df4.ts.net`)).toBe(false);
  });
});
