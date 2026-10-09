// The practice report: after a session of play along or practice mode, how it went, the
// holes you missed most (often a bend), and the bars to work on. Pure: it reads the
// passes (play along) or the mistakes per note (practice mode) and the song.

import { holeSoundText } from './htab/serializer';
import { midiToName } from './pitch';
import { barAt, barPassage, barStarts, type Passage } from './passage';
import type { PassResult } from './playAlong';
import type { Score, ScoreEvent } from './score';

export interface Trouble {
  /** Missed (play along) or played wrong first (practice mode). */
  misses: number;
  /** Early or late (play along). */
  off: number;
}

export interface SessionReport {
  mode: 'along' | 'practice';
  /** Play along: passes scored, and how many were clean. */
  passes: number;
  clean: number;
  /** Notes due over the session, how many were played, and (play along) how many in time. */
  notes: number;
  played: number;
  inTime: number;
  /** Practice mode: wrong notes. */
  mistakes: number;
  /** The holes (or chords) with the most trouble, worst first. */
  holes: (Trouble & { label: string })[];
  /** The bars with the most trouble, worst first. */
  bars: (Trouble & { bar: number; passage: Passage })[];
}

/** A note's label: its holes ("-3'", "(4 5)"), or note names for notes off the harmonica. */
export function noteLabel(ev: ScoreEvent): string {
  const parts = ev.sounds.map((s, k) => (s.type === 'hole' ? holeSoundText(s) : ev.midis[k] !== null ? midiToName(ev.midis[k]!) : '?'));
  return parts.length > 1 ? `(${parts.join(' ')})` : (parts[0] ?? '');
}

function troubles(score: Score, missed: Map<number, number>, off: Map<number, number>) {
  const starts = barStarts(score);
  const holes = new Map<string, Trouble>();
  const bars = new Map<number, Trouble>();
  const add = <K,>(m: Map<K, Trouble>, k: K, misses: number, o: number) => {
    const t = m.get(k) ?? { misses: 0, off: 0 };
    m.set(k, { misses: t.misses + misses, off: t.off + o });
  };
  for (const i of new Set([...missed.keys(), ...off.keys()])) {
    const ev = score.events[i];
    if (!ev) continue;
    const m = missed.get(i) ?? 0;
    const o = off.get(i) ?? 0;
    add(holes, noteLabel(ev), m, o);
    add(bars, barAt(score, ev.start, starts), m, o);
  }
  const worst = (a: Trouble, b: Trouble) => b.misses - a.misses || b.off - a.off;
  return {
    holes: [...holes].map(([label, t]) => ({ label, ...t })).sort(worst),
    bars: [...bars].map(([bar, t]) => ({ bar: bar + 1, passage: barPassage(score, bar, starts), ...t })).sort(worst),
  };
}

const tally = (lists: number[][]) => {
  const m = new Map<number, number>();
  for (const list of lists) for (const i of list) m.set(i, (m.get(i) ?? 0) + 1);
  return m;
};

/** A play-along session from its passes. */
export function alongReport(score: Score, passes: PassResult[]): SessionReport {
  const sum = (f: (p: PassResult) => number) => passes.reduce((a, p) => a + f(p), 0);
  return {
    mode: 'along',
    passes: passes.length,
    clean: passes.filter((p) => p.clean).length,
    notes: sum((p) => p.total),
    played: sum((p) => p.hit + p.early + p.late),
    inTime: sum((p) => p.hit),
    mistakes: sum((p) => p.strays),
    ...troubles(score, tally(passes.map((p) => p.missedAt)), tally(passes.map((p) => p.offAt))),
  };
}

/** A practice-mode session: notes played, and the wrong notes tried on each. */
export function practiceReport(score: Score, played: number, mistakesAt: Record<number, number>): SessionReport {
  const missed = new Map(Object.entries(mistakesAt).map(([i, n]) => [Number(i), n]));
  const mistakes = [...missed.values()].reduce((a, b) => a + b, 0);
  return { mode: 'practice', passes: 0, clean: 0, notes: played, played, inTime: played, mistakes, ...troubles(score, missed, new Map()) };
}

/**
 * How well it went, 0–100: play along, the share of notes played; practice mode, the share
 * of tries that were right.
 */
export function accuracy(r: SessionReport): number {
  if (r.mode === 'practice') return Math.round((r.played / Math.max(1, r.played + r.mistakes)) * 100);
  return Math.round((r.played / Math.max(1, r.notes)) * 100);
}
