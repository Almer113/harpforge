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
import { beatsPerBar, type ParseIssue, type TabLine } from '../htab/types';
import { keyUsesFlats } from '../pitch';
import { EPS, fromDoc, lineGroups, toDoc, type Song } from './model';

/** What a rewrite had to keep in a comment: text that couldn't be read. */
export interface SpliceReport {
  kept: string[];
}

/** A message for the kept text, or null if there was none. */
export function keptMessage(report: SpliceReport): string | null {
  if (!report.kept.length) return null;
  const list = report.kept.slice(0, 3).map((k) => `“${k}”`).join(', ') + (report.kept.length > 3 ? '…' : '');
  return `Kept ${list} in a comment: ${report.kept.length === 1 ? 'it isn’t' : 'they aren’t'} tab the app can read.`;
}

/** A line's own comment, and text on it that couldn't be read, as one comment ("" if none). */
interface Tail {
  tail: string;
  kept: string[];
}

interface Chunk extends Tail {
  /** Raw line indexes of the tab line and the lyrics lines that belong to it. */
  from: number;
  to: number;
  /** Raw lines before the chunk that aren't part of another chunk (comments, blanks, headings), and where they start. */
  glue: string[];
  glueStart: number;
  /** Lines between the tab line and its (first) lyrics line: blank lines and comments. */
  before: string[];
  /** Lines after the first lyrics line, in order: more verses and the comments among them. */
  after: string[];
}

const isHeading = (raw: string) => raw.trim().startsWith('@');
const isLyrics = (raw: string) => /^\s*w:/i.test(raw);
const isComment = (raw: string) => raw.trim().startsWith('#');

/**
 * The raw lines belonging to the tab line at `from`: its lyrics lines, which (as the
 * parser reads them) may come after blank lines or comments, and the lines around them.
 */
function chunkEnd(raw: string[], from: number): { to: number; before: string[]; after: string[] } {
  let to = from;
  for (let k = from + 1; k < raw.length && (isLyrics(raw[k]) || isComment(raw[k]) || raw[k].trim() === ''); k++) if (isLyrics(raw[k])) to = k;
  let first = -1;
  for (let k = from + 1; k <= to; k++)
    if (isLyrics(raw[k])) {
      first = k;
      break;
    }
  if (first < 0) return { to, before: [], after: [] };
  return { to, before: raw.slice(from + 1, first), after: raw.slice(first + 1, to + 1) };
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
function tailOf(rawLine: string, at: number, text: string, issues: ParseIssue[]): Tail {
  const c = commentAt(rawLine);
  const end = at + (c < 0 ? rawLine.length : c);
  const kept: string[] = [];
  for (const is of issues) {
    if (is.severity !== 'error' || is.span.start < at || is.span.end > end) continue;
    const t = text.slice(is.span.start, is.span.end).trim();
    if (t && !kept.includes(t)) kept.push(t);
  }
  const own = c < 0 ? '' : rawLine.slice(c).trimEnd();
  if (!kept.length) return { tail: own, kept };
  return { tail: `# kept: ${kept.join(' ')}` + (own ? ` · ${own.replace(/^#\s*/, '')}` : ''), kept };
}

/**
 * The rewritten lines of a chunk: the new tab line with its comment, the lines that were
 * between it and its lyrics, the new lyrics, then the rest (more verses) as written.
 */
function rewritten(text: string[], tail: string, before: string[], after: string[]): string[] {
  const [tab, ...lyrics] = text;
  const out: string[] = [];
  if (tab !== undefined) out.push(tail ? `${tab} ${tail}` : tab);
  else if (tail) out.push(tail);
  out.push(...before, ...lyrics);
  // Verse 1 is gone but more verses follow: an empty lyrics line keeps them in their places.
  if (after.some(isLyrics) && !lyrics.length) out.push('w:');
  return [...out, ...after];
}

/** Whether to spell pitches with flats: as the text already does, else from the key. */
export function flatsFor(text: string, key: string | undefined): boolean {
  const body = text.slice(splitHeader(text).bodyStart);
  const flat = /(^|[\s([{|])[A-G]b-?\d/.test(body);
  // A tab written with sharps stays that way, whatever the key says.
  if (!flat && /(^|[\s([{|])[A-G]#-?\d/.test(body)) return false;
  return flat || keyUsesFlats(key);
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
  const opts: SerializeOptions = { flats: flatsFor(oldText, oldDoc.meta.key), barBeats: beatsPerBar(oldDoc.meta) };
  // Rewritten lines may be spelled for a new key (a transposed tab).
  const newOpts: SerializeOptions = { ...opts, flats: flats ?? opts.flats };
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
    const chunk = chunkEnd(raw, from);
    const { tail, kept } = tailOf(raw[from], bodyStart + starts[from], oldText, issues);
    report?.kept.push(...kept);
    replace.set(from, { to: chunk.to, text: rewritten(after, tail, chunk.before, chunk.after) });
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
  const opts: SerializeOptions = { flats: flatsFor(oldText, oldDoc.meta.key), barBeats: beatsPerBar(oldDoc.meta) };
  const tell = (kept: string[]) => report?.kept.push(...kept);

  // Raw lines of the body, and which belong to each tab line.
  const { raw, starts } = rawLines(oldText, bodyStart);
  const lineAt = new Map<number, number>(); // body offset → raw line index
  starts.forEach((off, i) => lineAt.set(off, i));
  const chunks = new Map<number, Chunk>();
  // Lines of only chord symbols: the editor moves their chord onto the next note, so they
  // travel with the next line (kept while it's unchanged; when it's rewritten the chord is
  // in the new line, and only the row's comment, if any, is left in its place).
  const chordRows = new Map<number, Tail>();
  let prevEnd = -1;
  oldDoc.lines.forEach((l, li) => {
    if (!l.src) return;
    const from = lineAt.get(l.src.start - bodyStart);
    if (from === undefined) return;
    if (chordOnly(l)) {
      chordRows.set(from, tailOf(raw[from], l.src.start, oldText, issues));
      return;
    }
    const chunk = chunkEnd(raw, from);
    chunks.set(li, { from, glue: raw.slice(prevEnd + 1, from), glueStart: prevEnd + 1, ...chunk, ...tailOf(raw[from], l.src.start, oldText, issues) });
    prevEnd = chunk.to;
  });
  const trailingStart = prevEnd + 1;
  const trailing = raw.slice(trailingStart);
  /** `lines` (starting at raw row `start`) with chord rows replaced by their comment. */
  const withoutChordRows = (lines: string[], start: number) =>
    lines.flatMap((g, i) => {
      const row = chordRows.get(start + i);
      if (!row) return [g];
      tell(row.kept);
      return row.tail ? [row.tail] : [];
    });

  const oldSong = fromDoc(oldDoc);
  const oldCanon = new Map<number, string>();
  for (const c of canonicalLines(oldSong, opts)) if (c.whole) oldCanon.set(c.first!, c.text.join('\n'));
  // Source lines that had music, and those whose music is still in the song.
  const hadMusic = new Set(oldSong.measures.map((m) => m.src));
  const hasMusic = new Set(song.measures.map((m) => m.src));

  const out: string[] = [];
  const used = new Set<number>();
  const emitted = new Set<number>(); // lines whose in-between lines were written
  const verbatimLines = new Set<number>();
  const order = [...chunks.keys()];
  // Lines whose music isn't written under their own line any more.
  const flushBefore = (li: number) => {
    for (const k of order) {
      if (k >= li) break;
      if (used.has(k)) continue;
      used.add(k);
      const c = chunks.get(k)!;
      // A line the parser read no music from (a typo): nothing about it changed, so it stays.
      if (!hadMusic.has(k)) {
        out.push(...withoutChordRows(c.glue, c.glueStart), ...raw.slice(c.from, c.to + 1));
        continue;
      }
      out.push(...withoutChordRows(c.glue, c.glueStart).filter((g) => isComment(g) || isLyrics(g)));
      if (c.tail) {
        out.push(c.tail);
        tell(c.kept);
      }
      // Merged into the line before: its extra verses follow that line's lyrics. Deleted: only comments stay.
      const merged = hasMusic.has(k);
      out.push(...c.before.filter(isComment), ...c.after.filter((a) => isComment(a) || (merged && isLyrics(a))));
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
      let glue = verbatim ? [...chunk.glue] : withoutChordRows(chunk.glue, chunk.glueStart);
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
      out.push(...rewritten(c.text, chunk.tail, chunk.before, chunk.after));
      tell(chunk.kept);
    } else out.push(...c.text);
    if (L !== undefined) emitted.add(L);
  }
  flushBefore(Infinity);
  // Chord-only lines after the last line belong to it: replaced by their comment when it was rewritten.
  const lastLine = order[order.length - 1];
  const lastKept = lastLine === undefined || verbatimLines.has(lastLine);
  out.push(...(lastKept ? trailing : withoutChordRows(trailing, trailingStart)));
  return out.join('\n');
}
