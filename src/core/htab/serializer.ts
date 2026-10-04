// Turns a TabDoc back into .htab text.

import { midiToName } from '../pitch';
import type { HoleSound, Sound } from '../types';
import type { BarEvent, NoteEvent, RestEvent, TabDoc, TabEvent, TabLine, TabMeta } from './types';
import { headerValue } from './parser';

export interface SerializeOptions {
  flats?: boolean;
}

export function holeSoundText(s: HoleSound, omitBreath = false): string {
  return (
    (s.slide ? '<' : '') +
    (s.breath === 'draw' && !omitBreath ? '-' : '') +
    s.hole +
    "'".repeat(s.bend) +
    (s.over ? 'o' : '')
  );
}

export function soundText(s: Sound, opts: SerializeOptions = {}): string {
  return s.type === 'pitch' ? midiToName(s.midi, opts.flats) : holeSoundText(s);
}

function chordText(sounds: Sound[], opts: SerializeOptions): string {
  const holes = sounds.filter((s): s is HoleSound => s.type === 'hole');
  if (holes.length === sounds.length && holes.every((h) => h.breath === 'draw')) {
    return '-(' + holes.map((h) => holeSoundText(h, true)).join(' ') + ')';
  }
  return '(' + sounds.map((s) => soundText(s, opts)).join(' ') + ')';
}

function eventCore(e: NoteEvent | RestEvent, opts: SerializeOptions): string {
  if (e.kind === 'rest') return '.';
  if (e.tied) return '~';
  return e.sounds.length === 1 ? soundText(e.sounds[0], opts) : chordText(e.sounds, opts);
}

function withChord(e: NoteEvent | RestEvent, text: string): string {
  return e.chord ? `[${e.chord}] ${text}` : text;
}

const BAR_TEXT: Record<BarEvent['style'], string> = {
  single: '|',
  double: '||',
  final: '|]',
  'repeat-start': '|:',
  'repeat-end': ':|',
};

const EPS = 1e-6;
const isInt = (x: number) => Math.abs(x - Math.round(x)) < EPS;
const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** A group's length as "~" marks and an optional "/N" divider: 1.5 beats → "~~/2". */
function groupLength(sum: number): string {
  if (isInt(sum) && sum >= 1) return '~'.repeat(Math.round(sum) - 1);
  for (const n of [2, 3, 4, 6, 8, 12, 16, 24, 48]) {
    if (isInt(sum * n) && sum * n >= 1 - EPS) return '~'.repeat(Math.round(sum * n) - 1) + '/' + n;
  }
  return '~'.repeat(Math.max(0, Math.round(sum) - 1));
}

function groupText(items: (NoteEvent | RestEvent)[], opts: SerializeOptions): string {
  const sum = items.reduce((a, e) => a + e.beats, 0);
  let ints: number[] | null = null;
  for (const d of [1, 2, 3, 4, 6, 8, 12, 16, 24, 48]) {
    if (items.every((e) => isInt(e.beats * d))) {
      ints = items.map((e) => Math.max(1, Math.round(e.beats * d)));
      break;
    }
  }
  ints ??= items.map((e) => Math.max(1, Math.round(e.beats * 48)));
  const g = ints.reduce((a, b) => gcd(a, b));
  const parts = items.map((e, k) => withChord(e, eventCore(e, opts) + '~'.repeat(ints![k] / g - 1)));
  // A group cut short by a bar line (odd meters such as 7/8) gets a fractional length.
  return '{' + parts.join(' ') + '}' + groupLength(sum);
}

/** Serializes one line of events (without lyrics). */
export function eventsText(events: TabEvent[], opts: SerializeOptions = {}): string {
  const out: string[] = [];
  let i = 0;
  while (i < events.length) {
    const e = events[i];
    if (e.kind === 'bar') {
      out.push(BAR_TEXT[e.style]);
      i++;
      continue;
    }
    if (e.kind === 'rest' && e.beats <= EPS) {
      if (e.chord) out.push(`[${e.chord}]`);
      i++;
      continue;
    }
    if (isInt(e.beats) && e.beats >= 1) {
      // A tie is one "~" per beat; a note is one token plus a "~" per extra beat.
      out.push(withChord(e, eventCore(e, opts) + '~'.repeat(Math.round(e.beats) - 1)));
      i++;
      continue;
    }
    // Fractional beats: gather events until they add up to whole beats.
    const group: (NoteEvent | RestEvent)[] = [e];
    let sum = e.beats;
    let j = i + 1;
    while (!isInt(sum) && j < events.length && events[j].kind !== 'bar' && group.length < 24) {
      const next = events[j] as NoteEvent | RestEvent;
      group.push(next);
      sum += next.beats;
      j++;
    }
    out.push(groupText(group, opts));
    i = j;
  }
  return out.join(' ');
}

function lyricsText(line: TabLine): string | null {
  const notes = line.events.filter((e): e is NoteEvent => e.kind === 'note' && !e.tied);
  if (!notes.some((n) => n.lyric)) return null;
  let last = notes.length - 1;
  while (last >= 0 && !notes[last].lyric) last--;
  const parts: string[] = [];
  for (let k = 0; k <= last; k++) {
    const syl = notes[k].lyric ?? '*';
    // A syllable that is just a hyphen is written "\-" (a bare "-" would join two syllables).
    if (syl.trim() === '-') {
      parts.push('\\-');
      continue;
    }
    // Hyphens inside a syllable are literal ("round-up"); a trailing one joins to the next syllable.
    parts.push(syl.trim().replace(/\s+/g, '~').replace(/-(?!$)/g, '\\-') || '*');
  }
  // Join: syllables ending with "-" glue to the next one.
  let text = '';
  for (const p of parts) text += text === '' || (text.endsWith('-') && !text.endsWith('\\-')) ? p : ' ' + p;
  return 'w: ' + text;
}

export function headerText(meta: TabMeta): string {
  const rows: [string, string | number | undefined][] = [
    ['title', meta.title],
    ['artist', meta.artist],
    ['harmonica', meta.harmonica],
    ['tuning', meta.tuning],
    ['harp-key', meta.harpKey],
    ['key', meta.key],
    ['position', meta.position],
    ['tempo', meta.tempo],
    ['time', meta.time],
  ];
  const lines = rows.filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}: ${headerValue(v!)}`);
  for (const [k, v] of Object.entries(meta.extra)) lines.push(`${k}: ${headerValue(v)}`);
  return ['---', ...lines, '---'].join('\n');
}

/** One line of tab and its lyrics line, if any (without the section heading). */
export function lineText(line: TabLine, opts: SerializeOptions = {}): string[] {
  if (!line.events.length) return [];
  const lyr = lyricsText(line);
  return lyr ? [eventsText(line.events, opts), lyr] : [eventsText(line.events, opts)];
}

export function bodyText(lines: TabLine[], opts: SerializeOptions = {}): string {
  const out: string[] = [];
  for (const line of lines) {
    if (line.section !== undefined) {
      if (out.length) out.push('');
      out.push(`@ ${line.section}`);
    }
    out.push(...lineText(line, opts));
  }
  return out.join('\n');
}

export function serializeHtab(doc: TabDoc, opts: SerializeOptions = {}): string {
  return headerText(doc.meta) + '\n' + bodyText(doc.lines, opts) + '\n';
}

/** Breaks a flat list of events into lines of `barsPerLine` bars (or `notesPerLine` if no bars). */
export function wrapEvents(events: TabEvent[], barsPerLine = 4, notesPerLine = 12): TabLine[] {
  const lines: TabLine[] = [];
  let cur: TabEvent[] = [];
  let bars = 0;
  let notes = 0;
  const hasBars = events.some((e) => e.kind === 'bar');
  for (const e of events) {
    cur.push(e);
    if (e.kind === 'bar') bars++;
    else notes++;
    if ((hasBars && e.kind === 'bar' && bars >= barsPerLine) || (!hasBars && notes >= notesPerLine)) {
      lines.push({ events: cur });
      cur = [];
      bars = 0;
      notes = 0;
    }
  }
  if (cur.length) lines.push({ events: cur });
  return lines;
}
