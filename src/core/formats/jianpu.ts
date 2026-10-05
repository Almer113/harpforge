// Numbered musical notation (jianpu, 简谱): scale degrees 1–7 relative to the key's
// "do" (1=C, 1=G …), 0 for rests, octave dots, underlines for short notes and
// dashes for held beats. Common for Asian tremolo harmonica music.
//
// Text syntax (import & export):
//   1=G 4/4          key and time (required to tell numbers from hole tabs)
//   5 3 5 - | 6 5 3 - |     a beat each; "-" holds one more beat; "0" rests
//   1' 2'' 5, 6,,    octave up / down (also the combining dots 1̇ and 1̣)
//   #4 b7            sharps / flats
//   5_ 3_  6__       underline: eighth, sixteenth
//   5 - | - 3        a dash after a bar line ties the note across it ("~" also ties)
//   5. 3_            dotted
//   {5 6 5}          a beat split evenly (triplets etc.), as in .htab
//   [G7] w: @ |      chord symbols, lyrics, sections, bars — as in .htab

import type { Harmonica } from '../instruments';
import { keyUsesFlats, mod12, parseKey, parsePitchClass, pitchClassName } from '../pitch';
import type { BarEvent, NoteEvent, RestEvent, TabDoc, TabEvent, TabLine } from '../htab/types';
import { splitLyrics } from '../htab/parser';
import { eventMidis, keyFifths, notesMeta, type Imported } from './common';

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const DOT_ABOVE = '\u0307';
const DOT_BELOW = '\u0323';

/** Pitch class of "do" for a key: the relative major's tonic (Am → C). */
export function doPitchClass(key: string | undefined): number {
  const f = keyFifths(key);
  if (f !== null) return mod12(f * 7);
  const pc = key ? parsePitchClass(key.replace(/^(Low|High)\s+/i, '').trim()) : null;
  return pc ?? 0;
}

/** MIDI of the middle-octave "do" (C4…B4). */
const baseDo = (doPc: number) => 60 + doPc;

export interface Degree {
  degree: number; // 1..7
  accidental: -1 | 0 | 1;
  octave: number; // 0 = middle octave, +1 = one dot above, −1 = one dot below
}

// Chromatic notes as sharps or flats of the nearest degree: #1 b3 #4 #5 b7.
const CHROMATIC: Record<number, [number, -1 | 0 | 1]> = {
  0: [1, 0], 1: [1, 1], 2: [2, 0], 3: [3, -1], 4: [3, 0], 5: [4, 0],
  6: [4, 1], 7: [5, 0], 8: [5, 1], 9: [6, 0], 10: [7, -1], 11: [7, 0],
};

export function midiToDegree(midi: number, doPc: number): Degree {
  const base = baseDo(doPc);
  const s = mod12(midi - base);
  const [degree, accidental] = CHROMATIC[s];
  return { degree, accidental, octave: Math.floor((midi - base) / 12) };
}

export function degreeToMidi(d: Degree, doPc: number): number {
  return baseDo(doPc) + d.octave * 12 + MAJOR[d.degree - 1] + d.accidental;
}

/** Plain-text spelling of one degree: "#4'", "b7,", "5". */
export function degreeText(d: Degree): string {
  const acc = d.accidental > 0 ? '#' : d.accidental < 0 ? 'b' : '';
  const oct = d.octave > 0 ? "'".repeat(d.octave) : ','.repeat(-d.octave);
  return acc + d.degree + oct;
}

// ---- Detection & import --------------------------------------------------------------

const KEY_LINE = /(?:^|\s)1\s*=\s*([#b♯♭]?\s*[A-Ga-g][#b♯♭]?)(?![a-z])/;

export function looksLikeJianpu(text: string): boolean {
  return /^\s*(?:[^\n]*\s)?1\s*=\s*[#b♯♭]?[A-Ga-g]/m.test(text) || new RegExp(`[0-7][${DOT_ABOVE}${DOT_BELOW}]`).test(text);
}

function readKey(raw: string): string | undefined {
  const k = raw.replace(/\s+/g, '').replace('♯', '#').replace('♭', 'b');
  // "1=bB" / "1=#F" (accidental first) or "1=Bb".
  const m = /^([#b]?)([A-Ga-g])([#b]?)$/.exec(k);
  if (!m) return undefined;
  return m[2].toUpperCase() + (m[1] || m[3]);
}

export function parseJianpu(text: string): Imported {
  const warnings: string[] = [];
  const meta = notesMeta({ tempo: 90 });
  let doPc = 0;
  const lines: TabLine[] = [];
  let pendingSection: string | undefined;
  let lastLine: TabLine | undefined;
  let inHeader = false;
  const tieCtx: TieContext = { last: null };

  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    let line = raw.replace(/\s+$/, '');
    const trimmed = line.trim();
    // A comment ("# …"), but not a line starting with a sharp degree ("#1 2 3").
    if (!trimmed || /^#(?![1-7])/.test(trimmed)) continue;
    if (trimmed === '---') {
      inHeader = !inHeader;
      continue;
    }
    const field = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(trimmed);
    if (field && field[1].toLowerCase() !== 'w') {
      const [, k, v] = field;
      const key = k.toLowerCase();
      if (key === 'title') meta.title = v;
      else if (key === 'artist' || key === 'composer') meta.artist = v;
      else if (key === 'tempo' || key === 'bpm') meta.tempo = parseFloat(v) || meta.tempo;
      else if (key === 'time' || key === 'meter') meta.time = v;
      else if (key === 'key') {
        meta.key = v;
        doPc = doPitchClass(v);
      } else if (key === 'harmonica' || key === 'tuning' || key === 'harp-key') {
        (meta as unknown as Record<string, string>)[key === 'harp-key' ? 'harpKey' : key] = v;
      }
      continue;
    }
    if (inHeader) continue;

    // Key / time / tempo line: "1=G 3/4 ♩=96"
    const keyM = KEY_LINE.exec(line);
    if (keyM) {
      const key = readKey(keyM[1]);
      if (key) {
        meta.key ??= key;
        doPc = doPitchClass(key);
      }
      const time = /(\d+)\s*\/\s*(\d+)/.exec(line);
      if (time) meta.time = `${time[1]}/${time[2]}`;
      const tempo = /(?:♩|q|bpm|tempo)\s*=?\s*(\d{2,3})|(\d{2,3})\s*bpm/i.exec(line);
      if (tempo) meta.tempo = parseInt(tempo[1] ?? tempo[2], 10);
      line = line.replace(KEY_LINE, ' ').replace(/(\d+)\s*\/\s*(\d+)/, ' ').replace(/(?:♩|q|bpm|tempo)\s*=?\s*\d{2,3}|\d{2,3}\s*bpm/gi, ' ');
      if (!line.trim()) continue;
    }
    if (trimmed.startsWith('@')) {
      pendingSection = trimmed.slice(1).trim();
      continue;
    }
    if (/^w:/i.test(trimmed)) {
      if (lastLine) {
        const syl = splitLyrics(trimmed.slice(2));
        let k = 0;
        for (const ev of lastLine.events) {
          if (ev.kind !== 'note' || ev.tied || k >= syl.length) continue;
          const s = syl[k++];
          if (s !== '*' && s !== '_') ev.lyric = s;
        }
      }
      continue;
    }

    const events = parseLine(line, doPc, warnings, tieCtx);
    if (!events.length) continue;
    const tl: TabLine = { events };
    if (pendingSection !== undefined) {
      tl.section = pendingSection;
      pendingSection = undefined;
    }
    lines.push(tl);
    lastLine = tl;
  }
  if (!lines.length) warnings.push('No numbered notes found.');
  return { doc: { meta, lines }, warnings: [...new Set(warnings)], format: 'Numbered notation' };
}

/** The last note or rest read, across bars and lines, so dashes and "~" can tie to it. */
interface TieContext {
  last: NoteEvent | RestEvent | null;
}

function parseLine(s: string, doPc: number, warnings: string[], ctx: TieContext): TabEvent[] {
  const events: TabEvent[] = [];
  let pendingChord: string | undefined;
  let group: (NoteEvent | RestEvent)[] | null = null;
  const last = () => {
    const e = events[events.length - 1];
    return e && e.kind !== 'bar' ? e : undefined;
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c) || c === '(' || c === ')') {
      i++;
      continue;
    }
    if (c === '|' || (c === ':' && s[i + 1] === '|')) {
      let style: BarEvent['style'] = 'single';
      let len = 1;
      if (s.startsWith(':|', i)) [style, len] = ['repeat-end', 2];
      else if (s.startsWith('||', i)) [style, len] = ['double', 2];
      else if (s.startsWith('|]', i)) [style, len] = ['final', 2];
      else if (s.startsWith('|:', i)) [style, len] = ['repeat-start', 2];
      // A chord symbol right before a bar line, with no note after it, marks the end of its bar.
      if (pendingChord && !group) {
        events.push({ kind: 'rest', beats: 0, chord: pendingChord });
        pendingChord = undefined;
      }
      events.push({ kind: 'bar', style });
      i += len;
      continue;
    }
    if (c === '[') {
      const j = s.indexOf(']', i);
      if (j > i) pendingChord = s.slice(i + 1, j).trim() || undefined;
      i = j > i ? j + 1 : i + 1;
      continue;
    }
    if (c === '{') {
      group = [];
      i++;
      continue;
    }
    if (c === '}') {
      // A group lasts one beat, plus one per "~" after it, divided by an optional "/N"
      // ("{5 6 7}/2" = half a beat); items share it by weight.
      let tildes = 0;
      while (s[i + 1 + tildes] === '~') tildes++;
      const div = /^\/(\d{1,2})/.exec(s.slice(i + 1 + tildes));
      const total = (1 + tildes) / (div ? Math.max(1, parseInt(div[1], 10)) : 1);
      if (group && group.length) {
        const sum = group.reduce((a, e) => a + e.beats, 0);
        for (const e of group) e.beats = (total * e.beats) / sum;
        events.push(...group);
      }
      group = null;
      i += 1 + tildes + (div ? div[0].length : 0);
      continue;
    }
    if (c === '-' || c === '–' || c === '—') {
      const prev = group ? group[group.length - 1] : last();
      if (prev) prev.beats += 1;
      else if (ctx.last) {
        // A dash after a bar line: the note is tied across it.
        const tie: NoteEvent | RestEvent =
          ctx.last.kind === 'note' ? { kind: 'note', sounds: ctx.last.sounds, beats: 1, tied: true } : { kind: 'rest', beats: 1 };
        events.push(tie);
        ctx.last = tie;
      }
      i++;
      continue;
    }
    const m = new RegExp(`^([#b♯♭]*)([0-7~])([',${DOT_ABOVE}${DOT_BELOW}’]*)([_.~]*)`).exec(s.slice(i));
    if (m) {
      i += m[0].length;
      if (m[2] === '~') {
        // "~": a tie (keeps the previous note sounding), with the usual length marks.
        let beats = 1;
        for (const ch of m[4]) {
          if (ch === '_') beats /= 2;
          else if (ch === '~') beats += 1;
        }
        if (m[4].includes('.')) beats *= 1.5;
        const prevNote = ctx.last;
        const tie: NoteEvent | RestEvent =
          prevNote && prevNote.kind === 'note' ? { kind: 'note', sounds: prevNote.sounds, beats, tied: true } : { kind: 'rest', beats };
        if (pendingChord) {
          tie.chord = pendingChord;
          pendingChord = undefined;
        }
        if (group) group.push(tie);
        else events.push(tie);
        ctx.last = tie;
        continue;
      }
      const digit = parseInt(m[2], 10);
      let beats = 1;
      for (const ch of m[4]) {
        if (ch === '_') beats /= 2;
        else if (ch === '~') beats += 1;
      }
      if (m[4].includes('.')) beats *= 1.5;
      let accidental = 0;
      for (const ch of m[1]) accidental += ch === '#' || ch === '♯' ? 1 : -1;
      let octave = 0;
      for (const ch of m[3]) octave += ch === "'" || ch === '’' || ch === DOT_ABOVE ? 1 : -1;
      const ev: NoteEvent | RestEvent =
        digit === 0
          ? { kind: 'rest', beats }
          : {
              kind: 'note',
              beats,
              sounds: [
                {
                  type: 'pitch',
                  midi: degreeToMidi(
                    { degree: digit, accidental: Math.max(-1, Math.min(1, accidental)) as -1 | 0 | 1, octave },
                    doPc,
                  ),
                },
              ],
            };
      if (pendingChord) {
        ev.chord = pendingChord;
        pendingChord = undefined;
      }
      if (group) group.push(ev);
      else events.push(ev);
      ctx.last = ev;
      continue;
    }
    warnings.push(`Skipped "${c}" in numbered notation`);
    i++;
  }
  // A chord symbol at the end of the line: a marker at the end of the bar.
  if (pendingChord) events.push({ kind: 'rest', beats: 0, chord: pendingChord });
  return events;
}

// ---- Export ---------------------------------------------------------------------------

/** Duration spelling for one note: suffix underlines/dot and number of trailing dashes. */
export function durationSpelling(beats: number): { suffix: string; dashes: number } | null {
  const table: [number, string, number][] = [
    [0.25, '__', 0], [0.375, '__.', 0], [0.5, '_', 0], [0.75, '_.', 0], [1, '', 0], [1.5, '.', 0],
  ];
  for (const [b, suffix, dashes] of table) if (Math.abs(beats - b) < 1e-6) return { suffix, dashes };
  if (Math.abs(beats - Math.round(beats)) < 1e-6 && beats >= 1) return { suffix: '', dashes: Math.round(beats) - 1 };
  return null;
}

/** A group's length after its "}": "~" per extra beat, and "/N" for part of a beat ("~~/2" = 1½ beats). */
function groupLength(sum: number): string {
  const isInt = (x: number) => Math.abs(x - Math.round(x)) < 1e-6;
  if (isInt(sum) && sum >= 1 - 1e-6) return '~'.repeat(Math.round(sum) - 1);
  for (let n = 2; n < 100; n++) if (isInt(sum * n)) return '~'.repeat(Math.max(0, Math.round(sum * n) - 1)) + '/' + n;
  return '~'.repeat(Math.max(0, Math.round(sum) - 1));
}

export function writeJianpu(doc: TabDoc, harp?: Harmonica): string {
  const { meta } = doc;
  const key = meta.key ?? harp?.spec.key.replace(/^(Low|High)\s+/i, '') ?? 'C';
  const doPc = doPitchClass(key);
  const out: string[] = [];
  if (meta.title) out.push(`title: ${meta.title}`);
  if (meta.artist) out.push(`artist: ${meta.artist}`);
  // "1=" names do, the relative major's tonic: a minor or modal key is written as its own line.
  const mode = parseKey(key)?.mode ?? 'major';
  if (mode !== 'major') out.push(`key: ${key}`);
  out.push(`1=${pitchClassName(doPc, keyUsesFlats(key))} ${meta.time} ♩=${Math.round(meta.tempo)}`, '');
  for (const line of doc.lines) {
    if (line.section) out.push(`@ ${line.section}`);
    if (!line.events.length) continue;
    const parts: string[] = [];
    const lyrics: string[] = [];
    const events = line.events;
    let i = 0;
    const tokenFor = (e: NoteEvent | RestEvent, scaleBeats: number | null): string => {
      const chord = e.chord ? `[${e.chord}]` : '';
      const midis = e.kind === 'note' ? eventMidis(e, harp) : [];
      if (e.kind === 'note' && e.tied) {
        // A tie: dashes for whole beats (the usual way), "~" otherwise.
        if (scaleBeats === null && Math.abs(e.beats - Math.round(e.beats)) < 1e-6 && e.beats >= 1) return chord + Array(Math.round(e.beats)).fill('-').join(' ');
        if (scaleBeats !== null) return chord + '~' + '~'.repeat(Math.max(0, Math.round(scaleBeats) - 1));
        const sp = durationSpelling(e.beats);
        return chord + '~' + (sp ? sp.suffix : '');
      }
      const core = midis.length ? degreeText(midiToDegree(midis[midis.length - 1], doPc)) : '0';
      // A note the harp can't play is written as a rest ("0"), which takes no syllable.
      if (e.kind === 'note' && midis.length) lyrics.push(e.lyric ? e.lyric.trim().replace(/\s+/g, '~').replace(/-(?!$)/g, '\\-') : '*');
      if (scaleBeats !== null) return chord + core + '~'.repeat(Math.max(0, Math.round(scaleBeats) - 1));
      const sp = durationSpelling(e.beats)!;
      return chord + core + sp.suffix + ' -'.repeat(sp.dashes);
    };
    while (i < events.length) {
      const e = events[i];
      if (e.kind === 'bar') {
        parts.push({ single: '|', double: '||', final: '|]', 'repeat-start': '|:', 'repeat-end': ':|' }[e.style]);
        i++;
        continue;
      }
      if (e.beats <= 0) {
        if (e.chord) parts.push(`[${e.chord}]`);
        i++;
        continue;
      }
      if (durationSpelling(e.beats)) {
        parts.push(tokenFor(e, null));
        i++;
        continue;
      }
      // Odd rhythms (triplets…): a { } group adding up to whole beats.
      // (It stops at a bar line or a chord symbol on its own; one that ends off the beat gets "/N".)
      const group: (NoteEvent | RestEvent)[] = [];
      let sum = 0;
      const wholeBeats = (e: TabEvent) => e.kind !== 'bar' && e.beats >= 1 - 1e-6 && Math.abs(e.beats - Math.round(e.beats)) < 1e-6;
      while (i < events.length && events[i].kind !== 'bar' && (events[i] as NoteEvent | RestEvent).beats > 0 && (group.length === 0 || (Math.abs(sum - Math.round(sum)) > 1e-6 && !wholeBeats(events[i])))) {
        const g = events[i] as NoteEvent | RestEvent;
        group.push(g);
        sum += g.beats;
        i++;
      }
      // Each note's share of the group in whole units (⅔ + ⅓ → 2 and 1; 0.4 + 0.6 → 2 and 3).
      const isInt = (x: number) => Math.abs(x - Math.round(x)) < 1e-6;
      const d = Array.from({ length: 96 }, (_, k) => k + 1).find((n) => group.every((g) => isInt(g.beats * n)));
      const units = d ? group.map((g) => Math.max(1, Math.round(g.beats * d))) : group.map((g) => Math.max(1, Math.round((g.beats / sum) * 48)));
      const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
      const g0 = units.reduce(gcd);
      parts.push('{' + group.map((g, k) => tokenFor(g, units[k] / g0)).join(' ') + '}' + groupLength(sum));
    }
    out.push(parts.join(' '));
    if (lyrics.some((l) => l !== '*')) {
      let text = '';
      for (const syl of lyrics) text += text === '' || text.endsWith('-') ? syl : ' ' + syl;
      out.push('w: ' + text);
    }
  }
  return out.join('\n') + '\n';
}
