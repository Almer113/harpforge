// Measure model for the visual editor.
//
// A song is a list of measures; each measure is `cap` beats long (from the time
// signature) and holds items at a start time with a duration. Gaps are rests.
// Edits are pure functions Song → Song; the editor converts to and from TabDoc so
// the .htab text stays the single source of truth.

import { beatsPerBar, type BarStyle, type NoteEvent, type RestEvent, type TabDoc, type TabEvent, type TabLine, type TabMeta } from '../htab/types';
import type { Sound } from '../types';

export const EPS = 1e-6;

export interface Item {
  start: number;
  dur: number;
  /** Empty = an explicit rest (kept only when it carries a chord symbol or lyric). */
  sounds: Sound[];
  chord?: string;
  lyric?: string;
  /** Tied from the item before it (same sound, keeps sounding across the gap/bar). */
  tied?: boolean;
}

export interface Measure {
  items: Item[];
  /** Bar line drawn at the start (repeat start), if any. */
  startBar?: BarStyle;
  /** 'none': no bar line is written (the bar carries on on the next line of text). */
  endBar: BarStyle | 'none';
  /** Starts a new line of the sheet. */
  lineBreak: boolean;
  section?: string;
  /**
   * Written length when it differs from the time signature: a pickup or another short
   * bar. It's only filled with rests up to this length (notes may make it longer).
   */
  len?: number;
  /** Index of the text line the measure was read from (lets untouched lines keep their own text). */
  src?: number;
}

export interface Song {
  meta: TabMeta;
  measures: Measure[];
  /** Beats per measure. */
  cap: number;
}

export interface Pos {
  m: number;
  start: number;
}

const near = (a: number, b: number) => Math.abs(a - b) < EPS;
const emptyMeasure = (lineBreak = false): Measure => ({ items: [], endBar: 'single', lineBreak });

export function itemEnd(it: Item): number {
  return it.start + it.dur;
}

export function measureLength(m: Measure): number {
  return m.items.reduce((a, it) => Math.max(a, itemEnd(it)), 0);
}

/** Beats a measure really takes: its written length (short bars) or the time signature, or more if overfull. */
export function measureSpan(song: Song, m: Measure): number {
  return Math.max(m.len ?? song.cap, measureLength(m));
}

/** Measure indexes on each line of text (a line starts at a line break or a section). */
export function lineGroups(song: Song): number[][] {
  const groups: number[][] = [];
  song.measures.forEach((m, i) => {
    if (!groups.length || m.lineBreak || m.section !== undefined) groups.push([]);
    groups[groups.length - 1].push(i);
  });
  return groups;
}

// ---- Doc ↔ Song --------------------------------------------------------------------------

export function fromDoc(doc: TabDoc): Song {
  const cap = beatsPerBar(doc.meta);
  const hasBars = doc.lines.some((l) => l.events.some((e) => e.kind === 'bar'));
  const measures: Measure[] = [];
  let cur = emptyMeasure(true);
  let t = 0;
  let pendingChord: string | undefined;
  let pendingSection: string | undefined;
  let lineStart = true;

  const close = (endBar: Measure['endBar'] = 'single') => {
    cur.endBar = endBar;
    // Pickups and other short bars keep their length instead of being filled with rests.
    if (hasBars && t < cap - EPS) cur.len = t;
    measures.push(cur);
    cur = emptyMeasure(false);
    t = 0;
  };
  const touched = () => cur.items.length > 0 || t > EPS;

  doc.lines.forEach((line, li) => {
    if (line.section !== undefined) pendingSection = line.section;
    lineStart = true;
    for (const ev of line.events) {
      if (ev.kind === 'bar') {
        if (!touched()) {
          if (ev.style !== 'single') cur.startBar = ev.style;
        } else close(ev.style);
        continue;
      }
      if (ev.beats <= EPS) {
        if (!ev.chord) continue;
        // A chord symbol with no note after it on its line marks the end of the bar it follows.
        const into = touched() ? cur : lineStart ? null : measures[measures.length - 1];
        if (into) into.items.push({ start: into === cur ? t : Math.max(into.len ?? cap, measureLength(into)), dur: 0, sounds: [], chord: ev.chord });
        else pendingChord = ev.chord;
        continue;
      }
      if (!hasBars && t >= cap - EPS) close();
      if (lineStart) {
        if (touched()) close();
        cur.lineBreak = true;
        lineStart = false;
      }
      cur.src ??= li;
      if (pendingSection !== undefined) {
        cur.section = pendingSection;
        pendingSection = undefined;
      }
      const chord = ev.chord ?? pendingChord;
      pendingChord = undefined;
      const sounds = ev.kind === 'note' ? ev.sounds : [];
      if (sounds.length || chord || ev.lyric) {
        const item: Item = { start: t, dur: ev.beats, sounds, chord, lyric: ev.lyric };
        if (ev.kind === 'note' && ev.tied) item.tied = true;
        cur.items.push(item);
      }
      t += ev.beats;
    }
    // A line ending without a bar line ends the measure there; no bar line is written for it.
    if (touched()) close(hasBars ? 'none' : 'single');
  });
  if (touched() || cur.section !== undefined) close();
  if (pendingChord && measures.length) {
    const last = measures[measures.length - 1];
    last.items.push({ start: Math.max(measureLength(last), 0), dur: 0, sounds: [], chord: pendingChord });
  }
  if (!measures.length) measures.push(emptyMeasure(true));
  measures[0].lineBreak = true;
  return { meta: doc.meta, measures, cap };
}

export function toDoc(song: Song): TabDoc {
  const lines: TabLine[] = [];
  let line: TabLine | null = null;
  // The item sounding right before the current one, for checking ties, and the
  // event written for it (a tie inside a measure just lengthens that event).
  let prev: Item | null = null;
  let prevEvent: NoteEvent | null = null;
  song.measures.forEach((m) => {
    if (!line || m.lineBreak || m.section !== undefined) {
      line = { events: [] };
      if (m.section !== undefined) line.section = m.section;
      lines.push(line);
    }
    const events = line.events;
    if (m.startBar) events.push({ kind: 'bar', style: m.startBar });
    const measureFrom = events.length;
    let t = 0;
    for (const it of [...m.items].sort((a, b) => a.start - b.start || a.dur - b.dur)) {
      if (it.start > t + EPS) {
        pushRest(events, t, it.start);
        prev = null;
        prevEvent = null;
      }
      // A tie is only kept when it directly follows a note with the same sound.
      const tie = !!it.tied && !!prev && prev.sounds.length > 0 && sameSounds(prev.sounds, it.sounds);
      if (tie && prevEvent && events.indexOf(prevEvent) >= measureFrom && !it.chord) {
        // Inside a measure a tie is just a longer note: "4~", not "4 ~".
        prevEvent.beats += it.dur;
      } else {
        const ev = itemEvent(it, tie);
        events.push(ev);
        prevEvent = ev.kind === 'note' ? ev : null;
      }
      if (it.dur > EPS) prev = it;
      t = Math.max(t, itemEnd(it));
    }
    const target = m.len ?? song.cap;
    if (t < target - EPS) {
      pushRest(events, t, target);
      prev = null;
      prevEvent = null;
    }
    if (m.endBar !== 'none') events.push({ kind: 'bar', style: m.endBar });
  });
  return { meta: song.meta, lines };
}

/** Rests from `from` to `to`, split at beat boundaries so the text stays readable. */
function pushRest(events: TabEvent[], from: number, to: number) {
  let t = from;
  const firstBeat = Math.ceil(t - EPS);
  if (firstBeat > t + EPS && firstBeat < to - EPS) {
    events.push({ kind: 'rest', beats: firstBeat - t });
    t = firstBeat;
  }
  const whole = Math.floor(to + EPS);
  if (whole > t + EPS && Math.abs(t - Math.round(t)) < EPS) {
    events.push({ kind: 'rest', beats: whole - t });
    t = whole;
  }
  if (to > t + EPS) events.push({ kind: 'rest', beats: to - t });
}

export function sameSounds(a: Sound[], b: Sound[]): boolean {
  return a.length === b.length && JSON.stringify(a) === JSON.stringify(b);
}

function itemEvent(it: Item, tie = false): TabEvent {
  if (it.sounds.length && tie) {
    const ev: NoteEvent = { kind: 'note', sounds: it.sounds, beats: it.dur, tied: true };
    if (it.chord) ev.chord = it.chord;
    return ev;
  }
  if (it.sounds.length) {
    const ev: NoteEvent = { kind: 'note', sounds: it.sounds, beats: it.dur };
    if (it.chord) ev.chord = it.chord;
    if (it.lyric) ev.lyric = it.lyric;
    return ev;
  }
  const r: RestEvent = { kind: 'rest', beats: it.dur };
  if (it.chord) r.chord = it.chord;
  if (it.lyric) r.lyric = it.lyric;
  return r;
}

// ---- Editing --------------------------------------------------------------------------------

/** The "end of song" bar belongs on the last measure: move it there after the song grows. */
function keepFinalBarLast(s: Song): Song {
  const last = s.measures.length - 1;
  const i = s.measures.findIndex((m, k) => k < last && m.endBar === 'final');
  if (i >= 0 && s.measures[last].endBar === 'single') {
    s.measures[i].endBar = 'single';
    s.measures[last].endBar = 'final';
  }
  return s;
}

function cloneSong(song: Song): Song {
  return { ...song, measures: song.measures.map((m) => ({ ...m, items: m.items.map((it) => ({ ...it })) })) };
}

export function findItem(song: Song, pos: Pos): Item | undefined {
  return song.measures[pos.m]?.items.find((it) => near(it.start, pos.start));
}

/** The item covering a time in a measure (for clicks on a note's body). */
export function itemAt(song: Song, m: number, time: number): Item | undefined {
  return song.measures[m]?.items.find((it) => it.start - EPS <= time && time < itemEnd(it) - EPS);
}

/**
 * Places an item, overwriting what it lands on: items starting inside its span are
 * removed and an item running into it is shortened. A note longer than the room
 * left in the measure continues as tied pieces in the following measures.
 */
export function placeItem(song: Song, m: number, item: Item): Song {
  if (item.dur <= EPS) return placeOne(song, m, item);
  let s = song;
  let at = { m, start: Math.max(0, Math.min(item.start, song.cap - EPS)) };
  let left = Math.min(item.dur, song.cap * 64);
  let first = true;
  while (left > EPS) {
    const take = Math.min(left, song.cap - at.start);
    const piece: Item = { ...item, start: at.start, dur: take };
    if (!first) {
      piece.tied = true;
      delete piece.chord;
      delete piece.lyric;
    }
    s = placeOne(s, at.m, piece);
    left -= take;
    first = false;
    at = { m: at.m + 1, start: 0 };
  }
  return s;
}

/** Places an item within one measure (clipped to it). */
function placeOne(song: Song, m: number, item: Item): Song {
  const s = cloneSong(song);
  while (s.measures.length <= m) s.measures.push(emptyMeasure(false));
  const meas = s.measures[m];
  const start = Math.max(0, Math.min(item.start, s.cap - EPS));
  const dur = item.dur <= EPS ? 0 : Math.min(item.dur, s.cap - start);
  const end = start + dur;
  meas.items = meas.items.flatMap((o) => {
    if (dur <= EPS) return near(o.start, start) && o.dur <= EPS ? [] : [o];
    if (itemEnd(o) <= start + EPS || o.start >= end - EPS) return [o];
    if (o.start < start - EPS) return [{ ...o, dur: start - o.start }];
    return [];
  });
  meas.items.push({ ...item, start, dur });
  meas.items.sort((a, b) => a.start - b.start);
  return keepFinalBarLast(s);
}

export function removeItems(song: Song, positions: Pos[]): Song {
  const s = cloneSong(song);
  for (const p of positions) {
    const meas = s.measures[p.m];
    if (meas) meas.items = meas.items.filter((it) => !near(it.start, p.start));
  }
  return s;
}

/**
 * Changes an item. For tied notes the whole chain changes: `dur` is the length of
 * the whole note (re-split at bar lines) and `sounds` apply to every piece.
 */
export function updateItem(song: Song, pos: Pos, patch: Partial<Omit<Item, 'start'>>): Song {
  const it = findItem(song, pos);
  if (!it) return song;
  const chain = chainAt(song, pos);
  if (patch.dur !== undefined) {
    const total = chainLength(song, chain);
    if (!near(patch.dur, total) || chain.length > 1) {
      const head = findItem(song, chain[0])!;
      const rest = { ...patch };
      delete rest.dur;
      const merged = { ...head, ...rest, dur: patch.dur };
      if (near(patch.dur, total) && Object.keys(rest).length === 0) return song;
      return placeItem(removeItems(song, chain), chain[0].m, merged);
    }
  }
  const s = cloneSong(song);
  if (patch.sounds) for (const p of chain) findItem(s, p)!.sounds = patch.sounds;
  const target = findItem(s, pos)!;
  const { sounds: _sounds, dur: _dur, ...own } = patch;
  void _sounds;
  void _dur;
  Object.assign(target, own);
  if (!target.chord) delete target.chord;
  if (!target.lyric) delete target.lyric;
  if (!target.tied) delete target.tied;
  return s;
}

/** Moves (or copies) a note — the whole tied chain — so that the grabbed piece lands at `to`. */
export function moveItem(song: Song, from: Pos, to: Pos, copy = false): Song {
  const chain = chainAt(song, from);
  const head = findItem(song, chain[0]);
  if (!head) return song;
  const offset = absBeat(song, from) - absBeat(song, chain[0]);
  const target = posAt(song, Math.max(0, absBeat(song, to) - offset));
  const base = copy ? song : removeItems(song, chain);
  const placed = { ...head, start: target.start, dur: chainLength(song, chain) };
  delete placed.tied;
  return placeItem(base, target.m, placed);
}

/**
 * Gives every selected note a new length. Notes that follow each other directly are
 * laid out again one after another, so shortening or lengthening a run of notes never
 * swallows the notes inside it; only the run's end moves (like a single note's).
 */
export function setLengths(s: Song, sel: Pos[], beats: number): { song: Song; selection: Pos[] } {
  if (sel.length === 1) return { song: updateItem(s, sel[0], { dur: beats }), selection: sel };
  // One entry per (tied) note, in order.
  const heads: { pos: Pos; chain: Pos[]; item: Item; abs: number; len: number }[] = [];
  for (const p of sel) {
    const chain = chainAt(s, p);
    if (!chain.length || heads.some((h) => samePos(h.pos, chain[0]))) continue;
    heads.push({ pos: chain[0], chain, item: findItem(s, chain[0])!, abs: absBeat(s, chain[0]), len: chainLength(s, chain) });
  }
  heads.sort((a, b) => a.abs - b.abs);
  const runs: (typeof heads)[] = [];
  for (const h of heads) {
    const run = runs[runs.length - 1];
    const prev = run?.[run.length - 1];
    if (prev && Math.abs(advanceAbs(s, prev) - h.abs) < EPS) run.push(h);
    else runs.push([h]);
  }
  let next = s;
  const selection: Pos[] = [];
  // Later runs first, so earlier ones can grow over them predictably.
  for (const run of [...runs].reverse()) {
    next = removeChains(next, run.map((h) => h.pos));
    let at = run[0].pos;
    for (const h of run) {
      next = placeItem(next, at.m, { ...h.item, tied: undefined, start: at.start, dur: beats });
      selection.unshift(at);
      at = advance(next, at, beats);
    }
  }
  return { song: next, selection: selection.sort((a, b) => a.m - b.m || a.start - b.start) };
}

/** Where the note at `h` ends, in lane beats (the start of the slot right after it). */
function advanceAbs(s: Song, h: { pos: Pos; chain: Pos[] }): number {
  const last = h.chain[h.chain.length - 1];
  const it = findItem(s, last)!;
  const end = last.start + it.dur;
  // A note ending on its bar line ends where the next measure starts.
  return end >= measureSpan(s, s.measures[last.m]) - EPS ? (last.m + 1) * s.cap : last.m * s.cap + end;
}

/**
 * Moves (or copies) several notes together by `delta` beats, keeping their spacing.
 * Tied notes move whole. Returns the new song and where the moved notes start.
 */
export function moveItems(song: Song, positions: Pos[], delta: number, copy = false): { song: Song; moved: Pos[] } {
  const heads: { pos: Pos; item: Item; len: number }[] = [];
  for (const p of positions) {
    const chain = chainAt(song, p);
    if (!chain.length || heads.some((h) => samePos(h.pos, chain[0]))) continue;
    heads.push({ pos: chain[0], item: findItem(song, chain[0])!, len: chainLength(song, chain) });
  }
  if (!heads.length) return { song, moved: [] };
  // Nothing moves before the start of the song.
  const first = Math.min(...heads.map((h) => absBeat(song, h.pos)));
  const d = Math.max(delta, -first);
  let next = copy ? song : removeChains(song, heads.map((h) => h.pos));
  const moved: Pos[] = [];
  for (const h of heads) {
    const to = posAt(next, absBeat(song, h.pos) + d);
    const placed = { ...h.item, start: to.start, dur: h.len };
    delete placed.tied;
    next = placeItem(next, to.m, placed);
    moved.push(to);
  }
  return { song: next, moved };
}

/** Every note and rest from `a` to `b` (either order), in reading order. */
export function positionsBetween(song: Song, a: Pos, b: Pos): Pos[] {
  const all = allPositions(song);
  const [lo, hi] = absBeat(song, a) <= absBeat(song, b) ? [a, b] : [b, a];
  return all.filter((p) => absBeat(song, p) >= absBeat(song, lo) - EPS && absBeat(song, p) <= absBeat(song, hi) + EPS);
}

// ---- Ties ----------------------------------------------------------------------------------

/** Absolute beat of a position (measures are `cap` long). */
export function absBeat(song: Song, pos: Pos): number {
  return pos.m * song.cap + pos.start;
}

export function posAt(song: Song, abs: number): Pos {
  const m = Math.floor(abs / song.cap + EPS);
  return { m, start: Math.max(0, abs - m * song.cap) };
}

/** The item ending exactly where `pos` starts (in this measure, or the end of the previous one). */
export function previousItem(song: Song, pos: Pos): { pos: Pos; item: Item } | null {
  const meas = song.measures[pos.m];
  if (!meas) return null;
  if (pos.start > EPS) {
    const it = meas.items.find((x) => near(itemEnd(x), pos.start) && x.dur > EPS);
    return it ? { pos: { m: pos.m, start: it.start }, item: it } : null;
  }
  const prevM = song.measures[pos.m - 1];
  if (!prevM) return null;
  const end = measureSpan(song, prevM);
  const it = prevM.items.find((x) => near(itemEnd(x), end) && x.dur > EPS);
  return it ? { pos: { m: pos.m - 1, start: it.start }, item: it } : null;
}

/** The item starting exactly where the one at `pos` ends. */
export function nextItem(song: Song, pos: Pos): { pos: Pos; item: Item } | null {
  const it = findItem(song, pos);
  if (!it) return null;
  const end = itemEnd(it);
  if (end < measureSpan(song, song.measures[pos.m]) - EPS) {
    const n = song.measures[pos.m].items.find((x) => near(x.start, end) && x !== it);
    return n ? { pos: { m: pos.m, start: n.start }, item: n } : null;
  }
  const nm = song.measures[pos.m + 1];
  const n = nm?.items.find((x) => near(x.start, 0));
  return n ? { pos: { m: pos.m + 1, start: 0 }, item: n } : null;
}

/** All pieces of the (possibly tied) note at `pos`, first to last. */
export function chainAt(song: Song, pos: Pos): Pos[] {
  const it = findItem(song, pos);
  if (!it) return [];
  let head = { pos, item: it };
  for (let guard = 0; head.item.tied && guard < 256; guard++) {
    const p = previousItem(song, head.pos);
    if (!p || !p.item.sounds.length || !sameSounds(p.item.sounds, head.item.sounds)) break;
    head = p;
  }
  const out = [head.pos];
  let cur = head;
  for (let guard = 0; guard < 256; guard++) {
    const n = nextItem(song, cur.pos);
    if (!n || !n.item.tied || !sameSounds(n.item.sounds, cur.item.sounds)) break;
    out.push(n.pos);
    cur = n;
  }
  return out;
}

export function chainLength(song: Song, chain: Pos[]): number {
  return chain.reduce((a, p) => a + (findItem(song, p)?.dur ?? 0), 0);
}

/** Removes whole notes: any piece of a tied chain removes the chain. */
export function removeChains(song: Song, positions: Pos[]): Song {
  const all: Pos[] = [];
  for (const p of positions) for (const q of chainAt(song, p)) if (!all.some((x) => x.m === q.m && near(x.start, q.start))) all.push(q);
  return removeItems(song, all.length ? all : positions);
}

/** Ties a note to the one before it (taking its sound), or unties it. */
export function setTie(song: Song, pos: Pos, on: boolean): Song {
  const it = findItem(song, pos);
  if (!it) return song;
  if (!on) return updateItem(song, pos, { tied: false });
  const prev = previousItem(song, pos);
  if (!prev || !prev.item.sounds.length) return song;
  const s = updateItem(song, pos, { sounds: prev.item.sounds });
  const s2 = cloneSong(s);
  findItem(s2, pos)!.tied = true;
  delete findItem(s2, pos)!.lyric;
  return s2;
}

// ---- Measures -------------------------------------------------------------------------------

export function insertMeasure(song: Song, at: number): Song {
  const s = cloneSong(song);
  const i = Math.max(0, Math.min(at, s.measures.length));
  // The bar before it may run on without a bar line: it needs one now.
  if (s.measures[i - 1]?.endBar === 'none') s.measures[i - 1].endBar = 'single';
  s.measures.splice(i, 0, emptyMeasure(false));
  return keepFinalBarLast(s);
}

export function deleteMeasure(song: Song, m: number): Song {
  const s = cloneSong(song);
  const [gone] = s.measures.splice(m, 1);
  if (!s.measures.length) s.measures.push(emptyMeasure(true));
  // Deleting the last measure keeps the song's end bar on the new last one.
  if (gone && m === s.measures.length && gone.endBar !== 'single' && gone.endBar !== 'none' && s.measures[m - 1]?.endBar === 'single') s.measures[m - 1].endBar = gone.endBar;
  // Keep the line/section start on the measure that takes its place.
  const next = s.measures[m];
  if (gone && next) {
    if (gone.lineBreak) next.lineBreak = true;
    if (gone.section !== undefined && next.section === undefined) next.section = gone.section;
  }
  s.measures[0].lineBreak = true;
  return s;
}

export function duplicateMeasure(song: Song, m: number): Song {
  const s = cloneSong(song);
  const src = s.measures[m];
  if (!src) return song;
  if (src.endBar === 'none') src.endBar = 'single';
  if (m === s.measures.length - 1 && src.endBar === 'final') {
    s.measures.splice(m + 1, 0, { ...src, items: src.items.map((it) => ({ ...it })), lineBreak: false, section: undefined, startBar: undefined, src: undefined });
    s.measures[m].endBar = 'single';
    return s;
  }
  s.measures.splice(m + 1, 0, { ...src, items: src.items.map((it) => ({ ...it })), lineBreak: false, section: undefined, startBar: undefined, src: undefined });
  return s;
}

export function clearMeasure(song: Song, m: number): Song {
  const s = cloneSong(song);
  if (s.measures[m]) s.measures[m].items = [];
  return s;
}

export function updateMeasure(song: Song, m: number, patch: Partial<Omit<Measure, 'items'>>): Song {
  const s = cloneSong(song);
  if (!s.measures[m]) return song;
  Object.assign(s.measures[m], patch);
  if (s.measures[m].section === '') delete s.measures[m].section;
  s.measures[0].lineBreak = true;
  return s;
}

// ---- Time signature -----------------------------------------------------------------------

/**
 * Changes the time signature. With `reflow`, notes are re-barred (notes crossing a new
 * bar are split into ties). A pickup bar stays a pickup; repeat signs and other bar
 * lines stay where they were when a new bar line falls on the same beat.
 */
export function setTimeSignature(song: Song, time: string, reflow: boolean): Song {
  const meta = { ...song.meta, time };
  const cap = beatsPerBar(meta);
  if (!reflow) return { ...cloneSong(song), meta, cap };

  // Flatten to absolute time; each old measure spans its real length.
  type Abs = Item & { at: number };
  const abs: Abs[] = [];
  const marks: { at: number; end: number; m: Measure }[] = [];
  let t = 0;
  for (const m of song.measures) {
    for (const it of [...m.items].sort((a, b) => a.start - b.start)) {
      const at = t + it.start;
      const last = abs[abs.length - 1];
      // Tied pieces merge back into one note before re-barring.
      if (it.tied && last && near(last.at + last.dur, at) && sameSounds(last.sounds, it.sounds)) last.dur += it.dur;
      else abs.push({ ...it, at, tied: it.tied && !!last && near(last.at + last.dur, at) ? true : undefined });
    }
    const span = measureSpan(song, m);
    marks.push({ at: t, end: t + span, m });
    t += span;
  }
  // A pickup (short first bar) keeps its length; the new bars start after it.
  const first = song.measures[0];
  // (A first bar that only runs on to the next line of text isn't a pickup.)
  const pickup = first?.len !== undefined && first.len < song.cap - EPS && first.endBar !== 'none' ? marks[0].end : 0;
  const pickupNew = pickup > EPS && pickup < cap - EPS ? pickup : 0;
  const indexAt = (at: number) => (pickupNew && at < pickupNew - EPS ? 0 : (pickupNew ? 1 : 0) + Math.floor((at - pickupNew) / cap + EPS));
  const startOf = (mi: number) => (pickupNew ? (mi === 0 ? 0 : pickupNew + (mi - 1) * cap) : mi * cap);
  const spanOf = (mi: number) => (pickupNew && mi === 0 ? pickupNew : cap);

  // Re-bar up to the end of the last note (trailing empty space isn't music).
  const lastNoteEnd = abs.reduce((a, it) => Math.max(a, it.at + it.dur), 0);
  const total = lastNoteEnd > EPS ? lastNoteEnd : t;
  const count = Math.max(1, indexAt(total - 1e-3) + 1);
  const measures: Measure[] = Array.from({ length: count }, (_, i) => emptyMeasure(i === 0));
  if (pickupNew) measures[0].len = pickupNew;
  for (const it of abs) {
    let at = it.at;
    let left = it.dur;
    let firstPiece = true;
    do {
      // A chord mark at the end of a bar stays there (not on the next bar's downbeat).
      const mi = Math.max(0, Math.min(count - 1, indexAt(it.dur <= EPS && firstPiece ? at - 1e-3 : at)));
      const start = at - startOf(mi);
      const take = left <= EPS ? 0 : mi === count - 1 ? left : Math.min(left, spanOf(mi) - start);
      const piece: Item = { ...it, start, dur: take };
      delete (piece as Partial<Abs>).at;
      if (!firstPiece) {
        delete piece.chord;
        delete piece.lyric;
        if (!piece.sounds.length) break;
        piece.tied = true;
      }
      measures[mi].items.push(piece);
      at += take;
      left -= take;
      firstPiece = false;
    } while (left > EPS);
  }
  for (const mk of marks) {
    const mi = Math.min(count - 1, indexAt(mk.at));
    const nm = measures[mi];
    if (mk.m.section !== undefined) nm.section = mk.m.section;
    if (mk.m.lineBreak) nm.lineBreak = true;
    nm.src ??= mk.m.src;
    // Bar lines move with the music when a new bar line falls on the same beat.
    if (mk.m.startBar && near(startOf(mi), mk.at)) nm.startBar = mk.m.startBar;
    if (mk.m.endBar !== 'single' && mk.m.endBar !== 'none') {
      const ei = Math.min(count - 1, indexAt(mk.end - 1e-3));
      if (near(startOf(ei) + spanOf(ei), mk.end) || ei === count - 1) measures[ei].endBar = mk.m.endBar;
    }
  }
  // A short last bar stays short.
  const last = song.measures[song.measures.length - 1];
  if (last?.len !== undefined && count > 1) {
    const rest = total - startOf(count - 1);
    if (rest < cap - EPS) measures[count - 1].len = rest;
  }
  return { meta, measures, cap };
}

// ---- Positions ------------------------------------------------------------------------------

/** The slot after an item of `dur` at `pos`, moving into the next measure when full. */
export function advance(song: Song, pos: Pos, dur: number): Pos {
  return posAt(song, absBeat(song, pos) + dur);
}

/** All items in reading order. */
export function allPositions(song: Song): Pos[] {
  return song.measures.flatMap((m, mi) => [...m.items].sort((a, b) => a.start - b.start).map((it) => ({ m: mi, start: it.start })));
}

export function samePos(a: Pos | null | undefined, b: Pos | null | undefined): boolean {
  return !!a && !!b && a.m === b.m && near(a.start, b.start);
}

export function snapTo(x: number, grid: number): number {
  return Math.round(x / grid + EPS) * grid;
}
