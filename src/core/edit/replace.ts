// Phase 17b: find and replace holes — one hole as written ("-4", "6'", "6o", "<5"), found
// exactly (a -3 isn't a -3'), and replaced by another. A note held over a tie is one note:
// every part of it changes. Harmonica chords only when asked, and never into one that would
// mix blow and draw or hold the same hole twice.

import { parseHtab } from '../htab/parser';
import type { HoleSound, Sound } from '../types';
import { chainAt, cloneSong, EPS, findItem, samePos, type Pos, type Song } from './model';

/** The one hole `text` writes, or null (not a hole, or more than one). */
export function parseHole(text: string): HoleSound | null {
  // (A minus sign or dash pasted from a web page counts as the draw's "-".)
  const t = text.trim().replace(/^[\u2212\u2013\u2010]/, '-');
  if (!t || /\s/.test(t)) return null;
  const { doc, issues } = parseHtab(t);
  if (issues.some((i) => i.severity === 'error')) return null;
  const notes = doc.lines.flatMap((l) => l.events).filter((e) => e.kind === 'note');
  if (notes.length !== 1 || notes[0].kind !== 'note' || notes[0].sounds.length !== 1) return null;
  const s = notes[0].sounds[0];
  return s.type === 'hole' ? s : null;
}

export const sameHole = (a: Sound, b: HoleSound) => a.type === 'hole' && a.hole === b.hole && a.breath === b.breath && a.bend === b.bend && a.over === b.over && a.slide === b.slide;

/** Where to look: the whole song, bars from…to (a section), or chosen notes. */
export type FindScope = { kind: 'song' } | { kind: 'bars'; from: number; to: number } | { kind: 'notes'; at: Pos[] };

export interface Found {
  /** The note (the first part of a tied one). */
  at: Pos;
  /** Every part of it (more than one when it's tied over). */
  chain: Pos[];
  /** It's in a harmonica chord. */
  chord: boolean;
}

/** The notes playing `hole` (in chords too when `chords`), in order, within `scope`. */
export function findHoles(song: Song, hole: HoleSound, opts: { chords: boolean; scope: FindScope }): Found[] {
  const { scope } = opts;
  const chosen = scope.kind === 'notes' ? scope.at : [];
  const out: Found[] = [];
  song.measures.forEach((meas, m) => {
    for (const it of [...meas.items].sort((a, b) => a.start - b.start)) {
      if (it.dur <= EPS || !it.sounds.length) continue;
      const chord = it.sounds.length > 1;
      if (!(chord ? opts.chords && it.sounds.some((s) => sameHole(s, hole)) : sameHole(it.sounds[0], hole))) continue;
      const at = { m, start: it.start };
      const chain = chainAt(song, at);
      // (The tied-over parts are found with the first.)
      if (chain.length && !samePos(chain[0], at)) continue;
      // (A tied note counts when any part of it is where it's looked for.)
      if (scope.kind === 'bars' && !(chain.length ? chain : [at]).some((p) => p.m >= scope.from && p.m < scope.to)) continue;
      if (scope.kind === 'notes' && !chain.some((p) => chosen.some((c) => samePos(c, p)))) continue;
      out.push({ at, chain: chain.length ? chain : [at], chord });
    }
  });
  return out;
}

export interface Replaced {
  song: Song;
  replaced: number;
  /** Chords left as they were: blow and draw would mix, or a hole would be there twice. */
  skipped: number;
}

/** `found` with `hole` replaced by `by` (lengths, words and chord symbols as they were). */
export function replaceHoles(song: Song, found: Found[], hole: HoleSound, by: HoleSound): Replaced {
  const s = cloneSong(song);
  let replaced = 0;
  let skipped = 0;
  for (const f of found) {
    const first = findItem(s, f.at);
    if (!first) continue;
    const sounds = first.sounds.map((x) => (sameHole(x, hole) ? { ...by } : x));
    if (sounds.length > 1) {
      const holes = sounds.filter((x): x is HoleSound => x.type === 'hole');
      const mixed = new Set(holes.map((x) => x.breath)).size > 1;
      const twice = new Set(holes.map((x) => `${x.hole}${x.slide ? 's' : ''}`)).size < holes.length;
      if (mixed || twice) {
        skipped++;
        continue;
      }
      // (A chord's holes stay in order: (4 6 7), not (4 7 6).)
      sounds.sort((x, y) => (x.type === 'hole' && y.type === 'hole' ? x.hole - y.hole : 0));
    }
    for (const p of f.chain) {
      const it = findItem(s, p);
      if (it) it.sounds = sounds.map((x) => ({ ...x }));
    }
    replaced++;
  }
  return { song: s, replaced, skipped };
}
