// MusicXML (partwise) import & export. Import reads the first part and first voice.

import { strFromU8, unzipSync } from 'fflate';
import { parseChord } from '../chords';
import type { Harmonica } from '../instruments';
import { holeSoundText } from '../htab/serializer';
import { beatsPerBar, type NoteEvent, type RestEvent, type TabDoc, type TabEvent, type TabLine } from '../htab/types';
import { pitchClassName } from '../pitch';
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

  let divisions = 1;
  let voice: string | null = null;
  const lines: TabLine[] = [];
  let events: TabEvent[] = [];
  let pendingChord: string | undefined;
  let last: NoteEvent | null = null;
  let tempoSet = false;
  let measuresInLine = 0;
  let explicitBreaks = false;

  for (const measure of [...part.getElementsByTagName('measure')]) {
    const print = child(measure, 'print');
    if (print && (print.getAttribute('new-system') === 'yes' || print.getAttribute('new-page') === 'yes') && events.length) {
      explicitBreaks = true;
      lines.push({ events });
      events = [];
      measuresInLine = 0;
    }
    for (const el of [...measure.children]) {
      switch (el.nodeName) {
        case 'attributes': {
          const div = text(el, 'divisions');
          if (div) divisions = parseInt(div, 10) || divisions;
          const fifths = text(el, 'fifths');
          if (fifths !== undefined && !meta.key) {
            const f = parseInt(fifths, 10);
            const minor = text(el, 'mode') === 'minor';
            const majorPc = (f * 7 + 1200) % 12;
            meta.key = minor ? pitchClassName(majorPc + 9, f < 0) + 'm' : pitchClassName(majorPc, f < 0);
          }
          const beats = text(el, 'beats');
          const beatType = text(el, 'beat-type');
          if (beats && beatType) meta.time = `${beats}/${beatType}`;
          break;
        }
        case 'direction':
        case 'sound': {
          const sound = el.nodeName === 'sound' ? el : child(el, 'sound');
          const tempo = sound?.getAttribute('tempo');
          if (tempo && !tempoSet) {
            meta.tempo = Math.round(parseFloat(tempo));
            tempoSet = true;
          }
          const words = el.nodeName === 'direction' ? text(el, 'rehearsal') : undefined;
          if (words && !events.length) lines.push({ section: words, events: [] });
          break;
        }
        case 'harmony': {
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
          if (v !== voice) break;
          const isChord = !!child(el, 'chord');
          const dur = parseFloat(text(el, 'duration') ?? '0');
          const beats = dur / divisions;
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
          if (tieStop && last && midi !== null && last.sounds.length === 1 && last.sounds[0].type === 'pitch' && last.sounds[0].midi === midi) {
            last.beats += beats;
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
          const lyric = [...el.getElementsByTagName('lyric')].find((l) => (l.getAttribute('number') ?? '1') === '1');
          if (lyric) {
            const t = text(lyric, 'text');
            const syl = text(lyric, 'syllabic');
            if (t) ev.lyric = t + (syl === 'begin' || syl === 'middle' ? '-' : '');
          }
          events.push(ev);
          last = ev;
          break;
        }
      }
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

const DIVISIONS = 48;
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

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function harmonyXml(symbol: string): string {
  const info = parseChord(symbol);
  if (!info) return '';
  const m = /^([A-G])([#b]?)(.*?)(?:\/([A-G])([#b]?))?$/.exec(symbol.replace('♯', '#').replace('♭', 'b'));
  if (!m) return '';
  const alter = (a: string) => (a === '#' ? '<root-alter>1</root-alter>' : a === 'b' ? '<root-alter>-1</root-alter>' : '');
  const kind = Object.entries(KIND_SUFFIX).find(([, suf]) => suf === m[3])?.[0] ?? 'major';
  const bass = m[4] ? `<bass><bass-step>${m[4]}</bass-step>${m[5] ? `<bass-alter>${m[5] === '#' ? 1 : -1}</bass-alter>` : ''}</bass>` : '';
  return `<harmony><root><root-step>${m[1]}</root-step>${alter(m[2])}</root><kind text="${esc(m[3])}">${kind}</kind>${bass}</harmony>`;
}

/** Writes partwise MusicXML 3.1 with lyrics, chord symbols and the tab as a second lyric line. */
export function writeMusicXml(doc: TabDoc, harp?: Harmonica): string {
  const { meta } = doc;
  const bpb = beatsPerBar(meta);
  const fifths = keyFifths(meta.key) ?? 0;
  const [beatsNum, beatType] = meta.time.split('/');

  // Flatten to timed items, then split into measures (tying notes across bar lines).
  type Item = { beats: number; ev: NoteEvent | RestEvent };
  const items: Item[] = [];
  for (const l of doc.lines) for (const e of l.events) if (e.kind !== 'bar' && e.beats > 0) items.push({ beats: e.beats, ev: e });
  const measures: { beats: number; ev: NoteEvent | RestEvent; tieStart: boolean; tieStop: boolean; first: boolean }[][] = [[]];
  let room = bpb;
  for (const it of items) {
    let left = it.beats;
    let first = true;
    while (left > 1e-6) {
      if (room <= 1e-6) {
        measures.push([]);
        room = bpb;
      }
      const take = Math.min(left, room);
      left -= take;
      room -= take;
      measures[measures.length - 1].push({ beats: take, ev: it.ev, tieStart: left > 1e-6, tieStop: !first, first });
      first = false;
    }
  }

  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push('<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">');
  out.push('<score-partwise version="3.1">');
  out.push(`<work><work-title>${esc(meta.title || 'Untitled')}</work-title></work>`);
  if (meta.artist) out.push(`<identification><creator type="composer">${esc(meta.artist)}</creator><encoding><software>HarpForge</software></encoding></identification>`);
  out.push('<part-list><score-part id="P1"><part-name>Harmonica</part-name><score-instrument id="P1-I1"><instrument-name>Harmonica</instrument-name></score-instrument><midi-instrument id="P1-I1"><midi-program>23</midi-program></midi-instrument></score-part></part-list>');
  out.push('<part id="P1">');
  let wordOpen = false;
  measures.forEach((m, mi) => {
    out.push(`<measure number="${mi + 1}">`);
    if (mi === 0) {
      out.push(`<attributes><divisions>${DIVISIONS}</divisions><key><fifths>${fifths}</fifths></key><time><beats>${beatsNum}</beats><beat-type>${beatType}</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>`);
      out.push(`<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${Math.round(meta.tempo)}</per-minute></metronome></direction-type><sound tempo="${Math.round(meta.tempo)}"/></direction>`);
    }
    for (const n of m) {
      if (n.first && n.ev.chord) out.push(harmonyXml(n.ev.chord));
      const dur = Math.round(n.beats * DIVISIONS);
      const t = noteType(n.beats);
      const typeXml = t ? `<type>${t.type}</type>${'<dot/>'.repeat(t.dots)}` : '';
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
          if (ev.lyric) {
            const hyphen = ev.lyric.endsWith('-');
            const word = hyphen ? ev.lyric.slice(0, -1) : ev.lyric;
            const syllabic = wordOpen ? (hyphen ? 'middle' : 'end') : hyphen ? 'begin' : 'single';
            wordOpen = hyphen;
            lyrics += `<lyric number="1"><syllabic>${syllabic}</syllabic><text>${esc(word)}</text></lyric>`;
          }
          const holes = ev.sounds.filter((s): s is HoleSound => s.type === 'hole');
          if (holes.length) lyrics += `<lyric number="2" name="tab"><syllabic>single</syllabic><text>${esc(holes.map((h) => holeSoundText(h)).join(' '))}</text></lyric>`;
        }
        out.push(`<note>${k > 0 ? '<chord/>' : ''}${pitch}<duration>${dur}</duration>${tieXml}${typeXml}${tiedXml}${lyrics}</note>`);
      });
    }
    if (mi === measures.length - 1) out.push('<barline location="right"><bar-style>light-heavy</bar-style></barline>');
    out.push('</measure>');
  });
  out.push('</part>', '</score-partwise>');
  return out.join('\n') + '\n';
}

