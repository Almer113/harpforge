// ASCII guitar/bass tab ("e|---3---|") → melody.
//
// Tab has fret numbers but rarely rhythm, so durations are estimated from the
// spacing between columns, and the melody is the highest note at each moment.
// Guitar sounds an octave below written pitch; we use written pitch, which suits
// a harmonica's range.

import { mod12, parsePitchClass } from '../pitch';
import { wrapEvents } from '../htab/serializer';
import type { TabEvent, TabLine } from '../htab/types';
import { notesMeta, type Imported } from './common';

const GUITAR = [64, 59, 55, 50, 45, 40]; // e B G D A E (high to low)
const BASS = [43, 38, 33, 28]; // G D A E
const SEVEN = [64, 59, 55, 50, 45, 40, 35];

const TAB_LINE = /^\s*([A-Ga-g][#b]?)?\s*[|:]\s*[-–—0-9hpbrsxXt/\\~()|*.<>^v=]{6,}\s*$/;

function isTabLine(line: string): boolean {
  if (!TAB_LINE.test(line)) return false;
  const body = line.replace(/^\s*[A-Ga-g]?[#b]?\s*[|:]/, '');
  const dashes = (body.match(/[-–—]/g) ?? []).length;
  return dashes >= body.length * 0.4;
}

export function countTabLines(text: string): number {
  return text.split('\n').filter(isTabLine).length;
}

export function looksLikeGuitarTab(text: string): boolean {
  const lines = text.split('\n');
  let run = 0;
  for (const l of lines) {
    run = isTabLine(l) ? run + 1 : 0;
    if (run >= 4) return true;
  }
  return false;
}

function tuningFor(names: (string | undefined)[]): number[] {
  const n = names.length;
  const base = n === 4 ? BASS : n === 7 ? SEVEN : GUITAR.slice(0, n);
  return base.map((b, i) => {
    const pc = names[i] ? parsePitchClass(names[i]!.toUpperCase().replace(/^([A-G])B$/, '$1b')) : null;
    if (pc === null) return b;
    // Nearest pitch with that name to the standard string (e.g. drop D).
    for (let d = 0; d <= 6; d++) {
      if (mod12(b - d) === pc) return b - d;
      if (mod12(b + d) === pc) return b + d;
    }
    return b;
  });
}

export function parseGuitarTab(text: string): Imported {
  const warnings: string[] = [];
  const src = text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  const meta = notesMeta({ tempo: 90 });
  const lines: TabLine[] = [];
  const titleLine = src.find((l) => l.trim() && !isTabLine(l));
  if (titleLine && titleLine.trim().length < 70) meta.title = titleLine.trim().replace(/\s+(tabs?|chords)\s+by\s+.*$/i, '');
  const by = src.map((l) => /\b(?:tabs?|chords)\s+by\s+(.+)$/i.exec(l.trim())).find(Boolean);
  if (by) meta.artist = by[1].trim();

  let i = 0;
  let melodyNotes = 0;
  while (i < src.length) {
    if (!isTabLine(src[i])) {
      i++;
      continue;
    }
    const block: string[] = [];
    while (i < src.length && isTabLine(src[i])) block.push(src[i++]);
    if (block.length < 4 || block.length > 7) continue;

    const names = block.map((l) => /^\s*([A-Ga-g][#b]?)\s*[|:]/.exec(l)?.[1]);
    const tuning = tuningFor(names);
    const starts = block.map((l) => l.search(/[|:]/) + 1);
    const width = Math.max(...block.map((l) => l.length));

    // Notes by column; bars where every string has "|".
    const byCol = new Map<number, number[]>();
    const bars: number[] = [];
    for (let col = Math.min(...starts); col < width; col++) {
      if (block.every((l) => l[col] === '|') && col > Math.max(...starts)) bars.push(col);
    }
    block.forEach((l, s) => {
      for (let col = starts[s]; col < l.length; col++) {
        if (!/\d/.test(l[col]) || /\d/.test(l[col - 1] ?? '')) continue;
        const two = /\d/.test(l[col + 1] ?? '') && parseInt(l.slice(col, col + 2), 10) <= 24;
        const fret = parseInt(two ? l.slice(col, col + 2) : l[col], 10);
        const list = byCol.get(col) ?? [];
        list.push(tuning[s] + fret + 12);
        byCol.set(col, list);
      }
    });
    const cols = [...byCol.keys()].sort((a, b) => a - b);
    if (!cols.length) continue;
    const gaps = cols.slice(1).map((c, k) => c - cols[k]).filter((g) => g > 0);
    const unit = gaps.length ? [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : 2;

    const events: TabEvent[] = [];
    let barIdx = 0;
    cols.forEach((col, k) => {
      while (barIdx < bars.length && bars[barIdx] < col) {
        if (events.length && events[events.length - 1].kind !== 'bar') events.push({ kind: 'bar', style: 'single' });
        barIdx++;
      }
      const next = cols[k + 1] ?? col + unit * 2;
      const beats = Math.max(0.25, Math.min(4, Math.round(((next - col) / unit) * 2) / 4));
      const top = Math.max(...byCol.get(col)!);
      events.push({ kind: 'note', sounds: [{ type: 'pitch', midi: top }], beats });
      melodyNotes++;
    });
    if (bars.length && events[events.length - 1]?.kind !== 'bar') events.push({ kind: 'bar', style: 'single' });
    lines.push(...wrapEvents(events, 4, 12));
  }
  if (!melodyNotes) warnings.push('No guitar tab found.');
  else warnings.push('Guitar tab: rhythm is estimated from the spacing, and the top note of each chord is used as the melody.');
  return { doc: { meta, lines }, warnings, format: 'Guitar tab' };
}
