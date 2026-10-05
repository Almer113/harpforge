// Turns timed notes (start/end in beats) into tab events with rests and bar lines.
// Used by live recording and MIDI import.

import type { TabEvent } from './htab/types';
import type { Sound } from './types';

export interface TimedCluster {
  start: number;
  end: number;
  sounds: Sound[];
}

/**
 * Snaps timed notes to a grid and merges notes that start together into chords. The grid
 * can differ from beat to beat (a function of the time): triplets here, sixteenths there.
 */
export function quantize(notes: { start: number; end: number; sound: Sound }[], grid: number | ((at: number) => number), dedupe: (a: Sound, b: Sound) => boolean): TimedCluster[] {
  const gridAt = typeof grid === 'number' ? () => grid : grid;
  const q = (x: number) => {
    const g = gridAt(x);
    return Math.max(0, Math.round(x / g) * g);
  };
  const clusters: TimedCluster[] = [];
  for (const n of notes) {
    const start = q(n.start);
    const end = Math.max(start + gridAt(n.start), q(n.end));
    const c = clusters.find((k) => Math.abs(k.start - start) < 1e-9);
    if (c) {
      if (!c.sounds.some((s) => dedupe(s, n.sound))) c.sounds.push(n.sound);
      c.end = Math.max(c.end, end);
    } else clusters.push({ start, end, sounds: [n.sound] });
  }
  return clusters.sort((a, b) => a.start - b.start);
}

/**
 * Lays clusters out as notes and rests, starting at the first note's bar.
 * Notes are cut at the next note (no overlaps); rests are split at bar lines.
 */
export function clustersToEvents(clusters: TimedCluster[], bpb: number, startAtZero = false): TabEvent[] {
  if (!clusters.length) return [];
  const timeline: { beats: number; sounds?: Sound[] }[] = [];
  let pos = startAtZero ? 0 : Math.floor(clusters[0].start / bpb) * bpb;
  const origin = pos;
  clusters.forEach((c, i) => {
    if (c.start > pos + 1e-9) timeline.push({ beats: c.start - pos });
    const next = clusters[i + 1]?.start ?? Infinity;
    const end = Math.min(c.end, next);
    if (end - c.start > 1e-9) timeline.push({ beats: end - c.start, sounds: c.sounds });
    pos = Math.max(pos, end);
  });

  const events: TabEvent[] = [];
  let t = origin;
  let nextBar = origin + bpb;
  const barIfDue = () => {
    while (t >= nextBar - 1e-6) {
      if (events.length && events[events.length - 1].kind !== 'bar') events.push({ kind: 'bar', style: 'single' });
      nextBar += bpb;
    }
  };
  for (const item of timeline) {
    let remaining = item.beats;
    if (!item.sounds) {
      while (remaining > 1e-6) {
        const chunk = Math.min(remaining, nextBar - t);
        events.push({ kind: 'rest', beats: chunk });
        t += chunk;
        remaining -= chunk;
        barIfDue();
      }
      continue;
    }
    // Split at bar lines: the part after each bar is a tie.
    let first = true;
    while (remaining > 1e-6) {
      const room = nextBar - t;
      const chunk = room > 1e-6 ? Math.min(remaining, room) : remaining;
      events.push(first ? { kind: 'note', sounds: item.sounds, beats: chunk } : { kind: 'note', sounds: item.sounds, beats: chunk, tied: true });
      first = false;
      t += chunk;
      remaining -= chunk;
      barIfDue();
    }
  }
  return events;
}
