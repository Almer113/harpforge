// Standard notation (via abcjs), optionally with the harmonica holes and lyrics under
// the staff, chord symbols above it, and the title/tempo header.
// Notes light up during playback and can be clicked like tab cards.

import abcjs from 'abcjs';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { writeAbc } from '../core/formats/abc';
import { eventKey } from '../core/score';
import type { Parsed } from '../state/store';
import { followTo } from './follow';

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
  const versesKey = verses?.join(',');
  const abc = useMemo(
    () => writeAbc(parsed.doc, parsed.harp, { tabLine: holes, lyrics, chords, header, verses: versesKey === undefined ? undefined : versesKey.split(',').map(Number) }),
    [parsed, holes, lyrics, chords, header, versesKey],
  );

  useEffect(() => {
    if (!host.current) return;
    // Ink colour from where the staff is shown (light on the dark app, black on paper).
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
  }, [abc, parsed, oneSvgPerLine, holes, staffWidth]);

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
    // `abc`: after the staff is drawn again, its notes are new elements to highlight.
    // oxlint-disable-next-line react/exhaustive-deps, react-hooks/exhaustive-deps
  }, [activeEvents, selectedEvent, abc]);

  return <div className="staffview" ref={host} />;
}
