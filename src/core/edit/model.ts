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
}

export interface Measure {
  items: Item[];
  /** Bar line drawn at the start (repeat start), if any. */
  startBar?: BarStyle;
  endBar: BarStyle;
  /** Starts a new line of the sheet. */
  lineBreak: boolean;
  section?: string;
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

  const close = (endBar: BarStyle = 'single') => {
    cur.endBar = endBar;
    measures.push(cur);
    cur = emptyMeasure(false);
    t = 0;
  };
  const touched = () => cur.items.length > 0 || t > EPS;

  for (const line of doc.lines) {
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
        if (ev.chord) pendingChord = ev.chord;
        continue;
      }
      if (!hasBars && t >= cap - EPS) close();
      if (lineStart) {
        if (touched()) close();
        cur.lineBreak = true;
        lineStart = false;
      }
      if (pendingSection !== undefined) {
        cur.section = pendingSection;
        pendingSection = undefined;
      }
      const chord = ev.chord ?? pendingChord;
      pendingChord = undefined;
      const sounds = ev.kind === 'note' ? ev.sounds : [];
      if (sounds.length || chord || ev.lyric) cur.items.push({ start: t, dur: ev.beats, sounds, chord, lyric: ev.lyric });
      t += ev.beats;
    }
    // A line ending mid-measure without a bar still ends the measure (keeps the line).
    if (touched()) close();
  }
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
  song.measures.forEach((m) => {
    if (!line || m.lineBreak || m.section !== undefined) {
      line = { events: [] };
      if (m.section !== undefined) line.section = m.section;
      lines.push(line);
    }
    const events = line.events;
    if (m.startBar) events.push({ kind: 'bar', style: m.startBar });
    let t = 0;
    for (const it of [...m.items].sort((a, b) => a.start - b.start || a.dur - b.dur)) {
      if (it.start > t + EPS) pushRest(events, t, it.start);
      events.push(itemEvent(it));
      t = Math.max(t, itemEnd(it));
    }
    if (t < song.cap - EPS) pushRest(events, t, song.cap);
    events.push({ kind: 'bar', style: m.endBar });
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

function itemEvent(it: Item): TabEvent {
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
 * removed and an item running into it is shortened. Durations are clipped to the
 * measure.
 */
export function placeItem(song: Song, m: number, item: Item): Song {
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
  return s;
}

export function removeItems(song: Song, positions: Pos[]): Song {
  const s = cloneSong(song);
  for (const p of positions) {
    const meas = s.measures[p.m];
    if (meas) meas.items = meas.items.filter((it) => !near(it.start, p.start));
  }
  return s;
}

/** Changes fields of an item; a new duration re-places it (overwriting what follows). */
export function updateItem(song: Song, pos: Pos, patch: Partial<Omit<Item, 'start'>>): Song {
  const it = findItem(song, pos);
  if (!it) return song;
  const next = { ...it, ...patch };
  if (patch.dur !== undefined && !near(patch.dur, it.dur)) return placeItem(removeItems(song, [pos]), pos.m, next);
  const s = cloneSong(song);
  const target = findItem(s, pos)!;
  Object.assign(target, patch);
  if (!target.chord) delete target.chord;
  if (!target.lyric) delete target.lyric;
  return s;
}

/** Moves (or copies) an item to another slot. */
export function moveItem(song: Song, from: Pos, to: Pos, copy = false): Song {
  const it = findItem(song, from);
  if (!it) return song;
  const base = copy ? song : removeItems(song, [from]);
  return placeItem(base, to.m, { ...it, start: to.start });
}

// ---- Measures -------------------------------------------------------------------------------

export function insertMeasure(song: Song, at: number): Song {
  const s = cloneSong(song);
  s.measures.splice(Math.max(0, Math.min(at, s.measures.length)), 0, emptyMeasure(false));
  return s;
}

export function deleteMeasure(song: Song, m: number): Song {
  const s = cloneSong(song);
  const [gone] = s.measures.splice(m, 1);
  if (!s.measures.length) s.measures.push(emptyMeasure(true));
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
  s.measures.splice(m + 1, 0, { ...src, items: src.items.map((it) => ({ ...it })), lineBreak: false, section: undefined, startBar: undefined });
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

/** Changes the time signature. With `reflow`, notes are re-barred (notes crossing a new bar are split). */
export function setTimeSignature(song: Song, time: string, reflow: boolean): Song {
  const meta = { ...song.meta, time };
  const cap = beatsPerBar(meta);
  if (!reflow) return { ...cloneSong(song), meta, cap };

  // Flatten to absolute time; each old measure spans max(cap, its content).
  type Abs = Item & { at: number };
  const abs: Abs[] = [];
  const marks: { at: number; section?: string; lineBreak: boolean }[] = [];
  let t = 0;
  for (const m of song.measures) {
    marks.push({ at: t, section: m.section, lineBreak: m.lineBreak });
    for (const it of m.items) abs.push({ ...it, at: t + it.start });
    t += Math.max(song.cap, measureLength(m));
  }
  const total = t;
  const count = Math.max(1, Math.ceil(total / cap - EPS));
  const measures: Measure[] = Array.from({ length: count }, (_, i) => emptyMeasure(i === 0));
  for (const it of abs) {
    let at = it.at;
    let left = it.dur;
    let first = true;
    do {
      const mi = Math.min(count - 1, Math.floor(at / cap + EPS));
      const start = at - mi * cap;
      const take = left <= EPS ? 0 : Math.min(left, cap - start);
      const piece: Item = { ...it, start, dur: take };
      delete (piece as Partial<Abs>).at;
      if (!first) {
        delete piece.chord;
        delete piece.lyric;
        if (!piece.sounds.length) break;
      }
      measures[mi].items.push(piece);
      at += take;
      left -= take;
      first = false;
    } while (left > EPS);
  }
  for (const mk of marks) {
    const mi = Math.min(count - 1, Math.floor(mk.at / cap + EPS));
    if (mk.section !== undefined) measures[mi].section = mk.section;
    if (mk.lineBreak) measures[mi].lineBreak = true;
  }
  const lastEnd = song.measures[song.measures.length - 1]?.endBar;
  if (lastEnd && lastEnd !== 'single') measures[count - 1].endBar = lastEnd;
  return { meta, measures, cap };
}

// ---- Positions ------------------------------------------------------------------------------

/** The slot after an item of `dur` at `pos`, moving into the next measure when full. */
export function advance(song: Song, pos: Pos, dur: number): Pos {
  const t = pos.start + dur;
  if (t < song.cap - EPS) return { m: pos.m, start: t };
  return { m: pos.m + 1, start: Math.max(0, t - song.cap) };
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
