// Transposing and "make easier" for notes in the visual editor: the chosen notes are
// re-tabbed together (so hand movement stays smooth), on the same harmonica.

import { notesToTab, type ConvertStats } from '../convert';
import type { NoteEvent, TabDoc } from '../htab/types';
import { soundCost, soundPitch, type Harmonica } from '../instruments';
import type { Sound } from '../types';
import { allPositions, chainAt, findItem, samePos, updateItem, type Pos, type Song } from './model';

export interface RetabResult {
  song: Song;
  /** How many notes changed, and the techniques needed before and after. */
  changed: number;
  before: { bends: number; overblows: number };
  after: { bends: number; overblows: number };
  unplayable: number;
}

function techniques(sounds: Sound[][]) {
  let bends = 0;
  let overblows = 0;
  for (const ss of sounds) for (const s of ss) if (s.type === 'hole') {
    if (s.bend) bends++;
    if (s.over) overblows++;
  }
  return { bends, overblows };
}

/**
 * Re-tabs notes (the whole song when `positions` is empty), moved by `shift` semitones.
 * With shift 0 it finds the easiest way to play the same notes.
 */
export function retabNotes(song: Song, harp: Harmonica, positions: Pos[], shift: number): RetabResult {
  // Each note once (tied notes by their first piece), in playing order.
  const targets = (positions.length ? positions : allPositions(song))
    .map((p) => chainAt(song, p)[0] ?? p)
    .filter((p, i, all) => all.findIndex((q) => samePos(q, p)) === i && (findItem(song, p)?.sounds.length ?? 0) > 0)
    .sort((a, b) => a.m - b.m || a.start - b.start);
  const old = targets.map((p) => findItem(song, p)!.sounds);
  const doc: TabDoc = {
    meta: song.meta,
    lines: [{ events: old.map((sounds): NoteEvent => ({ kind: 'note', sounds, beats: 1 })) }],
  };
  const r = notesToTab(doc, harp, { shift, sourceHarp: harp });
  const fresh = r.doc.lines[0].events.map((e) => (e.kind === 'note' ? e.sounds : []));
  let next = song;
  let changed = 0;
  targets.forEach((p, i) => {
    const sounds = fresh[i];
    if (!sounds?.length || JSON.stringify(sounds) === JSON.stringify(old[i])) return;
    // "Make easier" never swaps a note for a harder one (the search also weighs movement).
    if (shift === 0 && cost(harp, sounds) > cost(harp, old[i])) return;
    next = updateItem(next, p, { sounds });
    changed++;
  });
  const now = targets.map((p) => findItem(next, p)?.sounds ?? []);
  return { song: next, changed, before: techniques(old), after: techniques(now), unplayable: (r.stats as ConvertStats).unplayable };
}

function cost(harp: Harmonica, sounds: Sound[]): number {
  return sounds.reduce((a, s) => a + (s.type === 'hole' ? (soundPitch(harp, s) === null ? 99 : soundCost(s)) : 50), 0);
}
