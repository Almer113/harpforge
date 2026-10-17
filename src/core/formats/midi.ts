// Standard MIDI files: import (melody extraction) and export.

import type { Harmonica } from '../instruments';
import { beatsPerBar, type NoteEvent, type RestEvent, type TabDoc, type TabEvent } from '../htab/types';
import { isChordSymbol } from '../chords';
import { keyFromSignature } from '../pitch';
import { clustersToEvents, quantize } from '../timeline';
import type { Sound } from '../types';
import { wrapEvents } from '../htab/serializer';
import { keyFifths, notesMeta, type Imported } from './common';
import { backingNotes, BACKING_STYLES, hasChords, type BackingStyle } from '../backing';
import { playbackScore } from '../repeats';
import { buildScore, harmonicaFromMeta } from '../score';

// ---- Reading -------------------------------------------------------------------

/**
 * Grids a beat can be read in, simplest first, with how far off a note may start. Odd
 * tuplets need near-exact timing (a file written by a program), so a human's slightly
 * uneven eighths aren't read as quintuplets.
 */
const BEAT_GRIDS: [number, number][] = [
  [1 / 2, 0.03],
  [1 / 4, 0.03],
  [1 / 3, 0.03],
  [1 / 6, 0.02],
  [1 / 8, 0.02],
  [1 / 5, 0.005],
  [1 / 7, 0.005],
  [1 / 12, 0.005],
];

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

/** One line of music to choose from: a track, or one channel of a track that holds several. */
interface Part extends RawTrack {
  id: string;
  label: string;
}

class Reader {
  pos = 0;
  constructor(private data: Uint8Array) {}
  get eof() {
    return this.pos >= this.data.length;
  }
  u8() {
    // (Past the end — a file cut short — reads as 0, and the reading stops at the end.)
    return this.data[this.pos++] ?? 0;
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

/**
 * Reads a MIDI file and takes one part as the melody: the one named like a melody, or the
 * busiest single line. Tracks holding several channels (format 0) are split by channel;
 * `part` picks another part (see Imported.parts).
 */
export function parseMidi(data: Uint8Array, opts: { part?: string } = {}): Imported {
  const warnings: string[] = [];
  const r = new Reader(data);
  if (r.str(4) !== 'MThd') throw new Error('Not a MIDI file');
  const hlen = r.u32();
  r.u16(); // format
  const ntrks = r.u16();
  let division = r.u16();
  if (!division) throw new Error('This MIDI file has no timing (its division is 0), so its notes can’t be placed.');
  r.pos = 8 + hlen;
  if (division & 0x8000) {
    warnings.push('SMPTE-timed MIDI: timing may be approximate.');
    division = 480;
  }

  // Every tempo set (the tab keeps one: the one it's played at longest), and the words and
  // texts along the way (lyrics; chord symbols; a karaoke file's words as text).
  const tempos: { tick: number; us: number }[] = [];
  const lyricEvents: { tick: number; text: string }[] = [];
  const textEvents: { tick: number; text: string; track: string }[] = [];
  let lastTick = 0;
  let timeSig: string | null = null;
  let keySig: string | null = null;
  let title: string | undefined;
  const tracks: RawTrack[] = [];

  for (let t = 0; t < ntrks && !r.eof; t++) {
    const id = r.str(4);
    const len = r.u32();
    // (A length past the end of the file, as a damaged one may have, stops at the end.)
    const end = Math.min(r.pos + len, data.length);
    if (id !== 'MTrk') {
      r.pos = end;
      continue;
    }
    const track: RawTrack = { name: '', notes: [] };
    const open = new Map<number, { start: number; channel: number }[]>();
    let tick = 0;
    let status = 0;
    while (r.pos < end && !r.eof) {
      tick += r.varlen();
      let b = r.u8();
      if (b === 0xff) {
        const type = r.u8();
        const l = r.varlen();
        const d = r.bytes(l);
        if (type === 0x51) {
          const us = (d[0] << 16) | (d[1] << 8) | d[2];
          // (Only a tempo that can be played: 20–400 beats a minute.)
          if (us >= 150_000 && us <= 3_000_000) tempos.push({ tick, us });
        }
        else if (type === 0x05) lyricEvents.push({ tick, text: decodeText(d) });
        else if (type === 0x01) textEvents.push({ tick, text: decodeText(d), track: String(t) });
        else if (type === 0x58 && timeSig === null && d[0] > 0 && d[0] <= 32 && d[1] <= 6) timeSig = `${d[0]}/${Math.pow(2, d[1])}`;
        else if (type === 0x59 && keySig === null) {
          const sf = (d[0] << 24) >> 24;
          keySig = keyFromSignature(sf, d[1] === 1 ? 'minor' : 'major');
        } else if (type === 0x03) {
          const name = new TextDecoder().decode(d).trim();
          track.name = name;
          // The first track's name is the song's (one-track files too, like our own export).
          if (t === 0 && name) title ??= name;
        }
        continue;
      }
      if (b === 0xf0 || b === 0xf7) {
        // Read the length first: `r.pos += r.varlen()` would add it to the position from before the length bytes.
        const len = r.varlen();
        r.pos += len;
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
        // (Notes held by channel and pitch: the same pitch on two channels are two notes.)
        const key = channel * 128 + note;
        if (type === 0x90 && vel > 0) {
          const list = open.get(key) ?? [];
          list.push({ start: tick, channel });
          open.set(key, list);
        } else {
          const list = open.get(key);
          const on = list?.shift();
          if (on) {
            track.notes.push({ start: on.start, end: tick, midi: note, channel: on.channel });
            lastTick = Math.max(lastTick, tick);
          }
        }
      } else if (type === 0xc0 || type === 0xd0) r.pos += 1;
      else r.pos += 2;
    }
    r.pos = end;
    if (track.notes.length) tracks.push(track);
  }

  // Parts: each track, split by channel when it holds several (drums, channel 10, left out).
  const candidates: Part[] = [];
  tracks.forEach((tr, ti) => {
    const channels = [...new Set(tr.notes.map((n) => n.channel))].filter((c) => c !== 9).sort((a, b) => a - b);
    for (const ch of channels) {
      const name = tr.name || (tracks.length > 1 ? `Track ${ti + 1}` : '');
      const label = channels.length > 1 || !name ? `${name ? name + ' · ' : ''}channel ${ch + 1}` : name;
      candidates.push({ id: `${ti}:${ch}`, label, name: tr.name, notes: tr.notes.filter((n) => n.channel === ch) });
    }
  });
  if (!candidates.length) throw new Error('No notes found in this MIDI file.');
  const score = (tr: RawTrack) => {
    const sorted = [...tr.notes].sort((a, b) => a.start - b.start);
    let mono = 0;
    for (let i = 1; i < sorted.length; i++) if (sorted[i].start >= sorted[i - 1].end - division / 8) mono++;
    const avg = sorted.reduce((a, n) => a + n.midi, 0) / sorted.length;
    const named = /harmonica|harp|melody|lead|vocal|voice|solo|tune/i.test(tr.name) ? 1000 : /bass|accomp|drum|perc|chord|rhythm|pad|backing/i.test(tr.name) ? -500 : 0;
    return named + mono + avg / 10;
  };
  candidates.sort((a, b) => score(b) - score(a));
  const chosen = candidates.find((c) => c.id === opts.part) ?? candidates[0];
  if (candidates.length > 1) warnings.push(`Imported “${chosen.label}” as the melody (${candidates.length} parts with notes: pick another under Part).`);
  else if (chosen.name.startsWith('Backing (')) warnings.push('This file has only HarpForge’s backing chords (its song had no notes): they came in as the tune.');
  // (A song can't go on for ever: notes after a very long silence — a damaged file — are left out.)
  const MAX_BEATS = 8000;
  const far = chosen.notes.filter((n) => n.start / division > MAX_BEATS).length;
  if (far) {
    chosen.notes = chosen.notes.filter((n) => n.start / division <= MAX_BEATS);
    warnings.push(`${far} note${far === 1 ? '' : 's'} more than ${MAX_BEATS} beats in were left out (the file may be damaged).`);
  }

  // One tempo: the one the song is played at longest (from each change to the next, or the end).
  // (120 until the first tempo given; one given after the last note isn't played at.)
  const sortedTempos = [...tempos].sort((a, b) => a.tick - b.tick).filter((x, k, all) => all[k + 1]?.tick !== x.tick && (x.tick < lastTick || k === 0));
  if (sortedTempos[0] && sortedTempos[0].tick > 0) sortedTempos.unshift({ tick: 0, us: 500_000 });
  const bpm = (us: number) => Math.round(60_000_000 / us);
  const lasting = new Map<number, number>();
  sortedTempos.forEach((x, k) => {
    const until = Math.max(sortedTempos[k + 1]?.tick ?? lastTick, x.tick);
    lasting.set(bpm(x.us), (lasting.get(bpm(x.us)) ?? 0) + until - x.tick);
  });
  const kept = [...lasting].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? (sortedTempos[0] ? bpm(sortedTempos[0].us) : 120);
  if (lasting.size > 1) {
    const all = [...lasting.keys()];
    warnings.push(`The tempo changes during the song (${Math.min(...all)}–${Math.max(...all)} bpm): the tab keeps ${kept} bpm, the tempo it’s played at longest.`);
  }

  const meta = notesMeta({
    title: title || undefined,
    tempo: kept,
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
  // Each beat takes the simplest grid its notes start on (eighths, sixteenths, triplets,
  // quintuplets …), so exact files come back exact; beats that fit none use the song's grid.
  const byBeat = new Map<number, number[]>();
  for (const n of chosen.notes) {
    const b = toBeats(n.start);
    const k = Math.floor(b + 1e-6);
    byBeat.set(k, [...(byBeat.get(k) ?? []), b - k]);
  }
  const beatGrid = new Map<number, number>();
  for (const [k, offs] of byBeat) {
    const g = BEAT_GRIDS.find(([c, tol]) => offs.every((o) => Math.abs(o - Math.round(o / c) * c) < tol));
    if (g !== undefined) beatGrid.set(k, g[0]);
  }
  const gridAt = (at: number) => beatGrid.get(Math.floor(at + 1e-6)) ?? grid;
  // A note's end (often played short) snaps to whichever is nearer: its beat's grid or the song's.
  const snapEnd = (x: number) => {
    const a = Math.round(x / gridAt(x)) * gridAt(x);
    const b = Math.round(x / grid) * grid;
    return Math.abs(a - x) <= Math.abs(b - x) ? a : b;
  };
  // A note that stops just before the next one starts (played or written slightly short) lasts until it.
  const starts = [...new Set(chosen.notes.map((n) => toBeats(n.start)))].sort((x, y) => x - y);
  const notes = chosen.notes.map((n) => {
    const end = toBeats(n.end);
    const next = starts.find((x) => x > toBeats(n.start) + 1e-6);
    return { start: toBeats(n.start), end: next !== undefined && next >= end && next - end <= 0.08 ? next : end, sound: { type: 'pitch', midi: n.midi } as Sound };
  });
  const clusters = quantize(notes, gridAt, (a, b) => a.type === 'pitch' && b.type === 'pitch' && a.midi === b.midi, snapEnd);
  for (const c of clusters) c.sounds.sort((a, b) => (a.type === 'pitch' && b.type === 'pitch' ? a.midi - b.midi : 0));
  const events = clustersToEvents(clusters, beatsPerBar(meta));
  // (The tab starts at the bar of the first note.)
  const origin = clusters.length ? Math.floor(clusters[0].start / beatsPerBar(meta)) * beatsPerBar(meta) : 0;
  placeMidiWords(events, origin, lyricEvents, textEvents, tracks, division, warnings);
  const parts = candidates.length > 1 ? candidates.map((c) => ({ id: c.id, label: c.label })) : undefined;
  return { doc: { meta, lines: wrapEvents(events, 4) }, warnings, format: 'MIDI', parts, part: chosen.id, choosePart: (id) => parseMidi(data, { part: id }) };
}

/** Text as UTF-8, or else as older files write it (Windows' Western European). */
const decodeText = (d: Uint8Array) => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(d);
  } catch {
    return new TextDecoder('windows-1252').decode(d);
  }
};

/**
 * The file's words on the notes (each syllable on the note starting nearest it, within a
 * quarter beat), and its chord symbols. Words are its lyric events; or, in a karaoke file
 * with none, its text events ("/" or "\\" starting a line, "@" lines being its title and
 * such). A syllable starting with a space (or a line) starts a word; one that doesn't goes on
 * the word before ("Twin-kle").
 */
function placeMidiWords(events: TabEvent[], origin: number, lyrics: { tick: number; text: string }[], texts: { tick: number; text: string; track: string }[], tracks: RawTrack[], division: number, warnings: string[]) {
  const heads: { at: number; ev: NoteEvent | RestEvent }[] = [];
  let at = origin;
  for (const e of events) {
    if (e.kind === 'bar') continue;
    if (e.kind === 'note' && !e.tied) heads.push({ at, ev: e });
    else if (e.kind === 'rest') heads.push({ at, ev: e });
    at += e.beats;
  }
  const nearest = (tick: number, notesOnly: boolean) => {
    const b = tick / division;
    let best: (typeof heads)[number] | null = null;
    for (const h of heads) if ((!notesOnly || h.ev.kind === 'note') && Math.abs(h.at - b) <= 0.25 + 1e-6 && (!best || Math.abs(h.at - b) < Math.abs(best.at - b))) best = h;
    return best?.ev;
  };
  // Chord symbols written as text (as our own export writes them).
  for (const t of texts) {
    const sym = t.text.trim();
    if (!isChordSymbol(sym)) continue;
    const ev = nearest(t.tick, false);
    if (ev && !ev.chord) ev.chord = sym;
  }
  // A karaoke file's words: the texts of its words track (named so, or with lines started by "/" or "\").
  const wordTracks = new Set(texts.filter((t) => /^[/\\]/.test(t.text) || /words|lyric|karaoke/i.test(tracks[Number(t.track)]?.name ?? '')).map((t) => t.track));
  const all = (lyrics.length ? lyrics : texts.filter((t) => wordTracks.has(t.track) && !t.text.startsWith('@') && !isChordSymbol(t.text.trim()))).sort((a, b) => a.tick - b.tick);
  // (An event that only breaks the line ends the word before it.)
  const words: { tick: number; text: string }[] = [];
  for (const w of all) {
    if (w.text.replace(/[\s/\\]/g, '')) words.push(w);
    else if (words.length) words[words.length - 1] = { ...words[words.length - 1], text: `${words[words.length - 1].text.trimEnd()} ` };
  }
  if (!words.length) return;
  // (Some files mark no word breaks at all: each syllable is then a word.)
  const marked = words.some((w) => /^[\s/\\]|\s$|-$/.test(w.text));
  let placed = 0;
  let missed = 0;
  words.forEach((w, k) => {
    let syl = w.text.replace(/^[\s/\\]+/, '').trimEnd();
    const next = words[k + 1];
    const goesOn = marked && !!next && !/\s$/.test(w.text) && !/^[\s/\\]/.test(next.text);
    if (goesOn && !syl.endsWith('-')) syl += '-';
    const ev = nearest(w.tick, true);
    if (!ev) {
      missed++;
      return;
    }
    // (Two on one note: one word sung on it.)
    ev.lyric = ev.lyric ? `${ev.lyric.replace(/-$/, '')}${syl}` : syl;
    placed++;
  });
  if (!placed) warnings.push(`The file’s words (${missed} syllable${missed === 1 ? '' : 's'}) didn’t line up with this part’s notes: left out.`);
  else warnings.push(`Put the file’s words on the notes (${placed} syllable${placed === 1 ? '' : 's'}${missed ? `; ${missed} with no note under ${missed === 1 ? 'it' : 'them'} left out` : ''}).`);
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

/** The backing's sound in other programs (General MIDI): a pad, a guitar, an accordion. */
const BACKING_PROGRAM: Record<'pad' | 'strum' | 'oompah', number> = { pad: 88, strum: 25, oompah: 21 };

export interface MidiExportOptions {
  /** The backing style (the ♫ menu's); "off" or the drone: a pad. Written only for songs with chords. */
  backing?: BackingStyle | 'off';
}

/**
 * A MIDI file of the song as it's played: repeats and endings played out, each time through
 * singing its verse (the words as lyric events, a word's last syllable followed by a space),
 * the chord symbols as text — the tune on a harmonica (track 1, channel 1) and, for a song with
 * chords, the backing on a track and channel of its own (track 2, channel 2), to mute or keep.
 */
export function writeMidi(doc: TabDoc, harp?: Harmonica, opts: MidiExportOptions = {}): Uint8Array {
  const PPQ = 480;
  const { meta } = doc;
  const h = harp ?? harmonicaFromMeta(meta);
  const played = playbackScore(doc, buildScore(doc, h).score, { repeats: true, allVerses: true });
  const score = played.score;
  type Ev = { tick: number; order: number; bytes: number[] };
  const tick = (beats: number) => Math.round(beats * PPQ);

  // Track 1: the song's settings, then the tune.
  const tune: Ev[] = [];
  const us = Math.round(60_000_000 / meta.tempo);
  tune.push({ tick: 0, order: 0, bytes: textEvent(0x03, meta.title || 'HarpForge') });
  tune.push({ tick: 0, order: 0, bytes: [0xff, 0x51, 3, (us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff] });
  const [n, d] = meta.time.split('/').map(Number);
  if (n && d) tune.push({ tick: 0, order: 0, bytes: [0xff, 0x58, 4, n, Math.round(Math.log2(d)), 24, 8] });
  const fifths = keyFifths(meta.key);
  if (fifths !== null) {
    const minor = /m(in(or)?)?$/i.test(meta.key!.trim()) && !/maj/i.test(meta.key!);
    tune.push({ tick: 0, order: 0, bytes: [0xff, 0x59, 2, fifths & 0xff, minor ? 1 : 0] });
  }
  tune.push({ tick: 0, order: 0, bytes: [0xc0, 22] }); // GM 23: Harmonica

  // Notes (ties merged into the note they continue), each time through with its verse's words.
  const notes: { tick: number; ticks: number; midis: number[] }[] = [];
  let open: (typeof notes)[number] | null = null;
  score.events.forEach((e, k) => {
    const t = tick(e.start);
    const ticks = tick(e.beats);
    if (e.chord) tune.push({ tick: t, order: 1, bytes: textEvent(0x01, e.chord) });
    const v = played.verse[k] ?? 0;
    const word = (v === 0 ? e.lyric : e.verses?.[v - 1])?.trim();
    if (word && !e.tied && word !== '_') tune.push({ tick: t, order: 1, bytes: textEvent(0x05, word.endsWith('-') ? word : `${word} `) });
    if (e.rest) {
      open = null;
      return;
    }
    if (e.tied && open) open.ticks += ticks;
    else {
      open = { tick: t, ticks, midis: e.midis.filter((m): m is number => m !== null) };
      notes.push(open);
    }
  });
  for (const nt of notes) {
    const off = nt.tick + Math.max(1, nt.ticks - Math.min(30, Math.floor(nt.ticks / 10)));
    for (const m of nt.midis) {
      tune.push({ tick: nt.tick, order: 2, bytes: [0x90, m, 90] });
      tune.push({ tick: off, order: 0, bytes: [0x80, m, 0] });
    }
  }

  // Track 2: the backing, for a song with chords.
  const tracks = [tune];
  if (hasChords(score)) {
    const style = opts.backing === 'strum' || opts.backing === 'oompah' ? opts.backing : 'pad';
    const backing: Ev[] = [{ tick: 0, order: 0, bytes: textEvent(0x03, `Backing (${BACKING_STYLES.find((b) => b.id === style)!.label})`) }, { tick: 0, order: 0, bytes: [0xc1, BACKING_PROGRAM[style]] }];
    for (const b of backingNotes(score, meta.time, style)) {
      const at = tick(b.at);
      const len = Math.max(1, tick(b.dur) - 10);
      const vel = Math.max(1, Math.min(127, Math.round(b.vel * 100)));
      // (A strum's notes a moment apart, upwards or down.)
      const order = b.up ? [...b.midis].reverse() : b.midis;
      order.forEach((m, i) => {
        const on = at + (style === 'strum' ? i * 8 : 0);
        backing.push({ tick: on, order: 2, bytes: [0x91, m, vel] });
        backing.push({ tick: on + len, order: 0, bytes: [0x81, m, 0] });
      });
    }
    tracks.push(backing);
  }

  const chunks = tracks.map((evs) => {
    evs.sort((a, b) => a.tick - b.tick || a.order - b.order);
    const track: number[] = [];
    let last = 0;
    for (const e of evs) {
      track.push(...varlen(e.tick - last), ...e.bytes);
      last = e.tick;
    }
    track.push(0, 0xff, 0x2f, 0);
    const len = track.length;
    return [0x4d, 0x54, 0x72, 0x6b, (len >>> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff, ...track];
  });
  // (One track: format 0; with the backing: format 1, tracks played together.)
  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, tracks.length > 1 ? 1 : 0, 0, tracks.length, (PPQ >> 8) & 0xff, PPQ & 0xff];
  return new Uint8Array([...header, ...chunks.flat()]);
}
