// MusicXML (partwise) import & export. Import reads the first part and first voice.

import { lineVerses, lyricOf, setLyricOf } from '../verses';
import { strFromU8, unzipSync } from 'fflate';
import { isNoChord, parseChord } from '../chords';
import type { Harmonica } from '../instruments';
import { holeSoundText } from '../htab/serializer';
import { beatsPerBar, type BarStyle, type NoteEvent, type RestEvent, type TabDoc, type TabEvent, type TabLine } from '../htab/types';
import { keyFromSignature, parseKey } from '../pitch';
import type { HoleSound } from '../types';
import { eventMidis, keyFifths, notesMeta, spell, type Imported } from './common';

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

export function parseMusicXml(xml: string): Imported {
  const warnings: string[] = [];
  const dom = new DOMParser().parseFromString(xml, 'application/xml');
  if (dom.getElementsByTagName('parsererror').length) throw new Error('This MusicXML file could not be read.');
  if (dom.documentElement.nodeName === 'score-timewise') throw new Error('Timewise MusicXML is not supported yet — export as partwise.');
  const meta = notesMeta({ tempo: 100 });
  meta.title = text(dom.documentElement, 'work-title') || text(dom.documentElement, 'movement-title') || undefined;
  const creator = [...dom.getElementsByTagName('creator')].find((c) => c.getAttribute('type') === 'composer') ?? dom.getElementsByTagName('creator')[0];
  if (creator?.textContent?.trim()) meta.artist = creator.textContent.trim();

  const parts = dom.getElementsByTagName('part');
  if (!parts.length) throw new Error('No parts found in this MusicXML file.');
  if (parts.length > 1) warnings.push(`Imported the first of ${parts.length} parts.`);
  const part = parts[0];
  // Its lyric lines (numbered 1, 2…, or named), in order: verse 1, 2…
  const numbers = [...new Set([...part.getElementsByTagName('lyric')].filter((l) => l.getAttribute('name') !== 'tab').map((l) => l.getAttribute('number') ?? '1'))];
  if (numbers.every((n) => /^\d+$/.test(n))) numbers.sort((a, b) => Number(a) - Number(b));
  const verseOf = new Map(numbers.map((n, k) => [n, k]));

  let divisions = 1;
  let voice: string | null = null;
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
            events.push(rest);
            last = null;
            break;
          }
          const ev: NoteEvent = { kind: 'note', sounds: [{ type: 'pitch', midi }], beats };
          if (pendingChord) ev.chord = pendingChord;
          pendingChord = undefined;
          // Each lyric line (number 1, 2, …) is a verse; the tab HarpForge writes under the staff isn't.
          for (const lyric of el.getElementsByTagName('lyric')) {
            if (lyric.getAttribute('name') === 'tab') continue;
            const v = verseOf.get(lyric.getAttribute('number') ?? '1');
            const t = text(lyric, 'text');
            const syl = text(lyric, 'syllabic');
            if (v !== undefined && t && !lyricOf(ev, v)) setLyricOf(ev, v, t + (syl === 'begin' || syl === 'middle' ? '-' : ''));
          }
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
    const repeat = barline ? child(barline, 'repeat')?.getAttribute('direction') : undefined;
    events.push({ kind: 'bar', style: repeat === 'backward' ? 'repeat-end' : style === 'light-heavy' ? 'final' : style === 'light-light' ? 'double' : 'single' });
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
type XmlMeasure = { pieces: Piece[]; endBar?: BarStyle; startBar?: BarStyle; section?: string; newLine?: boolean };

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
          else if (measures.length > 1) measures[measures.length - 2].endBar = e.style;
          continue;
        }
        // "|:" after a bar: the bar ends normally and the next one starts the repeat.
        cur().endBar = e.style === 'repeat-start' ? 'single' : e.style;
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

const BARLINE: Partial<Record<BarStyle, string>> = {
  double: '<barline location="right"><bar-style>light-light</bar-style></barline>',
  final: '<barline location="right"><bar-style>light-heavy</bar-style></barline>',
  'repeat-end': '<barline location="right"><bar-style>light-heavy</bar-style><repeat direction="backward"/></barline>',
};

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
  // A short first bar is a pickup: numbered 0 and marked implicit, as notation programs expect.
  const firstLen = measures[0]?.pieces.reduce((a, p) => a + p.beats, 0) ?? 0;
  const pickup = measures.length > 1 && firstLen > 1e-6 && firstLen < bpb - 1e-6;
  measures.forEach((m, mi) => {
    const num = pickup ? mi : mi + 1;
    out.push(`<measure number="${num}"${pickup && mi === 0 ? ' implicit="yes"' : ''}>`);
    if (m.newLine && mi > 0) out.push('<print new-system="yes"/>');
    if (mi === 0) {
      out.push(`<attributes><divisions>${DIVISIONS}</divisions><key><fifths>${fifths}</fifths><mode>${mode}</mode></key><time><beats>${beatsNum}</beats><beat-type>${beatType}</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>`);
      out.push(`<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${Math.round(meta.tempo)}</per-minute></metronome></direction-type><sound tempo="${Math.round(meta.tempo)}"/></direction>`);
    }
    if (m.startBar === 'repeat-start') out.push('<barline location="left"><bar-style>heavy-light</bar-style><repeat direction="forward"/></barline>');
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
      const midis = n.ev.kind === 'note' ? eventMidis(n.ev, harp) : [];
      if (!midis.length) {
        out.push(`<note><rest/><duration>${dur}</duration>${typeXml}</note>`);
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
          for (let v = 0; v < verses; v++) {
            const lyric = lyricOf(ev, v);
            if (!lyric) continue;
            const hyphen = lyric.length > 1 && lyric.endsWith('-');
            const word = hyphen ? lyric.slice(0, -1) : lyric;
            const syllabic = wordOpen[v] ? (hyphen ? 'middle' : 'end') : hyphen ? 'begin' : 'single';
            wordOpen[v] = hyphen;
            lyrics += `<lyric number="${v + 1}"><syllabic>${syllabic}</syllabic><text>${esc(word)}</text></lyric>`;
          }
          const holes = ev.tied ? [] : ev.sounds.filter((s): s is HoleSound => s.type === 'hole');
          if (holes.length) lyrics += `<lyric number="${verses + 1}" name="tab"><syllabic>single</syllabic><text>${esc(holes.map((h) => holeSoundText(h)).join(' '))}</text></lyric>`;
        }
        out.push(`<note>${k > 0 ? '<chord/>' : ''}${pitch}<duration>${dur}</duration>${tieXml}${typeXml}${tiedXml}${lyrics}</note>`);
      });
    }
    const end = m.endBar ?? (mi === measures.length - 1 ? 'final' : 'single');
    if (BARLINE[end]) out.push(BARLINE[end]!);
    out.push('</measure>');
  });
  out.push('</part>', '</score-partwise>');
  return out.join('\n') + '\n';
}
