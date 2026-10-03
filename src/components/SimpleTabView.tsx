// Simple tab: just the holes, all the same size, a small gap between measures and
// the tab's own line breaks. No rhythm, chords, lyrics or rests.

import { useEffect, useRef } from 'react';
import { holeSoundText, soundText } from '../core/htab/serializer';
import type { NoteEvent, TabEvent } from '../core/htab/types';
import { eventKey } from '../core/score';
import type { Parsed } from '../state/store';

interface Props {
  parsed: Parsed;
  activeEvents: number[];
  selectedEvent: number | null;
  onSelect?: (scoreIndex: number, ev: NoteEvent) => void;
}

/** A note's holes; a chord's holes sit side by side ("456", "-1-2-3"). */
function tokenText(ev: NoteEvent): string {
  return ev.sounds.map((s) => (s.type === 'hole' ? holeSoundText(s) : soundText(s))).join('');
}

function breathClass(ev: NoteEvent): string {
  if (ev.sounds.every((s) => s.type === 'hole' && s.breath === 'blow')) return 'blow';
  if (ev.sounds.every((s) => s.type === 'hole' && s.breath === 'draw')) return 'draw';
  return 'other';
}

/** Splits a line into measures of played notes (rests and ties are left out). */
function measuresOf(events: TabEvent[]): { ev: NoteEvent; ei: number }[][] {
  const out: { ev: NoteEvent; ei: number }[][] = [[]];
  events.forEach((ev, ei) => {
    if (ev.kind === 'bar') {
      if (out[out.length - 1].length) out.push([]);
    } else if (ev.kind === 'note' && !ev.tied && ev.sounds.length) out[out.length - 1].push({ ev, ei });
  });
  return out.filter((m) => m.length);
}

export function SimpleTabView({ parsed, activeEvents, selectedEvent, onSelect }: Props) {
  const { doc, indexByKey } = parsed;
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!activeEvents.length || !root.current) return;
    root.current.querySelector(`[data-index="${activeEvents[activeEvents.length - 1]}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeEvents]);

  const lines = doc.lines.map((l, li) => ({ li, measures: measuresOf(l.events) })).filter((l) => l.measures.length);
  if (!lines.length) return <div className="tab-empty"><p>This tab is empty.</p></div>;

  return (
    <div className="simpletab" ref={root}>
      {lines.map(({ li, measures }) => (
        <div className="st-line" key={li}>
          {measures.map((m, mi) => (
            <span className="st-measure" key={mi}>
              {m.map(({ ev, ei }) => {
                const idx = indexByKey.get(eventKey(li, ei));
                const active = idx !== undefined && activeEvents.includes(idx);
                const selected = idx !== undefined && idx === selectedEvent;
                return (
                  <button
                    key={ei}
                    data-index={idx}
                    className={`st-note ${breathClass(ev)} ${active ? 'active' : ''} ${selected ? 'selected' : ''}`}
                    onClick={() => idx !== undefined && onSelect?.(idx, ev)}
                  >
                    {tokenText(ev)}
                  </button>
                );
              })}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
