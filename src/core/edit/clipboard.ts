// Copy and paste in the visual editor go through the system clipboard as tab text, so
// notes can move between tabs, windows and other apps (a forum post, a message).

import { parseHtab } from '../htab/parser';
import { bodyText } from '../htab/serializer';
import { absBeat, chainAt, chainLength, EPS, findItem, fromDoc, measureSpan, placeItem, posAt, samePos, toDoc, type Item, type Pos, type Song } from './model';

interface Piece {
  rel: number;
  item: Item;
}

/** The selected notes (tied notes whole), with their start relative to the first one. */
function piecesOf(song: Song, positions: Pos[]): Piece[] {
  const heads: Pos[] = [];
  for (const p of positions) {
    const head = chainAt(song, p)[0] ?? p;
    if (findItem(song, head) && !heads.some((h) => samePos(h, head))) heads.push(head);
  }
  if (!heads.length) return [];
  const base = Math.min(...heads.map((h) => absBeat(song, h)));
  return heads
    .map((h) => {
      const item = { ...findItem(song, h)!, dur: chainLength(song, chainAt(song, h)) };
      delete item.tied;
      return { rel: absBeat(song, h) - base, item };
    })
    .sort((a, b) => a.rel - b.rel);
}

/** Tab text for the selected notes, keeping their rhythm and the rests between them. */
export function copyText(song: Song, positions: Pos[]): string {
  const pieces = piecesOf(song, positions);
  if (!pieces.length) return '';
  // Keep the bar lines where they were: the first note sits where it did in its bar, and the
  // part of that bar before it is left out (written like a pickup).
  const first = positions.map((p) => chainAt(song, p)[0] ?? p).reduce((a, b) => (absBeat(song, b) < absBeat(song, a) ? b : a));
  const phase = first.start;
  let s: Song = { meta: song.meta, cap: song.cap, measures: [{ items: [], endBar: 'single', lineBreak: true }] };
  for (const p of pieces) {
    const at = posAt(s, phase + p.rel);
    s = placeItem(s, at.m, { ...p.item, start: at.start });
  }
  const head = s.measures[0];
  if (phase > EPS) {
    head.items = head.items.map((it) => ({ ...it, start: it.start - phase }));
    head.len = song.cap - phase;
  }
  // The copied notes, not the rest of the last bar or its bar line.
  const end = phase + Math.max(...pieces.map((p) => p.rel + p.item.dur));
  const lastIndex = s.measures.length - 1;
  const last = s.measures[lastIndex];
  last.len = end - lastIndex * s.cap - (lastIndex === 0 ? phase : 0);
  last.endBar = 'none';
  return bodyText(toDoc(s).lines).trim();
}

/**
 * Pastes tab text at `at` (overwriting what's there). Accepts copied notes or any tab
 * text, e.g. "4 -4 5 -5 6" from a website. Returns null if it isn't tab.
 */
export function pasteText(song: Song, text: string, at: Pos): { song: Song; placed: Pos[]; end: Pos } | null {
  const src = text.trim();
  if (!src) return null;
  const { doc, issues } = parseHtab(/^---/.test(src) ? src : `---\n---\n${src}`);
  if (issues.some((i) => i.severity === 'error')) return null;
  const from = fromDoc(doc);
  const pieces: Piece[] = [];
  let t = 0;
  for (const m of from.measures) {
    for (const it of m.items) {
      // Ties inside the pasted text join up again; a tie at its very start has nothing to continue.
      const prev = pieces[pieces.length - 1];
      if (it.tied && prev && Math.abs(prev.rel + prev.item.dur - (t + it.start)) < EPS) prev.item.dur += it.dur;
      else pieces.push({ rel: t + it.start, item: { ...it, tied: undefined } });
    }
    t += measureSpan(from, m);
  }
  const notes = pieces.filter((p) => p.item.sounds.length || p.item.chord || p.item.lyric);
  if (!notes.length) return null;
  const base = absBeat(song, at);
  let s = song;
  const placed: Pos[] = [];
  let end = base;
  for (const p of notes) {
    const to = posAt(s, base + p.rel);
    s = placeItem(s, to.m, { ...p.item, start: to.start });
    placed.push(to);
    end = Math.max(end, base + p.rel + p.item.dur);
  }
  return { song: s, placed, end: posAt(s, end) };
}
