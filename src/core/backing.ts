// Backing chords: the chord symbols of the song, played under it. Pure: which notes, when
// (in score beats), and how loud; the engine gives them their sound.
//
// A chord lasts until the next one ("N.C.": nothing). Three ways to play it:
// - Pad: held, soft, for as long as it lasts.
// - Strum: on every beat, the bar's first a little stronger; in 4/4, an up-strum after
//   beats 2 and 4 too (down, down-up, down, down-up).
// - Oom-pah: the bass note on the strong beat, the chord on the others (a waltz in 3/4, a
//   lilt in 6/8); in 4/4 the bass alternates root and fifth.
// Where the beats fall follows the bars (a pickup's beats are those at the end of a bar).

import { isNoChord, parseChord } from './chords';
import { barStarts } from './passage';
import type { Score } from './score';

export type BackingStyle = 'pad' | 'strum' | 'oompah' | 'drone';

export const BACKING_STYLES: { id: BackingStyle; label: string; hint: string }[] = [
  { id: 'pad', label: 'Pad', hint: 'Soft held chords, under the harmonica' },
  { id: 'strum', label: 'Strum', hint: 'A guitar-like strum on the beats' },
  { id: 'oompah', label: 'Oom-pah', hint: 'Bass on the strong beat, chord on the others (a waltz in 3/4)' },
  { id: 'drone', label: 'Drone', hint: 'A held note of the song’s key (and its fifth), for songs without chords too' },
];

/** What the drone holds: the song's key note, the harmonica's, or a note (pitch class). */
export type DroneRoot = 'song' | 'harp' | number;

/** The drone's notes: its root low (G2–F#3), the fifth over it if wanted, and the root an octave up. */
export function droneMidis(pc: number, fifth: boolean): number[] {
  const root = 43 + ((pc - 43) % 12 + 12) % 12;
  return fifth ? [root, root + 7, root + 12] : [root, root + 12];
}

/** A note (or several together) of the backing, in score beats. */
export interface BackingNote {
  at: number;
  dur: number;
  midis: number[];
  /** Loudness, 0–1. */
  vel: number;
  /** A bass note, or the chord (strummed: its notes a moment apart). */
  part: 'bass' | 'chord';
  /** Strummed upwards (the up-strum: high notes first). */
  up?: boolean;
}

/** A chord and the beats it lasts (null: no chord, "N.C."). */
export interface ChordSpan {
  start: number;
  end: number;
  tones: number[] | null;
  bass: number | null;
}

const EPS = 1e-6;

/** The song's chords in the order played: each from its symbol to the next. */
export function chordSpans(score: Score): ChordSpan[] {
  const out: ChordSpan[] = [];
  for (const ev of score.events) {
    if (!ev.chord) continue;
    const info = isNoChord(ev.chord) ? null : parseChord(ev.chord);
    // (A symbol that isn't a chord — a direction in brackets — changes nothing.)
    if (!info && !isNoChord(ev.chord)) continue;
    const last = out[out.length - 1];
    if (last) last.end = ev.start;
    out.push({ start: ev.start, end: score.totalBeats, tones: info ? info.tones.map((t) => ((t % 12) + 12) % 12) : null, bass: info ? (info.bass ?? info.root) : null });
  }
  return out.filter((c) => c.end > c.start + EPS);
}

/** Whether the song has chord symbols to play. */
export function hasChords(score: Score): boolean {
  return chordSpans(score).some((c) => c.tones);
}

/** A chord's notes, close together around the middle of the piano (at most four, the 5th left out first). */
export function chordVoicing(tones: number[]): number[] {
  const pcs = [...new Set(tones)];
  // Four notes at most: an extension's 5th goes, then the root (the bass has it).
  let keep = pcs;
  if (keep.length > 4) keep = keep.filter((_pc, i) => i !== 2);
  if (keep.length > 4) keep = keep.slice(1);
  keep = keep.slice(0, 4);
  // Each note in E3–D#4: compact, low enough to sit under a harmonica.
  return keep.map((pc) => 52 + ((pc - 52) % 12 + 12) % 12).sort((a, b) => a - b);
}

/** The bass note of a chord: E2–D#3. */
export function bassNote(pc: number): number {
  return 40 + ((pc - 40) % 12 + 12) % 12;
}

/** The beat a meter is felt in, in quarter beats (a dotted quarter in 6/8, a half in 2/2). */
export function pulseOf(time: string): number {
  const [top, bottom] = (/^(\d+)\s*\/\s*(\d+)$/.exec(time) ?? []).slice(1).map(Number);
  // (3/8, 6/8, 9/8, 12/8: in dotted quarters; 5/8, 7/8: in eighths.)
  if (bottom === 8) return top % 3 === 0 ? 1.5 : 0.5;
  if (bottom === 2) return 2;
  return 1;
}

/** A bar's length in quarter beats, from the time signature (4 when it can't be read). */
function barBeats(time: string): number {
  const [top, bottom] = (/^(\d+)\s*\/\s*(\d+)$/.exec(time) ?? []).slice(1).map(Number);
  return top > 0 && bottom > 0 ? (top * 4) / bottom : 4;
}

/**
 * The backing's notes from `from` to `to` (score beats) in `style`. A chord already sounding
 * at `from` is heard there (a pad at once; strums and the oom-pah from the next beat).
 */
export function backingNotes(score: Score, time: string, style: BackingStyle, from = 0, to = score.totalBeats, drone: number[] = []): BackingNote[] {
  // The drone: one held note, all the way (chords or not).
  if (style === 'drone') return drone.length && to > from + EPS ? [{ at: from, dur: to - from, midis: drone, vel: 0.4, part: 'chord' }] : [];
  const spans = chordSpans(score).filter((c) => c.tones && c.end > from + EPS && c.start < to - EPS);
  if (!spans.length) return [];
  const out: BackingNote[] = [];
  const at = (beat: number) => spans.find((c) => c.start <= beat + EPS && beat < c.end - EPS);

  if (style === 'pad') {
    for (const c of spans) {
      const start = Math.max(c.start, from);
      const end = Math.min(c.end, to);
      if (end > start + EPS) out.push({ at: start, dur: end - start, midis: [bassNote(c.bass!), ...chordVoicing(c.tones!)], vel: 0.32, part: 'chord' });
    }
    return out;
  }

  // The beats, on the time signature's bars: each bar's from its start. A short first bar (a
  // pickup) counts from its end; a short bar after another short bar finishes it (a pickup played
  // again after a repeat's last bar); a longer bar (or a song with no bar lines) goes on counting.
  const pulse = pulseOf(time);
  const full = barBeats(time);
  const n = Math.max(1, Math.round(full / pulse));
  const starts = barStarts(score);
  const hits: { beat: number; k: number; n: number }[] = [];
  let prevShort = 0;
  starts.forEach((s, i) => {
    const end = i + 1 < starts.length ? starts[i + 1] : score.totalBeats;
    const len = end - s;
    const short = len < full - EPS;
    let first = 0;
    let lead = 0;
    if (short && i === 0) lead = full - len;
    else if (short && prevShort && prevShort + len <= full + EPS) first = Math.round(prevShort / pulse);
    for (let k = 0; ; k++) {
      const beat = s - lead + k * pulse;
      if (beat >= end - EPS) break;
      if (beat >= s - EPS) hits.push({ beat, k: (first + k) % n, n });
    }
    prevShort = short && !(i === 0) && !first ? len : 0;
  });
  const inRange = hits.filter((h) => h.beat >= from - EPS && h.beat < to - EPS);
  inRange.forEach((h, j) => {
    const c = at(h.beat);
    if (!c) return;
    const next = inRange[j + 1]?.beat ?? Math.min(to, c.end);
    const room = Math.min(next, c.end, to) - h.beat;
    if (room <= EPS) return;
    const chord = chordVoicing(c.tones!);
    if (style === 'strum') {
      // In 4/4, an up-strum after beats 2 and 4, when the chord's still there.
      const up = h.n === 4 && pulse === 1 && (h.k === 1 || h.k === 3) && room > 0.5 + EPS;
      out.push({ at: h.beat, dur: (up ? 0.5 : room) * 0.9, midis: chord, vel: h.k === 0 ? 0.62 : 0.48, part: 'chord' });
      if (up) out.push({ at: h.beat + 0.5, dur: (room - 0.5) * 0.9, midis: chord.slice(-3), vel: 0.34, part: 'chord', up: true });
      return;
    }
    // Oom-pah: the bass on the bar's first beat (and its third, on the fifth, in 4/4 — the root
    // when the chord's just come in there).
    const bassBeat = h.k === 0 || (h.n === 4 && h.k === 2);
    if (bassBeat) {
      const fresh = h.k === 0 || Math.abs(c.start - h.beat) < EPS;
      const pc = fresh ? c.bass! : (c.tones!.find((t) => (t - c.tones![0] + 12) % 12 === 7) ?? c.bass!);
      out.push({ at: h.beat, dur: room * 0.8, midis: [bassNote(pc)], vel: 0.6, part: 'bass' });
    } else out.push({ at: h.beat, dur: Math.min(room, pulse) * 0.45, midis: chord, vel: 0.4, part: 'chord' });
  });
  return out;
}
