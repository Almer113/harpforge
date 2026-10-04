// Pages in the URL (#/library, #/play, #/edit), so Back/Forward and bookmarks work.
// Share links (#tab=…) are handled by share.ts and replaced by the page's own hash.

import { useApp, type Page } from './store';

const SLUGS: Record<Page, string> = { play: 'play', editor: 'edit', library: 'library' };

function pageFromHash(hash: string): Page | null {
  const m = /^#\/([a-z]+)/.exec(hash);
  if (!m) return null;
  const hit = (Object.keys(SLUGS) as Page[]).find((p) => SLUGS[p] === m[1]);
  return hit ?? null;
}

const hashFor = (p: Page) => `#/${SLUGS[p]}`;

/** Reads the page from the URL and keeps the two in step. Call once at start-up. */
export function startRouter() {
  // The old Convert page is now the import dialog.
  if (location.hash.startsWith('#/convert')) {
    history.replaceState(null, '', location.pathname + location.search + hashFor(useApp.getState().page));
    useApp.setState({ importDraft: { name: 'Pasted text', pasteText: '' } });
  }
  const initial = pageFromHash(location.hash);
  if (initial) useApp.getState().setPage(initial);
  else if (!/[#&]tab=/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search + hashFor(useApp.getState().page));

  // Page changes in the app add a history entry…
  useApp.subscribe((s, prev) => {
    if (s.page !== prev.page && pageFromHash(location.hash) !== s.page) history.pushState(null, '', location.pathname + location.search + hashFor(s.page));
  });
  // …and Back / Forward / an edited URL change the page.
  const sync = () => {
    const p = pageFromHash(location.hash);
    if (p && p !== useApp.getState().page) useApp.getState().setPage(p);
  };
  window.addEventListener('popstate', sync);
  window.addEventListener('hashchange', sync);
}
