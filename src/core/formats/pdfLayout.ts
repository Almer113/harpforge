// Rebuilds plain, column-aligned text from positioned words — from a PDF's text
// layer or from OCR — so chord lines stay lined up with the lyrics below them.
//
// Chord sheets often mix fonts (proportional bold chords over monospaced lyrics),
// so columns come from x positions measured against the lyric character pitch,
// not from character counts.

import { isChordSymbol } from '../chords';

export interface PosWord {
  text: string;
  x0: number;
  x1: number;
  /** OCR confidence 0–100 (100 for real text). */
  conf?: number;
}

export interface PosLine {
  words: PosWord[];
  y0: number;
  y1: number;
}

export interface PosPage {
  lines: PosLine[];
  width: number;
}

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

// ---- OCR clean-up ------------------------------------------------------------------

// Common OCR misreadings of bold chord letters.
const CHORD_FIXES: Record<string, string> = {
  Cc: 'C', CC: 'C', cC: 'C', '[4': 'C', '(C': 'C', '€': 'C', '©': 'C', '¢': 'C', '[C': 'C', 'C:': 'C',
  FE: 'F', Fr: 'F', 'F:': 'F', "F'": 'F', 'F.': 'F',
  '8b': 'Bb', Bh: 'Bb', 'B6': 'Bb', '86': 'Bb', '8': 'B',
  '6': 'G', '6m': 'Gm', '67': 'G7', 'Gm7.': 'Gm7',
  Fm7: 'Fm7', Abm: 'Abm', 'A7.': 'A7', 'D7.': 'D7', 'E7.': 'E7',
  '0': 'D', 'Dd': 'D', 'Em.': 'Em', 'Am.': 'Am',
};

/** Fixes one token that should be a chord, or returns null if it can't be one. */
export function fixChordToken(tok: string): string | null {
  if (isChordSymbol(tok)) return tok;
  if (CHORD_FIXES[tok]) return CHORD_FIXES[tok];
  const stripped = tok.replace(/^[[(|.,:;'"`]+|[\]).,:;'"`|]+$/g, '');
  if (stripped && isChordSymbol(stripped)) return stripped;
  // "Cc", "FE": a chord letter followed by a doubled echo of itself.
  if (tok.length === 2 && tok[0].toUpperCase() === tok[1].toUpperCase() && isChordSymbol(tok[0])) return tok[0];
  if (tok.length === 2 && /^[A-G]$/.test(tok[0]) && /[A-Z]/.test(tok[1]) && tok[1] !== 'M') return tok[0];
  return null;
}

const REPEAT = /^[xX×]\d{1,2}$/;

function fixLyricText(t: string): string {
  return t
    .replace(/(?<=[A-Za-z]')11\b/g, 'll') // I'11 → I'll
    .replace(/(?<=[a-z])1(?=[a-z])/g, 'l') // he1lo → hello
    .replace(/(?<=\b[A-Za-z]{1,6})0(?=[a-z])/g, 'o')
    .replace(/[‘’`]/g, "'")
    .replace(/[“”]/g, '"');
}

/** Cleans OCR output in place: chord-line fixes, lyric fixes, logo/noise removal. */
export function cleanOcrPage(page: PosPage): PosPage {
  const lines: PosLine[] = [];
  for (const line of page.lines) {
    // Small low-confidence specks far to the right are logos / page furniture.
    let words = line.words.filter((w) => !(w.x0 > page.width * 0.8 && w.text.length <= 2 && (w.conf ?? 100) < 85));
    // A short low-confidence word far off to the right, cut off from the rest of the line: a logo.
    words = words.filter((w, k) => {
      const prev = words[k - 1];
      const isolated = !!prev && w.x0 - prev.x1 > page.width * 0.15 && w.x0 > page.width * 0.6;
      return !(isolated && w.text.length <= 4 && (w.conf ?? 100) < 90);
    });
    words = words.filter((w) => w.text.trim());
    if (!words.length) continue;
    const avgConf = words.reduce((a, w) => a + (w.conf ?? 100), 0) / words.length;
    const chars = words.reduce((a, w) => a + w.text.length, 0);
    if (avgConf < 45 || (chars <= 2 && avgConf < 70)) continue;

    const fixed = words.map((w) => (REPEAT.test(w.text) ? w.text.toLowerCase().replace('×', 'x') : fixChordToken(w.text)));
    const chordish = fixed.filter((f) => f !== null).length;
    if (chordish / words.length >= 0.6 && fixed.some((f) => f && !REPEAT.test(f))) {
      words = words.map((w, k) => ({ ...w, text: fixed[k] ?? w.text })).filter((_, k) => fixed[k] !== null || words.length <= 2);
    } else {
      words = words.map((w) => ({ ...w, text: fixLyricText(w.text) }));
    }
    lines.push({ ...line, words });
  }
  return { ...page, lines };
}

// ---- Layout --------------------------------------------------------------------------

/** Horizontal distance between character starts in the body text. */
function charPitch(pages: PosPage[]): number {
  const steps: number[] = [];
  for (const p of pages) {
    for (const l of p.lines) {
      if (l.words.length < 3) continue;
      for (let i = 0; i + 1 < l.words.length; i++) {
        const a = l.words[i];
        const b = l.words[i + 1];
        const d = (b.x0 - a.x0) / (a.text.length + 1);
        if (d > 0) steps.push(d);
      }
    }
  }
  if (steps.length >= 5) return median(steps);
  const widths = pages.flatMap((p) => p.lines.flatMap((l) => l.words.filter((w) => w.text.length >= 3).map((w) => (w.x1 - w.x0) / w.text.length)));
  return median(widths) * 1.1 || 8;
}

/** Joins large lines at the top of the first page (the title block) into one line. */
function titleLines(page: PosPage): { title: string | null; rest: PosLine[] } {
  const heights = page.lines.map((l) => l.y1 - l.y0);
  const med = median(heights);
  const parts: string[] = [];
  let i = 0;
  while (i < page.lines.length && i < 4 && page.lines[i].y1 - page.lines[i].y0 >= med * 1.3) {
    parts.push(page.lines[i].words.map((w) => w.text).join(' '));
    i++;
  }
  return parts.length ? { title: parts.join(' '), rest: page.lines.slice(i) } : { title: null, rest: page.lines };
}

/** Turns positioned words into column-aligned text (one text line per line). */
export function layoutPages(pages: PosPage[]): string {
  if (!pages.length) return '';
  const pitch = charPitch(pages);
  const out: string[] = [];
  pages.forEach((page, pi) => {
    let lines = page.lines;
    if (pi === 0) {
      const t = titleLines(page);
      if (t.title) out.push(t.title);
      lines = t.rest;
    }
    // Left margin from text lines (bold chord glyphs can stick out a little further left).
    const isChordish = (l: PosLine) => l.words.filter((w) => isChordSymbol(w.text)).length >= l.words.length * 0.6;
    const textLefts = lines.filter((l) => l.words.length && !isChordish(l)).map((l) => l.words[0].x0).sort((a, b) => a - b);
    const allLefts = lines.map((l) => l.words[0]?.x0).filter((x): x is number => x !== undefined).sort((a, b) => a - b);
    const lefts = textLefts.length >= 3 ? textLefts : allLefts;
    const margin = lefts[Math.floor(lefts.length * 0.1)] ?? 0;
    const heights = lines.map((l) => l.y1 - l.y0);
    const lineH = median(heights) || 20;
    let prevY1: number | null = null;
    for (const line of lines) {
      const text = line.words.map((w) => w.text).join(' ');
      if (/^page\s*\d+\s*(\/|of)\s*\d+$/i.test(text.trim())) continue;
      // Preserve paragraph gaps.
      if (prevY1 !== null && line.y0 - prevY1 > lineH * 1.6) out.push('');
      prevY1 = line.y1;
      // Chord glyphs start a little right of the letter they belong to (they're often
      // centred over it), so chord lines round down a bit.
      const chordLine = line.words.filter((w) => isChordSymbol(w.text)).length >= line.words.length * 0.6;
      const bias = chordLine ? 0.35 : 0;
      let s = '';
      for (const w of line.words) {
        const col = Math.max(0, Math.round((w.x0 - margin) / pitch - bias));
        const at = s.length === 0 ? col : Math.max(col, s.length + 1);
        s = s.padEnd(at, ' ') + w.text;
      }
      out.push(s.replace(/\s+$/, ''));
    }
    out.push('');
  });
  // Trim blank lines only: leading spaces on the first line are column positions.
  return out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').trimEnd() + '\n';
}

// ---- PDF text layer → positioned lines ---------------------------------------------

export interface TextItem {
  str: string;
  x: number;
  /** Baseline y in PDF space (grows upwards). */
  y: number;
  w: number;
  h: number;
}

/** Groups PDF text items into lines of words, top to bottom. */
export function itemsToPage(items: TextItem[], width: number, height: number): PosPage {
  const words: { text: string; x0: number; x1: number; y: number; h: number }[] = [];
  for (const it of items) {
    if (!it.str.trim()) continue;
    const per = it.str.length ? it.w / it.str.length : 0;
    const re = /\S+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(it.str))) {
      words.push({ text: m[0], x0: it.x + per * m.index, x1: it.x + per * (m.index + m[0].length), y: height - it.y, h: it.h || 10 });
    }
  }
  words.sort((a, b) => a.y - b.y || a.x0 - b.x0);
  const lines: PosLine[] = [];
  let cur: typeof words = [];
  const flush = () => {
    if (!cur.length) return;
    cur.sort((a, b) => a.x0 - b.x0);
    const h = median(cur.map((w) => w.h));
    const y = median(cur.map((w) => w.y));
    lines.push({ words: cur.map((w) => ({ text: w.text, x0: w.x0, x1: w.x1, conf: 100 })), y0: y - h, y1: y });
    cur = [];
  };
  for (const w of words) {
    if (cur.length && Math.abs(w.y - cur[0].y) > Math.max(2, cur[0].h * 0.45)) flush();
    cur.push(w);
  }
  flush();
  return { lines, width };
}

// ---- Song-level chord correction ---------------------------------------------------

// Letters OCR mixes up in bold chord names.
const LOOKALIKE: Record<string, string[]> = {
  E: ['F'], F: ['E'], C: ['G'], G: ['C'], B: ['D'], D: ['B', 'O'],
};

function lookalikes(chord: string): string[] {
  const m = /^([A-G])(.*)$/.exec(chord);
  if (!m) return [];
  return (LOOKALIKE[m[1]] ?? []).map((l) => l + m[2]);
}

/**
 * Fixes one-off chords that OCR probably misread: a chord seen only once, read with
 * low confidence, whose look-alike is common in the same song, becomes the look-alike.
 */
export function fixRareChords(pages: PosPage[]): PosPage[] {
  const isChordLine = (l: PosLine) => l.words.length > 0 && l.words.filter((w) => isChordSymbol(w.text)).length >= l.words.length * 0.6;
  const counts = new Map<string, number>();
  for (const p of pages) for (const l of p.lines) if (isChordLine(l)) for (const w of l.words) if (isChordSymbol(w.text)) counts.set(w.text, (counts.get(w.text) ?? 0) + 1);
  return pages.map((p) => ({
    ...p,
    lines: p.lines.map((l) =>
      !isChordLine(l)
        ? l
        : {
            ...l,
            words: l.words.map((w) => {
              if ((counts.get(w.text) ?? 0) > 1 || (w.conf ?? 100) >= 90) return w;
              const alt = lookalikes(w.text).find((a) => (counts.get(a) ?? 0) >= 3);
              return alt ? { ...w, text: alt } : w;
            }),
          },
    ),
  }));
}
