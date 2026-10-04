// Parser for the HarpTab (.htab) text format. See docs/htab-format.md.
//
// The parser is forgiving: it never throws, collects issues with source spans,
// and accepts common internet tab spellings (+4, 4D, -3b, <5 ...).

import { parseNoteName } from '../pitch';
import type { Breath, HoleSound, Sound } from '../types';
import {
  defaultMeta,
  type BarEvent,
  type NoteEvent,
  type ParseIssue,
  type ParseResult,
  type RestEvent,
  type TabEvent,
  type TabLine,
  type TabMeta,
} from './types';

export const HEADER_ALIASES: Record<string, keyof TabMeta | 'extra'> = {
  title: 'title',
  artist: 'artist',
  composer: 'artist',
  harmonica: 'harmonica',
  instrument: 'harmonica',
  tuning: 'tuning',
  'harp-key': 'harpKey',
  harpkey: 'harpKey',
  'harp key': 'harpKey',
  key: 'key',
  position: 'position',
  tempo: 'tempo',
  bpm: 'tempo',
  time: 'time',
  meter: 'time',
};

/** Splits off the `---` front matter. Returns body start offset. */
export function splitHeader(text: string): { header: { key: string; value: string; line: number }[]; bodyStart: number; headerEnd: number } {
  const lines = text.split('\n');
  let idx = 0;
  let offset = 0;
  while (idx < lines.length && lines[idx].trim() === '') {
    offset += lines[idx].length + 1;
    idx++;
  }
  if (idx >= lines.length || lines[idx].trim() !== '---') return { header: [], bodyStart: 0, headerEnd: -1 };
  const header: { key: string; value: string; line: number }[] = [];
  offset += lines[idx].length + 1;
  idx++;
  for (; idx < lines.length; idx++) {
    const line = lines[idx];
    if (line.trim() === '---') {
      return { header, bodyStart: offset + line.length + 1, headerEnd: offset };
    }
    const content = stripComment(line);
    const colon = content.indexOf(':');
    if (colon > 0) header.push({ key: content.slice(0, colon).trim().toLowerCase(), value: content.slice(colon + 1).trim().replace(/\\#/g, '#'), line: idx });
    offset += line.length + 1;
  }
  // Unterminated header: treat everything as header.
  return { header, bodyStart: text.length, headerEnd: text.length };
}

/** A header value as written: a "#" that would start a comment (" # ") is written "\#". */
export function headerValue(v: string | number): string {
  return String(v).replace(/(^|\s)#(?=\s|$)/g, '$1\\#');
}

/** A header line without its comment: "#" after a space and before a space or the end ("title: Song #2" keeps its "#2"). */
function stripComment(line: string): string {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '#' && (i === 0 || /\s/.test(line[i - 1])) && (i === line.length - 1 || /\s/.test(line[i + 1]))) return line.slice(0, i);
  }
  return line;
}

function readMeta(header: { key: string; value: string }[]): TabMeta {
  const meta = defaultMeta();
  meta.tuning = undefined;
  meta.harpKey = undefined;
  for (const { key, value } of header) {
    const field = HEADER_ALIASES[key];
    if (!field) {
      meta.extra[key] = value;
      continue;
    }
    if (field === 'tempo') {
      const n = parseFloat(value);
      if (n > 0) meta.tempo = Math.min(400, Math.max(20, n));
    } else if (field === 'harmonica') {
      meta.harmonica = value.toLowerCase();
    } else if (field !== 'extra') {
      (meta as unknown as Record<string, string>)[field] = value;
    }
  }
  return meta;
}

/** Parses one sound word: a hole action ("-4'", "+6", "4D", "<5", "6o") or a pitch ("C#4"). */
export function parseSound(word: string, defaultBreath: Breath | null = null): Sound | string {
  if (/^[A-G]/.test(word)) {
    const midi = parseNoteName(word);
    return midi === null ? `Unknown note "${word}"` : { type: 'pitch', midi };
  }
  let i = 0;
  let breath: Breath | null = null;
  let slide = false;
  let bend = 0;
  let over = false;
  while (i < word.length && '<+-'.includes(word[i])) {
    const c = word[i++];
    if (c === '<') slide = true;
    else breath = c === '+' ? 'blow' : 'draw';
  }
  const digits = /^\d{1,2}/.exec(word.slice(i));
  if (!digits) return `Unrecognized tab "${word}"`;
  const hole = parseInt(digits[0], 10);
  i += digits[0].length;
  for (; i < word.length; i++) {
    const c = word[i];
    if (c === 'D' || c === 'd') breath = 'draw';
    else if (c === 'B') breath = 'blow';
    else if (c === "'" || c === '’' || c === 'b') bend++;
    else if (c === '"') bend += 2;
    else if (c === 'o' || c === 'O' || c === '°') over = true;
    else if (c === '<' || c === '*') slide = true;
    else return `Unrecognized tab "${word}"`;
  }
  if (hole < 1) return `Hole numbers start at 1 ("${word}")`;
  const s: HoleSound = { type: 'hole', hole, breath: breath ?? defaultBreath ?? 'blow', bend, over, slide };
  return s;
}

const STOP_CHARS = new Set(['|', '[', ']', '{', '}', '(', ')']);

interface Ctx {
  s: string;
  base: number;
  issues: ParseIssue[];
  pendingChord?: string;
}

function issue(ctx: Ctx, message: string, a: number, b: number, severity: 'error' | 'warning' = 'error') {
  ctx.issues.push({ message, span: { start: ctx.base + a, end: ctx.base + Math.max(b, a + 1) }, severity });
}

function countTildes(s: string, i: number): number {
  let n = 0;
  while (s[i + n] === '~') n++;
  return n;
}

/** Parses events between [from, to). Inside a group, beats are relative weights. */
function parseRange(ctx: Ctx, from: number, to: number, inGroup: boolean): TabEvent[] {
  const { s } = ctx;
  const events: TabEvent[] = [];
  let i = from;
  const takeChord = () => {
    const c = ctx.pendingChord;
    ctx.pendingChord = undefined;
    return c;
  };

  while (i < to) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) break;

    // Bar lines
    if (c === '|' || (c === ':' && s[i + 1] === '|')) {
      let style: BarEvent['style'] = 'single';
      let len = 1;
      if (s.startsWith(':||', i)) [style, len] = ['repeat-end', 3];
      else if (s.startsWith(':|', i)) [style, len] = ['repeat-end', 2];
      else if (s.startsWith('||', i)) [style, len] = ['double', 2];
      else if (s.startsWith('|]', i)) [style, len] = ['final', 2];
      else if (s.startsWith('|:', i)) [style, len] = ['repeat-start', 2];
      if (inGroup) issue(ctx, 'Bar lines are not allowed inside { }', i, i + len);
      else events.push({ kind: 'bar', style, src: { start: ctx.base + i, end: ctx.base + i + len } });
      i += len;
      continue;
    }

    // Chord symbol [G7]
    if (c === '[') {
      const j = s.indexOf(']', i);
      if (j < 0 || j >= to) {
        issue(ctx, 'Missing "]" for chord symbol', i, to);
        return events;
      }
      const sym = s.slice(i + 1, j).trim();
      if (sym) ctx.pendingChord = sym;
      i = j + 1;
      continue;
    }

    // Beat group {a b c}
    if (c === '{') {
      if (inGroup) {
        issue(ctx, 'Groups { } cannot be nested', i, i + 1);
        i++;
        continue;
      }
      const j = s.indexOf('}', i);
      if (j < 0 || j >= to) {
        issue(ctx, 'Missing "}" for beat group', i, to);
        return events;
      }
      const inner = parseRange(ctx, i + 1, j, true) as (NoteEvent | RestEvent)[];
      const tildes = countTildes(s, j + 1);
      // "{7}/2" = half a beat, "{6~ 7}~~/2" = 1½ beats: needed for odd meters like 7/8.
      const div = /^\/(\d{1,2})/.exec(s.slice(j + 1 + tildes));
      const divisor = div ? Math.max(1, parseInt(div[1], 10)) : 1;
      const total = (1 + tildes) / divisor;
      const sum = inner.reduce((a, e) => a + e.beats, 0);
      if (inner.length === 0) issue(ctx, 'Empty beat group', i, j + 1, 'warning');
      for (const e of inner) {
        e.beats = (total * e.beats) / sum;
        events.push(e);
      }
      i = j + 1 + tildes + (div ? div[0].length : 0);
      continue;
    }

    if (c === '}' || c === ']' || c === ')') {
      issue(ctx, `Unexpected "${c}"`, i, i + 1);
      i++;
      continue;
    }

    // Harmonica chord (4 5 6) / -(1 2 3)
    if (c === '(' || ((c === '-' || c === '+') && s[i + 1] === '(')) {
      const defaultBreath: Breath | null = c === '-' ? 'draw' : c === '+' ? 'blow' : null;
      const open = c === '(' ? i : i + 1;
      const j = s.indexOf(')', open);
      if (j < 0 || j >= to) {
        issue(ctx, 'Missing ")" for harmonica chord', i, to);
        return events;
      }
      const sounds: Sound[] = [];
      const inner = s.slice(open + 1, j);
      let k = 0;
      for (const word of inner.split(/[\s,]+/)) {
        if (!word) continue;
        const at = inner.indexOf(word, k);
        k = at + word.length;
        const r = parseSound(word, defaultBreath);
        if (typeof r === 'string') issue(ctx, r, open + 1 + at, open + 1 + at + word.length);
        else sounds.push(r);
      }
      const tildes = countTildes(s, j + 1);
      const end = j + 1 + tildes;
      if (sounds.length) {
        events.push({ kind: 'note', sounds, beats: 1 + tildes, chord: takeChord(), src: { start: ctx.base + i, end: ctx.base + end } });
      } else {
        issue(ctx, 'Empty harmonica chord', i, end);
      }
      i = end;
      continue;
    }

    // Plain word: sound or rest
    let j = i;
    while (j < to && !/\s/.test(s[j]) && !STOP_CHARS.has(s[j])) j++;
    const raw = s.slice(i, j);
    let core = raw;
    let tildes = 0;
    while (core.endsWith('~')) {
      core = core.slice(0, -1);
      tildes++;
    }
    const src = { start: ctx.base + i, end: ctx.base + j };
    if (core === '.' || core === 'r' || core === 'R') {
      events.push({ kind: 'rest', beats: 1 + tildes, chord: takeChord(), src });
    } else if (core === '') {
      // A bare "~": a tie — the previous note keeps sounding (one beat per "~").
      // Its sounds are filled in after the whole tab is read (it may cross lines).
      events.push({ kind: 'note', sounds: [], beats: tildes, tied: true, chord: takeChord(), src });
    } else {
      const r = parseSound(core);
      if (typeof r === 'string') issue(ctx, r, i, j);
      else events.push({ kind: 'note', sounds: [r], beats: 1 + tildes, chord: takeChord(), src });
    }
    i = j;
  }
  return events;
}

/** Splits a lyrics line into syllables: words split on spaces, hyphens kept on the syllable. */
export function splitLyrics(text: string): string[] {
  const out: string[] = [];
  for (const word of text.trim().split(/\s+/)) {
    if (!word) continue;
    // "~" joins words into one syllable and "\-" is a literal hyphen, as in ABC.
    const parts = word.replace(/\\-/g, '\u0001').split(/(?<=-)/);
    for (const p of parts) if (p && p !== '-') out.push(p.replace(/~/g, ' ').replace(/\u0001/g, '-'));
  }
  return out;
}

function attachLyrics(line: TabLine, text: string) {
  const syllables = splitLyrics(text);
  let k = 0;
  for (const ev of line.events) {
    if (ev.kind !== 'note' || ev.tied) continue; // tied notes aren't sung again
    if (k >= syllables.length) break;
    const syl = syllables[k++];
    if (syl !== '*' && syl !== '_') ev.lyric = syl;
  }
}

/**
 * Gives each tie ("~") the sounds of the note it continues. A tie after a rest just
 * lengthens the rest; a tie with nothing before it is an error.
 */
function resolveTies(lines: TabLine[], issues: ParseIssue[]) {
  let last: NoteEvent | RestEvent | null = null;
  for (const line of lines) {
    line.events.forEach((ev, k) => {
      if (ev.kind === 'bar' || ev.beats <= 0) return;
      if (ev.kind === 'note' && ev.tied) {
        if (last && last.kind === 'note') ev.sounds = last.sounds;
        else {
          if (!last) issues.push({ message: 'A tie "~" needs a note before it', span: ev.src ?? { start: 0, end: 1 }, severity: 'error' });
          const rest: RestEvent = { kind: 'rest', beats: ev.beats, chord: ev.chord, src: ev.src };
          line.events[k] = rest;
          last = rest;
          return;
        }
      }
      last = ev as NoteEvent | RestEvent;
    });
  }
}

export function parseHtab(text: string): ParseResult {
  const issues: ParseIssue[] = [];
  const { header, bodyStart } = splitHeader(text);
  const meta = readMeta(header);
  const lines: TabLine[] = [];
  let pendingSection: string | undefined;
  let lastLine: TabLine | undefined;
  // Lyrics lines after the last tab line: the first is its lyrics, more are extra verses (kept, not shown).
  let verses = 0;

  let offset = bodyStart;
  const body = text.slice(bodyStart);
  for (const rawLine of body.split('\n')) {
    const lineStart = offset;
    offset += rawLine.length + 1;
    const line = rawLine.replace(/\r$/, '');
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    if (trimmed.startsWith('@')) {
      if (pendingSection !== undefined) lines.push({ section: pendingSection, events: [] });
      pendingSection = trimmed.slice(1).trim();
      lastLine = undefined;
      continue;
    }
    if (/^w:/i.test(trimmed)) {
      if (lastLine && verses++ === 0) attachLyrics(lastLine, trimmed.slice(2));
      else if (lastLine)
        issues.push({ message: `Verse ${verses} is kept as written; only the first verse is shown and played`, span: { start: lineStart, end: lineStart + line.length }, severity: 'info' });
      else issues.push({ message: 'Lyrics line "w:" must follow a tab line', span: { start: lineStart, end: lineStart + line.length }, severity: 'warning' });
      continue;
    }
    const ctx: Ctx = { s: line, base: lineStart, issues };
    const events = parseRange(ctx, 0, line.length, false);
    if (ctx.pendingChord) {
      // A trailing chord symbol with nothing after it: attach as a zero-length marker on a rest.
      events.push({ kind: 'rest', beats: 0, chord: ctx.pendingChord });
    }
    const tabLine: TabLine = { events, src: { start: lineStart, end: lineStart + line.length } };
    if (pendingSection !== undefined) {
      tabLine.section = pendingSection;
      pendingSection = undefined;
    }
    lines.push(tabLine);
    lastLine = tabLine;
    verses = 0;
  }
  if (pendingSection !== undefined) lines.push({ section: pendingSection, events: [] });

  resolveTies(lines, issues);
  return { doc: { meta, lines }, issues };
}
