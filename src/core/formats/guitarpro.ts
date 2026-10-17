// Guitar Pro 7 and 8 files (.gp: a zip holding Content/score.gpif, an XML score) — the track
// and voice with the melody, or the one picked under Part. Notes come from the pitch stored
// with them, or else from the string and fret on the track's tuning (and capo); with their
// lengths (dots, tuplets), ties, words (each beat's, or the track's lyrics text laid on its
// notes), chord names, tempo, time and key, repeats, 1st/2nd endings and sections.

import { strFromU8, unzipSync } from 'fflate';
import { wrapEvents } from '../htab/serializer';
import { beatsPerBar, type BarStyle, type NoteEvent, type RestEvent, type TabEvent, type TabLine } from '../htab/types';
import { keyFromSignature } from '../pitch';
import { setLyricOf } from '../verses';
import { melodyScore, notesMeta, partWarning, type Imported, type PartChoice } from './common';

const GPIF = 'Content/score.gpif';

/** Whether a zip holds a Guitar Pro 7–8 score. */
export const isGp = (names: string[]) => names.includes(GPIF);

/** The score inside a .gp. */
export function unzipGp(data: Uint8Array): string {
  const files = unzipSync(data, { filter: (f) => f.name === GPIF });
  if (!files[GPIF]) throw new Error('No score inside this .gp file (Guitar Pro 6 .gpx files aren’t read).');
  return strFromU8(files[GPIF]);
}

const kids = (el: Element | undefined, name?: string) => (el ? [...el.children].filter((c) => !name || c.nodeName === name) : []);
const kid = (el: Element | undefined, name: string) => kids(el, name)[0] as Element | undefined;
const val = (el: Element | undefined, name: string) => kid(el, name)?.textContent?.trim();
const ids = (s: string | undefined) => (s ?? '').split(/\s+/).filter(Boolean).map(Number);
/** A note's or track's property ("Fret", "Tuning"…). */
const prop = (el: Element | undefined, name: string) => kids(kid(el, 'Properties'), 'Property').find((p) => p.getAttribute('name') === name);

const VALUES: Record<string, number> = { DoubleWhole: 8, Whole: 4, Half: 2, Quarter: 1, Eighth: 0.5, '16th': 0.25, '32nd': 0.125, '64th': 0.0625, '128th': 0.03125 };
const STEP_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

interface Gpif {
  byId: (section: string, item: string) => Map<string, Element>;
  root: Element;
}

function index(dom: Document): Gpif {
  const root = dom.documentElement;
  const cache = new Map<string, Map<string, Element>>();
  return {
    root,
    byId: (section, item) => {
      if (!cache.has(section)) cache.set(section, new Map(kids(kid(root, section), item).map((e) => [e.getAttribute('id') ?? '', e])));
      return cache.get(section)!;
    },
  };
}

/**
 * A Guitar Pro 7–8 score: the track and voice asked for (`part`: "1:0", track 1's first voice),
 * or else the most melody-like; the others are offered under Part.
 */
export function parseGuitarPro(xml: string, opts: { part?: string } = {}): Imported {
  // (Its texts are CDATA sections: made plain text first, for parsers that don't take them.)
  const plain = xml.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
  const dom = new DOMParser().parseFromString(plain, 'application/xml');
  if (dom.getElementsByTagName('parsererror').length || dom.documentElement.nodeName !== 'GPIF') throw new Error('This Guitar Pro file could not be read.');
  const g = index(dom);
  const tracks = kids(kid(g.root, 'Tracks'), 'Track');
  const masterBars = kids(kid(g.root, 'MasterBars'), 'MasterBar');
  const bars = g.byId('Bars', 'Bar');
  const voices = g.byId('Voices', 'Voice');
  const beats = g.byId('Beats', 'Beat');
  // Each track, and each of its voices with notes in it.
  const options: (PartChoice & { ti: number; voice: number; name: string })[] = [];
  tracks.forEach((track, ti) => {
    const name = val(track, 'Name') ?? '';
    const used = new Set<number>();
    for (const mb of masterBars) {
      const bar = bars.get(String(ids(val(mb, 'Bars'))[ti]));
      ids(val(bar, 'Voices')).forEach((vid, k) => {
        if (vid < 0) return;
        if (ids(val(voices.get(String(vid)), 'Beats')).some((b) => kid(beats.get(String(b)), 'Notes'))) used.add(k);
      });
    }
    const label = name || `Track ${ti + 1}`;
    for (const v of [...used].sort()) options.push({ id: `${ti}:${v}`, label: label + (used.size > 1 ? ` · voice ${v + 1}` : ''), ti, voice: v, name });
  });
  if (!options.length) throw new Error('No notes found in this Guitar Pro file.');
  const read = (o: (typeof options)[number]) => readTrack(g, o.ti, o.voice);
  let chosen = options.find((o) => o.id === opts.part);
  let result = chosen ? read(chosen) : null;
  if (!chosen || !result) {
    let best = -Infinity;
    for (const o of options) {
      const r = read(o);
      const s = melodyScore(r.doc, o.name);
      if (!result || s > best) {
        best = s;
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
    choosePart: (id) => parseGuitarPro(xml, { part: id }),
  };
}

/** One track's one voice, as a document. */
function readTrack(g: Gpif, ti: number, voiceNo: number): Imported {
  const warnings: string[] = [];
  const meta = notesMeta({ tempo: 120, time: '4/4' });
  const score = kid(g.root, 'Score');
  meta.title = val(score, 'Title') || undefined;
  meta.artist = val(score, 'Artist') || undefined;
  const track = kids(kid(g.root, 'Tracks'), 'Track')[ti];
  // The track's tuning (lowest string first) and capo: for notes stored as string and fret.
  const staff = kid(kid(track, 'Staves'), 'Staff') ?? track;
  const tuning = ids((prop(staff, 'Tuning') ?? prop(track, 'Tuning'))?.getElementsByTagName('Pitches')[0]?.textContent ?? undefined);
  const capo = Number((prop(staff, 'CapoFret') ?? prop(track, 'CapoFret'))?.textContent?.trim() || 0) || 0;
  // Chord names by id (the track's chord diagrams).
  const chordNames = new Map<string, string>();
  for (const item of track.getElementsByTagName('Item')) if (item.getAttribute('name')) chordNames.set(item.getAttribute('id') ?? '', item.getAttribute('name')!);

  const masterBars = kids(kid(g.root, 'MasterBars'), 'MasterBar');
  const bars = g.byId('Bars', 'Bar');
  const voices = g.byId('Voices', 'Voice');
  const beatEls = g.byId('Beats', 'Beat');
  const noteEls = g.byId('Notes', 'Note');
  const rhythms = g.byId('Rhythms', 'Rhythm');

  const pitchOf = (note: Element): number | null => {
    const midi = prop(note, 'Midi')?.getElementsByTagName('Number')[0]?.textContent;
    if (midi) return Number(midi);
    const concert = prop(note, 'ConcertPitch')?.getElementsByTagName('Pitch')[0];
    if (concert) {
      const step = val(concert, 'Step') ?? 'C';
      const acc = val(concert, 'Accidental') ?? '';
      const alter = acc === '#' ? 1 : acc === 'b' ? -1 : acc === '##' || acc === 'x' ? 2 : acc === 'bb' ? -2 : 0;
      return (Number(val(concert, 'Octave') ?? '4') + 1) * 12 + (STEP_PC[step] ?? 0) + alter;
    }
    const string = Number(prop(note, 'String')?.getElementsByTagName('String')[0]?.textContent);
    const fret = Number(prop(note, 'Fret')?.getElementsByTagName('Fret')[0]?.textContent);
    if (Number.isNaN(string) || Number.isNaN(fret) || tuning[string] === undefined) return null;
    return tuning[string] + fret + capo;
  };

  // Tempo changes (by bar): the one played longest is kept.
  const tempos = kids(kid(kid(g.root, 'MasterTrack'), 'Automations'), 'Automation')
    .filter((a) => val(a, 'Type') === 'Tempo')
    .map((a) => ({ bar: Number(val(a, 'Bar') ?? '0'), bpm: Math.round(Number((val(a, 'Value') ?? '').split(/\s+/)[0])) }))
    .filter((t) => t.bpm > 0)
    .sort((a, b) => a.bar - b.bar);
  if (tempos.length) {
    const lasting = new Map<number, number>();
    tempos.forEach((t, k) => lasting.set(t.bpm, (lasting.get(t.bpm) ?? 0) + Math.max(0, (tempos[k + 1]?.bar ?? masterBars.length) - t.bar)));
    meta.tempo = [...lasting].sort((a, b) => b[1] - a[1])[0][0];
    if (lasting.size > 1) {
      const all = [...lasting.keys()];
      warnings.push(`The tempo changes during the song (${Math.min(...all)}–${Math.max(...all)} bpm): the tab keeps ${meta.tempo} bpm, the tempo it’s played at longest.`);
    }
  }

  const events: TabEvent[] = [];
  const firstTime = val(masterBars[0], 'Time');
  if (firstTime && /^\d+\/\d+$/.test(firstTime)) meta.time = firstTime;
  const key = kid(masterBars[0], 'Key');
  if (key) meta.key = keyFromSignature(Number(val(key, 'AccidentalCount') ?? '0'), val(key, 'Mode') === 'Minor' ? 'minor' : 'major');
  let timeWarned = false;
  let lastEnding = '';
  const sections = new Map<number, string>();
  let lastNote: NoteEvent | null = null;
  let anyWords = false;
  masterBars.forEach((mb, mi) => {
    const time = val(mb, 'Time');
    if (time && time !== meta.time && !timeWarned) {
      warnings.push(`The time signature changes to ${time} during the song; the tab keeps ${meta.time}.`);
      timeWarned = true;
    }
    const section = val(kid(mb, 'Section'), 'Text') || val(kid(mb, 'Section'), 'Letter');
    const repeat = kid(mb, 'Repeat');
    if (repeat?.getAttribute('start') === 'true') events.push({ kind: 'bar', style: 'repeat-start' });
    const startAt = events.length;
    if (section) sections.set(startAt, section);
    const endings = ids(val(mb, 'AlternateEndings'));
    // (An ending goes on the bar it starts; the bars after it with the same numbers carry on.)
    const endingHere = endings.length && endings.join() !== lastEnding ? endings : undefined;
    lastEnding = endings.join();
    const bar = bars.get(String(ids(val(mb, 'Bars'))[ti]));
    const vid = ids(val(bar, 'Voices'))[voiceNo];
    let pos = 0;
    for (const bid of vid !== undefined && vid >= 0 ? ids(val(voices.get(String(vid)), 'Beats')) : []) {
      const beat = beatEls.get(String(bid));
      if (!beat || kid(beat, 'GraceNotes')) continue;
      const rhythm = rhythms.get(kid(beat, 'Rhythm')?.getAttribute('ref') ?? '');
      let len = VALUES[val(rhythm, 'NoteValue') ?? 'Quarter'] ?? 1;
      const dots = Number(kid(rhythm, 'AugmentationDot')?.getAttribute('count') ?? '0');
      len *= 2 - Math.pow(0.5, dots);
      const tup = kid(rhythm, 'PrimaryTuplet');
      if (tup) len *= Number(tup.getAttribute('den')) / Number(tup.getAttribute('num')) || 1;
      const noteIds = ids(val(beat, 'Notes'));
      let ev: NoteEvent | RestEvent;
      if (noteIds.length) {
        const notes = noteIds.map((n) => noteEls.get(String(n))).filter((n): n is Element => !!n);
        const midis = notes.map(pitchOf).filter((m): m is number => m !== null);
        ev = { kind: 'note', beats: len, sounds: [...new Set(midis)].sort((a, b) => a - b).map((midi) => ({ type: 'pitch' as const, midi })) };
        if (notes.some((n) => kid(n, 'Tie')?.getAttribute('destination') === 'true') && lastNote) ev.tied = true;
        // The beat's own words, a line each verse.
        kids(kid(beat, 'Lyrics'), 'Line').forEach((line, v) => {
          const text = line.textContent?.trim();
          if (text) {
            setLyricOf(ev, v, text);
            anyWords = true;
          }
        });
        lastNote = ev;
      } else {
        ev = { kind: 'rest', beats: len };
        lastNote = null;
      }
      const chord = chordNames.get(val(beat, 'Chord') ?? '');
      if (chord) ev.chord = chord;
      if (endingHere && pos === 0) ev.ending = endingHere;
      events.push(ev);
      pos += len;
    }
    const full = beatsPerBar(meta);
    if (pos < full - 1e-6) {
      const rest: RestEvent = { kind: 'rest', beats: full - pos };
      if (endingHere && pos === 0) rest.ending = endingHere;
      events.push(rest);
    }
    let style: BarStyle = mi === masterBars.length - 1 ? 'final' : 'single';
    if (repeat?.getAttribute('end') === 'true') style = 'repeat-end';
    const count = Number(repeat?.getAttribute('count') ?? '0');
    events.push({ kind: 'bar', style, ...(style === 'repeat-end' && count > 2 ? { times: count } : {}) });
  });

  // The track's lyrics text (as Guitar Pro's lyrics editor keeps it), when no beat has words:
  // syllables ("-" between them, spaces between words) on the notes from its bar on.
  if (!anyWords) {
    const lines = kids(kid(track, 'Lyrics'), 'Line');
    lines.forEach((line, v) => {
      const text = (val(line, 'Text') ?? '').replace(/\s+/g, ' ').trim();
      if (!text) return;
      const from = Number(val(line, 'Offset') ?? '0') || 0;
      const syllables = text.split(' ').flatMap((word) => {
        const parts = word.split('-').filter(Boolean);
        return parts.map((p, k) => (k < parts.length - 1 ? `${p}-` : p));
      });
      let bar = 0;
      let k = 0;
      for (const e of events) {
        if (e.kind === 'bar') {
          if (e.style !== 'repeat-start') bar++;
          continue;
        }
        if (bar < from || e.kind !== 'note' || e.tied || k >= syllables.length) continue;
        setLyricOf(e, v, syllables[k++]);
      }
    });
  }

  // Lines: four bars each, and a section starts a line.
  const lines: TabLine[] = [];
  let chunk: TabEvent[] = [];
  let section: string | undefined;
  events.forEach((e, k) => {
    if (sections.has(k) && chunk.some((x) => x.kind !== 'bar')) {
      lines.push(...wrapEvents(chunk, 4).map((l, j) => (j === 0 && section !== undefined ? { ...l, section } : l)));
      chunk = [];
    }
    if (sections.has(k)) section = sections.get(k);
    chunk.push(e);
  });
  if (chunk.length) lines.push(...wrapEvents(chunk, 4).map((l, j) => (j === 0 && section !== undefined ? { ...l, section } : l)));
  return { doc: { meta, lines }, warnings, format: 'Guitar Pro' };
}
