// Conversions between pitch notation and harmonica tab.
//
// Tab → notes is a lookup. Notes → tab is a search: most pitches can be played in
// more than one way, so we pick the path through the song with the lowest
// "playability cost" (techniques + hand movement), Viterbi-style.

import {
  allOptions,
  allSpecs,
  getHarmonica,
  harmonicaName,
  soundPitch,
  type Harmonica,
  type HarmonicaSpec,
} from './instruments';
import { midiToName, mod12, parsePitchClass } from './pitch';
import type { NoteEvent, RestEvent, TabDoc, TabEvent, TabMeta } from './htab/types';
import type { Breath, HoleSound, Sound } from './types';

export interface ConvertStats {
  notes: number;
  bends: number;
  overblows: number;
  slides: number;
  unplayable: number;
  reducedChords: number;
  cost: number;
}

export interface ConvertResult {
  doc: TabDoc;
  warnings: string[];
  stats: ConvertStats;
}

function cloneMeta(meta: TabMeta): TabMeta {
  return { ...meta, extra: { ...meta.extra } };
}

function mapEvents(doc: TabDoc, fn: (e: NoteEvent) => TabEvent): TabDoc {
  return {
    meta: cloneMeta(doc.meta),
    lines: doc.lines.map((l) => ({ ...l, events: l.events.map((e) => (e.kind === 'note' ? fn(e) : { ...e })) })),
  };
}

function restFor(e: NoteEvent): RestEvent {
  return { kind: 'rest', beats: e.beats, chord: e.chord, src: e.src };
}

/** Pitches of an event; hole sounds are resolved on `harp` (null if unplayable). */
function eventPitches(e: NoteEvent, harp?: Harmonica): (number | null)[] {
  return e.sounds.map((s) => (s.type === 'pitch' ? s.midi : harp ? soundPitch(harp, s) : null));
}

// ---- Tab → notes ---------------------------------------------------------------

export function tabToNotes(doc: TabDoc, harp: Harmonica): { doc: TabDoc; warnings: string[] } {
  const warnings: string[] = [];
  const out = mapEvents(doc, (e) => {
    const pitches = eventPitches(e, harp);
    const sounds: Sound[] = [];
    pitches.forEach((m, k) => {
      if (m === null) {
        const s = e.sounds[k];
        warnings.push(`Skipped ${s.type === 'hole' ? s.hole : '?'}: not playable on ${harp.name}`);
      } else sounds.push({ type: 'pitch', midi: m });
    });
    return sounds.length ? { ...e, sounds } : restFor(e);
  });
  out.meta.extra = { ...out.meta.extra };
  out.meta.harmonica = harp.spec.family;
  out.meta.tuning = harp.spec.tuning;
  out.meta.harpKey = harp.spec.key;
  out.meta.extra.notation = 'notes';
  return { doc: out, warnings };
}

// ---- Notes → tab ---------------------------------------------------------------

interface Candidate {
  sounds: HoleSound[];
  cost: number;
  center: number;
  breath: Breath;
  reduced: boolean;
}

function singleCandidates(harp: Harmonica, midi: number, extraCost = 0, reduced = false): Candidate[] {
  return allOptions(harp)
    .filter((o) => o.midi === midi)
    .map((o) => ({ sounds: [o.sound], cost: o.cost + extraCost, center: o.sound.hole, breath: o.sound.breath, reduced }));
}

function chordCandidates(harp: Harmonica, pitches: number[]): Candidate[] {
  const out: Candidate[] = [];
  const slides = harp.hasSlide ? [false, true] : [false];
  for (const breath of ['blow', 'draw'] as Breath[]) {
    for (const slide of slides) {
      // Holes that produce each pitch unbent with this breath/slide.
      const choices = pitches.map((p) =>
        harp.holes
          .filter((h) => (breath === 'blow' ? h.blow : h.draw) + (slide ? 1 : 0) === p)
          .map((h) => h.hole),
      );
      if (choices.some((c) => c.length === 0)) continue;
      const pick = (k: number, acc: number[]) => {
        if (k === choices.length) {
          const sorted = [...acc].sort((a, b) => a - b);
          const distinct = new Set(sorted).size === sorted.length;
          if (distinct && sorted[sorted.length - 1] - sorted[0] === sorted.length - 1) {
            out.push({
              sounds: sorted.map((hole) => ({ type: 'hole', hole, breath, bend: 0, over: false, slide })),
              cost: 0.2 * sorted.length + (slide ? 0.3 : 0),
              center: (sorted[0] + sorted[sorted.length - 1]) / 2,
              breath,
              reduced: false,
            });
          }
          return;
        }
        for (const h of choices[k]) pick(k + 1, [...acc, h]);
      };
      pick(0, []);
    }
  }
  return out;
}

function transition(a: Candidate, b: Candidate): number {
  return 0.35 * Math.abs(a.center - b.center) + (a.breath !== b.breath ? 0.05 : 0);
}

export interface NotesToTabOptions {
  /** Semitones added to every pitch before mapping (e.g. -12 to drop an octave). */
  shift?: number;
  /** Harmonica to read hole sounds with when the source is already a tab. */
  sourceHarp?: Harmonica;
}

export function notesToTab(doc: TabDoc, harp: Harmonica, opts: NotesToTabOptions = {}): ConvertResult {
  const shift = opts.shift ?? 0;
  const warnings: string[] = [];
  const stats: ConvertStats = { notes: 0, bends: 0, overblows: 0, slides: 0, unplayable: 0, reducedChords: 0, cost: 0 };

  // 1. Candidates per note event.
  type Slot = { line: number; index: number; event: NoteEvent; cands: Candidate[]; pitches: number[] };
  const slots: Slot[] = [];
  doc.lines.forEach((l, li) =>
    l.events.forEach((e, ei) => {
      if (e.kind !== 'note') return;
      const raw = eventPitches(e, opts.sourceHarp).filter((m): m is number => m !== null).map((m) => m + shift);
      const pitches = [...new Set(raw)].sort((a, b) => a - b);
      let cands: Candidate[] = [];
      if (pitches.length === 1) cands = singleCandidates(harp, pitches[0]);
      else if (pitches.length > 1) {
        cands = chordCandidates(harp, pitches);
        if (!cands.length) {
          // Fall back to the melody (top) note, then any playable chord note.
          for (let k = pitches.length - 1; k >= 0 && !cands.length; k--) cands = singleCandidates(harp, pitches[k], 2, true);
        }
      }
      slots.push({ line: li, index: ei, event: e, cands, pitches });
    }),
  );

  // 2. Viterbi over playable slots.
  const playable = slots.filter((s) => s.cands.length);
  const best: number[][] = [];
  const back: number[][] = [];
  playable.forEach((slot, i) => {
    best[i] = [];
    back[i] = [];
    slot.cands.forEach((c, j) => {
      if (i === 0) {
        best[i][j] = c.cost;
        back[i][j] = -1;
        return;
      }
      let min = Infinity;
      let arg = 0;
      playable[i - 1].cands.forEach((p, k) => {
        const v = best[i - 1][k] + transition(p, c);
        if (v < min) {
          min = v;
          arg = k;
        }
      });
      best[i][j] = min + c.cost;
      back[i][j] = arg;
    });
  });
  const chosen = new Map<Slot, Candidate>();
  if (playable.length) {
    const last = playable.length - 1;
    let j = best[last].indexOf(Math.min(...best[last]));
    stats.cost = best[last][j];
    for (let i = last; i >= 0; i--) {
      chosen.set(playable[i], playable[i].cands[j]);
      j = back[i][j];
    }
  }

  // 3. Rebuild the document.
  const lookup = new Map<string, Slot>();
  for (const s of slots) lookup.set(`${s.line}:${s.index}`, s);
  const out: TabDoc = {
    meta: cloneMeta(doc.meta),
    lines: doc.lines.map((l, li) => ({
      ...l,
      events: l.events.map((e, ei): TabEvent => {
        if (e.kind !== 'note') return { ...e };
        const slot = lookup.get(`${li}:${ei}`)!;
        const c = chosen.get(slot);
        if (!c) {
          if (slot.pitches.length) {
            stats.unplayable++;
            stats.cost += 25;
            warnings.push(`${slot.pitches.map((p) => midiToName(p)).join('+')} isn't playable on ${harp.name}`);
          }
          return restFor(e);
        }
        stats.notes++;
        for (const s of c.sounds) {
          if (s.bend) stats.bends++;
          if (s.over) stats.overblows++;
          if (s.slide) stats.slides++;
        }
        if (c.reduced) {
          stats.reducedChords++;
          warnings.push(`Chord ${slot.pitches.map((p) => midiToName(p)).join('+')} reduced to a single note`);
        }
        return { ...e, sounds: c.sounds };
      }),
    })),
  };
  out.meta.harmonica = harp.spec.family;
  out.meta.tuning = harp.spec.tuning;
  out.meta.harpKey = harp.spec.key;
  delete out.meta.extra.notation;
  return { doc: out, warnings, stats };
}

/** Re-tabs a tab for a different harmonica, keeping the pitches. */
export function retab(doc: TabDoc, from: Harmonica, to: Harmonica): ConvertResult {
  const best = bestShift(doc, to, from);
  return notesToTab(doc, to, { sourceHarp: from, shift: best });
}

function bestShift(doc: TabDoc, harp: Harmonica, sourceHarp?: Harmonica): number {
  let bestShift = 0;
  let bestScore = Infinity;
  for (const shift of [0, -12, 12, -24, 24]) {
    const r = notesToTab(doc, harp, { shift, sourceHarp });
    const score = r.stats.cost + Math.abs(shift) / 6;
    if (score < bestScore) {
      bestScore = score;
      bestShift = shift;
    }
  }
  return bestShift;
}

// ---- Harmonica suggestions ----------------------------------------------------

export interface Suggestion {
  spec: HarmonicaSpec;
  name: string;
  shift: number;
  score: number;
  stats: ConvertStats;
  position?: number;
}

/** Position number for playing in `songTonic` on a diatonic in `harpKey`. */
export function positionFor(harpKey: string, songTonicPc: number): number | undefined {
  const pc = parsePitchClass(harpKey.replace(/^(Low|High)\s+/i, ''));
  if (pc === null) return undefined;
  return mod12((songTonicPc - pc) * 7) + 1;
}

function guessTonic(doc: TabDoc, sourceHarp?: Harmonica): number | undefined {
  if (doc.meta.key) {
    const pc = parsePitchClass(doc.meta.key.replace(/m(in(or)?)?$/i, '').trim());
    if (pc !== null) return pc;
  }
  // Fall back to the last note of the song.
  for (let l = doc.lines.length - 1; l >= 0; l--) {
    const evs = doc.lines[l].events;
    for (let e = evs.length - 1; e >= 0; e--) {
      const ev = evs[e];
      if (ev.kind === 'note') {
        const ps = eventPitches(ev, sourceHarp).filter((m): m is number => m !== null);
        if (ps.length) return mod12(Math.min(...ps));
      }
    }
  }
  return undefined;
}

export function suggestHarmonicas(doc: TabDoc, opts: { sourceHarp?: Harmonica; limit?: number; families?: string[] } = {}): Suggestion[] {
  const tonic = guessTonic(doc, opts.sourceHarp);
  const results: Suggestion[] = [];
  for (const spec of allSpecs()) {
    if (opts.families && !opts.families.includes(spec.family)) continue;
    const harp = getHarmonica(spec);
    let best: Suggestion | null = null;
    for (const shift of [0, -12, 12]) {
      const r = notesToTab(doc, harp, { shift, sourceHarp: opts.sourceHarp });
      const unusual = spec.family === 'diatonic' && (spec.tuning !== 'richter' || /Low|High/.test(spec.key)) ? 0.5 : 0;
      const score = r.stats.cost + Math.abs(shift) / 4 + 3 * r.stats.reducedChords + unusual;
      if (!best || score < best.score) {
        best = { spec, name: harmonicaName(spec), shift, score, stats: r.stats };
      }
    }
    if (best) {
      if (spec.family === 'diatonic' && tonic !== undefined) best.position = positionFor(spec.key, tonic);
      results.push(best);
    }
  }
  results.sort((a, b) => a.score - b.score);
  return results.slice(0, opts.limit ?? 10);
}
