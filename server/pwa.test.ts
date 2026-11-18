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
    // A file that changes under the same name (a new icon) gives a new version too.
    const files = ['index.html', 'icons/icon-192.png'];
    expect(version(serviceWorkerSource(template, files, ['old icon']))).not.toBe(version(serviceWorkerSource(template, files, ['new icon'])));
    expect(version(serviceWorkerSource(template, files, ['same']))).toBe(version(serviceWorkerSource(template, files, ['same'])));
  });
});

describe('the HarpForge mark', () => {
  const holes = (d: string) => (d.match(/M\d+ 112V144H\d+V112Z/g) ?? []).length;

  it('five holes, in the favicon and the header (never more: they blur when small)', () => {
    const svg = read('public/favicon.svg').toString();
    const app = read('src/App.tsx').toString();
    expect(holes(svg)).toBe(5);
    expect(holes(/<svg viewBox="0 0 256 256"[\s\S]*?d="([^"]+)"/.exec(app)?.[1] ?? '')).toBe(5);
  });

  it('the favicon: deep brass on light browser chrome, the bright brass only on dark', () => {
    const svg = read('public/favicon.svg').toString();
    expect(svg).toMatch(/^<svg[^>]*><title>HarpForge<\/title><style>path\{fill:#8f5e14\}@media \(prefers-color-scheme:dark\)\{path\{fill:#e3a948\}\}<\/style>/);
  });

  it('the page links the ICO before the SVG, and a 1200×630 link-preview image', () => {
    const html = read('index.html').toString();
    expect(html.indexOf('href="/favicon.ico"')).toBeGreaterThan(0);
    expect(html.indexOf('href="/favicon.ico"')).toBeLessThan(html.indexOf('href="/favicon.svg"'));
    expect(html).toContain('<meta property="og:image" content="https://almer113.github.io/harpforge/og-image.png" />');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(pngSize('public/og-image.png')).toEqual([1200, 630]);
    expect(read('public/favicon.ico').readUInt16LE(2)).toBe(1); // an icon file
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
