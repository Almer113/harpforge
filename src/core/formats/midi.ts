// Standard MIDI files: import (melody extraction) and export.

import type { Harmonica } from '../instruments';
import { beatsPerBar, type NoteEvent, type TabDoc } from '../htab/types';
import { pitchClassName } from '../pitch';
import { clustersToEvents, quantize } from '../timeline';
import type { Sound } from '../types';
import { wrapEvents } from '../htab/serializer';
import { eventMidis, keyFifths, notesMeta, type Imported } from './common';

// ---- Reading -------------------------------------------------------------------

interface RawNote {
  start: number;
  end: number;
  midi: number;
  channel: number;
}

interface RawTrack {
  name: string;
  notes: RawNote[];
}

class Reader {
  pos = 0;
  constructor(private data: Uint8Array) {}
  get eof() {
    return this.pos >= this.data.length;
  }
  u8() {
    return this.data[this.pos++];
  }
  u16() {
    return (this.u8() << 8) | this.u8();
  }
  u32() {
    return ((this.u8() << 24) >>> 0) + (this.u8() << 16) + (this.u8() << 8) + this.u8();
  }
  str(n: number) {
    let s = '';
    for (let i = 0; i < n; i++) s += String.fromCharCode(this.u8());
    return s;
  }
  varlen() {
    let v = 0;
    for (let i = 0; i < 4; i++) {
      const b = this.u8();
      v = (v << 7) | (b & 0x7f);
      if (!(b & 0x80)) break;
    }
    return v;
  }
  bytes(n: number) {
    const b = this.data.subarray(this.pos, this.pos + n);
    this.pos += n;
    return b;
  }
}

export function parseMidi(data: Uint8Array): Imported {
  const warnings: string[] = [];
  const r = new Reader(data);
  if (r.str(4) !== 'MThd') throw new Error('Not a MIDI file');
  const hlen = r.u32();
  r.u16(); // format
  const ntrks = r.u16();
  let division = r.u16();
  r.pos = 8 + hlen;
  if (division & 0x8000) {
    warnings.push('SMPTE-timed MIDI: timing may be approximate.');
    division = 480;
  }

  let tempoUs: number | null = null;
  let timeSig: string | null = null;
  let keySig: string | null = null;
  let title: string | undefined;
  const tracks: RawTrack[] = [];

  for (let t = 0; t < ntrks && !r.eof; t++) {
    const id = r.str(4);
    const len = r.u32();
    const end = r.pos + len;
    if (id !== 'MTrk') {
      r.pos = end;
      continue;
    }
    const track: RawTrack = { name: '', notes: [] };
    const open = new Map<number, { start: number; channel: number }[]>();
    let tick = 0;
    let status = 0;
    while (r.pos < end) {
      tick += r.varlen();
      let b = r.u8();
      if (b === 0xff) {
        const type = r.u8();
        const l = r.varlen();
        const d = r.bytes(l);
        if (type === 0x51 && tempoUs === null) tempoUs = (d[0] << 16) | (d[1] << 8) | d[2];
        else if (type === 0x58 && timeSig === null) timeSig = `${d[0]}/${Math.pow(2, d[1])}`;
        else if (type === 0x59 && keySig === null) {
          const sf = (d[0] << 24) >> 24;
          const minor = d[1] === 1;
          const majorPc = (sf * 7 + 1200) % 12;
          keySig = minor ? pitchClassName(majorPc + 9, sf < 0) + 'm' : pitchClassName(majorPc, sf < 0);
        } else if (type === 0x03) {
          const name = new TextDecoder().decode(d).trim();
          track.name = name;
          if (t === 0 && name && ntrks > 1) title ??= name;
        }
        continue;
      }
      if (b === 0xf0 || b === 0xf7) {
        r.pos += r.varlen();
        continue;
      }
      if (b & 0x80) status = b;
      else r.pos--; // running status
      b = status;
      const type = b & 0xf0;
      const channel = b & 0x0f;
      if (type === 0x90 || type === 0x80) {
        const note = r.u8();
        const vel = r.u8();
        if (type === 0x90 && vel > 0) {
          const list = open.get(note) ?? [];
          list.push({ start: tick, channel });
          open.set(note, list);
        } else {
          const list = open.get(note);
          const on = list?.shift();
          if (on) track.notes.push({ start: on.start, end: tick, midi: note, channel: on.channel });
        }
      } else if (type === 0xc0 || type === 0xd0) r.pos += 1;
      else r.pos += 2;
    }
    r.pos = end;
    if (track.notes.length) tracks.push(track);
  }

  // Pick the melody: skip drums; prefer named melody tracks, then the most monophonic busy track.
  const candidates = tracks
    .map((tr) => ({ ...tr, notes: tr.notes.filter((n) => n.channel !== 9) }))
    .filter((tr) => tr.notes.length);
  if (!candidates.length) throw new Error('No notes found in this MIDI file.');
  const score = (tr: RawTrack) => {
    const sorted = [...tr.notes].sort((a, b) => a.start - b.start);
    let mono = 0;
    for (let i = 1; i < sorted.length; i++) if (sorted[i].start >= sorted[i - 1].end - division / 8) mono++;
    const avg = sorted.reduce((a, n) => a + n.midi, 0) / sorted.length;
    const named = /harmonica|harp|melody|lead|vocal|voice|solo|tune/i.test(tr.name) ? 1000 : 0;
    return named + mono + avg / 10;
  };
  candidates.sort((a, b) => score(b) - score(a));
  const chosen = candidates[0];
  if (candidates.length > 1) warnings.push(`Imported the melody from track "${chosen.name || 'unnamed'}" (${candidates.length} tracks with notes).`);

  const meta = notesMeta({
    title: title || undefined,
    tempo: tempoUs ? Math.round(60_000_000 / tempoUs) : 120,
    time: timeSig ?? '4/4',
    key: keySig ?? undefined,
  });

  // Grid: 16ths, or triplet eighths when they fit clearly better.
  const toBeats = (tick: number) => tick / division;
  const err = (grid: number) => chosen.notes.reduce((a, n) => {
    const b = toBeats(n.start);
    return a + Math.abs(b - Math.round(b / grid) * grid);
  }, 0);
  const grid = err(1 / 3) < err(1 / 4) * 0.6 ? 1 / 3 : 1 / 4;
  const notes = chosen.notes.map((n) => ({ start: toBeats(n.start), end: toBeats(n.end), sound: { type: 'pitch', midi: n.midi } as Sound }));
  const clusters = quantize(notes, grid, (a, b) => a.type === 'pitch' && b.type === 'pitch' && a.midi === b.midi);
  for (const c of clusters) c.sounds.sort((a, b) => (a.type === 'pitch' && b.type === 'pitch' ? a.midi - b.midi : 0));
  const events = clustersToEvents(clusters, beatsPerBar(meta));
  return { doc: { meta, lines: wrapEvents(events, 4) }, warnings, format: 'MIDI' };
}

// ---- Writing --------------------------------------------------------------------

function varlen(n: number): number[] {
  const bytes = [n & 0x7f];
  n >>= 7;
  while (n > 0) {
    bytes.unshift((n & 0x7f) | 0x80);
    n >>= 7;
  }
  return bytes;
}

function textEvent(type: number, text: string): number[] {
  const b = [...new TextEncoder().encode(text)];
  return [0xff, type, ...varlen(b.length), ...b];
}

/** Writes a format-0 MIDI file with the melody on a harmonica patch. */
export function writeMidi(doc: TabDoc, harp?: Harmonica): Uint8Array {
  const PPQ = 480;
  const { meta } = doc;
  type Ev = { tick: number; order: number; bytes: number[] };
  const evs: Ev[] = [];
  const us = Math.round(60_000_000 / meta.tempo);
  evs.push({ tick: 0, order: 0, bytes: textEvent(0x03, meta.title || 'HarpForge') });
  evs.push({ tick: 0, order: 0, bytes: [0xff, 0x51, 3, (us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff] });
  const [n, d] = meta.time.split('/').map(Number);
  if (n && d) evs.push({ tick: 0, order: 0, bytes: [0xff, 0x58, 4, n, Math.round(Math.log2(d)), 24, 8] });
  const fifths = keyFifths(meta.key);
  if (fifths !== null) {
    const minor = /m(in(or)?)?$/i.test(meta.key!.trim()) && !/maj/i.test(meta.key!);
    evs.push({ tick: 0, order: 0, bytes: [0xff, 0x59, 2, fifths & 0xff, minor ? 1 : 0] });
  }
  evs.push({ tick: 0, order: 0, bytes: [0xc0, 22] }); // GM 23: Harmonica

  let t = 0;
  for (const line of doc.lines) {
    for (const e of line.events) {
      if (e.kind === 'bar') continue;
      const ticks = Math.round(e.beats * PPQ);
      if (e.kind === 'note') {
        const midis = eventMidis(e as NoteEvent, harp);
        if (e.lyric) evs.push({ tick: t, order: 1, bytes: textEvent(0x05, e.lyric) });
        if (e.chord) evs.push({ tick: t, order: 1, bytes: textEvent(0x01, e.chord) });
        const off = t + Math.max(1, ticks - Math.min(30, Math.floor(ticks / 10)));
        for (const m of midis) {
          evs.push({ tick: t, order: 2, bytes: [0x90, m, 90] });
          evs.push({ tick: off, order: 0, bytes: [0x80, m, 0] });
        }
      } else if (e.chord) evs.push({ tick: t, order: 1, bytes: textEvent(0x01, e.chord) });
      t += ticks;
    }
  }
  evs.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const track: number[] = [];
  let last = 0;
  for (const e of evs) {
    track.push(...varlen(e.tick - last), ...e.bytes);
    last = e.tick;
  }
  track.push(0, 0xff, 0x2f, 0);
  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (PPQ >> 8) & 0xff, PPQ & 0xff];
  const len = track.length;
  const trackHeader = [0x4d, 0x54, 0x72, 0x6b, (len >>> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff];
  return new Uint8Array([...header, ...trackHeader, ...track]);
}
