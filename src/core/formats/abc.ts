// ABC notation (https://abcnotation.com/wiki/abc:standard:v2.1): import & export.
//
// Import covers the parts that matter for melodies: header fields, key signatures
// and modes, accidentals (bar-scoped), lengths, broken rhythm, tuplets, ties, chords,
// chord symbols, rests, bars, lyrics (w:) and parts. Only the first tune and first
// voice are read.

import { isHeld, lineShown, lyricOf, setHeld, setLyricOf, songVerses } from '../verses';
import type { Harmonica } from '../instruments';
import { holeSoundText } from '../htab/serializer';
import { beatsPerBar, type BarEvent, type NoteEvent, type RestEvent, type TabDoc, type TabEvent, type TabLine } from '../htab/types';
import type { HoleSound } from '../types';
import { eventMidis, keyFifths, keySignature, LETTER_PC, notesMeta, spell, toFraction, type Imported } from './common';

// ---- Import ---------------------------------------------------------------------

interface PendingNote {
  ev: NoteEvent;
  /** The note's pitches, to match the note a tie leads to. */
  key: string;
  /** Letter and octave marks as written ("F", "c'"), for a tie over a bar line. */
  letter?: string;
}

export function parseAbc(text: string): Imported {
  const warnings: string[] = [];
  const src = text.replace(/\r\n?/g, '\n');
  const tunes = src.split(/\n(?=X:)/);
  const tune = tunes.find((t) => /(^|\n)K:/.test(t)) ?? src;
  if (tunes.filter((t) => /(^|\n)X:/.test(t)).length > 1) warnings.push('This file has several tunes; only the first was imported.');

  const meta = notesMeta({ time: '4/4', tempo: 120 });
  let unit = 1 / 8;
  let unitSet = false;
  let fifths = 0;
  const lines: TabLine[] = [];
  let inBody = false;
  let firstVoice: string | null = null;
  let currentVoice: string | null = null;
  let pendingSection: string | undefined;
  // One entry per written note head; null = a head merged into the previous note by a
  // tie (it still takes a lyric slot, but the syllable is dropped).
  let pendingLyricNotes: (NoteEvent | null)[] = [];
  // The bar (counted along the music lines a "w:" line belongs to) each of those notes is in.
  let pendingLyricBars: number[] = [];
  let lyricBar = 0;
  // An ending to go on the next note or rest (":|2" at a line's end: on the next line's first).
  let pendingEnding: number[] | undefined;
  // Words below a rest are sung words only in files HarpForge wrote (elsewhere "_Fine" is a direction).
  const ownRestWords = /^%\s*HarpForge\b.*below the rests/m.test(src);
  let lastNote: PendingNote | null = null;
  let tieOpen = false;
  let barAcc: Record<string, number> = {};
  const warned = new Set<string>();
  const warnOnce = (w: string) => {
    if (!warned.has(w)) {
      warned.add(w);
      warnings.push(w);
    }
  };

  const setMeter = (v: string) => {
    const t = v.trim();
    const time = t === 'C' ? '4/4' : t === 'C|' ? '2/2' : /^\d+\/\d+$/.test(t) ? t : null;
    if (!time) return;
    if (inBody) {
      // A tab has one time signature: keep the first (note lengths don't change with M:).
      if (time !== meta.time) warnOnce(`The time signature changes to ${time} during the tune; the tab keeps ${meta.time}.`);
      return;
    }
    meta.time = time;
    if (!unitSet) {
      const [n, d] = meta.time.split('/').map(Number);
      unit = n / d < 0.75 ? 1 / 16 : 1 / 8;
    }
  };
  const setKey = (v: string) => {
    const k = v.trim();
    if (!k || /^(none|HP|Hp)/.test(k)) return;
    const f = keyFifths(k);
    if (f !== null) fifths = f;
    const name = k.replace(/\s+(clef|transpose|octave|middle)=.*$/, '').trim();
    if (!inBody || !meta.key) meta.key = name;
    else if (name !== meta.key) warnOnce(`The key changes to ${name} during the tune; the song key stays ${meta.key}.`);
  };
  const setField = (field: string, value: string) => {
    const v = value.trim();
    switch (field) {
      case 'T':
        if (!meta.title) meta.title = v;
        else if (inBody) pendingSection = v;
        break;
      case 'C':
        if (!meta.artist) meta.artist = v;
        break;
      case 'M':
        setMeter(v);
        break;
      case 'L': {
        const m = /^(\d+)\/(\d+)$/.exec(v);
        if (m) {
          unit = parseInt(m[1], 10) / parseInt(m[2], 10);
          unitSet = true;
        }
        break;
      }
      case 'Q': {
        // Q:1/4=120, Q:120, Q:3/8=80, Q:"Allegro" 1/4=120
        const m = /(?:(\d+)\/(\d+)\s*=\s*)?(\d+)\s*$/.exec(v.replace(/"[^"]*"/g, '').trim());
        if (m) {
          const beatLen = m[1] ? parseInt(m[1], 10) / parseInt(m[2], 10) : unit;
          meta.tempo = Math.round(parseInt(m[3], 10) * beatLen * 4);
        }
        break;
      }
      case 'K':
        setKey(v);
        break;
      case 'P':
        if (inBody) pendingSection = v;
        break;
      case 'V': {
        const id = v.split(/\s/)[0];
        firstVoice ??= id;
        currentVoice = id;
        break;
      }
    }
  };

  let lyricRest: (NoteEvent | null)[] = [];
  let lyricRestBars: number[] = [];
  let continuesLine = false;
  let lastField = '';
  // Each "w:" line under a music line is a verse of it (1, 2, …); "+:" goes on with the last one.
  let verseCount = 0;
  let verse = 0;
  const attachLyrics = (textLine: string, continued = false) => {
    // Tokenize: syllables separated by spaces or hyphens; "_", "*" and a "-" on its own (after a
    // space or another "-") take a note with no new syllable; "|" goes on to the next bar.
    const notes = continued ? lyricRest : pendingLyricNotes;
    const bars = continued ? lyricRestBars : pendingLyricBars;
    if (!continued) verse = verseCount++;
    let k = 0;
    const re = /(\\[-%]|[^\s\-_*|~]|~)+-?|[_*]|\||-/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(textLine)) && k < notes.length) {
      const tok = m[0];
      if (tok === '|') {
        // (Words already up to the bar line: nothing to skip.)
        if (k > 0) while (k < notes.length && bars[k] === bars[k - 1]) k++;
        continue;
      }
      if (tok === '_' || tok === '*' || tok === '-') {
        // ("_": the syllable before goes on over this note; "*" and a lone "-": no words.)
        const held = notes[k];
        if (tok === '_' && held && !held.tied) setHeld(held, verse, true);
        k++;
        continue;
      }
      const target = notes[k++];
      // ("\-" is a literal hyphen: one ending a syllable is kept as "‐", so it isn't read as joined.)
      if (target && !target.tied) setLyricOf(target, verse, tok.replace(/(?<=.)\\-$/, '\u2010').replace(/\\-/g, '-').replace(/\\%/g, '%').replace(/~/g, ' '));
    }
    lyricRest = notes.slice(k);
    lyricRestBars = bars.slice(k);
  };

  const durationOf = (lenStr: string): number => {
    const m = /^(\d*)(\/*)(\d*)$/.exec(lenStr);
    if (!m) return 1;
    const num = m[1] ? parseInt(m[1], 10) : 1;
    let den = 1;
    if (m[2]) den = m[3] ? parseInt(m[3], 10) * Math.pow(2, m[2].length - 1) : Math.pow(2, m[2].length);
    return num / den;
  };

  const pitchOf = (acc: string, letter: string, marks: string): number => {
    const L = letter.toUpperCase();
    let octave = letter === L ? 4 : 5;
    for (const c of marks) octave += c === "'" ? 1 : -1;
    const key = L + octave;
    let alter: number;
    if (acc) {
      alter = acc === '=' ? 0 : acc === '^' ? 1 : acc === '^^' ? 2 : acc === '_' ? -1 : -2;
      barAcc[key] = alter;
    } else if (barAcc[key] !== undefined) alter = barAcc[key];
    else alter = keySignature(fifths)[L];
    return (octave + 1) * 12 + LETTER_PC[L] + alter;
  };

  const bodyLines = tune.split('\n');
  for (const raw of bodyLines) {
    const line = raw.replace(/(^|[^\\])%.*$/, '$1');
    const trimmed = line.trim();
    if (!trimmed) continue;
    // "+:" continues the field above it (most often a long lyrics line).
    const field = /^([A-Za-z+]):(.*)$/.exec(trimmed);
    if (field && !/^[|[]/.test(trimmed) && !field[2].startsWith('|')) {
      const [, f, v] = field;
      if (f === '+') {
        if (lastField === 'w' && (!currentVoice || currentVoice === firstVoice)) attachLyrics(v, true);
        continue;
      }
      lastField = f;
      if (f === 'w') {
        // A line of harmonica holes (as HarpForge writes under the staff, first) is the tab, not
        // lyrics; a line of only "*" is an empty verse, keeping its place.
        const hole = String.raw`<?(?:\\-)?\d{1,2}'{0,3}o?`;
        const isTabLine =
          verseCount === 0 && new RegExp(`\\d`).test(v) && new RegExp(`^(?:\\*|${hole}(?:~${hole})*)(?:\\s+(?:\\*|${hole}(?:~${hole})*))*$`).test(v.trim());
        if (isTabLine) {
          // ("+:" after it continues the tab, not a verse.)
          lastField = 'w-tab';
          continue;
        }
        if (!currentVoice || currentVoice === firstVoice) attachLyrics(v);
        continue;
      }
      if (f === 'K' && !inBody) {
        setField(f, v);
        inBody = true;
        continue;
      }
      if (f === 'V' && inBody) {
        setField(f, v);
        continue;
      }
      setField(f, v);
      continue;
    }
    if (!inBody) continue;
    lastField = '';
    if (currentVoice && firstVoice && currentVoice !== firstVoice) continue;

    // Music line. A "w:" line belongs to the music line just before it, so notes of a line
    // that had no lyrics aren't given the next line's words (unless it continued with "\").
    if (!continuesLine) {
      pendingLyricNotes = [];
      pendingLyricBars = [];
      lyricBar = 0;
      verseCount = 0;
    }
    continuesLine = /\\\s*$/.test(line);
    const events: TabEvent[] = [];
    let pendingChord: string | undefined;
    // Words written below a rest ("_roll"z2): sung over it (a verse each, " / " between).
    let pendingBelow: string | undefined;
    // A repeat count for the next ":|".
    let pendingTimes: number | undefined;
    let tuplet: { left: number; factor: number } | null = null;
    let broken: number | null = null; // multiplier for the next note
    const s = line;
    let i = 0;

    const pushNote = (ev: NoteEvent | RestEvent, tieMidi?: number) => {
      if (tuplet) {
        ev.beats *= tuplet.factor;
        if (--tuplet.left <= 0) tuplet = null;
      }
      if (broken !== null) {
        ev.beats *= broken;
        broken = null;
      }
      if (pendingChord) {
        ev.chord = pendingChord;
        pendingChord = undefined;
      }
      if (pendingEnding) {
        ev.ending = pendingEnding;
        pendingEnding = undefined;
      }
      if (pendingBelow !== undefined) {
        if (ev.kind === 'rest') {
          const rest = ev;
          pendingBelow.split(' / ').forEach((w, v) => setLyricOf(rest, v, w.trim() || undefined));
          if (rest.lyric !== undefined || rest.verses?.some(Boolean)) rest.sung = true;
        }
        pendingBelow = undefined;
      }
      // Ties: within a bar the notes merge; across a bar line (or line) they stay tied.
      const key = ev.kind === 'note' ? ev.sounds.map((s) => (s.type === 'pitch' ? s.midi : 0)).join(',') : '';
      void tieMidi;
      if (ev.kind === 'note' && tieOpen && lastNote && lastNote.key === key) {
        tieOpen = false;
        const idx = events.lastIndexOf(lastNote.ev);
        const crossesBar = idx < 0 || events.slice(idx + 1).some((e) => e.kind === 'bar');
        if (!crossesBar && !ev.chord) {
          lastNote.ev.beats += ev.beats;
          pendingLyricNotes.push(null);
          pendingLyricBars.push(lyricBar);
          return;
        }
        ev.tied = true;
        events.push(ev);
        pendingLyricNotes.push(ev);
        pendingLyricBars.push(lyricBar);
        lastNote = { ev, key };
        return;
      }
      tieOpen = false;
      events.push(ev);
      if (ev.kind === 'note') {
        lastNote = { ev, key };
        pendingLyricNotes.push(ev);
        pendingLyricBars.push(lyricBar);
      } else lastNote = null;
    };

    while (i < s.length) {
      // Music of another voice ("[V:2] ..." on the same line) is skipped up to the next voice change.
      if (currentVoice && firstVoice && currentVoice !== firstVoice) {
        const next = s.indexOf('[V:', i);
        if (next < 0) break;
        const inline = /^\[V:([^\]]*)\]/.exec(s.slice(next));
        if (inline) setField('V', inline[1]);
        i = next + (inline ? inline[0].length : 3);
        continue;
      }
      const c = s[i];
      if (/\s/.test(c) || c === '`' || c === 'y' || c === '\\') {
        i++;
        continue;
      }
      if (c === '"') {
        const j = s.indexOf('"', i + 1);
        const content = s.slice(i + 1, j < 0 ? s.length : j);
        const timesMark = /^\^\s*(?:[×x]\s*(\d{1,2})|(\d{1,2})\s*[×x])\s*$/.exec(content);
        if (timesMark) pendingTimes = Number(timesMark[1] ?? timesMark[2]);
        else if (content && !/^[\^_<>@]/.test(content)) pendingChord = content.trim();
        else if (ownRestWords && content.startsWith('_') && content.length > 1) pendingBelow = content.slice(1).replace(/\\%/g, '%');
        i = j < 0 ? s.length : j + 1;
        continue;
      }
      if (c === '!' || c === '+') {
        const j = s.indexOf(c, i + 1);
        i = j < 0 ? i + 1 : j + 1;
        continue;
      }
      if (c === '{') {
        const j = s.indexOf('}', i);
        i = j < 0 ? s.length : j + 1;
        continue;
      }
      if (c === '(') {
        const m = /^\((\d)(?::(\d)?)?(?::(\d))?/.exec(s.slice(i));
        if (m) {
          const p = parseInt(m[1], 10);
          const compound = !['2', '3', '4', '6', '8'].includes(meta.time.split('/')[1]) || ['6/8', '9/8', '12/8'].includes(meta.time);
          const qDefault = p === 2 || p === 4 || p === 8 ? 3 : p === 3 || p === 6 ? 2 : compound ? 3 : 2;
          const q = m[2] ? parseInt(m[2], 10) : qDefault;
          const r = m[3] ? parseInt(m[3], 10) : p;
          tuplet = { left: r, factor: q / p };
          i += m[0].length;
        } else i++;
        continue;
      }
      if (c === ')') {
        i++;
        continue;
      }
      if (c === '-') {
        tieOpen = true;
        i++;
        continue;
      }
      if (c === '>' || c === '<') {
        let n = 0;
        while (s[i + n] === c) n++;
        const factor = 1 - Math.pow(0.5, n); // > : 1.5/0.5, >> : 1.75/0.25
        if (lastNote || events.length) {
          const prev = events[events.length - 1];
          if (prev && prev.kind !== 'bar') {
            prev.beats *= c === '>' ? 1 + factor : 1 - factor;
            broken = c === '>' ? 1 - factor : 1 + factor;
          }
        }
        i += n;
        continue;
      }
      // Bars, repeats, endings
      if (c === '|' || c === ':' || (c === '[' && /^\[[|\d]/.test(s.slice(i)))) {
        // A bar line, maybe with an ending's numbers after it ("|1", ":|2", "|1,2"), or an
        // ending on its own ("[1", "[1,2", "[1-3").
        const m = /^(?:(:*\[?\|+\]?:*|:+\|*:*|\[\|)(\d[\d,-]*)?|\[(\d[\d,-]*))/.exec(s.slice(i));
        const tok = m ? m[0] : c;
        i += tok.length;
        const nums = m?.[2] ?? m?.[3];
        if (nums) pendingEnding = endingNumbers(nums);
        if (m?.[3]) continue; // an ending on its own
        const bar = m?.[1] ?? tok;
        // ":|" with "^×3" over its bar's last note: played three times.
        const times = pendingTimes;
        pendingTimes = undefined;
        if (/^:+\|*:+$/.test(bar) || /^:\|+:$/.test(bar)) {
          // "::" / ":|:" — the end of one repeat and the start of the next.
          events.push({ kind: 'bar', style: 'repeat-end', ...(times ? { times } : {}) }, { kind: 'bar', style: 'repeat-start' });
          barAcc = {};
          lyricBar++;
          continue;
        }
        let style: BarEvent['style'] = 'single';
        if (bar.startsWith(':') && bar.endsWith(':')) style = 'repeat-end';
        else if (bar.startsWith(':')) style = 'repeat-end';
        else if (bar.endsWith(':')) style = 'repeat-start';
        else if (bar.includes('||')) style = 'double';
        else if (bar.includes('|]') || bar.includes('[|')) style = 'final';
        events.push({ kind: 'bar', style, ...(style === 'repeat-end' && times ? { times } : {}) });
        barAcc = {};
        lyricBar++;
        continue;
      }
      if (c === '[') {
        const inline = /^\[([A-Za-z]):([^\]]*)\]/.exec(s.slice(i));
        if (inline) {
          setField(inline[1], inline[2]);
          i += inline[0].length;
          continue;
        }
        // Chord [CEG]2
        const m = /^\[((?:[\^=_]*[A-Ga-g][,']*\d*\/*\d*-?\s*)+)\](\d*\/*\d*)/.exec(s.slice(i));
        if (m) {
          const midis: number[] = [];
          let innerLen = 1;
          const noteRe = /([\^=_]*)([A-Ga-g])([,']*)(\d*\/*\d*)/g;
          let nm: RegExpExecArray | null;
          let first = true;
          while ((nm = noteRe.exec(m[1]))) {
            midis.push(pitchOf(nm[1], nm[2], nm[3]));
            if (first) innerLen = durationOf(nm[4]);
            first = false;
          }
          const beats = unit * 4 * innerLen * durationOf(m[2]);
          i += m[0].length;
          const uniq = [...new Set(midis)].sort((a, b) => a - b);
          pushNote({ kind: 'note', sounds: uniq.map((midi) => ({ type: 'pitch', midi })), beats });
          continue;
        }
        i++;
        continue;
      }
      // Decorations shorthand
      if ('~.HLMOPSTuvJR'.includes(c) && /[\^=_A-Ga-gzx"[]/.test(s[i + 1] ?? '')) {
        i++;
        continue;
      }
      // Note
      const nm = /^([\^=_]*)([A-Ga-g])([,']*)(\d*\/*\d*)/.exec(s.slice(i));
      if (nm) {
        let midi = pitchOf(nm[1], nm[2], nm[3]);
        // A note tied over a bar line keeps its accidental ("^F-|F" is F# both times).
        const ln = lastNote as PendingNote | null; // set inside pushNote
        const prev = ln?.ev.sounds[0];
        if (tieOpen && !nm[1] && prev?.type === 'pitch' && ln!.ev.sounds.length === 1 && ln!.letter === nm[2].toUpperCase() + nm[3]) midi = prev.midi;
        const beats = unit * 4 * durationOf(nm[4]);
        i += nm[0].length;
        pushNote({ kind: 'note', sounds: [{ type: 'pitch', midi }], beats }, midi);
        if (lastNote) (lastNote as PendingNote).letter = nm[2].toUpperCase() + nm[3];
        continue;
      }
      // Rests
      const rm = /^([zx])(\d*\/*\d*)/.exec(s.slice(i));
      if (rm) {
        i += rm[0].length;
        pushNote({ kind: 'rest', beats: unit * 4 * durationOf(rm[2]) });
        continue;
      }
      const mm = /^([ZX])(\d*)/.exec(s.slice(i));
      if (mm) {
        i += mm[0].length;
        const bars = mm[2] ? parseInt(mm[2], 10) : 1;
        pushNote({ kind: 'rest', beats: bars * beatsPerBar(meta) });
        continue;
      }
      warnOnce(`Skipped unsupported ABC symbol "${c}"`);
      i++;
    }
    if (pendingChord) events.push({ kind: 'rest', beats: 0, chord: pendingChord });
    if (events.length) {
      const tl: TabLine = { events };
      if (pendingSection !== undefined) {
        tl.section = pendingSection;
        pendingSection = undefined;
      }
      lines.push(tl);
    }
  }

  if (!inBody) warnings.push('No "K:" line found — is this an ABC file?');
  return { doc: { meta, lines }, warnings, format: 'ABC' };
}

// ---- Export ---------------------------------------------------------------------

export interface AbcExportOptions {
  /** Add the harmonica tab as a lyric line under the staff. */
  tabLine?: boolean;
  lyrics?: boolean;
  /** Which verses' lyrics (0-based; default every one), a "w:" line each. */
  verses?: number[];
  /** Chord symbols above the staff (default true). */
  chords?: boolean;
  /** Title, composer and tempo marking (default true; the staff view can leave them out). */
  header?: boolean;
  /** Reference number written in X:. */
  index?: number;
  /**
   * Words sung over a rest written below it ("_roll"z2; verses " / " between): a "w:" line
   * can't hold them (ABC's words skip rests). Files only: the staff view draws them itself.
   */
  restWords?: boolean;
}

const LEN_DENS = [1, 2, 4, 8, 16, 32];

/** "1,2" / "1-3" (an ABC ending's numbers) → [1, 2] / [1, 2, 3]. */
function endingNumbers(text: string): number[] {
  const out = new Set<number>();
  for (const part of text.split(',')) {
    const [a, b] = part.split('-').map(Number);
    if (!Number.isFinite(a)) continue;
    for (let n = a; n <= (Number.isFinite(b) ? Math.min(b, a + 20) : a); n++) if (n >= 1) out.add(n);
  }
  return [...out].sort((x, y) => x - y);
}

/** A part of a written line that's a bar line ("|", ":|", "|1"…), not music. */
const BAR_PART = /^[|:\][]+\d*(,\d+)*$/;

/** Whether any note of `line` (not a tie) has words in one of the verses `list`. */
export function lineHasNoteWords(line: TabLine, list: number[]): boolean {
  return line.events.some((e) => e.kind === 'note' && !e.tied && list.some((v) => !!lyricOf(e, v)?.trim()));
}

/** Tuplet ratios tried for lengths no plain note shows: p notes in the time of q. */
const TUPLETS: [number, number][] = [
  [3, 2],
  [5, 4],
  [5, 2],
  [6, 4],
  [7, 4],
  [7, 8],
];

function lengthText(beats: number, unit: number): string {
  const [n, d] = toFraction(beats / (unit * 4), [1, 2, 4, 8, 16, 32, 3, 6, 12, 24]);
  if (n === 1 && d === 1) return '';
  if (d === 1) return String(n);
  if (n === 1 && d === 2) return '/';
  return n === 1 ? `/${d}` : `${n}/${d}`;
}

function isPlainLength(beats: number, unit: number): boolean {
  // Exactly a plain length (toFraction rounds to its nearest fraction when none fits).
  const x = beats / (unit * 4);
  const [n, d] = toFraction(x, [1, 2, 3, 4, 6, 8, 12, 16, 24, 32]);
  return LEN_DENS.includes(d) && Math.abs(n / d - x) < 1e-6;
}

function tabToken(e: NoteEvent): string {
  const holes = e.sounds.filter((s): s is HoleSound => s.type === 'hole');
  if (!holes.length) return '*';
  return holes.map((h) => holeSoundText(h).replace(/-/g, '\\-')).join('~');
}

/**
 * Writes ABC. Pitches come from `harp` for hole sounds. Returns the text and the
 * order of written note/rest events (line, eventIndex), for mapping clicks back.
 */
export function writeAbc(doc: TabDoc, harp?: Harmonica, opts: AbcExportOptions = {}): { text: string; order: [number, number][] } {
  const { meta } = doc;
  const tabLine = opts.tabLine ?? false;
  const withLyrics = opts.lyrics ?? true;
  const verses = opts.verses ?? Array.from({ length: Math.max(1, songVerses(doc)) }, (_, k) => k);
  const withChords = opts.chords ?? true;
  const withHeader = opts.header ?? true;
  const fifths = keyFifths(meta.key) ?? 0;
  // "Low F" / "High G" are harps, not keys: ABC's K: is F / G.
  const keyText = keyFifths(meta.key) !== null ? meta.key!.replace(/^\s*(Low|High)\s+/i, '') : 'C';
  const unit = 1 / 8;
  const out: string[] = [`X:${opts.index ?? 1}`];
  // (Words sung over rests written below them: said, so they're read back as words.)
  let wroteRestWords = false;
  if (withHeader) {
    out.push(`T:${meta.title || 'Untitled'}`);
    if (meta.artist) out.push(`C:${meta.artist}`);
  }
  out.push(`M:${meta.time}`, 'L:1/8', ...(withHeader ? [`Q:1/4=${Math.round(meta.tempo)}`] : []), `K:${keyText}`);
  const order: [number, number][] = [];
  let lastTieable: number | null = null;
  // The previous line's notes, and where it is in `out`: a tie from its last note is marked there.
  let prevLine: { parts: string[]; glued: Set<number>; at: number; tieable: number | null } | null = null;
  // Beams: notes shorter than a beat are written touching ("cd", not "c d") within a beat — a
  // dotted quarter in 3/8, 6/8, 9/8 and 12/8 — so the staff beams them; rests and longer notes
  // break the beam. `pos` is where in the bar the next note starts (in quarter beats).
  const [timeTop, timeBottom] = (/^(\d+)\s*\/\s*(\d+)$/.exec(meta.time) ?? []).slice(1).map(Number);
  const beamBeat = timeBottom === 8 && timeTop % 3 === 0 ? 1.5 : 1;
  // A short first bar (a pickup) is the end of a bar: its notes are on the beats they'd have there.
  const firstBar = (() => {
    let len = 0;
    for (const line of doc.lines) {
      for (const e of line.events) {
        // (A bar line before any music, as a "|:" opening the song, isn't the first bar's end.)
        if (e.kind === 'bar') {
          if (len > 1e-6) return len;
          continue;
        }
        len += e.beats;
      }
    }
    return len;
  })();
  const barLen = beatsPerBar(meta);
  let anyMusic = false;
  let pos = firstBar > 1e-6 && firstBar < barLen - 1e-6 ? barLen - firstBar : 0;
  let beam: { group: number; end: number } | null = null;
  /** The parts written, as a line: a part in `glued` touches the one before it (a beam). */
  const lineOf = (parts: string[], glued: Set<number>) => parts.map((p, k) => (k === 0 || glued.has(k) ? p : ' ' + p)).join('');

  doc.lines.forEach((line, li) => {
    if (line.section) out.push(`P:${line.section}`);
    if (!line.events.length) return;
    let barAcc: Record<string, number> = {};
    const sig = keySignature(fifths);
    const parts: string[] = [];
    const glued = new Set<number>();
    // (A beam doesn't go on from one line to the next.)
    beam = null;
    lastTieable = null;
    // Each verse's syllables, a slot per note ("*": none). (One verse picked: a line with fewer shows its own.)
    const lineList = lineShown(line, verses);
    const lyr: string[][] = lineList.map(() => []);
    const tabs: string[] = [];
    // Words over rests go below them as text when there's no "w:" row to put them in (no note
    // of the line has words): there's nowhere else on the staff for them.
    const restsBelow = withLyrics && (opts.restWords || !lineHasNoteWords(line, lineList));

    const noteText = (midi: number): string => {
      const sp = spell(midi, fifths);
      const key = sp.letter + sp.octave;
      const current = barAcc[key] ?? sig[sp.letter];
      let acc = '';
      if (current !== sp.alter) {
        acc = sp.alter === 0 ? '=' : sp.alter > 0 ? '^'.repeat(sp.alter) : '_'.repeat(-sp.alter);
        barAcc[key] = sp.alter;
      }
      let name: string;
      if (sp.octave >= 5) name = sp.letter.toLowerCase() + "'".repeat(sp.octave - 5);
      else name = sp.letter + ','.repeat(Math.max(0, 4 - sp.octave));
      return acc + name;
    };

    const events = line.events;
    let i = 0;
    while (i < events.length) {
      const e = events[i];
      if (e.kind === 'bar') {
        // ":|x3": "×3" over the bar's last note (ABC has no repeat count of its own).
        if (e.style === 'repeat-end' && e.times && e.times > 2) {
          let k = parts.length - 1;
          while (k >= 0 && BAR_PART.test(parts[k])) k--;
          if (k >= 0) parts[k] = `"^×${e.times}"${parts[k]}`;
        }
        parts.push({ single: '|', double: '||', final: '|]', 'repeat-start': '|:', 'repeat-end': ':|' }[e.style]);
        barAcc = {};
        // (A bar line before any music — the song's opening "|:" — leaves a pickup's place.)
        if (anyMusic) pos = 0;
        beam = null;
        i++;
        continue;
      }
      if (e.beats <= 0) {
        if (e.chord && withChords) parts.push(`"${e.chord}"`);
        i++;
        continue;
      }
      // Tuplet runs: p notes in the time of q (triplets 3:2, quintuplets 5:4 …), written "(3" or "(p:q:n".
      if (!isPlainLength(e.beats, unit)) {
        const ratio = TUPLETS.find(([p, q]) => isPlainLength((e.beats * p) / q, unit));
        if (ratio) {
          const [p, q] = ratio;
          const fits = (ev: TabEvent) => ev.kind !== 'bar' && ev.beats > 0 && !isPlainLength(ev.beats, unit) && isPlainLength((ev.beats * p) / q, unit);
          let n = 0;
          while (n < p && i + n < events.length && fits(events[i + n])) n++;
          const prefix = p === 3 && q === 2 && n === 3 ? '(3' : `(${p}:${q}:${n}`;
          for (let k = 0; k < n; k++) emit(events[i + k] as NoteEvent | RestEvent, li, i + k, k === 0 ? prefix : '', p / q);
          i += n;
          continue;
        }
      }
      emit(e, li, i, '', 1);
      i++;
    }

    function emit(ev: NoteEvent | RestEvent, l: number, ei: number, prefix: string, sc: number) {
      // An ending starts here: its numbers on the bar line before it ("|1", ":|2"), else "[1".
      if (ev.ending?.length) {
        const nums = ev.ending.join(',');
        const k = parts.length - 1;
        if (k >= 0 && /^(\||:\||\|\||\|\])$/.test(parts[k])) parts[k] += nums;
        else parts.push(`[${nums}`);
        beam = null;
      }
      const len = lengthText(ev.beats * sc, unit);
      const chord = ev.chord && withChords ? `"${ev.chord.replace(/"/g, '')}"` : '';
      order.push([l, ei]);
      const start = pos;
      pos += ev.beats;
      anyMusic = true;
      if (ev.kind === 'rest') {
        const words = restsBelow ? lineList.map((v) => lyricOf(ev, v)?.trim().replace(/["/]/g, '').replace(/%/g, '\\%') ?? '') : [];
        const below = words.some(Boolean) ? `"_${words.slice(0, words.map(Boolean).lastIndexOf(true) + 1).join(' / ')}"` : '';
        if (below && opts.restWords) wroteRestWords = true;
        parts.push(`${prefix}${chord}${below}z${len}`);
        lastTieable = null;
        beam = null;
        return;
      }
      const midis = eventMidis(ev, harp);
      if (!midis.length) {
        parts.push(`${prefix}${chord}z${len}`);
        lastTieable = null;
        beam = null;
        return;
      }
      // Shorter than a beat: beamed to the note before when it's in the same beat and follows on.
      const group = Math.floor((start + 1e-6) / beamBeat);
      if (ev.beats < 1 - 1e-6) {
        if (beam && beam.group === group && Math.abs(beam.end - start) < 1e-6) glued.add(parts.length);
        beam = { group, end: pos };
      } else beam = null;
      const body = midis.length === 1 ? noteText(midis[0]) : `[${midis.map(noteText).join('')}]`;
      if (ev.tied && lastTieable !== null) parts[lastTieable] += '-';
      else if (ev.tied && lastTieable === null && !parts.some((p) => /[A-Ga-gz]/.test(p)) && prevLine?.tieable != null) {
        // A tie over the line break: the "-" goes on the last note of the line before.
        prevLine.parts[prevLine.tieable] += '-';
        out[prevLine.at] = lineOf(prevLine.parts, prevLine.glued);
        prevLine.tieable = null;
      }
      parts.push(`${prefix}${chord}${body}${len}`);
      lastTieable = parts.length - 1;
      if (ev.tied) {
        // Tied notes aren't sung or tabbed again, but keep their slot under the staff.
        if (withLyrics) for (const l of lyr) l.push('*');
        tabs.push('*');
        return;
      }
      if (withLyrics)
        lineList.forEach((v, k) => {
          const syl = lyricOf(ev, v);
          // (A syllable that's just a hyphen, or one ending in a literal "‐", is written "\-".)
          const text = syl?.trim();
          lyr[k].push(!text ? (isHeld(ev, v) ? '_' : '*') : text === '-' ? '\\-' : text.replace(/\s+/g, '~').replace(/-(?!$)/g, '\\-').replace(/\u2010/g, '\\-').replace(/[*_|]/g, '').replace(/%/g, '\\%'));
        });
      tabs.push(tabToken(ev));
    }

    out.push(lineOf(parts, glued));
    prevLine = { parts, glued, at: out.length - 1, tieable: lastTieable };
    if (tabLine && tabs.some((t) => t !== '*')) out.push('w: ' + tabs.join(' '));
    // Each verse up to the last with words here (an empty one keeps its row: "w: * *").
    const lastVerse = withLyrics ? lyr.map((l) => l.some((t) => t !== '*')).lastIndexOf(true) : -1;
    for (const verse of lyr.slice(0, lastVerse + 1)) {
      let text = '';
      // (A syllable ending "-" joins the next one; a written "\-" is a hyphen, not a join.)
      for (const syl of verse) text += text === '' || (text.endsWith('-') && !text.endsWith('\\-')) ? syl : ' ' + syl;
      out.push('w: ' + text);
    }
  });
  if (wroteRestWords) out.splice(1, 0, '% HarpForge: words sung over rests are written below the rests');
  return { text: out.join('\n') + '\n', order };
}
