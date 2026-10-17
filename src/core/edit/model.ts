// Measure model for the visual editor.
//
// A song is a list of measures; each measure is `cap` beats long (from the time
// signature) unless it's a short bar (a pickup: `len`), and holds items at a start time
// with a duration. Gaps are rests. Positions across measures are in played time
// (realBeat / posAtReal), so short bars count at their real length everywhere.
// Edits are pure functions Song → Song; the editor converts to and from TabDoc so
// the .htab text stays the single source of truth.

import { hasLyrics } from '../verses';
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
  /** Syllables in verses 2, 3… (see verses.ts). */
  verses?: (string | undefined)[];
  /** The verses where it holds the syllable before it ("_"; see verses.ts). */
  holds?: number[];
  /** Tied from the item before it (same sound, keeps sounding across the gap/bar). */
  tied?: boolean;
}

export interface Measure {
  items: Item[];
  /** Bar line drawn at the start (repeat start), if any. */
  startBar?: BarStyle;
  /** 'none': no bar line is written (the bar carries on on the next line of text). */
  endBar: BarStyle | 'none';
  /** A repeat end played more than twice (":|x3"): how many times through. */
  endTimes?: number;
  /** This bar starts a 1st/2nd… ending ("[1.]"): the times through it's played. */
  ending?: number[];
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

  // A tab without bar lines is cut into measures for the editor, but none are written back.
  const close = (endBar: Measure['endBar'] = hasBars ? 'single' : 'none', times?: number) => {
    cur.endBar = endBar;
    if (times) cur.endTimes = times;
    // Pickups and other short bars (and a line of an unbarred tab) keep their length instead of
    // being filled with rests; so does a bar made longer by rests (nothing written is lost).
    if (Math.abs(t - cap) > EPS && t > EPS) cur.len = t;
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
        } else close(ev.style, ev.times);
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
      if (ev.ending && !cur.items.length && t <= EPS) cur.ending = [...ev.ending];
      if (pendingSection !== undefined) {
        cur.section = pendingSection;
        pendingSection = undefined;
      }
      const chord = ev.chord ?? pendingChord;
      pendingChord = undefined;
      const sounds = ev.kind === 'note' ? ev.sounds : [];
      if (sounds.length || chord || hasLyrics(ev)) {
        const item: Item = { start: t, dur: ev.beats, sounds, chord, lyric: ev.lyric };
        if (ev.verses) item.verses = [...ev.verses];
        if (ev.holds) item.holds = [...ev.holds];
        if (ev.kind === 'note' && ev.tied) item.tied = true;
        cur.items.push(item);
      }
      t += ev.beats;
    }
    // A line ending without a bar line ends the measure there; no bar line is written for it.
    if (touched()) close('none');
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
      if (it.dur <= EPS && !it.chord) continue;
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
    // (An ending goes on the bar's first note or rest.)
    const first = m.ending?.length ? events.slice(measureFrom).find((e): e is NoteEvent | RestEvent => e.kind !== 'bar' && e.beats > EPS) : undefined;
    if (first) first.ending = [...m.ending!];
    if (m.endBar !== 'none') events.push({ kind: 'bar', style: m.endBar, ...(m.endBar === 'repeat-end' && m.endTimes ? { times: m.endTimes } : {}) });
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
  // (Nothing sounds for no time: a zero-length item is only ever a chord marker.)
  if (it.dur <= EPS) return { kind: 'rest', beats: 0, chord: it.chord };
  if (it.sounds.length && tie) {
    const ev: NoteEvent = { kind: 'note', sounds: it.sounds, beats: it.dur, tied: true };
    if (it.chord) ev.chord = it.chord;
    return ev;
  }
  if (it.sounds.length) {
    const ev: NoteEvent = { kind: 'note', sounds: it.sounds, beats: it.dur };
    if (it.chord) ev.chord = it.chord;
    if (it.lyric) ev.lyric = it.lyric;
    if (it.verses?.some(Boolean)) ev.verses = [...it.verses];
    if (it.holds?.length) ev.holds = [...it.holds];
    return ev;
  }
  const r: RestEvent = { kind: 'rest', beats: it.dur };
  if (it.chord) r.chord = it.chord;
  if (it.lyric) r.lyric = it.lyric;
  if (it.verses?.some(Boolean)) r.verses = [...it.verses];
  if (it.holds?.length) r.holds = [...it.holds];
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

export function cloneSong(song: Song): Song {
  return { ...song, measures: song.measures.map((m) => ({ ...m, items: m.items.map((it) => ({ ...it })) })) };
}

export function findItem(song: Song, pos: Pos): Item | undefined {
  return song.measures[pos.m]?.items.find((it) => near(it.start, pos.start));
}

/**
 * Places an item, overwriting what it lands on: items starting inside its span are
 * removed and an item running into it is shortened. A note longer than the room
 * left in the measure continues as tied pieces in the following measures.
 */
export function placeItem(song: Song, m: number, item: Item): Song {
  if (item.dur <= EPS) return placeOne(song, m, item);
  let s = song;
  let at = { m, start: Math.max(0, Math.min(item.start, roomOf(song, m) - EPS)) };
  let left = Math.min(item.dur, song.cap * 64);
  let first = true;
  while (left > EPS) {
    const take = Math.min(left, roomEnd(s, at.m, at.start) - at.start);
    const piece: Item = { ...item, start: at.start, dur: take };
    if (!first) {
      piece.tied = true;
      delete piece.chord;
      delete piece.lyric;
      delete piece.verses;
      delete piece.holds;
    }
    s = placeOne(s, at.m, piece);
    left -= take;
    first = false;
    at = { m: at.m + 1, start: 0 };
  }
  return s;
}

/**
 * Where a note placed at `start` in a measure has to stop (and carry on, tied, in the next
 * one): the end of the bar. A short bar (a pickup) ends at its own length, unless the note is
 * placed past that end on purpose, which makes the bar longer.
 */
function roomEnd(song: Song, m: number, start: number): number {
  const meas = song.measures[m];
  // The last bar (a short last bar, the end of an unbarred tab) just grows: there's no next one.
  if (!meas || m >= song.measures.length - 1) {
    const end = roomOf(song, m);
    return start < end - EPS ? end : start + song.cap;
  }
  // (A bar longer than the time signature, e.g. after the time changed without re-barring,
  // has its whole length.)
  const end = measureSpan(song, meas);
  return start < end - EPS ? end : Math.max(song.cap, start + 1);
}

/** How far into a measure notes can go: the time signature, or more in a longer bar. */
function roomOf(song: Song, m: number): number {
  const meas = song.measures[m];
  return Math.max(song.cap, meas ? measureSpan(song, meas) : 0);
}

/** A tab written without bar lines (every measure runs on). */
function unbarred(song: Song): boolean {
  return song.measures.length > 0 && song.measures.every((m) => m.endBar === 'none');
}

/** Places an item within one measure (clipped to it). */
function placeOne(song: Song, m: number, item: Item): Song {
  const s = cloneSong(song);
  const noBars = unbarred(s);
  while (s.measures.length <= m) s.measures.push({ ...emptyMeasure(false), endBar: noBars ? 'none' : 'single' });
  const meas = s.measures[m];
  const start = Math.max(0, Math.min(item.start, roomOf(s, m) - EPS));
  const dur = item.dur <= EPS ? 0 : Math.min(item.dur, roomEnd(s, m, start) - start);
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
  // A chord symbol on its own (no length) can't sound: it stays a marker until given a length.
  if (it.dur <= EPS && patch.sounds?.length && !(patch.dur && patch.dur > EPS)) {
    patch = { ...patch };
    delete patch.sounds;
  }
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
  if (!target.verses?.some(Boolean)) delete target.verses;
  if (!target.holds?.length) delete target.holds;
  if (!target.tied) delete target.tied;
  return s;
}

/** Moves (or copies) a note — the whole tied chain — so that the grabbed piece lands at `to`. */
export function moveItem(song: Song, from: Pos, to: Pos, copy = false): Song {
  const chain = chainAt(song, from);
  const head = findItem(song, chain[0]);
  if (!head) return song;
  const offset = realBeat(song, from) - realBeat(song, chain[0]);
  const target = posAtReal(song, Math.max(0, realBeat(song, to) - offset));
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
    heads.push({ pos: chain[0], chain, item: findItem(s, chain[0])!, abs: realBeat(s, chain[0]), len: chainLength(s, chain) });
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

/** Where the note at `h` ends (the start of the slot right after it). */
function advanceAbs(s: Song, h: { pos: Pos; chain: Pos[] }): number {
  const last = h.chain[h.chain.length - 1];
  return realBeat(s, last) + findItem(s, last)!.dur;
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
  const first = Math.min(...heads.map((h) => realBeat(song, h.pos)));
  const d = Math.max(delta, -first);
  let next = copy ? song : removeChains(song, heads.map((h) => h.pos));
  const moved: Pos[] = [];
  for (const h of heads) {
    const to = posAtReal(next, realBeat(song, h.pos) + d);
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
  const [lo, hi] = realBeat(song, a) <= realBeat(song, b) ? [a, b] : [b, a];
  return all.filter((p) => realBeat(song, p) >= realBeat(song, lo) - EPS && realBeat(song, p) <= realBeat(song, hi) + EPS);
}

// ---- Ties ----------------------------------------------------------------------------------

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
  delete findItem(s2, pos)!.verses;
  delete findItem(s2, pos)!.holds;
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
    s.measures.splice(m + 1, 0, { ...src, items: src.items.map((it) => ({ ...it })), lineBreak: false, section: undefined, startBar: undefined, ending: undefined, src: undefined });
    s.measures[m].endBar = 'single';
    return s;
  }
  s.measures.splice(m + 1, 0, { ...src, items: src.items.map((it) => ({ ...it })), lineBreak: false, section: undefined, startBar: undefined, ending: undefined, src: undefined });
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

type AbsItem = Item & { at: number };
type Mark = { at: number; end: number; m: Measure };

/** Measures as one timeline (tied pieces joined back into whole notes), from the first given measure. */
function flatten(song: Song, measures: Measure[]): { abs: AbsItem[]; marks: Mark[]; t: number } {
  const abs: AbsItem[] = [];
  const marks: Mark[] = [];
  let t = 0;
  for (const m of measures) {
    for (const it of [...m.items].sort((a, b) => a.start - b.start)) {
      const at = t + it.start;
      const last = abs[abs.length - 1];
      // Tied pieces merge back into one note; a tie at the very start continues a note before it.
      // (A tie carrying a chord symbol stays its own piece, so the chord keeps its place.)
      if (it.tied && !it.chord && last && near(last.at + last.dur, at) && sameSounds(last.sounds, it.sounds)) last.dur += it.dur;
      else abs.push({ ...it, at, tied: it.tied && (!last || near(last.at + last.dur, at)) ? true : undefined });
    }
    const span = measureSpan(song, m);
    marks.push({ at: t, end: t + span, m });
    t += span;
  }
  return { abs, marks, t };
}

/**
 * Cuts a timeline into bars of `cap` beats (after an optional pickup); notes crossing a
 * bar line become ties. Sections, line breaks and bar lines go where their marks fall.
 * A repeat sign or double bar always gets a bar line: when it falls inside a new bar, the
 * bar before it ends early (a short bar), so the music and the repeat stay exactly the same.
 */
function rebar(
  cap: number,
  abs: AbsItem[],
  marks: Mark[],
  total: number,
  opts: { pickup: number; lastShort: boolean; firstBreak: boolean; info?: RebarInfo; keepLines?: boolean; noBars?: boolean },
): Measure[] {
  const { pickup } = opts;
  // Where bar lines must fall: repeat signs and double bars.
  const keep = new Set<number>();
  for (const mk of marks) {
    if ((mk.m.startBar && mk.m.startBar !== 'single') || mk.m.ending) keep.add(mk.at);
    if (mk.m.endBar !== 'single' && mk.m.endBar !== 'none' && mk.m.endBar !== 'final') keep.add(mk.end);
  }
  const fixed = [...keep].filter((x) => x > EPS && x < total - 1e-3).sort((a, b) => a - b);
  // Bar starts: every `cap` beats (after the pickup), restarting at each fixed bar line.
  const starts = [0];
  let shortBars = 0;
  for (let t = 0, guard = 0; guard < 10000; guard++) {
    let next = t === 0 && pickup ? pickup : t + cap;
    const cut = fixed.find((x) => x > t + EPS && x < next - EPS);
    if (cut !== undefined) {
      next = cut;
      shortBars++;
    }
    if (next >= total - 1e-3) break;
    starts.push(next);
    t = next;
  }
  if (opts.info) opts.info.shortBars = shortBars;
  // `keepLines`: a line that starts inside a bar still starts after the same note; the bar is
  // split over the two lines (its first part runs on without a bar line), as it was written.
  const splitAt = new Set<number>();
  if (opts.keepLines) {
    for (const mk of marks) {
      if (!(mk.m.lineBreak || mk.m.section !== undefined) || mk.at <= EPS || mk.at >= total - 1e-3) continue;
      if (starts.some((x) => near(x, mk.at))) continue;
      splitAt.add(mk.at);
      starts.push(mk.at);
    }
    starts.sort((a, b) => a - b);
  }
  const count = starts.length;
  const indexAt = (at: number) => {
    let i = 0;
    while (i + 1 < count && starts[i + 1] <= at + EPS) i++;
    return i;
  };
  const startOf = (mi: number) => starts[Math.max(0, Math.min(count - 1, mi))];
  const spanOf = (mi: number) => (mi + 1 < count ? starts[mi + 1] - starts[mi] : cap);
  const measures: Measure[] = Array.from({ length: count }, (_, i) => emptyMeasure(i === 0 && opts.firstBreak));
  for (let i = 0; i + 1 < count; i++) if (opts.noBars || [...splitAt].some((x) => near(x, starts[i + 1]))) measures[i].endBar = 'none';
  if (opts.noBars) measures[count - 1].endBar = 'none';
  // Short bars (the pickup, and bars ending early at a repeat sign) keep their length.
  for (let i = 0; i + 1 < count; i++) if (spanOf(i) < cap - EPS) measures[i].len = spanOf(i);
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
      delete (piece as Partial<AbsItem>).at;
      if (!firstPiece) {
        delete piece.chord;
        delete piece.lyric;
        delete piece.verses;
        delete piece.holds;
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
    const mi = Math.max(0, Math.min(count - 1, indexAt(mk.at)));
    const nm = measures[mi];
    if (mk.m.section !== undefined) nm.section = mk.m.section;
    if (mk.m.lineBreak) nm.lineBreak = true;
    nm.src ??= mk.m.src;
    // Bar lines move with the music when a new bar line falls on the same beat.
    if (mk.m.startBar && near(startOf(mi), mk.at)) nm.startBar = mk.m.startBar;
    if (mk.m.ending && near(startOf(mi), mk.at)) nm.ending = mk.m.ending;
    if (mk.m.endBar !== 'single' && mk.m.endBar !== 'none' && !opts.noBars) {
      const ei = Math.max(0, Math.min(count - 1, indexAt(mk.end - 1e-3)));
      // A bar line past the end of the music (after trailing rests) goes on the last bar,
      // unless that already ends with its own sign (a repeat before the rests stays).
      const onLast = ei === count - 1 && (measures[ei].endBar === 'single' || measures[ei].endBar === 'none');
      if (near(startOf(ei) + spanOf(ei), mk.end) || onLast) {
        measures[ei].endBar = mk.m.endBar;
        if (mk.m.endTimes) measures[ei].endTimes = mk.m.endTimes;
      }
    }
  }
  // A short last bar stays short; so does the last bar after a bar was shortened for a repeat
  // sign (padding it with rests would add silence the song didn't have).
  if ((opts.lastShort || shortBars > 0) && count > 1) {
    const rest = total - startOf(count - 1);
    if (rest < cap - EPS) measures[count - 1].len = rest;
  }
  return measures;
}

/** What re-barring had to do: bars it ended early so a repeat sign keeps its place. */
export interface RebarInfo {
  shortBars: number;
}

/**
 * Changes the time signature. With `reflow`, notes are re-barred (notes crossing a new
 * bar are split into ties). A pickup bar stays a pickup; repeat signs and double bars stay
 * where they are in the music (the bar before one is shortened when needed; see `info`).
 */
export function setTimeSignature(song: Song, time: string, reflow: boolean, info?: RebarInfo): Song {
  const meta = { ...song.meta, time };
  const cap = beatsPerBar(meta);
  if (!reflow) return { ...cloneSong(song), meta, cap };
  const { abs, marks, t } = flatten(song, song.measures);
  // A pickup (short first bar) keeps its length; the new bars start after it.
  // (A first bar that only runs on to the next line of text isn't a pickup.)
  const first = song.measures[0];
  const pickup = first?.len !== undefined && first.len < song.cap - EPS && first.endBar !== 'none' ? marks[0].end : 0;
  // Re-bar up to the end of the last note (trailing empty space isn't music).
  // (Up to a closing repeat sign or double bar, though: the rests before it are part of the repeat.)
  const lastNoteEnd = abs.reduce((a, it) => Math.max(a, it.at + it.dur), 0);
  const lastMark = marks.reduce((a, mk) => (mk.m.endBar === 'repeat-end' || mk.m.endBar === 'double' ? Math.max(a, mk.end) : a), 0);
  const total = Math.max(lastNoteEnd > EPS ? lastNoteEnd : t, lastMark);
  const last = song.measures[song.measures.length - 1];
  const measures = rebar(cap, abs, marks, total, { pickup: pickup > EPS && pickup < cap - EPS ? pickup : 0, lastShort: last?.len !== undefined || lastMark >= total - EPS, firstBreak: true, info, noBars: unbarred(song) });
  return { meta, measures, cap };
}

/** Where a position is in played time (short and overfull bars take their real length). */
export function realBeat(song: Song, pos: Pos): number {
  let t = 0;
  for (let i = 0; i < pos.m && i < song.measures.length; i++) t += measureSpan(song, song.measures[i]);
  if (pos.m > song.measures.length) t += (pos.m - song.measures.length) * song.cap;
  return t + pos.start;
}

/** The position at a time in played time (the inverse of realBeat). */
export function posAtReal(song: Song, beat: number): Pos {
  let t = 0;
  for (let i = 0; i < song.measures.length; i++) {
    const span = measureSpan(song, song.measures[i]);
    if (beat < t + span - EPS) return { m: i, start: Math.max(0, beat - t) };
    t += span;
  }
  const extra = beat - t;
  const m = Math.floor(extra / song.cap + EPS);
  return { m: song.measures.length + m, start: Math.max(0, extra - m * song.cap) };
}

/**
 * Insert mode: everything from `at` on moves by `delta` beats (later for room, earlier
 * to close a gap), flowing over the bar lines. Bars before `at`'s bar are untouched.
 */
export function ripple(song: Song, at: Pos, delta: number): Song {
  if (Math.abs(delta) < EPS || at.m >= song.measures.length) return song;
  // Closing a gap starts in the bar where the gap starts (it may be the bar before `at`'s).
  const real = realBeat(song, at);
  let k = delta < 0 ? Math.min(at.m, posAtReal(song, Math.max(0, real + delta)).m) : at.m;
  // Start at the real start of the bar: a bar split over two lines of text starts on the line before.
  while (k > 0 && song.measures[k - 1].endBar === 'none' && song.measures[k - 1].len !== undefined) k--;
  const noBars = unbarred(song);
  if (noBars) k = 0;
  const from = real - realBeat(song, { m: k, start: 0 });
  const tail = song.measures.slice(k);
  const { abs, marks, t } = flatten(song, tail);
  const moved = abs
    // Closing a gap: whatever is still in it goes (callers clear it first).
    .filter((it) => !(delta < 0 && it.at >= from + delta - EPS && it.at < from - EPS))
    .map((it) => (it.at >= from - EPS ? { ...it, at: it.at + delta } : it));
  // Making room at a line start puts the new note on that line (the mark stays); closing a gap
  // moves a mark at its end back with the music after it, and one inside it to its start.
  const shift = (x: number) => (delta > 0 ? (x > from + EPS ? x + delta : x) : x >= from - EPS ? x + delta : Math.min(x, from + delta));
  const shifted = marks.map((mk, i) => {
    const prev = marks[i - 1]?.m;
    // A line starting at a plain bar line stays at that bar line (the music flows across it,
    // the bars stay put); one starting inside a bar starts after the same note as before, and
    // repeat signs and double bars keep the music they hold.
    const structural = (mk.m.startBar && mk.m.startBar !== 'single') || (prev && prev.endBar !== 'single' && prev.endBar !== 'none' && prev.endBar !== 'final');
    const stays = mk.at <= EPS || (prev?.endBar !== 'none' && !structural);
    return { ...mk, at: stays ? mk.at : shift(mk.at), end: shift(mk.end) };
  });
  const lastNoteEnd = moved.reduce((a, it) => Math.max(a, it.at + it.dur), 0);
  const total = Math.max(lastNoteEnd, t + delta, EPS);
  const last = tail[tail.length - 1];
  // The bar it starts in keeps its length: a pickup stays a pickup (a bar that only runs on to
  // the next line isn't one).
  const own = tail[0].len !== undefined && tail[0].endBar !== 'none' ? Math.min(song.cap, measureSpan(song, tail[0])) : song.cap;
  const measures = rebar(song.cap, moved, shifted, total, { pickup: own < song.cap - EPS && !noBars ? own : 0, lastShort: last?.len !== undefined, firstBreak: tail[0].lineBreak, keepLines: true, noBars });
  return keepFinalBarLast({ ...song, measures: [...cloneSong(song).measures.slice(0, k), ...measures] });
}

// ---- Insert mode ------------------------------------------------------------------------------

/** Where a (tied) note ends: the slot right after its last piece. */
function afterChain(song: Song, chain: Pos[]): Pos {
  const last = chain[chain.length - 1];
  return posAtReal(song, realBeat(song, last) + findItem(song, last)!.dur);
}

/** Makes room for `dur` beats at `at` (insert mode); in overwrite mode nothing moves. */
export function makeRoom(song: Song, at: Pos, dur: number, insert: boolean): Song {
  return insert ? ripple(song, at, dur) : song;
}

/** Deletes notes; in insert mode the music after each closes the gap. */
export function deleteNotes(song: Song, positions: Pos[], insert: boolean): Song {
  if (!insert) return removeChains(song, positions);
  const chains: Pos[][] = [];
  for (const p of positions) {
    const c = chainAt(song, p);
    if (c.length && !chains.some((x) => samePos(x[0], c[0]))) chains.push(c);
  }
  // Last first, so earlier positions stay valid.
  chains.sort((a, b) => realBeat(song, b[0]) - realBeat(song, a[0]));
  let s = song;
  for (const c0 of chains) {
    const c = chainAt(s, c0[0]);
    if (!c.length) continue;
    const end = afterChain(s, c);
    const len = chainLength(s, c);
    s = ripple(removeChains(s, [c[0]]), end, -len);
  }
  return s;
}

/**
 * Gives notes a new length. In insert mode the music after each note moves along
 * (later when it grows, earlier when it shrinks); otherwise see setLengths.
 */
export function changeLengths(song: Song, sel: Pos[], beats: number, insert: boolean): { song: Song; selection: Pos[] } {
  if (!insert) return setLengths(song, sel, beats);
  const heads: { pos: Pos; real: number; len: number }[] = [];
  for (const p of sel) {
    const c = chainAt(song, p);
    if (c.length && !heads.some((h) => samePos(h.pos, c[0]))) heads.push({ pos: c[0], real: realBeat(song, c[0]), len: chainLength(song, c) });
  }
  heads.sort((a, b) => b.real - a.real);
  let s = song;
  for (const h of heads) {
    const d = beats - h.len;
    if (Math.abs(d) < EPS) continue;
    const chain = chainAt(s, h.pos);
    if (!chain.length) continue;
    const end = afterChain(s, chain);
    if (d > 0) s = updateItem(ripple(s, end, d), h.pos, { dur: beats });
    else s = ripple(updateItem(s, h.pos, { dur: beats }), end, d);
  }
  // Each note moved by the growth of the notes before it.
  const order = [...heads].sort((a, b) => a.real - b.real);
  let shift = 0;
  const selection = order.map((h) => {
    const pos = posAtReal(s, h.real + shift);
    shift += beats - h.len;
    return pos;
  });
  return { song: s, selection };
}

// ---- Positions ------------------------------------------------------------------------------

/** The slot after an item of `dur` at `pos`, moving into the next measure at its bar line (short bars too). */
export function advance(song: Song, pos: Pos, dur: number): Pos {
  return posAtReal(song, realBeat(song, pos) + dur);
}

/**
 * Clears a stretch of time (overwriting it with a rest): notes starting in it go, and a
 * note running into it is cut at its start. Tied pieces after the cut go with it.
 */
export function clearSpan(song: Song, from: number, to: number): Song {
  if (to <= from + EPS) return song;
  const s = cloneSong(song);
  let t = 0;
  for (const m of s.measures) {
    const span = measureSpan(s, m);
    m.items = m.items.flatMap((it) => {
      const at = t + it.start;
      if (at >= from - EPS && at < to - EPS) return [];
      if (at < from - EPS && at + it.dur > from + EPS) return [{ ...it, dur: from - at }];
      return [it];
    });
    t += span;
  }
  return s;
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

/**
 * The grid a length moves on: ½ beat for eighths and longer, finer for what needs it
 * (a sixteenth or a dotted eighth: ¼ beat; triplets: ⅓ beat; triplet sixteenths: ⅙).
 */
export function gridFor(len: number): number {
  if (len <= EPS) return 0.5;
  for (const g of [0.5, 0.25, 1 / 3, 0.125, 1 / 6, 1 / 12]) if (Math.abs(len / g - Math.round(len / g)) < 1e-4) return g;
  return 0.25;
}

/** The grid for a note: its length's, or finer when it starts off that grid (a syncopated quarter). */
export function gridForNote(len: number, start: number): number {
  const frac = start - Math.floor(start + EPS);
  return frac > EPS ? Math.min(gridFor(len), gridFor(frac)) : gridFor(len);
}

/** The finer grid Shift gives while dragging: sixteenths, or triplet sixteenths on a triplet grid. */
export function fineGrid(grid: number): number {
  const triplet = Math.abs(grid * 3 - Math.round(grid * 3)) < 1e-6 && Math.abs(grid * 4 - Math.round(grid * 4)) > 1e-6;
  return Math.min(grid, triplet ? 1 / 6 : 0.25);
}
