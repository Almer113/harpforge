// Plain-text tab, the way harmonica players post tabs on forums and in messages:
// holes in a chosen spelling, with chords lined up above and lyrics below.

import { guessTonic, positionFor, positionName } from '../convert';
import { soundPitch, type Harmonica } from '../instruments';
import type { NoteEvent, TabDoc, TabEvent } from '../htab/types';
import { midiToName, keySpelling, type Spelling } from '../pitch';
import type { HoleSound, Sound } from '../types';

export interface PlainTextOptions {
  /** Write holes (4 -4) or notes (C5 D5). */
  spelling: 'holes' | 'notes';
  /** How blow and draw are written: "4 -4", "+4 -4" or "4B 4D". */
  style: 'htab' | 'plusminus' | 'letters';
  /** Bends: -3' -3'' or -3b -3bb. */
  bend: 'apostrophe' | 'b';
  /** Overblows/overdraws: 6o or 6ob. */
  over: 'o' | 'ob';
  title: boolean;
  sections: boolean;
  bars: boolean;
  chords: boolean;
  lyrics: boolean;
  /** Longest line, in characters; longer lines break between bars. */
  width: number;
}

export const DEFAULT_PLAIN_TEXT: PlainTextOptions = {
  spelling: 'holes',
  style: 'htab',
  bend: 'apostrophe',
  over: 'o',
  title: true,
  sections: true,
  bars: true,
  chords: true,
  lyrics: true,
  width: 72,
};

export function holeToken(s: HoleSound, o: PlainTextOptions): string {
  const draw = s.breath === 'draw';
  const head = o.style === 'plusminus' ? (draw ? '-' : '+') : o.style === 'htab' && draw ? '-' : '';
  const tail = o.style === 'letters' ? (draw ? 'D' : 'B') : '';
  const bend = (o.bend === 'b' ? 'b' : "'").repeat(s.bend);
  const over = s.over ? (o.over === 'ob' ? (draw ? 'od' : 'ob') : 'o') : '';
  return `${s.slide ? '<' : ''}${head}${s.hole}${tail}${bend}${over}`;
}

function soundToken(s: Sound, o: PlainTextOptions, flats: Spelling, harp: Harmonica): string {
  if (s.type === 'pitch') return midiToName(s.midi, flats);
  if (o.spelling === 'notes') {
    const m = soundPitch(harp, s);
    return m === null ? '?' : midiToName(m, flats);
  }
  return holeToken(s, o);
}

function noteToken(ev: NoteEvent, o: PlainTextOptions, flats: Spelling, harp: Harmonica): string {
  if (ev.sounds.length === 1) return soundToken(ev.sounds[0], o, flats, harp);
  return `(${ev.sounds.map((s) => soundToken(s, o, flats, harp)).join(' ')})`;
}

interface Cell {
  tab: string;
  chord?: string;
  lyric?: string;
}

/** One line of tab as columns: a cell per played note, "|" cells for bars. */
function cellsOf(events: TabEvent[], o: PlainTextOptions, flats: Spelling, harp: Harmonica): Cell[] {
  const cells: Cell[] = [];
  let pendingChord: string | undefined;
  for (const e of events) {
    if (e.kind === 'bar') {
      if (o.bars && cells.length && cells[cells.length - 1].tab !== '|') cells.push({ tab: '|' });
      continue;
    }
    if (e.chord) pendingChord = e.chord;
    // Rests and held-over (tied) notes aren't played: no column, but a chord on them waits for the next note.
    if (e.kind === 'rest' || e.tied || !e.sounds.length) continue;
    cells.push({ tab: noteToken(e, o, flats, harp), chord: o.chords ? pendingChord : undefined, lyric: o.lyrics ? e.lyric : undefined });
    pendingChord = undefined;
  }
  while (cells.length && cells[cells.length - 1].tab === '|' && !o.bars) cells.pop();
  return cells;
}

/** Lays cells out in aligned rows (chords, tab, lyrics), breaking at bars to fit the width. */
function layout(cells: Cell[], o: PlainTextOptions): string[] {
  const widthOf = (c: Cell) => (c.tab === '|' ? 2 : Math.max(c.tab.length, (c.chord?.length ?? 0), (c.lyric?.length ?? 0)) + 1);
  const rows: Cell[][] = [[]];
  let used = 0;
  // Break only at bar lines (or anywhere, if a bar is longer than the width).
  let lastBar = -1;
  for (const c of cells) {
    const row = rows[rows.length - 1];
    const w = widthOf(c);
    if (used + w > o.width && row.length) {
      if (lastBar >= 0 && lastBar < row.length - 1) {
        const carry = row.splice(lastBar + 1);
        rows.push(carry);
        used = carry.reduce((a, x) => a + widthOf(x), 0);
      } else {
        rows.push([]);
        used = 0;
      }
      lastBar = -1;
    }
    const cur = rows[rows.length - 1];
    if (c.tab === '|' && !cur.length) continue; // no bar at the start of a row
    cur.push(c);
    used += w;
    if (c.tab === '|') lastBar = cur.length - 1;
  }
  const out: string[] = [];
  for (const row of rows) {
    if (!row.length) continue;
    let chords = '';
    let tab = '';
    let lyrics = '';
    for (const c of row) {
      const w = widthOf(c);
      tab += c.tab.padEnd(w);
      chords += (c.chord ?? '').padEnd(w);
      lyrics += (c.lyric ?? '').padEnd(w);
    }
    if (chords.trim()) out.push(chords.trimEnd());
    out.push(tab.replace(/\s*\|\s*$/, ' |').trimEnd());
    if (lyrics.trim()) out.push(lyrics.trimEnd());
  }
  return out;
}

/** The whole tab as plain text. */
export function writePlainText(doc: TabDoc, harp: Harmonica, o: PlainTextOptions = DEFAULT_PLAIN_TEXT): string {
  const { meta } = doc;
  const flats = keySpelling(meta.key ?? harp.spec.key);
  const out: string[] = [];
  if (o.title) {
    out.push(`${meta.title || 'Untitled'}${meta.artist ? ` — ${meta.artist}` : ''}`);
    const tonic = guessTonic(doc, harp);
    const pos = tonic !== undefined && harp.spec.family !== 'chromatic' ? positionFor(harp.spec.key, tonic) : undefined;
    const how =
      o.style === 'letters' ? 'B = blow, D = draw' : o.style === 'plusminus' ? '+ = blow, - = draw' : 'plain number = blow, - = draw';
    const bend = o.bend === 'b' ? 'b = bend' : "' = bend";
    out.push(`${harp.name} harmonica${pos ? `, ${positionName(pos)} position` : ''}${meta.key ? ` · key ${meta.key}` : ''}`);
    if (o.spelling === 'notes') out.push('(notes as played, C4 = middle C)');
    else out.push(`(${how}, ${bend})`);
    out.push('');
  }
  let first = true;
  for (const line of doc.lines) {
    if (line.section !== undefined && o.sections) {
      if (!first) out.push('');
      out.push(`[${line.section}]`);
    }
    const cells = cellsOf(line.events, o, flats, harp);
    if (!cells.some((c) => c.tab !== '|')) continue;
    out.push(...layout(cells, o));
    first = false;
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
