// Verses: a tab line can have several lyrics lines ("w:"), one per verse. Verse 1 is the
// event's `lyric` (as it always was); verses 2, 3… are its `verses` (verses[0] is verse 2).

import type { TabDoc, TabLine } from './htab/types';

interface Sung {
  lyric?: string;
  verses?: (string | undefined)[];
  holds?: number[];
}

/** An event's syllable in verse `v` (0 = verse 1). */
export function lyricOf(ev: Sung, v: number): string | undefined {
  return v === 0 ? ev.lyric : ev.verses?.[v - 1];
}

/** Whether it holds the syllable before it in verse `v` ("_": "Oh___"). */
export function isHeld(ev: Sung, v: number): boolean {
  return !!ev.holds?.includes(v);
}

/** Makes it hold the syllable before it in verse `v` (or not). A hold has no syllable of its own. */
export function setHeld(ev: Sung, v: number, on: boolean) {
  const holds = (ev.holds ?? []).filter((x) => x !== v);
  if (on) {
    holds.push(v);
    holds.sort((a, b) => a - b);
    setLyricOf(ev, v, undefined);
  }
  if (holds.length) ev.holds = holds;
  else delete ev.holds;
}

/** Sets an event's syllable in verse `v` (undefined clears it), tidying away empty verses. A syllable replaces a hold. */
export function setLyricOf(ev: Sung, v: number, text: string | undefined) {
  if (text && ev.holds?.includes(v)) {
    const holds = ev.holds.filter((x) => x !== v);
    if (holds.length) ev.holds = holds;
    else delete ev.holds;
  }
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

/** Whether something is sung on it in any verse: words, or a syllable held over it. */
export function hasWords(ev: Sung): boolean {
  return hasLyrics(ev) || !!ev.holds?.length;
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
    // (A verse whose words on this line are only holds — "Oh" carried over the line break — counts.)
    for (const v of ev.holds ?? []) n = Math.max(n, v + 1);
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

/** Verse `v` on a line, or the line's last when it has fewer (a chorus with one verse sings it each time). */
export function lineVerse(line: TabLine, v: number): number {
  return Math.max(0, Math.min(v, lineVerses(line) - 1));
}

/** The verses a line shows: as chosen; one verse picked shows the line's own when it has fewer. */
export function lineShown(line: TabLine, shown: number[]): number[] {
  return shown.length === 1 ? [lineVerse(line, shown[0])] : shown;
}
