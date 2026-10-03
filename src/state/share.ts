// Share links: the whole tab, compressed, in the URL's #fragment. Nothing is sent
// to a server — the fragment never leaves the browser until someone opens the link.

import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';
import { loadTabText } from './actions';
import { useApp } from './store';

const PARAM = 'tab';

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function encodeTab(text: string): string {
  return toBase64Url(deflateSync(strToU8(text), { level: 9 }));
}

export function decodeTab(code: string): string {
  return strFromU8(inflateSync(fromBase64Url(code)));
}

export function shareLink(text: string): string {
  return `${location.origin}${location.pathname}#${PARAM}=${encodeTab(text)}`;
}

/** Copies a link to the current tab. */
export async function copyShareLink() {
  const s = useApp.getState();
  const link = shareLink(s.text);
  try {
    await navigator.clipboard.writeText(link);
    s.notify(link.length > 8000 ? 'Link copied — it’s long, so some apps may cut it off.' : 'Share link copied ✓');
  } catch {
    window.prompt('Copy this link:', link);
  }
}

/** Opens a tab from the page URL, if there is one. */
export function openSharedFromUrl() {
  const m = new RegExp(`[#&]${PARAM}=([A-Za-z0-9_-]+)`).exec(location.hash);
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search);
  try {
    const text = decodeTab(m[1]);
    loadTabText(text, 'shared link', { unchanged: true, message: 'Opened a shared tab — Save it to keep it in your library.' });
    useApp.getState().setPage('play');
  } catch {
    useApp.getState().notify('That share link is damaged or incomplete.');
  }
}
