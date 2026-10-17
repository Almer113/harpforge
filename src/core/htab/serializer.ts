// Turns a TabDoc back into .htab text.

import { hasWords, isHeld, lineVerses, lyricOf } from '../verses';
import { midiToName, type Spelling } from '../pitch';
import type { HoleSound, Sound } from '../types';
import { beatsPerBar, type BarEvent, type NoteEvent, type RestEvent, type TabDoc, type TabEvent, type TabLine, type TabMeta } from './types';
import { headerValue } from './parser';

export interface SerializeOptions {
  flats?: Spelling;
  /** Beats in a bar (from the time signature): a line's first bar is a pickup only if shorter. */
  barBeats?: number;
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

/** A rest that carries a syllable (in any verse): written "_" and counted by the "w:" lines. */
function isSung(e: NoteEvent | RestEvent): boolean {
  return e.kind === 'rest' && (hasWords(e) || !!e.sung);
}

function eventCore(e: NoteEvent | RestEvent, opts: SerializeOptions): string {
  if (e.kind === 'rest') return isSung(e) ? '_' : '.';
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
// Divisions a beat can be written in (5 and 7 for quintuplets and septuplets).
// Then any other the text can say ("/15": fifths of a triplet), up to /99.
const DIVISORS = [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 16, 20, 24, 28, 48];
const ALL_DIVISORS = [...DIVISORS, ...Array.from({ length: 98 }, (_, k) => k + 2).filter((n) => !DIVISORS.includes(n))];

/** A group's length as "~" marks and an optional "/N" divider: 1.5 beats → "~~/2". */
function groupLength(sum: number): string {
  if (isInt(sum) && sum >= 1 - EPS) return '~'.repeat(Math.round(sum) - 1);
  for (const n of ALL_DIVISORS.slice(1)) {
    if (isInt(sum * n) && sum * n >= 1 - EPS) return '~'.repeat(Math.round(sum * n) - 1) + '/' + n;
  }
  return '~'.repeat(Math.max(0, Math.round(sum) - 1));
}

function groupText(items: (NoteEvent | RestEvent)[], opts: SerializeOptions): string {
  const sum = items.reduce((a, e) => a + e.beats, 0);
  let ints: number[] | null = null;
  for (const d of ALL_DIVISORS) {
    if (items.every((e) => isInt(e.beats * d))) {
      ints = items.map((e) => Math.max(1, Math.round(e.beats * d)));
      break;
    }
  }
  // Lengths no division above fits: relative weights in 1/48ths of their sum.
  ints ??= items.map((e) => Math.max(1, Math.round((e.beats / sum) * 48)));
  const g = ints.reduce((a, b) => gcd(a, b));
  const parts = items.map((e, k) => withChord(e, eventCore(e, opts) + '~'.repeat(ints![k] / g - 1)));
  // A group cut short by a bar line (odd meters such as 7/8) gets a fractional length.
  return '{' + parts.join(' ') + '}' + groupLength(sum);
}

type Sounding = NoteEvent | RestEvent;

/** Part of an event cut at a beat: the first part is the event; later parts continue it (a tie, or more rest). */
function pieceOf(e: Sounding, beats: number, first: boolean): Sounding {
  if (first) return { ...e, beats };
  if (e.kind === 'note') return { kind: 'note', sounds: e.sounds, beats, tied: true };
  return { kind: 'rest', beats };
}

/**
 * Notes of one length spanning several beats in a way the beat can't show (quarter-note
 * triplets, a quintuplet over two beats): kept as one group rather than cut at the beats.
 */
function tupletRun(evs: Sounding[], k: number, t: number, atBeat: (x: number) => boolean): Sounding[] | null {
  const run: Sounding[] = [];
  let sum = 0;
  for (let i = k; i < evs.length && run.length < 24; i++) {
    const e = evs[i];
    if (e.beats <= EPS) return null;
    run.push(e);
    sum += e.beats;
    if (atBeat(t + sum)) break;
  }
  if (!atBeat(t + sum) || run.length < 2 || sum < 1 + EPS) return null;
  const len = run[0].beats;
  return run.every((e) => Math.abs(e.beats - len) < EPS) && !isInt(len * 4) ? run : null;
}

/**
 * One stretch between bar lines. Whole beats are single tokens ("4", "4~"); shorter notes
 * go in one group per beat ("{4 5}"), and a note that runs over a beat is cut there and
 * continues with a tie ("{4 5} {~ 6}"), so the text reads beat by beat. A pickup (a short
 * first bar) is counted from its end, where its beats are.
 */
function stretchText(events: Sounding[], opts: SerializeOptions, fromEnd: boolean): string[] {
  // A chord symbol on its own goes onto the note right after it.
  const evs: Sounding[] = [];
  for (let k = 0; k < events.length; k++) {
    const e = events[k];
    const next = events[k + 1];
    if (e.beats <= EPS && e.chord && next && next.beats > EPS && !next.chord) {
      events[k + 1] = { ...next, chord: e.chord };
      continue;
    }
    evs.push(e);
  }
  const total = evs.reduce((a, e) => a + e.beats, 0);
  const offset = fromEnd && !isInt(total) ? total - Math.floor(total) : 0;
  const atBeat = (x: number) => isInt(x - offset);
  const out: string[] = [];
  let group: Sounding[] = [];
  const flush = () => {
    if (group.length) out.push(groupText(group, opts));
    group = [];
  };
  let t = 0;
  for (let k = 0; k < evs.length; k++) {
    const e = evs[k];
    if (e.beats <= EPS) {
      // A chord symbol with no note after it (the end of a bar or line).
      flush();
      if (e.chord) out.push(`[${e.chord}]`);
      continue;
    }
    if (!group.length && atBeat(t)) {
      const run = tupletRun(evs, k, t, atBeat);
      if (run) {
        out.push(groupText(run, opts));
        t += run.reduce((a, x) => a + x.beats, 0);
        k += run.length - 1;
        continue;
      }
    }
    let left = e.beats;
    let first = true;
    while (left > EPS) {
      if (!group.length && atBeat(t) && left >= 1 - EPS) {
        // Whole beats: one token, "~" for each beat after the first.
        const whole = Math.floor(left + EPS);
        const p = pieceOf(e, whole, first);
        out.push(withChord(p, eventCore(p, opts) + '~'.repeat(whole - 1)));
        t += whole;
        left -= whole;
      } else {
        const nextBeat = Math.floor(t - offset + EPS) + 1 + offset;
        const take = Math.min(left, nextBeat - t);
        group.push(pieceOf(e, take, first));
        t += take;
        left -= take;
        if (atBeat(t)) flush();
      }
      first = false;
    }
  }
  flush();
  return out;
}

/** An ending's mark: "[1.]", "[1.2.]". */
export function endingText(nums: number[]): string {
  return `[${nums.map((n) => `${n}.`).join('')}]`;
}

/** Serializes one line of events (without lyrics). */
export function eventsText(events: TabEvent[], opts: SerializeOptions = {}): string {
  const out: string[] = [];
  let stretch: Sounding[] = [];
  let lineStart = true;
  const flush = (beforeBar: boolean) => {
    if (!stretch.length) return;
    // The first bar of a line, when it's short, is a pickup: its beats count from its end.
    const len = stretch.reduce((a, e) => a + e.beats, 0);
    const short = opts.barBeats === undefined || len < opts.barBeats - EPS;
    // An ending is written at the start of its bar ("[1.]"), before its first note.
    const ending = stretch.find((e) => e.beats > EPS)?.ending;
    if (ending?.length) out.push(endingText(ending));
    out.push(...stretchText(stretch, opts, lineStart && beforeBar && short));
    stretch = [];
    lineStart = false;
  };
  for (const e of events) {
    if (e.kind === 'bar') {
      flush(true);
      out.push(BAR_TEXT[e.style] + (e.style === 'repeat-end' && e.times && e.times > 2 ? `x${e.times}` : ''));
      continue;
    }
    stretch.push(e);
  }
  flush(false);
  return out.join(' ');
}

/** A line's lyrics line for verse `verse` (0 = verse 1), or null if it has no words. */
function lyricsText(line: TabLine, verse = 0): string | null {
  // Every note sung (not tied ones) and every sung rest ("_") takes a syllable.
  const notes = line.events.filter((e): e is NoteEvent | RestEvent => (e.kind === 'note' && !e.tied) || (e.kind === 'rest' && e.beats > EPS && isSung(e)));
  const syllable = (e: NoteEvent | RestEvent) => lyricOf(e, verse);
  const held = (e: NoteEvent | RestEvent) => isHeld(e, verse);
  // (Only holds on this line — a word carried on from the line before — still need writing.)
  if (!notes.some((e) => syllable(e) || held(e))) return null;
  // (Up to the last note with words — or holding them: "Oh _ _" keeps its holds.)
  let last = notes.length - 1;
  while (last >= 0 && !syllable(notes[last]) && !held(notes[last])) last--;
  const parts: string[] = [];
  for (let k = 0; k <= last; k++) {
    // "_": holds the syllable before; "*": no words.
    const syl = syllable(notes[k]) ?? (held(notes[k]) ? '_' : '*');
    // A syllable that is just a hyphen is written "\-" (a bare "-" would join two syllables).
    if (syl.trim() === '-') {
      parts.push('\\-');
      continue;
    }
    // Hyphens inside a syllable are literal ("round-up"); a trailing one joins to the next syllable.
    // ("‐", a literal hyphen kept from "\-", is written that way again.)
    parts.push(syl.trim().replace(/\s+/g, '~').replace(/-(?!$)/g, '\\-').replace(/‐/g, '\\-') || '*');
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

/**
 * One line of tab and its lyrics lines, a verse each (without the section heading). A verse
 * with no words on this line, before one that has some, is an empty "w:" keeping its place.
 */
export function lineText(line: TabLine, opts: SerializeOptions = {}): string[] {
  if (!line.events.length) return [];
  const out = [eventsText(line.events, opts)];
  for (let v = 0; v < lineVerses(line); v++) out.push(lyricsText(line, v) ?? 'w:');
  return out;
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
  const comments = doc.comments?.length ? '\n' + doc.comments.map((c) => (c ? `# ${c}` : '#')).join('\n') + '\n' : '';
  return headerText(doc.meta) + '\n' + bodyText(doc.lines, { barBeats: beatsPerBar(doc.meta), ...opts }) + '\n' + comments;
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
