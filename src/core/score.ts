// A Score is the timed, pitched view of a TabDoc: what autoplay plays and what the
// converters reason about.

import { getHarmonica, soundPitch, type Harmonica, type HarmonicaSpec } from './instruments';
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
  /** Syllables in verses 2, 3… (see verses.ts). */
  verses?: (string | undefined)[];
  /** Continues the previous note (a tie): shown, but not played again. */
  tied: boolean;
  /** How long the note sounds, including the tied notes that follow it. */
  soundBeats: number;
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
        if (e.beats > 0) events.push({ index: events.length, line: li, eventIndex: ei, start: t, beats: e.beats, sounds: [], midis: [], rest: true, chord: e.chord, tied: false, soundBeats: e.beats });
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
      const tied = !!e.tied;
      events.push({ index: events.length, line: li, eventIndex: ei, start: t, beats: e.beats, sounds: e.sounds, midis, rest: false, chord: e.chord, lyric: e.lyric, verses: e.verses, tied, soundBeats: e.beats });
      // A tie lengthens the sounding part of the note that started the chain.
      if (tied) {
        for (let k = events.length - 2; k >= 0; k--) {
          const head = events[k];
          if (head.rest) break;
          if (!head.tied) {
            head.soundBeats += e.beats;
            break;
          }
        }
      }
      t += e.beats;
    });
  });
  return { score: { events, totalBeats: t, bars }, issues };
}

/** Where each event's note sounds: from the start of its tied chain to the end of its last tie. */
export function soundSpans(score: Score): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  let head: { start: number; end: number } | null = null;
  for (const ev of score.events) {
    if (ev.rest) {
      head = null;
      out.push({ start: ev.start, end: ev.start + ev.beats });
      continue;
    }
    if (!ev.tied || !head) head = { start: ev.start, end: ev.start + ev.soundBeats };
    out.push(head);
  }
  return out;
}
