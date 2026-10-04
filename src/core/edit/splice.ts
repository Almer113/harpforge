// Writes an edited song back into the tab's own text, changing as little as possible.
//
// The visual editor works on a measure model, which can't hold everything the text
// can (comments, blank lines, spacing, alternative spellings like "+4" or "-3b", an
// empty section heading). So instead of rewriting the whole body, each line of text
// is kept exactly as written when its music didn't change; only edited lines are
// written fresh. Comments, blank lines and headings around a line stay with it.

import { parseHtab, splitHeader } from '../htab/parser';
import { lineText, type SerializeOptions } from '../htab/serializer';
import type { TabLine } from '../htab/types';
import { prefersFlats } from '../pitch';
import { fromDoc, lineGroups, toDoc, type Song } from './model';

interface Chunk {
  /** Raw line indexes of the tab line and the lyrics lines right after it. */
  from: number;
  to: number;
  /** Raw lines before the chunk that aren't part of another chunk (comments, blanks, headings). */
  glue: string[];
  /** Blank lines and comments between the tab line and its lyrics. */
  between: string[];
}

const isHeading = (raw: string) => raw.trim().startsWith('@');
const isLyrics = (raw: string) => /^\s*w:/i.test(raw);
const isComment = (raw: string) => raw.trim().startsWith('#');

/**
 * Last raw line belonging to the tab line at `from`: its lyrics lines, which (as the
 * parser reads them) may come after blank lines or comments. Those in-between lines are
 * returned too, so they can be kept when the line is rewritten.
 */
function chunkEnd(raw: string[], from: number): { to: number; between: string[] } {
  let to = from;
  for (let k = from + 1; k < raw.length && (isLyrics(raw[k]) || isComment(raw[k]) || raw[k].trim() === ''); k++) if (isLyrics(raw[k])) to = k;
  return { to, between: raw.slice(from + 1, to + 1).filter((l) => !isLyrics(l)) };
}

/** Whether to spell pitches with flats: from the key, or because the text already does. */
export function flatsFor(text: string, key: string | undefined): boolean {
  return prefersFlats(key) || /(^|[\s([{|])[A-G]b-?\d/.test(text.slice(splitHeader(text).bodyStart));
}

/** Each measure-set of a song as lines: the text of each line plus the source line its measures came from. */
function canonicalLines(song: Song, opts: SerializeOptions) {
  const lines = toDoc(song).lines;
  const groups = lineGroups(song);
  const count = new Map<number, number>();
  for (const m of song.measures) if (m.src !== undefined) count.set(m.src, (count.get(m.src) ?? 0) + 1);
  return lines.map((line: TabLine, k) => {
    const srcs = (groups[k] ?? []).map((i) => song.measures[i].src);
    const first = srcs[0];
    // A line maps back to its source line only if it holds exactly that line's measures.
    const whole = first !== undefined && srcs.every((x) => x === first) && count.get(first) === srcs.length;
    return { line, text: lineText(line, opts), first, whole };
  });
}

/**
 * The new body text after a change that rewrites notes but keeps the lines (re-tabbing
 * for another harmonica, moving an octave): `lines` must be `oldText`'s lines, in order.
 * Lines whose music is unchanged, comments, blank lines and headings stay as written.
 */
export function replaceLines(oldText: string, lines: TabLine[], flats?: boolean): string {
  const { bodyStart } = splitHeader(oldText);
  const oldDoc = parseHtab(oldText).doc;
  const opts: SerializeOptions = { flats: flatsFor(oldText, oldDoc.meta.key) };
  // Rewritten lines may be spelled for a new key (a transposed tab).
  const newOpts: SerializeOptions = { flats: flats ?? opts.flats };
  const raw = oldText.slice(bodyStart).split('\n');
  if (raw.length && raw[raw.length - 1] === '') raw.pop();
  const starts: number[] = [];
  let off = 0;
  for (const r of raw) {
    starts.push(off);
    off += r.length + 1;
  }
  const replace = new Map<number, { to: number; text: string[] }>();
  oldDoc.lines.forEach((l, li) => {
    const next = lines[li];
    if (!l.src || !next) return;
    const from = starts.indexOf(l.src.start - bodyStart);
    if (from < 0) return;
    const before = lineText(l, opts).join('\n');
    const after = lineText(next, newOpts);
    if (after.join('\n') === before) return;
    const { to, between } = chunkEnd(raw, from);
    replace.set(from, { to, text: [...after, ...between] });
  });
  const out: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const r = replace.get(i);
    if (!r) out.push(raw[i]);
    else {
      out.push(...r.text);
      i = r.to;
    }
  }
  return out.join('\n');
}

/** The new body text for `song`, keeping untouched lines of `oldText` as they are. */
export function spliceBody(oldText: string, song: Song): string {
  const { bodyStart } = splitHeader(oldText);
  const oldDoc = parseHtab(oldText).doc;
  const opts: SerializeOptions = { flats: flatsFor(oldText, oldDoc.meta.key) };

  // Raw lines of the body, and which belong to each tab line.
  const raw = oldText.slice(bodyStart).split('\n');
  if (raw.length && raw[raw.length - 1] === '') raw.pop();
  const lineAt = new Map<number, number>(); // body offset → raw line index
  let off = 0;
  raw.forEach((r, i) => {
    lineAt.set(off, i);
    off += r.length + 1;
  });
  const chunks = new Map<number, Chunk>();
  let prevEnd = -1;
  oldDoc.lines.forEach((l, li) => {
    if (!l.src) return;
    const from = lineAt.get(l.src.start - bodyStart);
    if (from === undefined) return;
    const { to, between } = chunkEnd(raw, from);
    chunks.set(li, { from, to, glue: raw.slice(prevEnd + 1, from), between });
    prevEnd = to;
  });
  const trailing = raw.slice(prevEnd + 1);

  const oldCanon = new Map<number, string>();
  for (const c of canonicalLines(fromDoc(oldDoc), opts)) if (c.whole) oldCanon.set(c.first!, c.text.join('\n'));

  const out: string[] = [];
  const used = new Set<number>();
  const emitted = new Set<number>(); // lines whose in-between comments were written
  const order = [...chunks.keys()];
  // Comments from lines that are gone move along to the next line written.
  const flushBefore = (li: number) => {
    for (const k of order) {
      if (k >= li) break;
      if (used.has(k)) continue;
      used.add(k);
      out.push(...chunks.get(k)!.glue.filter(isComment));
    }
  };

  for (const c of canonicalLines(song, opts)) {
    const L = c.first;
    const chunk = L !== undefined ? chunks.get(L) : undefined;
    const verbatim = !!chunk && c.whole && oldCanon.get(L!) === c.text.join('\n');
    const section = c.line.section;
    if (chunk && !used.has(L!)) {
      flushBefore(L!);
      used.add(L!);
      let glue = verbatim ? [...chunk.glue] : chunk.glue.filter((g) => !isLyrics(g));
      if (section !== oldDoc.lines[L!].section) {
        const h = glue.map(isHeading).lastIndexOf(true);
        if (section === undefined) glue = glue.filter((_, i) => i !== h);
        else if (h >= 0) glue[h] = `@ ${section}`;
        else glue.push(...(out.length && glue[glue.length - 1]?.trim() !== '' ? [''] : []), `@ ${section}`);
      }
      out.push(...glue);
    } else if (section !== undefined) {
      if (out.length) out.push('');
      out.push(`@ ${section}`);
    }
    out.push(...(verbatim ? raw.slice(chunk!.from, chunk!.to + 1) : [...c.text, ...(chunk && L !== undefined && !emitted.has(L) ? chunk.between : [])]));
    if (L !== undefined) emitted.add(L);
  }
  flushBefore(Infinity);
  out.push(...trailing);
  return out.join('\n');
}
