// Standard notation (via abcjs), optionally with the harmonica holes and lyrics under
// the staff, chord symbols above it, and the title/tempo header.
// Notes light up during playback and can be clicked like tab cards.

import abcjs from 'abcjs';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { lineHasNoteWords, writeAbc } from '../core/formats/abc';
import { eventKey } from '../core/score';
import type { Parsed } from '../state/store';
import { isHeld, lineShown, lyricOf, songVerses } from '../core/verses';
import { followTo } from './follow';
import { useShownTheme } from '../state/theme';

interface Props {
  parsed: Parsed;
  activeEvents: number[];
  selectedEvent: number | null;
  onNoteClick?: (scoreIndex: number) => void;
  show?: { holes: boolean; lyrics: boolean; chords: boolean; header: boolean };
  /** One drawing per line, so printed pages can break between lines. */
  oneSvgPerLine?: boolean;
  /** The width the staff is laid out to (it's then scaled to fit): less is bigger. */
  staffWidth?: number;
  /** Which verses' lyrics (0-based; default all). */
  verses?: number[];
}

export function StaffView({ parsed, activeEvents, selectedEvent, onNoteClick, show = { holes: true, lyrics: true, chords: true, header: true }, oneSvgPerLine = false, staffWidth = 760, verses }: Props) {
  const host = useRef<HTMLDivElement>(null);
  // k-th rendered note/rest → its SVG elements and score index.
  const map = useRef<{ elems: SVGElement[][]; scoreIndex: (number | undefined)[]; abcElems: unknown[] }>({ elems: [], scoreIndex: [], abcElems: [] });
  const clickRef = useRef(onNoteClick);
  useLayoutEffect(() => {
    clickRef.current = onNoteClick;
  });

  const { holes, lyrics, chords, header } = show;
  // (The staff is drawn in the theme's ink: a new theme draws it again.)
  const theme = useShownTheme();
  const versesKey = verses?.join(',');
  const abc = useMemo(
    () => writeAbc(parsed.doc, parsed.harp, { tabLine: holes, lyrics, chords, header, verses: versesKey === undefined ? undefined : versesKey.split(',').map(Number) }),
    [parsed, holes, lyrics, chords, header, versesKey],
  );

  useEffect(() => {
    if (!host.current) return;
    // Ink colour from where the staff is shown (the theme's, or black on paper).
    const fg = getComputedStyle(host.current).getPropertyValue('--staff-ink').trim() || '#e9e1d6';
    const tunes = abcjs.renderAbc(host.current, abc.text, {
      add_classes: true,
      oneSvgPerLine,
      responsive: 'resize',
      foregroundColor: fg,
      minPadding: 8,
      paddingtop: 4,
      paddingbottom: 8,
      paddingleft: 4,
      paddingright: 4,
      staffwidth: staffWidth,
      format: {
        gchordfont: 'Inter 13 bold',
        vocalfont: 'JetBrains Mono 12',
        titlefont: 'Inter 18 bold',
        composerfont: 'Inter 12',
        tempofont: 'Inter 11',
        partsfont: 'Inter 12 bold',
      },
      clickListener: (abcElem) => {
        const k = map.current.abcElems.indexOf(abcElem);
        const idx = k >= 0 ? map.current.scoreIndex[k] : undefined;
        if (idx !== undefined) clickRef.current?.(idx);
      },
    });
    // Collect rendered notes/rests in order; they line up with writeAbc's `order`.
    const elems: SVGElement[][] = [];
    const abcElems: unknown[] = [];
    const tune = tunes[0] as unknown as { lines: { staff?: { voices?: { el_type: string; abselem?: { elemset: SVGElement[] } }[][] }[] }[] };
    for (const line of tune?.lines ?? []) {
      const voice = line.staff?.[0]?.voices?.[0] ?? [];
      for (const el of voice) {
        if (el.el_type !== 'note') continue;
        elems.push(el.abselem?.elemset ?? []);
        abcElems.push(el);
      }
    }
    const scoreIndex = abc.order.map(([l, e]) => parsed.indexByKey.get(eventKey(l, e)));
    map.current = { elems, scoreIndex, abcElems };
    // Each note findable by its score index, as on the other views (performance mode finds
    // where you are by it).
    elems.forEach((set, k) => {
      if (scoreIndex[k] !== undefined) set[0]?.setAttribute('data-index', String(scoreIndex[k]));
    });
    // The holes (the first line under each note) in the tab's blow/draw colours.
    if (holes) {
      const css = getComputedStyle(host.current);
      const blow = css.getPropertyValue('--blow').trim();
      const draw = css.getPropertyValue('--draw').trim();
      for (const text of host.current.querySelectorAll('text.abcjs-lyric')) {
        const first = text.querySelector('tspan');
        const holesText = first?.textContent?.trim() ?? '';
        if (!first || !/^<?-?\d/.test(holesText)) continue;
        const parts = holesText.split(/\s+/);
        const draws = parts.filter((p) => /^<?-/.test(p)).length;
        if (draws === parts.length) first.setAttribute('fill', draw);
        else if (draws === 0) first.setAttribute('fill', blow);
        first.setAttribute('font-weight', 'bold');
      }
    }
    // Words sung over a rest ("_"): the staff only puts words under notes, so they're drawn
    // here, under the rest, in their verse's row.
    if (lyrics) drawRestWords(elems, abc.order, parsed, holes, versesKey === undefined ? undefined : versesKey.split(',').map(Number));
    // Syllables held over the notes after them ("_"): the extender line, which the staff
    // library doesn't draw.
    if (lyrics) drawHolds(elems, abc.order, parsed, holes, versesKey === undefined ? undefined : versesKey.split(',').map(Number));
    // oxlint-disable-next-line react/exhaustive-deps, react-hooks/exhaustive-deps
  }, [abc, parsed, oneSvgPerLine, holes, staffWidth, lyrics, versesKey, theme]);

  // Highlight sounding + selected notes.
  useEffect(() => {
    const { elems, scoreIndex } = map.current;
    const active = new Set(activeEvents);
    let lastActive: SVGElement | undefined;
    elems.forEach((set, k) => {
      const idx = scoreIndex[k];
      const on = idx !== undefined && active.has(idx);
      const sel = idx !== undefined && idx === selectedEvent;
      for (const el of set) {
        el.classList.toggle('abcjs-playing', on);
        el.classList.toggle('abcjs-selected-note', sel && !on);
      }
      if (on && set[0]) lastActive = set[0];
    });
    followTo(lastActive);
    // `abc`, `theme`: after the staff is drawn again, its notes are new elements to highlight.
    // oxlint-disable-next-line react/exhaustive-deps, react-hooks/exhaustive-deps
  }, [activeEvents, selectedEvent, abc, theme]);

  return <div className="staffview" ref={host} />;
}

/** Where the words under a staff line start (`line`: abcjs's line class, "abcjs-l2"), and one of them to copy. */
function lyricRows(svg: SVGSVGElement, line: string): { ys: number[]; sample: SVGTextElement | null } {
  const texts = [...svg.querySelectorAll<SVGTextElement>(`text.abcjs-lyric.${line}`)];
  const ys = [...new Set(texts.map((t) => Number(t.getAttribute('y'))))].filter((y) => Number.isFinite(y)).sort((a, b) => a - b);
  return { ys, sample: texts[texts.length - 1] ?? null };
}

/**
 * Draws the syllables of sung rests under them, in the rows of their verses (the holes row
 * first, when shown). Rows are found from the words already drawn on that staff line.
 */
function drawRestWords(elems: SVGElement[][], order: [number, number][], parsed: Parsed, holes: boolean, verses: number[] | undefined) {
  const shown = verses ?? Array.from({ length: Math.max(1, songVerses(parsed.doc)) }, (_, k) => k);
  order.forEach(([l, ei], k) => {
    const ev = parsed.doc.lines[l]?.events[ei];
    const set = elems[k];
    if (!ev || ev.kind !== 'rest' || !set?.length) return;
    const list = lineShown(parsed.doc.lines[l], shown);
    // (A line with no words on its notes has them below the rests already: see writeAbc.)
    if (!lineHasNoteWords(parsed.doc.lines[l], list)) return;
    const words = list.map((v) => lyricOf(ev, v));
    if (!words.some(Boolean)) return;
    const el = set[0];
    const svg = el.ownerSVGElement;
    const line = [...el.classList].find((c) => /^abcjs-l\d+$/.test(c));
    if (!svg || !line) return;
    const { ys, sample } = lyricRows(svg, line);
    if (!ys.length || !sample) return;
    let box: DOMRect;
    try {
      box = (el as unknown as SVGGraphicsElement).getBBox();
    } catch {
      return;
    }
    // (Drawn while hidden, nothing has a size yet: the words would all go to the left edge.)
    if (!box.width && !box.height) return;
    // (A note's rows are lines of one text, 1.2em apart: the holes, then each verse.)
    const gap = Number(sample.getAttribute('font-size') || 16) * 1.2;
    words.forEach((w, i) => {
      if (!w) return;
      const t = sample.cloneNode(false) as SVGTextElement;
      t.setAttribute('x', String(box.x + box.width / 2));
      t.setAttribute('y', String(ys[0] + (i + (holes ? 1 : 0)) * gap));
      t.setAttribute('text-anchor', 'middle');
      t.classList.add('sung-rest-word');
      t.textContent = w;
      sample.parentNode?.appendChild(t);
    });
  });
}

/**
 * Draws the extender line of each syllable held over the notes after it ("Oh___"): from just
 * after the word to the last held note, in the verse's row, on the same staff line.
 */
function drawHolds(elems: SVGElement[][], order: [number, number][], parsed: Parsed, holes: boolean, verses: number[] | undefined) {
  const shown = verses ?? Array.from({ length: Math.max(1, songVerses(parsed.doc)) }, (_, k) => k);
  const boxOf = (el: SVGElement | undefined): DOMRect | null => {
    try {
      const b = (el as unknown as SVGGraphicsElement | undefined)?.getBBox();
      return b && (b.width || b.height) ? b : null;
    } catch {
      return null;
    }
  };
  for (let row = 0; row < shown.length; row++) {
    // The syllable under way in this row: its note, its staff line, its word's length, and how far its line goes.
    let run: { el: SVGElement; line: string; chars: number; to: number } | null = null;
    const finish = () => {
      if (!run) return;
      const svg = run.el.ownerSVGElement;
      const { ys, sample } = svg ? lyricRows(svg, run.line) : { ys: [], sample: null };
      const from = boxOf(run.el);
      if (svg && sample && ys.length && from) {
        const size = Number(sample.getAttribute('font-size') || 16);
        const gap = size * 1.2;
        const start = from.x + from.width / 2 + (run.chars * size * 0.55) / 2 + 2;
        if (run.to > start + 2) {
          const y = ys[0] + (row + (holes ? 1 : 0)) * gap + 2;
          const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          line.setAttribute('x1', String(start));
          line.setAttribute('x2', String(run.to));
          line.setAttribute('y1', String(y));
          line.setAttribute('y2', String(y));
          line.setAttribute('stroke', sample.getAttribute('fill') || 'currentColor');
          line.setAttribute('stroke-width', '1.2');
          line.classList.add('lyric-hold');
          sample.parentNode?.appendChild(line);
        }
      }
      run = null;
    };
    order.forEach(([l, ei], k) => {
      const line = parsed.doc.lines[l];
      const ev = line?.events[ei];
      const el = elems[k]?.[0];
      if (!ev || ev.kind === 'bar' || !el) return;
      const v = lineShown(line, shown)[row];
      if (v === undefined) return;
      const staffLine = [...el.classList].find((c) => /^abcjs-l\d+$/.test(c)) ?? '';
      const words = lyricOf(ev, v);
      if (words) {
        finish();
        run = { el, line: staffLine, chars: words.replace(/-$/, '').length, to: 0 };
        return;
      }
      if (run && isHeld(ev, v) && staffLine === run.line) {
        const b = boxOf(el);
        if (b) run.to = b.x + b.width;
        return;
      }
      if (ev.kind === 'note' && ev.tied) return;
      finish();
    });
    finish();
  }
}
