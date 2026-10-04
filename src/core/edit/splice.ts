// Writes an edited song back into the tab's own text, changing as little as possible.
//
// The visual editor works on a measure model, which can't hold everything the text
// can (comments, blank lines, spacing, alternative spellings like "+4" or "-3b", an
// empty section heading, extra verses). So instead of rewriting the whole body, each
// line of text is kept exactly as written when its music didn't change; only edited
// lines are written fresh. Comments, blank lines, headings and extra verses around a
// line stay with it, and a rewritten line keeps its own "# comment" and anything in it
// that couldn't be read (moved into a comment, so nothing is lost).

import { parseHtab, splitHeader } from '../htab/parser';
import { lineText, type SerializeOptions } from '../htab/serializer';
import type { ParseIssue, TabLine } from '../htab/types';
import { keyUsesFlats } from '../pitch';
import { EPS, fromDoc, lineGroups, toDoc, type Song } from './model';

/** What a rewrite had to keep in a comment: tokens that couldn't be read. */
export interface SpliceReport {
  kept: string[];
}

/** A message for the kept tokens, or null if there were none. */
export function keptMessage(report: SpliceReport): string | null {
  if (!report.kept.length) return null;
  const list = report.kept.slice(0, 3).map((k) => `“${k}”`).join(', ') + (report.kept.length > 3 ? '…' : '');
  return `Kept ${list} in a comment on its line: ${report.kept.length === 1 ? 'it isn’t' : 'they aren’t'} tab the app can read.`;
}

interface Chunk {
  /** Raw line indexes of the tab line and the lyrics lines right after it. */
  from: number;
  to: number;
  /** Raw lines before the chunk that aren't part of another chunk (comments, blanks, headings), and where they start. */
  glue: string[];
  glueStart: number;
  /** Blank lines and comments between the tab line and its lyrics. */
  between: string[];
  /** Lyrics lines after the first (more verses): kept as written. */
  verses: string[];
  /** The line's own "# comment" and unreadable tokens, as a comment to put back on a rewritten line. */
  tail: string;
}

const isHeading = (raw: string) => raw.trim().startsWith('@');
const isLyrics = (raw: string) => /^\s*w:/i.test(raw);
const isComment = (raw: string) => raw.trim().startsWith('#');

/**
 * Last raw line belonging to the tab line at `from`: its lyrics lines, which (as the
 * parser reads them) may come after blank lines or comments. Those in-between lines are
 * returned too, so they can be kept when the line is rewritten, and so are the lyrics
 * lines after the first (extra verses).
 */
function chunkEnd(raw: string[], from: number): { to: number; between: string[]; verses: string[] } {
  let to = from;
  for (let k = from + 1; k < raw.length && (isLyrics(raw[k]) || isComment(raw[k]) || raw[k].trim() === ''); k++) if (isLyrics(raw[k])) to = k;
  const span = raw.slice(from + 1, to + 1);
  return { to, between: span.filter((l) => !isLyrics(l)), verses: span.filter(isLyrics).slice(1) };
}

/** A line holding only chord symbols (no notes, rests or bar lines). */
function chordOnly(line: TabLine): boolean {
  return line.events.length > 0 && line.events.every((e) => e.kind !== 'bar' && e.beats <= EPS);
}

/** Where a line's "# comment" starts, or -1. */
function commentAt(raw: string): number {
  for (let i = 0; i < raw.length; i++) if (raw[i] === '#' && (i === 0 || /\s/.test(raw[i - 1]))) return i;
  return -1;
}

/**
 * The comment to put back on a rewritten line: its own comment, and anything on it the
 * parser couldn't read ("# kept: x"). `at` is the raw line's offset in `text`.
 */
function tailOf(rawLine: string, at: number, text: string, issues: ParseIssue[], report?: SpliceReport): string {
  const c = commentAt(rawLine);
  const end = at + (c < 0 ? rawLine.length : c);
  const kept: string[] = [];
  for (const is of issues) {
    if (is.severity !== 'error' || is.span.start < at || is.span.end > end) continue;
    const t = text.slice(is.span.start, is.span.end).trim();
    if (t && !kept.includes(t)) kept.push(t);
  }
  report?.kept.push(...kept);
  const own = c < 0 ? '' : rawLine.slice(c).trimEnd();
  if (!kept.length) return own;
  return `# kept: ${kept.join(' ')}` + (own ? ` · ${own.replace(/^#\s*/, '')}` : '');
}

/** The rewritten lines of a chunk: the new text with its comment, then extra verses and in-between lines. */
function rewritten(text: string[], tail: string, verses: string[], between: string[]): string[] {
  const out = [...text];
  if (tail && out.length) out[0] = `${out[0]} ${tail}`;
  else if (tail) out.push(tail);
  // Verse 1 is gone but more verses follow: an empty lyrics line keeps them in their places.
  if (verses.length && !out.some(isLyrics)) out.push('w:');
  return [...out, ...verses, ...between];
}

/** Whether to spell pitches with flats: from the key, or because the text already does. */
export function flatsFor(text: string, key: string | undefined): boolean {
  return keyUsesFlats(key) || /(^|[\s([{|])[A-G]b-?\d/.test(text.slice(splitHeader(text).bodyStart));
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

/** The body's raw lines and each one's offset from the body start. */
function rawLines(text: string, bodyStart: number): { raw: string[]; starts: number[] } {
  const raw = text.slice(bodyStart).split('\n');
  if (raw.length && raw[raw.length - 1] === '') raw.pop();
  const starts: number[] = [];
  let off = 0;
  for (const r of raw) {
    starts.push(off);
    off += r.length + 1;
  }
  return { raw, starts };
}

/**
 * The new body text after a change that rewrites notes but keeps the lines (re-tabbing
 * for another harmonica, moving an octave): `lines` must be `oldText`'s lines, in order.
 * Lines whose music is unchanged, comments, blank lines, headings and extra verses stay as written.
 */
export function replaceLines(oldText: string, lines: TabLine[], flats?: boolean, report?: SpliceReport): string {
  const { bodyStart } = splitHeader(oldText);
  const { doc: oldDoc, issues } = parseHtab(oldText);
  const opts: SerializeOptions = { flats: flatsFor(oldText, oldDoc.meta.key) };
  // Rewritten lines may be spelled for a new key (a transposed tab).
  const newOpts: SerializeOptions = { flats: flats ?? opts.flats };
  const { raw, starts } = rawLines(oldText, bodyStart);
  const replace = new Map<number, { to: number; text: string[] }>();
  oldDoc.lines.forEach((l, li) => {
    const next = lines[li];
    if (!l.src || !next) return;
    const from = starts.indexOf(l.src.start - bodyStart);
    if (from < 0) return;
    const before = lineText(l, opts).join('\n');
    const after = lineText(next, newOpts);
    if (after.join('\n') === before) return;
    const { to, between, verses } = chunkEnd(raw, from);
    const tail = tailOf(raw[from], bodyStart + starts[from], oldText, issues, report);
    replace.set(from, { to, text: rewritten(after, tail, verses, between) });
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
export function spliceBody(oldText: string, song: Song, report?: SpliceReport): string {
  const { bodyStart } = splitHeader(oldText);
  const { doc: oldDoc, issues } = parseHtab(oldText);
  const opts: SerializeOptions = { flats: flatsFor(oldText, oldDoc.meta.key) };

  // Raw lines of the body, and which belong to each tab line.
  const { raw, starts } = rawLines(oldText, bodyStart);
  const lineAt = new Map<number, number>(); // body offset → raw line index
  starts.forEach((off, i) => lineAt.set(off, i));
  const chunks = new Map<number, Chunk>();
  // Lines of only chord symbols: the editor moves their chord onto the next note, so they
  // travel with the next line (kept while it's unchanged, dropped when it's rewritten).
  const chordRows = new Set<number>();
  let prevEnd = -1;
  oldDoc.lines.forEach((l, li) => {
    if (!l.src) return;
    const from = lineAt.get(l.src.start - bodyStart);
    if (from === undefined) return;
    if (chordOnly(l)) {
      chordRows.add(from);
      return;
    }
    const { to, between, verses } = chunkEnd(raw, from);
    const tail = tailOf(raw[from], l.src.start, oldText, issues);
    chunks.set(li, { from, to, glue: raw.slice(prevEnd + 1, from), glueStart: prevEnd + 1, between, verses, tail });
    prevEnd = to;
  });
  const trailingStart = prevEnd + 1;
  const trailing = raw.slice(trailingStart);
  const keepGlue = (c: Chunk, keep: (g: string, row: number) => boolean) => c.glue.filter((g, i) => keep(g, c.glueStart + i));

  const oldCanon = new Map<number, string>();
  for (const c of canonicalLines(fromDoc(oldDoc), opts)) if (c.whole) oldCanon.set(c.first!, c.text.join('\n'));

  const out: string[] = [];
  const used = new Set<number>();
  const emitted = new Set<number>(); // lines whose in-between comments were written
  const verbatimLines = new Set<number>();
  const order = [...chunks.keys()];
  const tellKept = (tail: string) => {
    const m = /^# kept: (.*?)(?: · |$)/.exec(tail);
    if (m && report) report.kept.push(...m[1].split(' '));
  };
  // Comments from lines that are gone move along to the next line written (with the
  // line's own comment and anything unreadable on it).
  const flushBefore = (li: number) => {
    for (const k of order) {
      if (k >= li) break;
      if (used.has(k)) continue;
      used.add(k);
      const c = chunks.get(k)!;
      out.push(...c.glue.filter(isComment));
      if (c.tail) {
        out.push(c.tail);
        tellKept(c.tail);
      }
    }
  };

  for (const c of canonicalLines(song, opts)) {
    const L = c.first;
    const chunk = L !== undefined ? chunks.get(L) : undefined;
    const verbatim = !!chunk && c.whole && oldCanon.get(L!) === c.text.join('\n');
    if (verbatim) verbatimLines.add(L!);
    const section = c.line.section;
    if (chunk && !used.has(L!)) {
      flushBefore(L!);
      used.add(L!);
      let glue = verbatim ? [...chunk.glue] : keepGlue(chunk, (g, row) => !isLyrics(g) && !chordRows.has(row));
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
    if (verbatim) out.push(...raw.slice(chunk!.from, chunk!.to + 1));
    else if (chunk && L !== undefined && !emitted.has(L)) {
      out.push(...rewritten(c.text, chunk.tail, chunk.verses, chunk.between));
      tellKept(chunk.tail);
    } else out.push(...c.text);
    if (L !== undefined) emitted.add(L);
  }
  flushBefore(Infinity);
  // Chord-only lines after the last line belong to it: dropped when it was rewritten.
  const lastLine = order[order.length - 1];
  const lastKept = lastLine === undefined || verbatimLines.has(lastLine);
  out.push(...trailing.filter((_, i) => lastKept || !chordRows.has(trailingStart + i)));
  return out.join('\n');
}

