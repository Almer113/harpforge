// MuseScore 3 and 4 files (.mscz: a zip holding the score; .mscx: the score itself) — the
// staff and voice with the melody, or the one picked under Part: its notes and rests with
// their lengths (dots, tuplets), ties, the words of each verse (held syllables too), chord
// symbols, tempo, time and key, repeats and 1st/2nd endings, line breaks and rehearsal
// marks (as sections). MuseScore 2 files are read where they happen to match.

import { strFromU8, unzipSync } from 'fflate';
import { beatsPerBar, type BarStyle, type NoteEvent, type RestEvent, type TabEvent, type TabLine } from '../htab/types';
import { keyFromSignature } from '../pitch';
import { setHeld, setLyricOf } from '../verses';
import { melodyScore, notesMeta, partWarning, type Imported, type PartChoice } from './common';

/** The score inside a .mscz. */
export function unzipMscz(data: Uint8Array): string {
  const files = unzipSync(data);
  const container = files['META-INF/container.xml'];
  if (container) {
    const m = /full-path="([^"]+\.mscx)"/.exec(strFromU8(container));
    if (m && files[m[1]]) return strFromU8(files[m[1]]);
  }
  const name = Object.keys(files).find((n) => /\.mscx$/i.test(n));
  if (!name) throw new Error('No score found inside the .mscz file.');
  return strFromU8(files[name]);
}

/** Whether a zip holds a MuseScore score. */
export const isMscz = (names: string[]) => names.some((n) => /\.mscx$/i.test(n));

const kids = (el: Element, name?: string) => [...el.children].filter((c) => !name || c.nodeName === name);
const kid = (el: Element, name: string) => kids(el, name)[0] as Element | undefined;
const val = (el: Element | undefined, name: string) => (el ? kid(el, name)?.textContent?.trim() : undefined);

const DURATIONS: Record<string, number> = { long: 16, breve: 8, whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25, '32nd': 0.125, '64th': 0.0625, '128th': 0.03125 };

/** A chord symbol's root from MuseScore's tonal pitch class (14 = C, each step a fifth up). */
export function tpcName(tpc: number): string {
  const letter = 'FCGDAEB'[(((tpc - 13) % 7) + 7) % 7];
  const acc = Math.floor((tpc - 13) / 7);
  return letter + (acc > 0 ? '#'.repeat(acc) : 'b'.repeat(-acc));
}

const fraction = (s: string | undefined) => {
  const m = /^(-?\d+)\/(\d+)$/.exec(s ?? '');
  return m ? (4 * Number(m[1])) / Number(m[2]) : null;
};

/**
 * A MuseScore score: the staff and voice asked for (`part`: "1:0", staff 1's first voice), or
 * else the most melody-like; the others are offered under Part.
 */
export function parseMuseScore(xml: string, opts: { part?: string } = {}): Imported {
  const dom = new DOMParser().parseFromString(xml, 'application/xml');
  if (dom.getElementsByTagName('parsererror').length) throw new Error('This MuseScore file could not be read.');
  const score = dom.getElementsByTagName('Score')[0];
  if (!score) throw new Error('No score in this MuseScore file.');
  const staves = kids(score, 'Staff');
  // Each staff's part name, and the voices with notes in it.
  const names = new Map<string, { name: string; count: number; k: number }>();
  for (const part of kids(score, 'Part')) {
    const name = val(part, 'trackName') || val(kid(part, 'Instrument') ?? part, 'longName') || '';
    const ids = kids(part, 'Staff').map((s) => s.getAttribute('id') ?? '');
    ids.forEach((id, k) => names.set(id, { name, count: ids.length, k }));
  }
  const options: (PartChoice & { staff: Element; voice: number; name: string })[] = [];
  for (const staff of staves) {
    const id = staff.getAttribute('id') ?? '';
    const voices = new Set<number>();
    for (const m of kids(staff, 'Measure')) kids(m, 'voice').forEach((v, k) => kids(v, 'Chord').some((c) => !isGrace(c)) && voices.add(k));
    // (MuseScore 2: chords straight in the measure, one voice.)
    if (!voices.size && kids(staff, 'Measure').some((m) => kids(m, 'Chord').length)) voices.add(0);
    const info = names.get(id);
    const base = (info?.name || `Staff ${id}`) + (info && info.count > 1 ? ` · staff ${info.k + 1}` : '');
    for (const v of [...voices].sort()) options.push({ id: `${id}:${v}`, label: base + (voices.size > 1 ? ` · voice ${v + 1}` : ''), staff, voice: v, name: info?.name ?? '' });
  }
  if (!options.length) throw new Error('No notes found in this MuseScore file.');
  const read = (o: (typeof options)[number]) => readStaff(score, o.staff, o.voice);
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
    choosePart: (id) => parseMuseScore(xml, { part: id }),
  };
}

const isGrace = (chord: Element) => kids(chord).some((c) => /^(acciaccatura|appoggiatura|grace\d+(after)?)$/.test(c.nodeName));

/** One staff's one voice, as a document. */
function readStaff(score: Element, staff: Element, voiceNo: number): Imported {
  const warnings: string[] = [];
  const warned = new Set<string>();
  const warnOnce = (w: string) => {
    if (!warned.has(w)) {
      warned.add(w);
      warnings.push(w);
    }
  };
  const meta = notesMeta({ tempo: 120, time: '4/4' });
  const metaTag = (name: string) => [...score.getElementsByTagName('metaTag')].find((t) => t.getAttribute('name') === name)?.textContent?.trim();
  // Title and composer: the page's own texts first (what's printed), else the file's tags.
  const boxText = (style: string) => [...score.getElementsByTagName('Text')].find((t) => val(t, 'style')?.toLowerCase() === style)?.getElementsByTagName('text')[0]?.textContent?.trim();
  meta.title = boxText('title') || metaTag('workTitle') || undefined;
  meta.artist = boxText('composer') || metaTag('composer') || undefined;

  const division = Number(val(score, 'Division')) || 480;
  const tempos: { at: number; bpm: number }[] = [];
  let timeSet = false;
  let keySet = false;
  const lines: TabLine[] = [];
  let line: TabEvent[] = [];
  let barsInLine = 0;
  let explicitBreaks = false;
  let pendingSection: string | undefined;
  let lineSection: string | undefined;
  let at = 0;
  const closeLine = () => {
    if (line.length) lines.push({ events: line, ...(lineSection !== undefined ? { section: lineSection } : {}) });
    line = [];
    lineSection = undefined;
    barsInLine = 0;
  };
  // Holds over notes (a syllable sung on, "melisma"): beats left to hold, by verse.
  const holding = new Map<number, number>();
  let lastNote: NoteEvent | null = null;

  for (const measure of kids(staff, 'Measure')) {
    const len = fraction(measure.getAttribute('len') ?? undefined);
    const voices = kids(measure, 'voice');
    const voice = voices.length ? voices[voiceNo] : voiceNo === 0 ? measure : undefined;
    // Settings and marks are on the first voice (and the measure).
    const first = voices[0] ?? measure;
    if (kid(measure, 'LayoutBreak') && val(kid(measure, 'LayoutBreak')!, 'subtype') === 'line') explicitBreaks = true;
    for (const el of kids(first)) {
      if (el.nodeName === 'TimeSig') {
        const t = `${val(el, 'sigN')}/${val(el, 'sigD')}`;
        if (!timeSet) {
          meta.time = /^\d+\/\d+$/.test(t) ? t : meta.time;
          timeSet = true;
        } else if (t !== meta.time) warnOnce(`The time signature changes to ${t} during the song; the tab keeps ${meta.time}.`);
      } else if (el.nodeName === 'KeySig' && !keySet) {
        const fifths = Number(val(el, 'concertKey') ?? val(el, 'accidental') ?? val(el, 'key') ?? 'NaN');
        if (!Number.isNaN(fifths)) {
          meta.key = keyFromSignature(fifths, val(el, 'mode') === 'minor' ? 'minor' : 'major');
          keySet = true;
        }
      } else if (el.nodeName === 'Tempo') {
        const q = Number(val(el, 'tempo'));
        if (q > 0) tempos.push({ at, bpm: Math.round(q * 60) });
      } else if (el.nodeName === 'RehearsalMark') {
        const text = el.getElementsByTagName('text')[0]?.textContent?.trim() || val(el, 'text');
        if (text) pendingSection = text.replace(/<[^>]+>/g, '');
      }
    }
    // A section starts a line.
    if (pendingSection !== undefined) {
      closeLine();
      lineSection = pendingSection;
      pendingSection = undefined;
    }
    const events: TabEvent[] = [];
    if (kid(measure, 'startRepeat')) events.push({ kind: 'bar', style: 'repeat-start' });
    let pos = 0;
    let tuplet = 1;
    let pendingChord: string | undefined;
    let pendingEnding: number[] | undefined;
    // (The ending started in this measure, read from its spanner.)
    for (const sp of [...first.getElementsByTagName('Spanner')].filter((s) => s.getAttribute('type') === 'Volta' && kid(s, 'Volta'))) {
      const v = kid(sp, 'Volta')!;
      const nums = (val(v, 'endings') ?? val(v, 'text') ?? '').split(/[^\d]+/).filter(Boolean).map(Number);
      // (On the bar it starts: an ending runs on to its repeat sign, as the tab reads it.)
      if (nums.length) pendingEnding = nums;
    }
    for (const el of voice ? kids(voice) : []) {
      switch (el.nodeName) {
        case 'Harmony': {
          const root = Number(val(el, 'root'));
          if (Number.isNaN(root)) break;
          const base = val(el, 'base');
          pendingChord = tpcName(root) + (val(el, 'name') ?? '') + (base ? `/${tpcName(Number(base))}` : '');
          break;
        }
        case 'Tuplet': {
          const normal = Number(val(el, 'normalNotes'));
          const actual = Number(val(el, 'actualNotes'));
          if (normal > 0 && actual > 0) tuplet = normal / actual;
          break;
        }
        case 'endTuplet':
          tuplet = 1;
          break;
        case 'location': {
          // A voice moved along (it starts later in the measure): a gap.
          const by = fraction(el.getElementsByTagName('fractions')[0]?.textContent?.trim());
          if (by && by > 0) {
            events.push({ kind: 'rest', beats: by });
            pos += by;
          }
          break;
        }
        case 'Chord':
        case 'Rest': {
          if (el.nodeName === 'Chord' && isGrace(el)) break;
          const type = val(el, 'durationType') ?? 'quarter';
          let beats = type === 'measure' ? (fraction(val(el, 'duration')) ?? len ?? beatsPerBar(meta)) : (DURATIONS[type] ?? 1);
          const dots = Number(val(el, 'dots') ?? '0');
          if (type !== 'measure') beats *= 2 - Math.pow(0.5, dots);
          // (MuseScore 2: the tuplet named on the chord.)
          beats *= kid(el, 'Tuplet') && tuplet === 1 ? 2 / 3 : tuplet;
          let ev: NoteEvent | RestEvent;
          if (el.nodeName === 'Rest') ev = { kind: 'rest', beats };
          else {
            const notes = kids(el, 'Note');
            const midis = notes.map((n) => Number(val(n, 'pitch'))).filter((m) => !Number.isNaN(m));
            ev = { kind: 'note', beats, sounds: midis.map((midi) => ({ type: 'pitch' as const, midi })) };
            // Tied from the note before: a tie spanner pointing back to it (or MuseScore 2's end of one).
            const tiedIn = notes.some((n) => [...n.getElementsByTagName('Spanner')].some((s) => s.getAttribute('type') === 'Tie' && kid(s, 'prev')) || kid(n, 'endSpanner'));
            if (tiedIn && lastNote) ev.tied = true;
            // The words, a verse each (numbered from 0); a syllable held on over the notes after it.
            const held = new Set<number>();
            for (const [v, left] of holding) {
              if (left > 1e-6) {
                setHeld(ev, v, true);
                held.add(v);
                holding.set(v, left - beats);
              } else holding.delete(v);
            }
            for (const ly of kids(el, 'Lyrics')) {
              const v = Number(val(ly, 'no') ?? '0') || 0;
              const text = ly.getElementsByTagName('text')[0]?.textContent ?? '';
              const syllabic = val(ly, 'syllabic');
              const syl = text.trim() + (syllabic === 'begin' || syllabic === 'middle' ? '-' : '');
              if (!syl) continue;
              setLyricOf(ev, v, syl);
              if (held.has(v)) setHeld(ev, v, false);
              const ticks = Number(val(ly, 'ticks') ?? '0') || (fraction(val(ly, 'ticks_f')) ?? 0) * (division / 4);
              if (ticks > 0) holding.set(v, ticks / division - beats);
            }
            lastNote = ev;
          }
          if (ev.kind === 'rest') {
            holding.clear();
            lastNote = null;
          }
          if (pendingChord) {
            ev.chord = pendingChord;
            pendingChord = undefined;
          }
          if (pendingEnding && !events.some((e) => e.kind !== 'bar')) ev.ending = pendingEnding;
          events.push(ev);
          pos += beats;
          break;
        }
        case 'BarLine':
          break;
      }
    }
    // The measure filled up to its length (a voice that stops early, or isn't there).
    const full = len ?? beatsPerBar(meta);
    if (pos < full - 1e-6) {
      const rest: RestEvent = { kind: 'rest', beats: full - pos };
      if (pendingEnding && !events.some((e) => e.kind !== 'bar')) rest.ending = pendingEnding;
      events.push(rest);
    }
    const endRepeat = kid(measure, 'endRepeat');
    const barSub = [...first.getElementsByTagName('BarLine')].map((b) => val(b, 'subtype')).find(Boolean);
    let style: BarStyle = 'single';
    if (endRepeat) style = 'repeat-end';
    else if (barSub === 'end' || barSub === 'final') style = 'final';
    else if (barSub === 'double') style = 'double';
    const times = endRepeat ? Number(endRepeat.textContent) || 2 : 2;
    events.push({ kind: 'bar', style, ...(style === 'repeat-end' && times > 2 ? { times } : {}) });
    line.push(...events);
    barsInLine++;
    const breakHere = kid(measure, 'LayoutBreak') ? val(kid(measure, 'LayoutBreak')!, 'subtype') === 'line' || val(kid(measure, 'LayoutBreak')!, 'subtype') === 'page' : false;
    if (breakHere || (!explicitBreaks && barsInLine >= 4)) closeLine();
    at += full;
  }
  closeLine();
  // One tempo: the one played longest.
  if (tempos.length) {
    const lasting = new Map<number, number>();
    tempos.forEach((t, k) => lasting.set(t.bpm, (lasting.get(t.bpm) ?? 0) + ((tempos[k + 1]?.at ?? at) - t.at)));
    meta.tempo = [...lasting].sort((a, b) => b[1] - a[1])[0][0];
    if (lasting.size > 1) {
      const all = [...lasting.keys()];
      warnings.push(`The tempo changes during the song (${Math.min(...all)}–${Math.max(...all)} bpm): the tab keeps ${meta.tempo} bpm, the tempo it’s played at longest.`);
    }
  }
  // (A last bar written as an ordinary one is the song's end.)
  return { doc: { meta, lines }, warnings, format: 'MuseScore' };
}
