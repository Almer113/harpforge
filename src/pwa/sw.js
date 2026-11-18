// The service worker: keeps a copy of the app so it opens without a connection, once
// installed or visited. Built into dist/sw.js by server/pwa.ts, which fills in this
// build's files and version (the two placeholders below).
//
// - Pages: from the network, so a new version shows right away; the kept copy when offline.
// - The app's files: the kept copy (their names change with their content).
// - The account API (api/): never kept, always the server's answer.
// - Fonts from Google: kept, refreshed in the background.
/* global self, caches, URL, Request, Response, fetch */

const FILES = self.HF_BUILD_FILES || [];
const VERSION = 'HF_BUILD_VERSION';
const CACHE = `harpforge-${VERSION}`;
const FONTS = 'harpforge-fonts';
// Where the app is served from ("/" on the HarpForge server, "/harpforge/" on GitHub Pages):
// this worker's own folder.
const BASE = new URL('./', self.location.href).href;
const PAGE = new URL('index.html', BASE).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // (Past the browser's own cache: this build's files, not ones kept from before.)
      .then((cache) => cache.addAll(FILES.map((f) => new Request(new URL(f, BASE).href, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('harpforge-') && k !== CACHE && k !== FONTS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com') {
    event.respondWith(fonts(req));
    return;
  }
  // Another site's (e.g. the OCR's language data), or outside the app, or the account API: untouched.
  if (!url.href.startsWith(BASE) || url.href.startsWith(new URL('api/', BASE).href)) return;

  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match(PAGE).then((r) => r || Response.error())));
    return;
  }
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(
      (kept) =>
        kept ||
        fetch(req).then((res) => {
          // (One not in the list, e.g. an older page's file: kept too, if it's a whole file.)
          if (res.ok && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            void caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});

async function fonts(req) {
  const cache = await caches.open(FONTS);
  const kept = await cache.match(req);
  const fresh = fetch(req)
    .then((res) => {
      if (res.ok || res.type === 'opaque') void cache.put(req, res.clone());
      return res;
    })
    .catch(() => kept || Response.error());
  return kept || fresh;
}
