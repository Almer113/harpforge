// Guitar Pro 7 and 8 files (.gp: a zip holding Content/score.gpif, an XML score) — the track
// and voice with the melody, or the one picked under Part. Notes come from the pitch stored
// with them, or else from the string and fret on the track's tuning (and capo); with their
// lengths (dots, tuplets), ties, words (each beat's, or the track's lyrics text laid on its
// notes), chord names, tempo, time and key, repeats, 1st/2nd endings and sections.

import { strFromU8, unzipSync } from 'fflate';
import type { Imported } from './common';
import { pickPart, songToDoc, type GpBar, type GpBeat, type GpOption, type GpSong } from './gpsong';

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
  // Each track's staves (a master bar lists a bar for each staff, track by track), and each
  // staff's voices with notes in it; not the drums.
  const options: GpOption[] = [];
  let staffAt = 0;
  tracks.forEach((track, ti) => {
    const staves = Math.max(1, kids(kid(track, 'Staves'), 'Staff').length);
    const first = staffAt;
    staffAt += staves;
    if (isDrums(track)) return;
    const name = val(track, 'Name') ?? '';
    for (let st = 0; st < staves; st++) {
      const used = new Set<number>();
      for (const mb of masterBars) {
        const bar = bars.get(String(ids(val(mb, 'Bars'))[first + st]));
        ids(val(bar, 'Voices')).forEach((vid, k) => {
          if (vid < 0) return;
          if (ids(val(voices.get(String(vid)), 'Beats')).some((b) => kid(beats.get(String(b)), 'Notes'))) used.add(k);
        });
      }
      const label = (name || `Track ${ti + 1}`) + (staves > 1 ? ` · staff ${st + 1}` : '');
      for (const v of [...used].sort()) {
        const id = staves > 1 ? `${ti}.${st}:${v}` : `${ti}:${v}`;
        options.push({ id, label: label + (used.size > 1 ? ` · voice ${v + 1}` : ''), name, read: () => songToDoc(readTrack(g, ti, st, first + st, v), 'Guitar Pro') });
      }
    }
  });
  return pickPart(options, opts.part, (id) => parseGuitarPro(xml, { part: id }));
}

/** A drum kit's track (its notes are drums, not pitches). */
const isDrums = (track: Element) => val(kid(track, 'InstrumentSet'), 'Type') === 'drumKit' || val(kid(track, 'MidiConnection'), 'PrimaryChannel') === '9';

/** A tempo automation's beats a minute, in quarter notes ("60 3": 60 dotted quarters). */
const BEAT_UNIT = [1, 0.5, 1, 1.5, 2, 3];
const quarterBpm = (value: string) => {
  const [bpm, unit] = value.split(/\s+/).map(Number);
  return Math.round(bpm * (BEAT_UNIT[unit] ?? 1));
};

/** One staff's one voice (`st` the track's staff, `bi` its place in the master bars' lists). */
function readTrack(g: Gpif, ti: number, st: number, bi: number, voiceNo: number): GpSong {
  const score = kid(g.root, 'Score');
  const track = kids(kid(g.root, 'Tracks'), 'Track')[ti];
  // The staff's tuning (lowest string first) and capo: for notes stored as string and fret.
  const staff = kids(kid(track, 'Staves'), 'Staff')[st] ?? track;
  const tuning = ids((prop(staff, 'Tuning') ?? prop(track, 'Tuning'))?.getElementsByTagName('Pitches')[0]?.textContent ?? undefined);
  const capo = Number((prop(staff, 'CapoFret') ?? prop(track, 'CapoFret'))?.textContent?.trim() || 0) || 0;
  // Chord names by id (the track's chord diagrams).
  const chordNames = new Map<string, string>();
  for (const p of [...kids(kid(track, 'Properties'), 'Property'), ...kids(kid(staff, 'Properties'), 'Property')]) {
    if (!/^(Diagram|Chord)Collection$/.test(p.getAttribute('name') ?? '')) continue;
    for (const item of p.getElementsByTagName('Item')) if (item.getAttribute('name')) chordNames.set(item.getAttribute('id') ?? '', item.getAttribute('name')!);
  }

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

  const key = kid(masterBars[0], 'Key');
  const song: GpSong = {
    title: val(score, 'Title'),
    artist: val(score, 'Artist'),
    key: key ? { accidentals: Number(val(key, 'AccidentalCount') ?? '0'), minor: val(key, 'Mode') === 'Minor' } : undefined,
    tempos: kids(kid(kid(g.root, 'MasterTrack'), 'Automations'), 'Automation')
      .filter((a) => val(a, 'Type') === 'Tempo')
      .map((a) => ({ bar: Number(val(a, 'Bar') ?? '0'), bpm: quarterBpm(val(a, 'Value') ?? '') })),
    pickup: !!kid(kid(g.root, 'MasterTrack'), 'Anacrusis'),
    bars: [],
    // (As Guitar Pro's lyrics editor keeps them.)
    lyrics: kids(kid(track, 'Lyrics'), 'Line').map((line) => ({ from: Number(val(line, 'Offset') ?? '0') || 0, text: val(line, 'Text') ?? '' })),
  };
  for (const mb of masterBars) {
    const repeat = kid(mb, 'Repeat');
    const bar: GpBar = {
      time: val(mb, 'Time'),
      repeatStart: repeat?.getAttribute('start') === 'true',
      repeatEnd: repeat?.getAttribute('end') === 'true' ? Number(repeat.getAttribute('count') ?? '2') || 2 : undefined,
      endings: ids(val(mb, 'AlternateEndings')),
      section: val(kid(mb, 'Section'), 'Text') || val(kid(mb, 'Section'), 'Letter'),
      beats: [],
    };
    const vid = ids(val(bars.get(String(ids(val(mb, 'Bars'))[bi])), 'Voices'))[voiceNo];
    for (const bid of vid !== undefined && vid >= 0 ? ids(val(voices.get(String(vid)), 'Beats')) : []) {
      const beat = beatEls.get(String(bid));
      if (!beat || kid(beat, 'GraceNotes')) continue;
      const rhythm = rhythms.get(kid(beat, 'Rhythm')?.getAttribute('ref') ?? '');
      let len = VALUES[val(rhythm, 'NoteValue') ?? 'Quarter'] ?? 1;
      len *= 2 - Math.pow(0.5, Number(kid(rhythm, 'AugmentationDot')?.getAttribute('count') ?? '0'));
      const tup = kid(rhythm, 'PrimaryTuplet');
      if (tup) len *= Number(tup.getAttribute('den')) / Number(tup.getAttribute('num')) || 1;
      const notes = ids(val(beat, 'Notes'))
        .map((n) => noteEls.get(String(n)))
        .filter((n): n is Element => !!n);
      const b: GpBeat = { beats: len, midis: notes.map(pitchOf).filter((m): m is number => m !== null) };
      if (notes.some((n) => kid(n, 'Tie')?.getAttribute('destination') === 'true')) b.tied = true;
      if (notes.length) b.words = kids(kid(beat, 'Lyrics'), 'Line').map((l) => l.textContent ?? '');
      b.chord = chordNames.get(val(beat, 'Chord') ?? '');
      bar.beats.push(b);
    }
    song.bars.push(bar);
  }
  return song;
}
