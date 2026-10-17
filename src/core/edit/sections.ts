// Phase 17a: sections as a whole — the bars from one heading ("@ Chorus") up to the next.
// Bars before the first heading are the song's start: a part without a name, kept at the top.
//
// Each tool is a pure change to the song (the measure model), and, for moving, duplicating and
// deleting, the same change made to the text's own lines (sectionText): a section is a block
// of lines there, so its comments, spelling, blank lines and lyrics travel with it exactly as
// written. The text version is used only when it reads back as the model's change.

import { parseHtab, splitHeader } from '../htab/parser';
import { EPS, fromDoc, type Item, type Measure, type Song } from './model';
import { spliceBody } from './splice';

export interface SectionRange {
  /** The heading (undefined: the bars before the first heading). */
  name?: string;
  /** Its bars: from, up to (not including) to. */
  from: number;
  to: number;
}

/** The song's parts in order: the start without a heading (if any), then each section. */
export function sectionRanges(song: Song): SectionRange[] {
  const out: SectionRange[] = [];
  song.measures.forEach((m, i) => {
    if (i === 0 || m.section !== undefined) {
      if (out.length) out[out.length - 1].to = i;
      out.push({ name: m.section, from: i, to: song.measures.length });
    }
  });
  return out;
}

/** The index (in sectionRanges) of the part holding bar `m`. */
export function sectionAt(song: Song, m: number): number {
  const r = sectionRanges(song);
  const k = r.findIndex((x) => m >= x.from && m < x.to);
  return k < 0 ? Math.max(0, r.length - 1) : k;
}

const cloneMeasure = (m: Measure): Measure => ({
  ...m,
  ending: m.ending ? [...m.ending] : undefined,
  items: m.items.map((it): Item => ({ ...it, sounds: it.sounds.map((s) => ({ ...s })), verses: it.verses ? [...it.verses] : undefined, holds: it.holds ? [...it.holds] : undefined })),
});
const cloned = (song: Song): Song => ({ ...song, measures: song.measures.map(cloneMeasure) });
/** Drops undefined fields (a copy made with `...` has some that the original didn't). */
const tidy = (m: Measure): Measure => {
  for (const k of Object.keys(m) as (keyof Measure)[]) if (m[k] === undefined) delete m[k];
  for (const it of m.items) for (const k of Object.keys(it) as (keyof Item)[]) if (it[k] === undefined) delete it[k];
  return m;
};

/**
 * The song's end bar (|]) stays on its last bar: one left in the middle by a move becomes an
 * ordinary bar line, and the new last bar takes it (if it had an ordinary one). A bar that
 * ran on without a bar line before a part that moved away gets one.
 */
function settle(s: Song, hadFinal: boolean): Song {
  const last = s.measures.length - 1;
  s.measures.forEach((m, i) => {
    if (i < last && m.endBar === 'final') m.endBar = 'single';
    // (A bar line is needed before a heading: a part ends at its last bar.)
    if (i < last && m.endBar === 'none' && s.measures[i + 1].section !== undefined) m.endBar = 'single';
  });
  if (hadFinal && s.measures[last] && s.measures[last].endBar === 'single') s.measures[last].endBar = 'final';
  if (s.measures[0]) s.measures[0].lineBreak = true;
  s.measures.forEach(tidy);
  return s;
}
const endsFinal = (s: Song) => s.measures[s.measures.length - 1]?.endBar === 'final';

// ---- Repeats that cross a part's edges ---------------------------------------------------

/** Each repeat's bars (from its |: or where it goes back to, through its endings). */
export function repeatSpans(song: Song): [number, number][] {
  const spans: [number, number][] = [];
  let open: number | null = null;
  let after = 0; // where a :| with no |: goes back to
  const ms = song.measures;
  for (let i = 0; i < ms.length; i++) {
    const m = ms[i];
    if (m.startBar === 'repeat-start') open = i;
    if (m.endBar === 'repeat-end') {
      let end = i;
      // Its later endings ([2.] …) belong to it: up to a bar line that ends them.
      for (let j = i + 1; j < ms.length && ms[j].ending?.length; j++) {
        end = j;
        while (end + 1 < ms.length && !ms[end + 1].ending && ms[end].endBar === 'single' && !ms[end + 1].lineBreak && ms[end + 1].startBar !== 'repeat-start') end++;
        j = end;
      }
      spans.push([open ?? after, end]);
      open = null;
      after = end + 1;
      i = end;
    }
  }
  return spans;
}

/** Whether a repeat starts inside the part and ends outside it, or the other way round. */
export function crossesRepeat(song: Song, r: SectionRange): boolean {
  return repeatSpans(song).some(([a, b]) => a <= r.to - 1 && b >= r.from && (a < r.from || b > r.to - 1));
}

// ---- The tools ------------------------------------------------------------------------------

export interface SectionEdit {
  song: Song;
  /** The text's own lines rearranged the same way (blocks: the parts' indexes, in their new order; null: removed). */
  blocks?: { order: (number | 'copy')[]; copyOf?: number };
  /** Said with the change: a repeat it splits, say. */
  note?: string;
}

/** Whether part k can move up (-1) or down (1): past another section, never above the start without a heading. */
export function canMove(song: Song, k: number, dir: -1 | 1): boolean {
  const r = sectionRanges(song);
  const other = r[k + dir];
  return !!r[k] && r[k].name !== undefined && !!other && other.name !== undefined;
}

const repeatNote = (song: Song, r: SectionRange, what: string) => (crossesRepeat(song, r) ? `A repeat runs across the edge of ${label(r)}: ${what}, so its repeat sign and its other end are now apart. (Undo puts it back.)` : undefined);
export const label = (r: SectionRange) => (r.name ? `“${r.name}”` : 'the start');

export function moveSection(song: Song, k: number, dir: -1 | 1): SectionEdit | null {
  if (!canMove(song, k, dir)) return null;
  const r = sectionRanges(song);
  const s = cloned(song);
  const final = endsFinal(s);
  const a = dir < 0 ? r[k - 1] : r[k];
  const b = dir < 0 ? r[k] : r[k + 1];
  const moved = [...s.measures.slice(b.from, b.to), ...s.measures.slice(a.from, a.to)];
  s.measures.splice(a.from, b.to - a.from, ...moved);
  const order = r.map((_, i) => i);
  [order[k], order[k + dir]] = [order[k + dir], order[k]];
  return { song: settle(s, final), blocks: { order }, note: repeatNote(song, r[k], 'it moved') ?? repeatNote(song, r[k + dir], 'it moved') };
}

export function duplicateSection(song: Song, k: number): SectionEdit | null {
  const r = sectionRanges(song)[k];
  if (!r || r.name === undefined) return null;
  const s = cloned(song);
  const final = endsFinal(s);
  const copy = s.measures.slice(r.from, r.to).map((m) => ({ ...cloneMeasure(m), src: undefined }));
  copy[0].lineBreak = true;
  // The original now has a part after it: it needs a bar line at its end.
  if (s.measures[r.to - 1].endBar === 'none') s.measures[r.to - 1].endBar = 'single';
  s.measures.splice(r.to, 0, ...copy);
  const order: (number | 'copy')[] = sectionRanges(song).map((_, i) => i);
  order.splice(k + 1, 0, 'copy');
  return { song: settle(s, final), blocks: { order, copyOf: k }, note: repeatNote(song, r, 'the copy has only part of it') };
}

export function deleteSection(song: Song, k: number): SectionEdit | null {
  const all = sectionRanges(song);
  const r = all[k];
  if (!r || r.name === undefined) return null;
  const s = cloned(song);
  const final = endsFinal(s);
  s.measures.splice(r.from, r.to - r.from);
  if (!s.measures.length) s.measures.push({ items: [], endBar: final ? 'final' : 'single', lineBreak: true });
  const order: (number | 'copy')[] = all.map((_, i) => i).filter((i) => i !== k);
  return { song: settle(s, final), blocks: { order }, note: repeatNote(song, r, 'it was deleted') };
}

export function renameSection(song: Song, k: number, name: string): Song {
  const r = sectionRanges(song)[k];
  const s = cloned(song);
  if (!r) return s;
  s.measures[r.from].section = name.trim();
  s.measures[r.from].lineBreak = true;
  return settle(s, endsFinal(s));
}

/** Its bars join the part before it (they stay on their own line). */
export function removeHeading(song: Song, k: number): Song {
  const r = sectionRanges(song)[k];
  const s = cloned(song);
  if (r?.name !== undefined) delete s.measures[r.from].section;
  return s;
}

/** Whether the part is one repeat (|: at its start, :| at its end), and how many times through. */
export function sectionRepeat(song: Song, k: number): number | null {
  const r = sectionRanges(song)[k];
  if (!r) return null;
  const first = song.measures[r.from];
  const last = song.measures[r.to - 1];
  return first.startBar === 'repeat-start' && last.endBar === 'repeat-end' ? (last.endTimes ?? 2) : null;
}

/** Whether "Repeat it" can wrap the part: it has no repeats or endings of its own inside. */
export function canRepeat(song: Song, k: number): boolean {
  const r = sectionRanges(song)[k];
  if (!r) return false;
  if (sectionRepeat(song, k) !== null) return true;
  const inside = song.measures.slice(r.from, r.to);
  return !inside.some((m, i) => m.ending?.length || m.endBar === 'repeat-end' || (i > 0 && m.startBar === 'repeat-start')) && !crossesRepeat(song, r);
}

/** Plays the part `times` times (|: … :|, :|xN past twice), or (null) once again. */
export function repeatSection(song: Song, k: number, times: number | null): Song {
  const r = sectionRanges(song)[k];
  const s = cloned(song);
  if (!r) return s;
  const first = s.measures[r.from];
  const last = s.measures[r.to - 1];
  if (times === null) {
    if (first.startBar === 'repeat-start') delete first.startBar;
    if (last.endBar === 'repeat-end') {
      last.endBar = r.to === s.measures.length ? 'final' : 'single';
      delete last.endTimes;
    }
  } else {
    first.startBar = 'repeat-start';
    last.endBar = 'repeat-end';
    if (times > 2) last.endTimes = times;
    else delete last.endTimes;
  }
  return settle(s, false);
}

/** A new section (`name`, one empty bar) right after part k. */
export function newSectionAfter(song: Song, k: number, name: string): Song {
  const r = sectionRanges(song)[k];
  const s = cloned(song);
  const final = endsFinal(s);
  const at = r ? r.to : s.measures.length;
  if (s.measures[at - 1]?.endBar === 'none') s.measures[at - 1].endBar = 'single';
  s.measures.splice(at, 0, { items: [], endBar: 'single', lineBreak: true, section: name.trim() });
  return settle(s, final);
}

/**
 * Bars `from`..`to` (inclusive) as a section named `name`. The bars after them keep the name
 * of the part they were in (they start it again), so nothing loses its heading.
 */
export function makeSection(song: Song, from: number, to: number, name: string): SectionEdit {
  const s = cloned(song);
  const final = endsFinal(s);
  const k = sectionAt(song, from);
  const was = sectionRanges(song)[k];
  if (to + 1 < s.measures.length && s.measures[to + 1].section === undefined && sectionAt(song, to + 1) === k && was.name !== undefined) {
    s.measures[to + 1].section = was.name;
    s.measures[to + 1].lineBreak = true;
  } else if (to + 1 < s.measures.length) s.measures[to + 1].lineBreak = true;
  s.measures[from].section = name.trim();
  s.measures[from].lineBreak = true;
  for (const i of [from - 1, to]) if (s.measures[i]?.endBar === 'none') s.measures[i].endBar = 'single';
  const made = { from, to: to + 1 };
  return { song: settle(s, final), note: crossesRepeat(song, made) ? 'A repeat runs across the new section’s edge: moving either part later would take the repeat apart.' : undefined };
}

/** Every note and rest of part k (for selecting it). */
export function sectionPositions(song: Song, k: number): { m: number; start: number }[] {
  const r = sectionRanges(song)[k];
  if (!r) return [];
  const out: { m: number; start: number }[] = [];
  for (let m = r.from; m < r.to; m++) for (const it of song.measures[m].items) if (it.dur > EPS) out.push({ m, start: it.start });
  return out;
}

// ---- The same change in the text ----------------------------------------------------------

/** Two songs with the same music (bars, notes, words, bar lines), wherever their text came from. */
export function sameMusic(a: Song, b: Song): boolean {
  const plain = (s: Song) => JSON.stringify(s.measures.map((m) => tidy({ ...cloneMeasure(m), src: undefined })));
  return a.cap === b.cap && plain(a) === plain(b);
}

/**
 * The text with its parts' blocks of lines rearranged as `edit.blocks` says (a copy is its
 * original's lines again), then any bar line the change moved (the song's end bar) written in;
 * null when the text's lines and its parts don't line up, or it wouldn't read back as `edit.song`.
 */
export function sectionText(text: string, edit: SectionEdit): string | null {
  if (!edit.blocks) return null;
  const { bodyStart } = splitHeader(text);
  const head = text.slice(0, bodyStart);
  const lines = text.slice(bodyStart).replace(/\n$/, '').split('\n');
  const headings = lines.flatMap((l, i) => (l.trim().startsWith('@') ? [i] : []));
  const ranges = sectionRanges(fromDoc(parseHtab(text).doc));
  const lead = ranges[0].name === undefined;
  // (One block of lines per part, or this isn't for it: a heading over no music, say.)
  if (headings.length !== ranges.length - (lead ? 1 : 0)) return null;
  // Above the first heading: the start's music (a part of its own), or only comments (kept on top).
  const starts = lead ? [0, ...headings] : headings;
  const top = lead ? [] : lines.slice(0, headings[0]);
  if (top.some((l) => l.trim() && !l.trim().startsWith('#'))) return null;
  const blocks = starts.map((from, i) => {
    const part = lines.slice(from, starts[i + 1] ?? lines.length);
    let end = part.length;
    while (end > 0 && !part[end - 1].trim()) end--;
    // (Blank lines at a block's end are its gap to the next.)
    return { lines: part.slice(0, end), gap: part.length - end };
  });
  const order = edit.blocks.order;
  const out: string[] = [...top];
  order.forEach((b, i) => {
    const block = blocks[b === 'copy' ? edit.blocks!.copyOf! : b];
    out.push(...block.lines);
    if (i < order.length - 1) out.push(...Array<string>(Math.max(1, block.gap)).fill(''));
  });
  const rearranged = head + out.join('\n') + '\n';
  const read = fromDoc(parseHtab(rearranged).doc);
  if (read.measures.length !== edit.song.measures.length) return null;
  // The change's bar lines on the rearranged lines: only lines whose music differs are rewritten.
  const target: Song = { ...edit.song, measures: edit.song.measures.map((m, i) => ({ ...m, src: read.measures[i].src })) };
  const result = head + spliceBody(rearranged, target) + '\n';
  return sameMusic(fromDoc(parseHtab(result).doc), edit.song) ? result : null;
}
