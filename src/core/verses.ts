// Verses: a tab line can have several lyrics lines ("w:"), one per verse. Verse 1 is the
// event's `lyric` (as it always was); verses 2, 3… are its `verses` (verses[0] is verse 2).

import type { TabDoc, TabLine } from './htab/types';

interface Sung {
  lyric?: string;
  verses?: (string | undefined)[];
}

/** An event's syllable in verse `v` (0 = verse 1). */
export function lyricOf(ev: Sung, v: number): string | undefined {
  return v === 0 ? ev.lyric : ev.verses?.[v - 1];
}

/** Sets an event's syllable in verse `v` (undefined clears it), tidying away empty verses. */
export function setLyricOf(ev: Sung, v: number, text: string | undefined) {
  if (v === 0) {
    if (text) ev.lyric = text;
    else delete ev.lyric;
    return;
  }
  const verses = [...(ev.verses ?? [])];
  verses[v - 1] = text || undefined;
  while (verses.length && !verses[verses.length - 1]) verses.pop();
  if (verses.length) ev.verses = verses;
  else delete ev.verses;
}

/** Whether an event has words in any verse. */
export function hasLyrics(ev: Sung): boolean {
  return !!ev.lyric || !!ev.verses?.some((x) => !!x);
}

/** How many verses a line has: up to the last one with words (0 without any). */
export function lineVerses(line: TabLine): number {
  let n = 0;
  for (const ev of line.events) {
    if (ev.kind === 'bar') continue;
    if (ev.lyric) n = Math.max(n, 1);
    ev.verses?.forEach((x, k) => {
      if (x) n = Math.max(n, k + 2);
    });
  }
  return n;
}

/** How many verses the song has (its line with the most). */
export function songVerses(doc: TabDoc): number {
  return doc.lines.reduce((n, l) => Math.max(n, lineVerses(l)), 0);
}

/** The verses to show (0-based): all of them, or just verse `pick` (1-based) when it exists. */
export function shownVerses(count: number, pick: number): number[] {
  if (pick >= 1 && pick <= count) return [pick - 1];
  return Array.from({ length: Math.max(1, count) }, (_, k) => k);
}
