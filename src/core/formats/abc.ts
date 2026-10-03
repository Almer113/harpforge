// ABC notation (https://abcnotation.com/wiki/abc:standard:v2.1): import & export.
//
// Import covers the parts that matter for melodies: header fields, key signatures
// and modes, accidentals (bar-scoped), lengths, broken rhythm, tuplets, ties, chords,
// chord symbols, rests, bars, lyrics (w:) and parts. Only the first tune and first
// voice are read.

import type { Harmonica } from '../instruments';
import { holeSoundText } from '../htab/serializer';
import { beatsPerBar, type BarEvent, type NoteEvent, type RestEvent, type TabDoc, type TabEvent, type TabLine } from '../htab/types';
import type { HoleSound } from '../types';
import { eventMidis, keyFifths, keySignature, LETTER_PC, notesMeta, spell, toFraction, type Imported } from './common';

// ---- Import ---------------------------------------------------------------------

interface PendingNote {
  ev: NoteEvent;
  /** Pitch of a tie-able single note. */
  tieMidi?: number;
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
  let pendingLyricNotes: NoteEvent[] = [];
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
    if (t === 'C') meta.time = '4/4';
    else if (t === 'C|') meta.time = '2/2';
    else if (/^\d+\/\d+$/.test(t)) meta.time = t;
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
    meta.key = k.replace(/\s+(clef|transpose|octave|middle)=.*$/, '').trim();
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

  const attachLyrics = (textLine: string) => {
    // Tokenize: syllables separated by spaces or hyphens; _ * skip; | to next bar (approximate: ignored).
    const notes = pendingLyricNotes;
    let k = 0;
    const re = /(\\-|[^\s\-_*|~]|~)+-?|[_*]|\|/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(textLine)) && k < notes.length) {
      const tok = m[0];
      if (tok === '|') continue;
      if (tok === '_' || tok === '*') {
        k++;
        continue;
      }
      notes[k++].lyric = tok.replace(/\\-/g, '-').replace(/~/g, ' ');
    }
    pendingLyricNotes = [];
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
    const field = /^([A-Za-z]):(.*)$/.exec(trimmed);
    if (field && !/^[|[]/.test(trimmed)) {
      const [, f, v] = field;
      if (f === 'w') {
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
    if (currentVoice && firstVoice && currentVoice !== firstVoice) continue;

    // Music line
    const events: TabEvent[] = [];
    let pendingChord: string | undefined;
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
      // Ties merge into the previous note when the pitch matches.
      if (ev.kind === 'note' && tieOpen && lastNote && tieMidi !== undefined && lastNote.tieMidi === tieMidi && !ev.chord) {
        lastNote.ev.beats += ev.beats;
        tieOpen = false;
        return;
      }
      tieOpen = false;
      events.push(ev);
      if (ev.kind === 'note') {
        lastNote = { ev, tieMidi };
        pendingLyricNotes.push(ev);
      } else lastNote = null;
    };

    while (i < s.length) {
      const c = s[i];
      if (/\s/.test(c) || c === '`' || c === 'y' || c === '\\') {
        i++;
        continue;
      }
      if (c === '"') {
        const j = s.indexOf('"', i + 1);
        const content = s.slice(i + 1, j < 0 ? s.length : j);
        if (content && !/^[\^_<>@]/.test(content)) pendingChord = content.trim();
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
        const m = /^(:*\[?\|+\]?:*|:+\|*:*|\[\d[\d,-]*|\[\|)\d*/.exec(s.slice(i));
        const tok = m ? m[0] : c;
        i += tok.length;
        if (/^\[\d/.test(tok)) continue; // ending marker
        let style: BarEvent['style'] = 'single';
        if (tok.startsWith(':') && tok.endsWith(':')) style = 'repeat-end';
        else if (tok.startsWith(':')) style = 'repeat-end';
        else if (tok.endsWith(':')) style = 'repeat-start';
        else if (tok.includes('||')) style = 'double';
        else if (tok.includes('|]') || tok.includes('[|')) style = 'final';
        events.push({ kind: 'bar', style });
        barAcc = {};
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
        const midi = pitchOf(nm[1], nm[2], nm[3]);
        const beats = unit * 4 * durationOf(nm[4]);
        i += nm[0].length;
        pushNote({ kind: 'note', sounds: [{ type: 'pitch', midi }], beats }, midi);
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
  /** Reference number written in X:. */
  index?: number;
}

const LEN_DENS = [1, 2, 4, 8, 16, 32];

function lengthText(beats: number, unit: number): string {
  const [n, d] = toFraction(beats / (unit * 4), [1, 2, 4, 8, 16, 32, 3, 6, 12, 24]);
  if (n === 1 && d === 1) return '';
  if (d === 1) return String(n);
  if (n === 1 && d === 2) return '/';
  return n === 1 ? `/${d}` : `${n}/${d}`;
}

function isPlainLength(beats: number, unit: number): boolean {
  const [, d] = toFraction(beats / (unit * 4), [1, 2, 3, 4, 6, 8, 12, 16, 24, 32]);
  return LEN_DENS.includes(d);
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
  const fifths = keyFifths(meta.key) ?? 0;
  const keyText = keyFifths(meta.key) !== null ? meta.key! : 'C';
  const unit = 1 / 8;
  const out: string[] = [`X:${opts.index ?? 1}`];
  out.push(`T:${meta.title || 'Untitled'}`);
  if (meta.artist) out.push(`C:${meta.artist}`);
  out.push(`M:${meta.time}`, 'L:1/8', `Q:1/4=${Math.round(meta.tempo)}`, `K:${keyText}`);
  const order: [number, number][] = [];

  doc.lines.forEach((line, li) => {
    if (line.section) out.push(`P:${line.section}`);
    if (!line.events.length) return;
    let barAcc: Record<string, number> = {};
    const sig = keySignature(fifths);
    const parts: string[] = [];
    const lyr: string[] = [];
    const tabs: string[] = [];

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
        parts.push({ single: '|', double: '||', final: '|]', 'repeat-start': '|:', 'repeat-end': ':|' }[e.style]);
        barAcc = {};
        i++;
        continue;
      }
      if (e.beats <= 0) {
        if (e.chord) parts.push(`"${e.chord}"`);
        i++;
        continue;
      }
      // Triplet-ish runs: lengths with a factor of 3 in the denominator.
      let tupletPrefix = '';
      let scale = 1;
      if (!isPlainLength(e.beats, unit)) {
        let n = 0;
        while (n < 3 && i + n < events.length && events[i + n].kind !== 'bar' && !isPlainLength((events[i + n] as NoteEvent).beats, unit)) n++;
        tupletPrefix = n === 3 ? '(3' : `(3:2:${n}`;
        scale = 1.5;
        for (let k = 0; k < n; k++) emit(events[i + k] as NoteEvent | RestEvent, li, i + k, k === 0 ? tupletPrefix : '', scale);
        i += n;
        continue;
      }
      emit(e, li, i, '', 1);
      i++;
    }

    function emit(ev: NoteEvent | RestEvent, l: number, ei: number, prefix: string, sc: number) {
      const len = lengthText(ev.beats * sc, unit);
      const chord = ev.chord ? `"${ev.chord.replace(/"/g, '')}"` : '';
      order.push([l, ei]);
      if (ev.kind === 'rest') {
        parts.push(`${prefix}${chord}z${len}`);
        return;
      }
      const midis = eventMidis(ev, harp);
      if (!midis.length) {
        parts.push(`${prefix}${chord}z${len}`);
        return;
      }
      const body = midis.length === 1 ? noteText(midis[0]) : `[${midis.map(noteText).join('')}]`;
      parts.push(`${prefix}${chord}${body}${len}`);
      if (withLyrics) lyr.push(ev.lyric ? ev.lyric.trim().replace(/\s+/g, '~').replace(/-(?!$)/g, '\\-') : '*');
      tabs.push(tabToken(ev));
    }

    out.push(parts.join(' '));
    if (tabLine && tabs.some((t) => t !== '*')) out.push('w: ' + tabs.join(' '));
    if (withLyrics && lyr.some((t) => t !== '*')) {
      let text = '';
      for (const syl of lyr) text += text === '' || text.endsWith('-') ? syl : ' ' + syl;
      out.push('w: ' + text);
    }
  });
  return { text: out.join('\n') + '\n', order };
}
