// A Score is the timed, pitched view of a TabDoc: what autoplay plays and what the
// converters reason about.

import { getHarmonica, soundPitch, type Harmonica, type HarmonicaSpec } from './instruments';
import { midiToName } from './pitch';
import type { ParseIssue, TabDoc, TabMeta } from './htab/types';
import type { Sound } from './types';

export interface ScoreEvent {
  /** Position in the score's event list. */
  index: number;
  line: number;
  /** Index into line.events. */
  eventIndex: number;
  start: number;
  beats: number;
  sounds: Sound[];
  /** Pitch per sound (null = not playable on this harmonica). */
  midis: (number | null)[];
  rest: boolean;
  chord?: string;
  lyric?: string;
}

export interface Score {
  events: ScoreEvent[];
  totalBeats: number;
  /** Beat positions of bar lines. */
  bars: number[];
}

export function eventKey(line: number, eventIndex: number): string {
  return `${line}:${eventIndex}`;
}

export function specFromMeta(meta: TabMeta): HarmonicaSpec {
  return getHarmonica({
    family: meta.harmonica as HarmonicaSpec['family'],
    tuning: meta.tuning,
    key: meta.harpKey,
  }).spec;
}

export function harmonicaFromMeta(meta: TabMeta): Harmonica {
  return getHarmonica(specFromMeta(meta));
}

export function buildScore(doc: TabDoc, harp: Harmonica): { score: Score; issues: ParseIssue[] } {
  const events: ScoreEvent[] = [];
  const bars: number[] = [];
  const issues: ParseIssue[] = [];
  let t = 0;
  doc.lines.forEach((line, li) => {
    line.events.forEach((e, ei) => {
      if (e.kind === 'bar') {
        bars.push(t);
        return;
      }
      if (e.kind === 'rest') {
        if (e.beats > 0) events.push({ index: events.length, line: li, eventIndex: ei, start: t, beats: e.beats, sounds: [], midis: [], rest: true, chord: e.chord });
        t += e.beats;
        return;
      }
      const midis = e.sounds.map((s) => (s.type === 'pitch' ? s.midi : soundPitch(harp, s)));
      midis.forEach((m, k) => {
        if (m === null && e.src) {
          const s = e.sounds[k];
          const why = s.type === 'hole' && s.hole > harp.holes.length ? `has no hole ${s.hole}` : 'can’t play this';
          issues.push({ message: `${harp.name} ${why}`, span: e.src, severity: 'warning' });
        }
      });
      events.push({ index: events.length, line: li, eventIndex: ei, start: t, beats: e.beats, sounds: e.sounds, midis, rest: false, chord: e.chord, lyric: e.lyric });
      t += e.beats;
    });
  });
  return { score: { events, totalBeats: t, bars }, issues };
}

export function describeMidis(midis: (number | null)[], flats = false): string {
  return midis.map((m) => (m === null ? '?' : midiToName(m, flats))).join(' ');
}
