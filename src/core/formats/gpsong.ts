// What the Guitar Pro readers (7–8's XML, and 3–5's binary files) read a track into, and
// how it becomes a tab: bars of beats (notes as MIDI pitches, words, chord names), repeats,
// endings, sections, the tempo played longest; and the pick of a track under Part.

import { wrapEvents } from '../htab/serializer';
import { beatsPerBar, type BarStyle, type NoteEvent, type RestEvent, type TabEvent, type TabLine } from '../htab/types';
import { keyFromSignature } from '../pitch';
import { setLyricOf } from '../verses';
import { melodyScore, notesMeta, partWarning, type Imported, type PartChoice } from './common';

export interface GpBeat {
  /** In quarter notes. */
  beats: number;
  /** Empty for a rest. */
  midis: number[];
  tied?: boolean;
  /** Its words, a verse each. */
  words?: string[];
  chord?: string;
}

export interface GpBar {
  time?: string;
  repeatStart?: boolean;
  /** How many times the repeat is played, when the bar ends one. */
  repeatEnd?: number;
  endings?: number[];
  section?: string;
  beats: GpBeat[];
}

export interface GpSong {
  title?: string;
  artist?: string;
  key?: { accidentals: number; minor: boolean };
  /** The tempo from each bar where it changes (the first at bar 0). */
  tempos: { bar: number; bpm: number }[];
  bars: GpBar[];
  /** Words typed as text, a line a verse — syllables split by "-", words by spaces — from bar `from` (0-based) on. */
  lyrics?: { from: number; text: string }[];
}

/** A track's song as a document. */
export function songToDoc(song: GpSong, format: string): Imported {
  const warnings: string[] = [];
  const meta = notesMeta({ tempo: 120, time: '4/4' });
  meta.title = song.title?.trim() || undefined;
  meta.artist = song.artist?.trim() || undefined;
  if (song.key) meta.key = keyFromSignature(song.key.accidentals, song.key.minor ? 'minor' : 'major');

  // Tempo changes: the one played longest is kept.
  const tempos = song.tempos.filter((t) => t.bpm > 0).sort((a, b) => a.bar - b.bar);
  if (tempos.length) {
    const lasting = new Map<number, number>();
    tempos.forEach((t, k) => lasting.set(t.bpm, (lasting.get(t.bpm) ?? 0) + Math.max(0, (tempos[k + 1]?.bar ?? song.bars.length) - t.bar)));
    meta.tempo = [...lasting].sort((a, b) => b[1] - a[1])[0][0];
    if (lasting.size > 1) {
      const all = [...lasting.keys()];
      warnings.push(`The tempo changes during the song (${Math.min(...all)}–${Math.max(...all)} bpm): the tab keeps ${meta.tempo} bpm, the tempo it’s played at longest.`);
    }
  }

  const events: TabEvent[] = [];
  const firstTime = song.bars[0]?.time;
  if (firstTime && /^\d+\/\d+$/.test(firstTime)) meta.time = firstTime;
  let timeWarned = false;
  let lastEnding = '';
  const sections = new Map<number, string>();
  let lastNote: NoteEvent | null = null;
  let anyWords = false;
  song.bars.forEach((bar, bi) => {
    if (bar.time && bar.time !== meta.time && !timeWarned) {
      warnings.push(`The time signature changes to ${bar.time} during the song; the tab keeps ${meta.time}.`);
      timeWarned = true;
    }
    if (bar.repeatStart) events.push({ kind: 'bar', style: 'repeat-start' });
    if (bar.section) sections.set(events.length, bar.section);
    // (An ending goes on the bar it starts; the bars after it with the same numbers carry on.)
    const endings = bar.endings ?? [];
    const endingHere = endings.length && endings.join() !== lastEnding ? endings : undefined;
    lastEnding = endings.join();
    let pos = 0;
    for (const b of bar.beats) {
      let ev: NoteEvent | RestEvent;
      const midis = [...new Set(b.midis)].sort((x, y) => x - y);
      if (midis.length || (b.tied && lastNote)) {
        // (A tied note with no pitch of its own sounds on the one before.)
        ev = { kind: 'note', beats: b.beats, sounds: midis.length ? midis.map((midi) => ({ type: 'pitch' as const, midi })) : [...lastNote!.sounds] };
        if (b.tied && lastNote) ev.tied = true;
        b.words?.forEach((w, v) => {
          if (w.trim()) {
            setLyricOf(ev, v, w.trim());
            anyWords = true;
          }
        });
        lastNote = ev;
      } else {
        ev = { kind: 'rest', beats: b.beats };
        lastNote = null;
      }
      if (b.chord?.trim()) ev.chord = b.chord.trim();
      if (endingHere && pos === 0) ev.ending = endingHere;
      events.push(ev);
      pos += b.beats;
    }
    const full = beatsPerBar(meta);
    if (pos < full - 1e-6) {
      const rest: RestEvent = { kind: 'rest', beats: full - pos };
      if (endingHere && pos === 0) rest.ending = endingHere;
      events.push(rest);
    }
    let style: BarStyle = bi === song.bars.length - 1 ? 'final' : 'single';
    if (bar.repeatEnd) style = 'repeat-end';
    events.push({ kind: 'bar', style, ...(style === 'repeat-end' && (bar.repeatEnd ?? 0) > 2 ? { times: bar.repeatEnd } : {}) });
  });

  // Words typed as text, when no beat has words: a syllable on each note from its bar on.
  if (!anyWords) {
    (song.lyrics ?? []).forEach(({ from, text }, v) => {
      // ("[…]" is a note to the singer, not sung.)
      const clean = text.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
      if (!clean) return;
      const syllables = clean.split(' ').flatMap((word) => {
        const parts = word.split('-').filter(Boolean);
        return parts.map((p, k) => (k < parts.length - 1 ? `${p}-` : p));
      });
      let bar = 0;
      let k = 0;
      for (const e of events) {
        if (e.kind === 'bar') {
          if (e.style !== 'repeat-start') bar++;
          continue;
        }
        if (bar < from || e.kind !== 'note' || e.tied || k >= syllables.length) continue;
        setLyricOf(e, v, syllables[k++]);
      }
    });
  }

  // Lines: four bars each, and a section starts a line.
  const lines: TabLine[] = [];
  let chunk: TabEvent[] = [];
  let section: string | undefined;
  const flush = () => lines.push(...wrapEvents(chunk, 4).map((l, j) => (j === 0 && section !== undefined ? { ...l, section } : l)));
  events.forEach((e, k) => {
    if (sections.has(k) && chunk.some((x) => x.kind !== 'bar')) {
      flush();
      chunk = [];
    }
    if (sections.has(k)) section = sections.get(k);
    chunk.push(e);
  });
  if (chunk.length) flush();
  return { doc: { meta, lines }, warnings, format };
}

export interface GpOption extends PartChoice {
  /** The track's name, for telling the melody. */
  name: string;
  read: () => Imported;
}

/** The option asked for, or else the most melody-like; the others offered under Part. */
export function pickPart(options: GpOption[], wanted: string | undefined, reparse: (id: string) => Imported): Imported {
  if (!options.length) throw new Error('No notes found in this Guitar Pro file.');
  let chosen = options.find((o) => o.id === wanted);
  let result = chosen?.read();
  if (!chosen || !result) {
    let best = -Infinity;
    for (const o of options) {
      const r = o.read();
      const s = melodyScore(r.doc, o.name);
      if (!result || s > best) {
        best = s;
        result = r;
        chosen = o;
      }
    }
  }
  if (options.length < 2) return result!;
  return {
    ...result!,
    warnings: [partWarning(chosen!.label, options.length), ...result!.warnings],
    parts: options.map((o) => ({ id: o.id, label: o.label })),
    part: chosen!.id,
    choosePart: reparse,
  };
}
