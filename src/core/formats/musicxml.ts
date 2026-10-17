// MusicXML import & export. Import reads one part's one voice — the most melody-like, or the
// one picked under Part — from partwise files and (rearranged to that) timewise ones.

import { hasWords, isHeld, lineVerses, lyricOf, setHeld, setLyricOf } from '../verses';
import { strFromU8, unzipSync } from 'fflate';
import { isNoChord, parseChord } from '../chords';
import type { Harmonica } from '../instruments';
import { holeSoundText } from '../htab/serializer';
import { beatsPerBar, type BarStyle, type NoteEvent, type RestEvent, type TabDoc, type TabEvent, type TabLine } from '../htab/types';
import { keyFromSignature, parseKey } from '../pitch';
import type { HoleSound } from '../types';
import { eventMidis, keyFifths, melodyScore, notesMeta, partWarning, spell, type Imported, type PartChoice } from './common';

const STEP_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

const KIND_SUFFIX: Record<string, string> = {
  major: '', minor: 'm', augmented: 'aug', diminished: 'dim', dominant: '7', 'major-seventh': 'maj7',
  'minor-seventh': 'm7', 'diminished-seventh': 'dim7', 'augmented-seventh': '7#5', 'half-diminished': 'm7b5',
  'major-minor': 'm(maj7)', 'major-sixth': '6', 'minor-sixth': 'm6', 'dominant-ninth': '9', 'major-ninth': 'maj9',
  'minor-ninth': 'm9', 'dominant-11th': '11', 'minor-11th': 'm11', 'dominant-13th': '13', 'suspended-second': 'sus2',
  'suspended-fourth': 'sus4', power: '5',
};

/** Unpacks a compressed .mxl into the main score XML. */
export function unzipMxl(data: Uint8Array): string {
  const files = unzipSync(data);
  const container = files['META-INF/container.xml'];
  if (container) {
    const m = /full-path="([^"]+)"/.exec(strFromU8(container));
    if (m && files[m[1]]) return strFromU8(files[m[1]]);
  }
  const name = Object.keys(files).find((n) => !n.startsWith('META-INF') && /\.(xml|musicxml)$/i.test(n));
  if (!name) throw new Error('No score found inside the .mxl file.');
  return strFromU8(files[name]);
}

const child = (el: Element, name: string) => el.getElementsByTagName(name)[0] as Element | undefined;
const text = (el: Element | undefined, name: string) => (el ? child(el, name)?.textContent?.trim() : undefined);

/**
 * A MusicXML score: the part and voice asked for (`part`: "2:1", the third part's voice 1), or
 * else the most melody-like of them all; the others are offered under Part.
 */
export function parseMusicXml(xml: string, opts: { part?: string } = {}): Imported {
  let dom = new DOMParser().parseFromString(xml, 'application/xml');
  if (dom.getElementsByTagName('parsererror').length) throw new Error('This MusicXML file could not be read.');
  if (dom.documentElement.nodeName === 'score-timewise') dom = partwise(dom);
  const parts = [...dom.getElementsByTagName('part')];
  if (!parts.length) throw new Error('No parts found in this MusicXML file.');
  // Each part's name (from the part list) and the voices its notes are in.
  const names = new Map([...dom.getElementsByTagName('score-part')].map((sp) => [sp.getAttribute('id') ?? '', text(sp, 'part-name') ?? '']));
  const options: (PartChoice & { pi: number; voice: string | null; name: string })[] = [];
  parts.forEach((part, pi) => {
    const name = names.get(part.getAttribute('id') ?? '')?.trim() ?? '';
    const voices = [...new Set([...part.getElementsByTagName('note')].filter((n) => !child(n, 'grace') && !child(n, 'cue')).map((n) => text(n, 'voice') ?? '1'))];
    const label = name || `Part ${pi + 1}`;
    if (voices.length <= 1) options.push({ id: `${pi}`, label, pi, voice: null, name });
    else for (const v of voices) options.push({ id: `${pi}:${v}`, label: `${label} · voice ${v}`, pi, voice: v, name });
  });
  const read = (o: (typeof options)[number]) => parsePart(dom, parts[o.pi], o.voice);
  let chosen = options.find((o) => o.id === opts.part);
  let result = chosen ? read(chosen) : null;
  if (!chosen || !result) {
    let best = -Infinity;
    for (const o of options) {
      const r = read(o);
      const score = melodyScore(r.doc, o.name);
      if (!result || score > best) {
        best = score;
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
    choosePart: (id) => parseMusicXml(xml, { part: id }),
  };
}

/**
 * A timewise score (measure by measure, each holding every part's bit) as a partwise one (part
 * by part, each holding its measures): the same music, the way the rest of the import reads it.
 */
function partwise(dom: Document): Document {
  const src = dom.documentElement;
  const out = dom.implementation.createDocument(null, 'score-partwise', null);
  const root = out.documentElement;
  for (const a of src.attributes) root.setAttribute(a.name, a.value);
  const measures = [...src.children].filter((c) => c.nodeName === 'measure');
  for (const c of src.children) if (c.nodeName !== 'measure') root.appendChild(out.importNode(c, true));
  const ids: string[] = [];
  for (const m of measures) for (const p of m.children) if (p.nodeName === 'part' && !ids.includes(p.getAttribute('id') ?? '')) ids.push(p.getAttribute('id') ?? '');
  for (const id of ids) {
    const part = out.createElement('part');
    part.setAttribute('id', id);
    for (const m of measures) {
      const mine = [...m.children].find((p) => p.nodeName === 'part' && p.getAttribute('id') === id);
      const measure = out.createElement('measure');
      for (const a of m.attributes) measure.setAttribute(a.name, a.value);
      if (mine) for (const c of mine.childNodes) measure.appendChild(out.importNode(c, true));
      part.appendChild(measure);
    }
    root.appendChild(part);
  }
  return out;
}

/** One part of a score, one voice of it (the first if `wanted` is null). */
function parsePart(dom: Document, part: Element, wanted: string | null): Imported {
  const warnings: string[] = [];
  const meta = notesMeta({ tempo: 100 });
  meta.title = text(dom.documentElement, 'work-title') || text(dom.documentElement, 'movement-title') || undefined;
  const creator = [...dom.getElementsByTagName('creator')].find((c) => c.getAttribute('type') === 'composer') ?? dom.getElementsByTagName('creator')[0];
  if (creator?.textContent?.trim()) meta.artist = creator.textContent.trim();

  // Its lyric lines (numbered 1, 2…, or named), in order: verse 1, 2…
  const numbers = [...new Set([...part.getElementsByTagName('lyric')].filter((l) => l.getAttribute('name') !== 'tab').map((l) => l.getAttribute('number') ?? '1'))];
  // (Numbered: verse n is number n, an empty verse 1 included; named: in order of appearance.)
  const numbered = numbers.every((n) => /^\d+$/.test(n) && Number(n) >= 1);
  const verseOf = new Map(numbers.map((n, k) => [n, numbered ? Number(n) - 1 : k]));
  /**
   * Each verse's extender under way: a syllable with <extend> holds over the notes after it
   * ("Oh___") — those with an extend of their own, or (as most programs write it) with no
   * words in that verse — up to the next words, a rest, or an extend "stop".
   */
  const extending = new Map<number, boolean>();
  /** A note's (or rest's) lyric lines, as verses. */
  const readLyrics = (el: Element, ev: NoteEvent | RestEvent) => {
    const seen = new Set<number>();
    for (const lyric of el.getElementsByTagName('lyric')) {
      if (lyric.getAttribute('name') === 'tab') continue;
      const v = verseOf.get(lyric.getAttribute('number') ?? '1');
      if (v === undefined) continue;
      const t = text(lyric, 'text');
      const syl = text(lyric, 'syllabic');
      const extend = lyric.getElementsByTagName('extend')[0];
      const goesOn = !!extend && extend.getAttribute('type') !== 'stop';
      if (t) {
        if (!lyricOf(ev, v)) setLyricOf(ev, v, t + (syl === 'begin' || syl === 'middle' ? '-' : ''));
        extending.set(v, goesOn);
        seen.add(v);
      } else if (extend) {
        // (Held over a rest too: the rest is sung, the word goes on over it.)
        setHeld(ev, v, true);
        extending.set(v, goesOn);
        seen.add(v);
      }
    }
    for (const [v, on] of extending) {
      if (!on || seen.has(v)) continue;
      // (A rest ends it, and so does a note where another verse has words — an extender left
      // open at a verse's end doesn't run into the next part; else a note with no words is held.)
      if (ev.kind === 'rest' || seen.size > 0) extending.set(v, false);
      else setHeld(ev, v, true);
    }
  };

  let divisions = 1;
  let voice: string | null = wanted;
  const lines: TabLine[] = [];
  let events: TabEvent[] = [];
  let pendingChord: string | undefined;
  let last: NoteEvent | null = null;
  let tempoSet = false;
  let measuresInLine = 0;
  // Lines follow the file's system breaks when it has any (our own export writes them).
  const explicitBreaks = [...part.getElementsByTagName('print')].some((p) => p.getAttribute('new-system') === 'yes' || p.getAttribute('new-page') === 'yes');
  let timeSet = false;
  // Position in the measure, and how far our voice has got: notes stacked under it
  // after a <backup> (another voice without a <voice> tag) are skipped.
  let pos = 0;
  let end = 0;
  const warned = new Set<string>();
  const warnOnce = (w: string) => {
    if (!warned.has(w)) {
      warned.add(w);
      warnings.push(w);
    }
  };

  for (const measure of part.getElementsByTagName('measure')) {
    pos = 0;
    end = 0;
    const print = child(measure, 'print');
    if (print && (print.getAttribute('new-system') === 'yes' || print.getAttribute('new-page') === 'yes') && events.length) {
      lines.push({ events });
      events = [];
      measuresInLine = 0;
    }
    // A repeat starting here ("|:" on the measure's left): the bar line before it becomes one
    // (after a ":|", or at the start of a line, it's a bar line of its own).
    const barlines = [...measure.getElementsByTagName('barline')];
    const left = barlines.find((b) => b.getAttribute('location') === 'left');
    if (left && child(left, 'repeat')?.getAttribute('direction') === 'forward') {
      const before = events.at(-1);
      if (before?.kind === 'bar' && before.style === 'single') before.style = 'repeat-start';
      else events.push({ kind: 'bar', style: 'repeat-start' });
    }
    // An ending starting here ("1." / "1, 2"): on the measure's first note or rest, once it's read.
    const endingEl = barlines.map((b) => child(b, 'ending')).find((e) => e?.getAttribute('type') === 'start');
    const endingNums = endingEl
      ? [...new Set((endingEl.getAttribute('number') ?? '').split(/[,\s]+/).map(Number).filter((n) => Number.isInteger(n) && n >= 1))].sort((a, b) => a - b)
      : [];
    const measureFrom = events.length;
    for (const el of measure.children) {
      switch (el.nodeName) {
        case 'attributes': {
          const div = text(el, 'divisions');
          if (div) divisions = parseInt(div, 10) || divisions;
          const fifths = text(el, 'fifths');
          if (fifths !== undefined && !meta.key) {
            // Modes too: no sharps or flats + dorian is D dorian, not C.
            meta.key = keyFromSignature(parseInt(fifths, 10), text(el, 'mode'));
          }
          const beats = text(el, 'beats');
          const beatType = text(el, 'beat-type');
          if (beats && beatType) {
            // A tab has one time signature: keep the first.
            if (!timeSet) meta.time = `${beats}/${beatType}`;
            else if (`${beats}/${beatType}` !== meta.time) warnOnce(`The time signature changes to ${beats}/${beatType} during the piece; the tab keeps ${meta.time}.`);
            timeSet = true;
          }
          break;
        }
        case 'backup': {
          pos -= parseFloat(text(el, 'duration') ?? '0') / divisions;
          break;
        }
        case 'forward': {
          // A forward in our own voice is a silent stretch (a hidden rest).
          const beats = parseFloat(text(el, 'duration') ?? '0') / divisions;
          const v = text(el, 'voice');
          if ((!v || v === voice) && pos >= end - 1e-6 && beats > 0) {
            events.push({ kind: 'rest', beats });
            last = null;
            end = pos + beats;
          }
          pos += beats;
          break;
        }
        case 'direction':
        case 'sound': {
          const sound = el.nodeName === 'sound' ? el : child(el, 'sound');
          const perMinute = el.nodeName === 'direction' ? text(el, 'per-minute') : undefined;
          const unit = el.nodeName === 'direction' ? text(el, 'beat-unit') : undefined;
          const unitBeats = unit === 'half' ? 2 : unit === 'eighth' ? 0.5 : unit === 'whole' ? 4 : 1;
          const tempo = sound?.getAttribute('tempo') ?? (perMinute ? String(parseFloat(perMinute) * unitBeats * (child(el, 'beat-unit-dot') ? 1.5 : 1)) : undefined);
          if (tempo && !tempoSet && parseFloat(tempo) > 0) {
            meta.tempo = Math.round(parseFloat(tempo));
            tempoSet = true;
          }
          // A rehearsal mark starts a section, on a new line wherever it falls.
          const words = el.nodeName === 'direction' ? text(el, 'rehearsal') : undefined;
          if (words) {
            if (events.length) {
              lines.push({ events });
              events = [];
              measuresInLine = 0;
            }
            lines.push({ section: words, events: [] });
          }
          break;
        }
        case 'harmony': {
          if (child(el, 'kind')?.textContent?.trim() === 'none') {
            pendingChord = 'N.C.';
            break;
          }
          const root = text(el, 'root-step');
          if (!root) break;
          const alter = parseFloat(text(el, 'root-alter') ?? '0');
          const kindEl = child(el, 'kind');
          const kindText = kindEl?.getAttribute('text');
          const suffix = kindText ?? KIND_SUFFIX[kindEl?.textContent?.trim() ?? 'major'] ?? '';
          const bassStep = text(el, 'bass-step');
          const bassAlter = parseFloat(text(el, 'bass-alter') ?? '0');
          const acc = (a: number) => (a > 0 ? '#'.repeat(a) : 'b'.repeat(-a));
          pendingChord = root + acc(alter) + suffix + (bassStep ? '/' + bassStep + acc(bassAlter) : '');
          break;
        }
        case 'note': {
          if (child(el, 'grace') || child(el, 'cue')) break;
          const v = text(el, 'voice') ?? '1';
          voice ??= v;
          const isChord = !!child(el, 'chord');
          const dur = parseFloat(text(el, 'duration') ?? '0');
          const beats = dur / divisions;
          const at = pos;
          if (!isChord) pos += beats;
          if (v !== voice) break;
          // Behind where our voice has got to: a second layer of music (after a <backup>).
          if (!isChord && at < end - 1e-6) {
            warnOnce('Only the top line of music was imported (the part has several layers).');
            break;
          }
          if (!isChord) end = Math.max(end, pos);
          const pitchEl = child(el, 'pitch');
          let midi: number | null = null;
          if (pitchEl) {
            const step = text(pitchEl, 'step')!;
            const alter = parseFloat(text(pitchEl, 'alter') ?? '0');
            const octave = parseInt(text(pitchEl, 'octave') ?? '4', 10);
            midi = (octave + 1) * 12 + STEP_PC[step] + Math.round(alter);
          }
          if (isChord && last && midi !== null) {
            if (!last.sounds.some((s) => s.type === 'pitch' && s.midi === midi)) last.sounds.push({ type: 'pitch', midi });
            break;
          }
          const tieStop = [...el.getElementsByTagName('tie')].some((t) => t.getAttribute('type') === 'stop');
          // A tie continues the note (or chord) before it.
          if (tieStop && last && midi !== null && last.sounds.some((s) => s.type === 'pitch' && s.midi === midi)) {
            // Within a measure the tie just lengthens the note; across a bar line it stays a tie.
            const idx = events.lastIndexOf(last);
            if (idx >= 0 && !events.slice(idx + 1).some((e) => e.kind === 'bar')) {
              last.beats += beats;
              break;
            }
            const tiedEv: NoteEvent = { kind: 'note', sounds: last.sounds, beats, tied: true };
            events.push(tiedEv);
            last = tiedEv;
            break;
          }
          if (midi === null) {
            const rest: RestEvent = { kind: 'rest', beats };
            if (pendingChord) rest.chord = pendingChord;
            pendingChord = undefined;
            // Words sung over a rest: a sung rest ("_").
            readLyrics(el, rest);
            if (hasWords(rest)) rest.sung = true;
            events.push(rest);
            last = null;
            break;
          }
          const ev: NoteEvent = { kind: 'note', sounds: [{ type: 'pitch', midi }], beats };
          if (pendingChord) ev.chord = pendingChord;
          pendingChord = undefined;
          // Each lyric line (number 1, 2, …) is a verse; the tab HarpForge writes under the staff isn't.
          readLyrics(el, ev);
          events.push(ev);
          last = ev;
          break;
        }
      }
    }
    // A chord symbol after the last note of a measure marks the end of that measure.
    if (pendingChord) {
      events.push({ kind: 'rest', beats: 0, chord: pendingChord });
      pendingChord = undefined;
    }
    // Bar line at the end of each measure.
    const barline = [...measure.getElementsByTagName('barline')].find((b) => (b.getAttribute('location') ?? 'right') === 'right');
    const style = text(barline, 'bar-style');
    if (endingNums.length) {
      const first = events.slice(measureFrom).find((e): e is NoteEvent | RestEvent => e.kind !== 'bar' && e.beats > 0);
      if (first) first.ending = endingNums;
    }
    const repeatEl = barline ? child(barline, 'repeat') : undefined;
    const repeat = repeatEl?.getAttribute('direction');
    const times = Number(repeatEl?.getAttribute('times'));
    // An ending that stops here without going back: a "||", the tab's way of ending one there.
    const endingStops = !!barline && ['stop', 'discontinue'].includes(child(barline, 'ending')?.getAttribute('type') ?? '');
    const plain = style === 'light-heavy' ? 'final' : style === 'light-light' || endingStops ? 'double' : 'single';
    events.push({ kind: 'bar', style: repeat === 'backward' ? 'repeat-end' : plain, ...(repeat === 'backward' && times > 2 ? { times } : {}) });
    measuresInLine++;
    if (!explicitBreaks && measuresInLine >= 4) {
      lines.push({ events });
      events = [];
      measuresInLine = 0;
    }
  }
  if (events.length) lines.push({ events });
  return { doc: { meta, lines }, warnings, format: 'MusicXML' };
}

// ---- Export ---------------------------------------------------------------------

// Divisible by 3, 5, 7 and 16, so triplets, quintuplets and septuplets come out exact.
const DIVISIONS = 1680;
const TYPES: [number, string][] = [
  [4, 'whole'], [2, 'half'], [1, 'quarter'], [0.5, 'eighth'], [0.25, '16th'], [0.125, '32nd'],
];

function noteType(beats: number): { type: string; dots: number } | null {
  for (const [len, name] of TYPES) {
    if (Math.abs(beats - len) < 1e-6) return { type: name, dots: 0 };
    if (Math.abs(beats - len * 1.5) < 1e-6) return { type: name, dots: 1 };
    if (Math.abs(beats - len * 1.75) < 1e-6) return { type: name, dots: 2 };
  }
  return null;
}

/** How to notate a length: a plain (dotted) note, a tuplet note (triplets, quintuplets…), or neither. */
function notation(beats: number): { type: string; dots: number; tuplet?: [number, number] } | null {
  const plain = noteType(beats);
  if (plain) return plain;
  for (const [actual, normal] of [[3, 2], [5, 4], [6, 4], [7, 4], [3, 4]] as [number, number][]) {
    const t = noteType((beats * actual) / normal);
    if (t) return { ...t, tuplet: [actual, normal] };
  }
  return null;
}

/** Splits a length nobody can write as one note into notatable pieces (to be tied). */
function splitLength(beats: number): number[] {
  const out: number[] = [];
  let left = beats;
  const sizes = [4, 3, 2, 1.5, 1, 0.75, 0.5, 0.375, 0.25, 0.125];
  for (let guard = 0; left > 1e-6 && guard < 32; guard++) {
    // What's left may be a tuplet value (⅔ of a beat…): write it as one note.
    if (notation(left)) {
      out.push(left);
      break;
    }
    const size = sizes.find((s) => s <= left + 1e-6 && (notation(left - s) || left - s > 0.125 - 1e-6)) ?? sizes.find((s) => s <= left + 1e-6) ?? left;
    out.push(Math.min(size, left));
    left -= Math.min(size, left);
  }
  return out;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function harmonyXml(symbol: string): string {
  if (isNoChord(symbol)) return '<harmony><root><root-step>C</root-step></root><kind text="N.C.">none</kind></harmony>';
  const info = parseChord(symbol);
  if (!info) return '';
  const m = /^([A-G])([#b]?)(.*?)(?:\/([A-G])([#b]?))?$/.exec(symbol.replace('♯', '#').replace('♭', 'b'));
  if (!m) return '';
  const alter = (a: string) => (a === '#' ? '<root-alter>1</root-alter>' : a === 'b' ? '<root-alter>-1</root-alter>' : '');
  const kind = Object.entries(KIND_SUFFIX).find(([, suf]) => suf === m[3])?.[0] ?? 'major';
  const bass = m[4] ? `<bass><bass-step>${m[4]}</bass-step>${m[5] ? `<bass-alter>${m[5] === '#' ? 1 : -1}</bass-alter>` : ''}</bass>` : '';
  return `<harmony><root><root-step>${m[1]}</root-step>${alter(m[2])}</root><kind text="${esc(m[3])}">${kind}</kind>${bass}</harmony>`;
}

/** `section`: a section starting inside a bar (the line before ran on without a bar line). */
type Piece = { beats: number; ev: NoteEvent | RestEvent; tieStart: boolean; tieStop: boolean; first: boolean; section?: string };
type XmlMeasure = {
  pieces: Piece[];
  endBar?: BarStyle;
  startBar?: BarStyle;
  section?: string;
  newLine?: boolean;
  /** It starts an ending (the times through it's played), and a ":|" played more than twice. */
  ending?: number[];
  endTimes?: number;
  /** An ending's bracket ends here: closed with a hook (":|") or left open. */
  endingStop?: 'stop' | 'discontinue';
};

/**
 * Measures as the tab draws them (its own bar lines, so pickups and short bars stay);
 * a tab without bar lines, or a bar that's too long, is cut into bars of the time signature.
 */
function measuresOf(doc: TabDoc, bpb: number): XmlMeasure[] {
  const measures: XmlMeasure[] = [{ pieces: [] }];
  let lastPiece: Piece | null = null;
  let room = bpb;
  let pendingSection: string | undefined;
  const cur = () => measures[measures.length - 1];
  let pendingLine = false;
  for (const l of doc.lines) {
    if (l.section) pendingSection = l.section;
    // Each line of the tab starts a new system (at its first new measure).
    if (l.events.some((e) => e.kind !== 'bar')) pendingLine = true;
    for (const e of l.events) {
      if (e.kind === 'bar') {
        if (!cur().pieces.length) {
          if (e.style === 'repeat-start') cur().startBar = e.style;
          else if (measures.length > 1) {
            measures[measures.length - 2].endBar = e.style;
            if (e.times) measures[measures.length - 2].endTimes = e.times;
          }
          continue;
        }
        // "|:" after a bar: the bar ends normally and the next one starts the repeat.
        cur().endBar = e.style === 'repeat-start' ? 'single' : e.style;
        if (e.style === 'repeat-end' && e.times) cur().endTimes = e.times;
        measures.push({ pieces: [], startBar: e.style === 'repeat-start' ? e.style : undefined });
        room = bpb;
        continue;
      }
      if (e.beats <= 0) {
        // A chord symbol with no note after it: written where it falls (the end of the bar).
        // (Right after a bar line, it belongs to the end of the bar before.)
        const into = !cur().pieces.length && measures.length > 1 ? measures[measures.length - 2] : cur();
        if (e.chord) into.pieces.push({ beats: 0, ev: e, tieStart: false, tieStop: false, first: true });
        continue;
      }
      if (pendingLine && !cur().pieces.length) {
        cur().newLine = true;
        pendingLine = false;
      }
      if (e.ending?.length && !cur().pieces.some((p) => p.beats > 0)) cur().ending = e.ending;
      let left = e.beats;
      let first = true;
      while (left > 1e-6) {
        // Bars are the tab's own; one holding more than the time signature allows is split.
        if (room <= 1e-6) {
          measures.push({ pieces: [] });
          room = bpb;
          if (pendingLine) {
            cur().newLine = true;
            pendingLine = false;
          }
        }
        const take = Math.min(left, room);
        left -= take;
        room -= take;
        const piece: Piece = { beats: take, ev: e, tieStart: left > 1e-6, tieStop: !first, first };
        if (pendingSection !== undefined) {
          if (cur().pieces.length) piece.section = pendingSection;
          else cur().section = pendingSection;
          pendingSection = undefined;
        }
        // A tied note: the previous piece ties into this one.
        if (first && e.kind === 'note' && e.tied && lastPiece) {
          lastPiece.tieStart = true;
          piece.tieStop = true;
        }
        cur().pieces.push(piece);
        lastPiece = piece;
        first = false;
      }
    }
  }
  if (!cur().pieces.length && measures.length > 1) measures.pop();
  // Where each ending's bracket stops: its ":|" (closed), a double or final bar line, the
  // next "|:" or ending, or the end of its line (open).
  measures.forEach((m, i) => {
    if (!m.ending) return;
    let j = i;
    while (j + 1 < measures.length) {
      const b = measures[j];
      const next = measures[j + 1];
      if (b.endBar === 'repeat-end' || b.endBar === 'double' || b.endBar === 'final' || next.startBar === 'repeat-start' || next.ending || next.newLine) break;
      j++;
    }
    measures[j].endingStop = measures[j].endBar === 'repeat-end' ? 'stop' : 'discontinue';
  });
  // Lengths no note value can show are written as tied pieces.
  for (const m of measures) {
    m.pieces = m.pieces.flatMap((p) => {
      if (p.beats <= 0 || notation(p.beats)) return [p];
      const parts = splitLength(p.beats);
      return parts.map((b, k) => ({ ...p, beats: b, first: p.first && k === 0, tieStop: k > 0 || p.tieStop, tieStart: k < parts.length - 1 || p.tieStart, section: k === 0 ? p.section : undefined }));
    });
  }
  return measures;
}

const BAR_STYLE: Partial<Record<BarStyle, string>> = { double: 'light-light', final: 'light-heavy', 'repeat-end': 'light-heavy' };

/** A measure's right bar line: its style, the end of an ending's bracket, the repeat back (and how many times). */
function rightBarline(end: BarStyle, m: XmlMeasure, endingNums?: number[]): string {
  const style = BAR_STYLE[end];
  const ending = m.endingStop && endingNums ? `<ending number="${endingNums.join(', ')}" type="${m.endingStop}"/>` : '';
  const repeat = end === 'repeat-end' ? `<repeat direction="backward"${m.endTimes && m.endTimes > 2 ? ` times="${m.endTimes}"` : ''}/>` : '';
  if (!style && !ending && !repeat) return '';
  return `<barline location="right">${style ? `<bar-style>${style}</bar-style>` : ''}${ending}${repeat}</barline>`;
}

/** Writes partwise MusicXML 3.1 with lyrics, chord symbols and the tab as a second lyric line. */
export function writeMusicXml(doc: TabDoc, harp?: Harmonica): string {
  const { meta } = doc;
  const bpb = beatsPerBar(meta);
  const fifths = keyFifths(meta.key) ?? 0;
  const mode = parseKey(meta.key)?.mode ?? 'major';
  const [beatsNum, beatType] = meta.time.split('/');
  const measures = measuresOf(doc, bpb);

  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push('<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">');
  out.push('<score-partwise version="3.1">');
  out.push(`<work><work-title>${esc(meta.title || 'Untitled')}</work-title></work>`);
  if (meta.artist) out.push(`<identification><creator type="composer">${esc(meta.artist)}</creator><encoding><software>HarpForge</software></encoding></identification>`);
  out.push('<part-list><score-part id="P1"><part-name>Harmonica</part-name><score-instrument id="P1-I1"><instrument-name>Harmonica</instrument-name></score-instrument><midi-instrument id="P1-I1"><midi-program>23</midi-program></midi-instrument></score-part></part-list>');
  out.push('<part id="P1">');
  // A lyric line per verse (number 1, 2, …), then the tab; each verse's word under way.
  const verses = Math.max(1, ...doc.lines.map(lineVerses));
  const wordOpen: boolean[] = Array.from({ length: verses }, () => false);
  // Each verse's syllables held over the notes after them ("_"): their lyric starts an
  // extender (<extend type="start"/>); the held notes go on with it.
  const holdStarts = new Map<object, Set<number>>();
  for (let v = 0; v < verses; v++) {
    let lastSyllable: object | null = null;
    for (const line of doc.lines)
      for (const ev of line.events) {
        if (ev.kind === 'bar') continue;
        if (lyricOf(ev, v)) lastSyllable = ev;
        else if (isHeld(ev, v)) {
          if (lastSyllable) holdStarts.set(lastSyllable, (holdStarts.get(lastSyllable) ?? new Set()).add(v));
        }
        // (A note sung with no words — "*" — ends it: a hold after it isn't this syllable's.)
        else if ((ev.kind === 'note' && !ev.tied) || (ev.kind === 'rest' && ev.sung)) lastSyllable = null;
      }
  }
  // A short first bar is a pickup: numbered 0 and marked implicit, as notation programs expect.
  const firstLen = measures[0]?.pieces.reduce((a, p) => a + p.beats, 0) ?? 0;
  const pickup = measures.length > 1 && firstLen > 1e-6 && firstLen < bpb - 1e-6;
  // The ending whose bracket is open (its numbers, for the "stop" that closes it).
  let endingNums: number[] | undefined;
  measures.forEach((m, mi) => {
    const num = pickup ? mi : mi + 1;
    out.push(`<measure number="${num}"${pickup && mi === 0 ? ' implicit="yes"' : ''}>`);
    if (m.newLine && mi > 0) out.push('<print new-system="yes"/>');
    if (mi === 0) {
      out.push(`<attributes><divisions>${DIVISIONS}</divisions><key><fifths>${fifths}</fifths><mode>${mode}</mode></key><time><beats>${beatsNum}</beats><beat-type>${beatType}</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>`);
      out.push(`<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${Math.round(meta.tempo)}</per-minute></metronome></direction-type><sound tempo="${Math.round(meta.tempo)}"/></direction>`);
    }
    if (m.ending) endingNums = m.ending;
    if (m.startBar === 'repeat-start' || m.ending) {
      const ending = m.ending ? `<ending number="${m.ending.join(', ')}" type="start">${m.ending.map((n) => `${n}.`).join(' ')}</ending>` : '';
      const repeat = m.startBar === 'repeat-start' ? '<repeat direction="forward"/>' : '';
      out.push(`<barline location="left">${repeat ? '<bar-style>heavy-light</bar-style>' : ''}${ending}${repeat}</barline>`);
    }
    if (m.section) out.push(`<direction placement="above"><direction-type><rehearsal>${esc(m.section)}</rehearsal></direction-type></direction>`);
    for (const n of m.pieces) {
      if (n.section) out.push(`<direction placement="above"><direction-type><rehearsal>${esc(n.section)}</rehearsal></direction-type></direction>`);
      if (n.first && n.ev.chord) out.push(harmonyXml(n.ev.chord));
      if (n.beats <= 0) continue;
      const dur = Math.round(n.beats * DIVISIONS);
      const t = notation(n.beats);
      const typeXml = t
        ? `<type>${t.type}</type>${'<dot/>'.repeat(t.dots)}${t.tuplet ? `<time-modification><actual-notes>${t.tuplet[0]}</actual-notes><normal-notes>${t.tuplet[1]}</normal-notes></time-modification>` : ''}`
        : '';
      /** The event's words, a numbered lyric line per verse (each with its own word under way). */
      const verseXml = (ev: NoteEvent | RestEvent) => {
        let xml = '';
        for (let v = 0; v < verses; v++) {
          const lyric = lyricOf(ev, v);
          if (!lyric) {
            if (isHeld(ev, v)) xml += `<lyric number="${v + 1}"><extend type="continue"/></lyric>`;
            continue;
          }
          const hyphen = lyric.length > 1 && lyric.endsWith('-');
          const word = hyphen ? lyric.slice(0, -1) : lyric;
          const syllabic = wordOpen[v] ? (hyphen ? 'middle' : 'end') : hyphen ? 'begin' : 'single';
          wordOpen[v] = hyphen;
          const extend = holdStarts.get(ev)?.has(v) ? '<extend type="start"/>' : '';
          xml += `<lyric number="${v + 1}"><syllabic>${syllabic}</syllabic><text>${esc(word)}</text>${extend}</lyric>`;
        }
        return xml;
      };
      const midis = n.ev.kind === 'note' ? eventMidis(n.ev, harp) : [];
      if (!midis.length) {
        out.push(`<note><rest/><duration>${dur}</duration>${typeXml}${n.first && n.ev.kind === 'rest' ? verseXml(n.ev) : ''}</note>`);
        continue;
      }
      const tieXml = (n.tieStop ? '<tie type="stop"/>' : '') + (n.tieStart ? '<tie type="start"/>' : '');
      const tiedXml = n.tieStop || n.tieStart ? `<notations>${n.tieStop ? '<tied type="stop"/>' : ''}${n.tieStart ? '<tied type="start"/>' : ''}</notations>` : '';
      midis.forEach((midi, k) => {
        const sp = spell(midi, fifths);
        const pitch = `<pitch><step>${sp.letter}</step>${sp.alter ? `<alter>${sp.alter}</alter>` : ''}<octave>${sp.octave}</octave></pitch>`;
        let lyrics = '';
        if (k === 0 && n.first && n.ev.kind === 'note') {
          const ev = n.ev;
          lyrics += verseXml(ev);
          const holes = ev.tied ? [] : ev.sounds.filter((s): s is HoleSound => s.type === 'hole');
          if (holes.length) lyrics += `<lyric number="${verses + 1}" name="tab"><syllabic>single</syllabic><text>${esc(holes.map((h) => holeSoundText(h)).join(' '))}</text></lyric>`;
        }
        out.push(`<note>${k > 0 ? '<chord/>' : ''}${pitch}<duration>${dur}</duration>${tieXml}${typeXml}${tiedXml}${lyrics}</note>`);
      });
    }
    const end = m.endBar ?? (mi === measures.length - 1 ? 'final' : 'single');
    const right = rightBarline(end, m, endingNums);
    if (right) out.push(right);
    if (m.endingStop) endingNums = undefined;
    out.push('</measure>');
  });
  out.push('</part>', '</score-partwise>');
  return out.join('\n') + '\n';
}
