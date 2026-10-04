// Share links: the whole tab, compressed, in the URL's #fragment. Nothing is sent
// to a server — the fragment never leaves the browser until someone opens the link.

import { deflateSync, Inflate, strFromU8, strToU8 } from 'fflate';
import { loadTabText } from './actions';
import { pageHash } from './router';
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

/** Longest tab a link may hold once unpacked (real tabs are a few KB). */
export const MAX_SHARED_BYTES = 1_000_000;

export class SharedTooLarge extends Error {}

/** Unpacks a link's tab, giving up past MAX_SHARED_BYTES (a crafted link could unpack to gigabytes). */
export function decodeTab(code: string): string {
  const input = fromBase64Url(code);
  const parts: Uint8Array[] = [];
  let size = 0;
  const inflate = new Inflate((chunk) => {
    size += chunk.length;
    if (size > MAX_SHARED_BYTES) throw new SharedTooLarge('too large');
    parts.push(chunk);
  });
  // Fed in small pieces, so no single piece can unpack to more than about a megabyte.
  const STEP = 512;
  for (let i = 0; i < input.length; i += STEP) inflate.push(input.subarray(i, i + STEP), i + STEP >= input.length);
  if (!input.length) inflate.push(new Uint8Array(0), true);
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return strFromU8(out);
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
  let text: string;
  try {
    text = decodeTab(m[1]);
  } catch (e) {
    history.replaceState(null, '', location.pathname + location.search + pageHash(useApp.getState().page));
    useApp.getState().notify(e instanceof SharedTooLarge ? 'That share link is too large to open.' : 'That share link is damaged or incomplete.');
    return;
  }
  // If the user keeps their unsaved tab instead, the link stays in the address bar for later.
  if (!loadTabText(text, 'shared link', { unchanged: true, message: 'Opened a shared tab — Save it to keep it in your library.' })) return;
  history.replaceState(null, '', location.pathname + location.search + pageHash('play'));
  useApp.getState().setPage('play');
}
