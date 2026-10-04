// Edits header fields in .htab text without touching the body.

import { HEADER_ALIASES, headerValue, splitHeader } from './parser';

/** Canonical header names, as written by the serializer. */
const CANONICAL: Record<string, string> = {
  title: 'title',
  artist: 'artist',
  harmonica: 'harmonica',
  tuning: 'tuning',
  harpKey: 'harp-key',
  key: 'key',
  position: 'position',
  tempo: 'tempo',
  time: 'time',
};

function fieldOf(rawKey: string): string {
  const f = HEADER_ALIASES[rawKey.toLowerCase()];
  return f && f !== 'extra' ? f : rawKey.toLowerCase();
}

/**
 * Sets (or removes, with undefined) header fields. Keys are TabMeta field names
 * (title, harmonica, tuning, harpKey, key, tempo, ...) or raw extra keys.
 */
export function setMetaFields(text: string, patch: Record<string, string | number | undefined>): string {
  const { bodyStart, headerEnd } = splitHeader(text);
  const remaining = new Map(Object.entries(patch));
  const out: string[] = [];

  if (headerEnd >= 0) {
    const headerLines = text.slice(0, headerEnd).split('\n');
    // headerLines: [maybe blank lines..., '---', fields..., ''] up to the closing ---
    let opened = false;
    for (const line of headerLines) {
      if (!opened) {
        if (line.trim() === '---') opened = true;
        out.push(line);
        continue;
      }
      const colon = line.indexOf(':');
      if (colon > 0 && !line.trim().startsWith('#')) {
        const field = fieldOf(line.slice(0, colon).trim());
        if (remaining.has(field)) {
          const v = remaining.get(field);
          remaining.delete(field);
          if (v !== undefined && v !== '') out.push(`${line.slice(0, colon).trim()}: ${headerValue(v)}`);
          continue;
        }
      }
      out.push(line);
    }
    while (out.length && out[out.length - 1] === '') out.pop();
  } else {
    out.push('---');
  }
  for (const [k, v] of remaining) {
    if (v !== undefined && v !== '') out.push(`${CANONICAL[k] ?? k}: ${headerValue(v)}`);
  }
  out.push('---');
  const body = headerEnd >= 0 ? text.slice(bodyStart) : text.replace(/^\s*\n/, '');
  return out.join('\n') + '\n' + body;
}
