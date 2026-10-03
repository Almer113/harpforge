// Standard notation (via abcjs) with the harmonica tab and lyrics under the staff.
// Notes light up during playback and can be clicked like tab cards.

import abcjs from 'abcjs';
import { useEffect, useMemo, useRef } from 'react';
import { writeAbc } from '../core/formats/abc';
import { eventKey } from '../core/score';
import type { Parsed } from '../state/store';

interface Props {
  parsed: Parsed;
  activeEvents: number[];
  selectedEvent: number | null;
  onNoteClick?: (scoreIndex: number) => void;
}

export function StaffView({ parsed, activeEvents, selectedEvent, onNoteClick }: Props) {
  const host = useRef<HTMLDivElement>(null);
  // k-th rendered note/rest → its SVG elements and score index.
  const map = useRef<{ elems: SVGElement[][]; scoreIndex: (number | undefined)[]; abcElems: unknown[] }>({ elems: [], scoreIndex: [], abcElems: [] });
  const clickRef = useRef(onNoteClick);
  clickRef.current = onNoteClick;

  const abc = useMemo(() => writeAbc(parsed.doc, parsed.harp, { tabLine: true }), [parsed]);

  useEffect(() => {
    if (!host.current) return;
    const fg = getComputedStyle(document.documentElement).getPropertyValue('--staff-ink').trim() || '#e9e1d6';
    const tunes = abcjs.renderAbc(host.current, abc.text, {
      add_classes: true,
      responsive: 'resize',
      foregroundColor: fg,
      minPadding: 8,
      paddingtop: 4,
      paddingbottom: 8,
      paddingleft: 4,
      paddingright: 4,
      staffwidth: 760,
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
  }, [abc, parsed]);

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
    lastActive?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeEvents, selectedEvent, abc]);

  return <div className="staffview" ref={host} />;
}
