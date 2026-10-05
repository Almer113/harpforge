// Copy and paste in the visual editor go through the system clipboard as tab text, so
// notes can move between tabs, windows and other apps (a forum post, a message).

import { parseHtab } from '../htab/parser';
import { bodyText } from '../htab/serializer';
import { chainAt, chainLength, clearSpan, EPS, findItem, fromDoc, measureSpan, placeItem, posAtReal, realBeat, samePos, toDoc, type Item, type Measure, type Pos, type Song } from './model';

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
  const base = Math.min(...heads.map((h) => realBeat(song, h)));
  return heads
    .map((h) => {
      const item = { ...findItem(song, h)!, dur: chainLength(song, chainAt(song, h)) };
      delete item.tied;
      return { rel: realBeat(song, h) - base, item };
    })
    .sort((a, b) => a.rel - b.rel);
}

/** Tab text for the selected notes, keeping their rhythm and the rests between them. */
export function copyText(song: Song, positions: Pos[]): string {
  const pieces = piecesOf(song, positions);
  if (!pieces.length) return '';
  // Keep the bar lines where they were: the copy starts at the first note, and its bars end
  // where the song's bars do (the first one is cut short like a pickup; short bars stay short).
  const first = positions.map((p) => chainAt(song, p)[0] ?? p).reduce((a, b) => (realBeat(song, b) < realBeat(song, a) ? b : a));
  const end = Math.max(...pieces.map((p) => p.rel + p.item.dur));
  const measures: Measure[] = [];
  for (let m = first.m, t = 0; t < end - EPS; m++) {
    const src = song.measures[m];
    const span = (src ? measureSpan(song, src) : song.cap) - (m === first.m ? first.start : 0);
    measures.push({ items: [], endBar: src?.endBar === 'none' ? 'none' : 'single', lineBreak: m === first.m, len: Math.min(span, end - t) });
    t += span;
  }
  let s: Song = { meta: song.meta, cap: song.cap, measures };
  for (const p of pieces) {
    const at = posAtReal(s, p.rel);
    s = placeItem(s, at.m, { ...p.item, start: at.start });
  }
  // Full bars are written as full bars; the last one ends at the copied notes, with no bar line.
  for (const m of s.measures) if (m.len !== undefined && m.len >= song.cap - EPS) delete m.len;
  s.measures[s.measures.length - 1].endBar = 'none';
  return bodyText(toDoc(s).lines).trim();
}

/**
 * Pastes tab text at `at` (overwriting what's there). Accepts copied notes or any tab
 * text, e.g. "4 -4 5 -5 6" from a website. Returns null if it isn't tab.
 */
export function pasteText(song: Song, text: string, at: Pos): { song: Song; placed: Pos[]; end: Pos } | null {
  const src = text.trim();
  if (!src) return null;
  const { doc, issues } = parseHtab(src.startsWith('---') ? src : `---\n---\n${src}`);
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
  const base = realBeat(song, at);
  // The pasted stretch overwrites what's there, rests included ("4 . 5" leaves a gap).
  const length = Math.max(t, ...notes.map((p) => p.rel + p.item.dur));
  let s = clearSpan(song, base, base + length);
  const placed: Pos[] = [];
  let end = base;
  for (const p of notes) {
    const to = posAtReal(s, base + p.rel);
    s = placeItem(s, to.m, { ...p.item, start: to.start });
    placed.push(to);
    end = Math.max(end, base + p.rel + p.item.dur);
  }
  return { song: s, placed, end: posAtReal(s, end) };
}
