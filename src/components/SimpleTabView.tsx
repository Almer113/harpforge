// Simple tab: just the holes, all the same size, a small gap between measures and
// the tab's own line breaks. No rhythm, chords, lyrics or rests.

import { useEffect, useRef } from 'react';
import { holeSoundText, soundText } from '../core/htab/serializer';
import type { NoteEvent, TabDoc, TabEvent } from '../core/htab/types';
import { eventKey } from '../core/score';
import type { Parsed, ReadAs } from '../state/store';
import { midiToName, keyUsesFlats } from '../core/pitch';
import { followTo } from './follow';

interface Props {
  parsed: Parsed;
  activeEvents: number[];
  selectedEvent: number | null;
  onSelect?: (scoreIndex: number, ev: NoteEvent) => void;
  /** Notes mode: note names (C5) instead of holes. */
  readAs?: ReadAs;
}

/** One hole, with two-digit hole numbers underlined so "8910" reads as 8 · 9 · 10. */
function HoleText({ text }: { text: string }) {
  const m = /^(<?-?)(\d+)(.*)$/.exec(text);
  if (!m || m[2].length < 2) return <>{text}</>;
  return (
    <>
      {m[1]}
      <span className="st-two">{m[2]}</span>
      {m[3]}
    </>
  );
}

/**
 * A note's holes; a chord's holes sit side by side. A draw chord gets one minus sign
 * ("-123"); a chord mixing blow and draw keeps one per hole.
 */
function Token({ ev }: { ev: NoteEvent }) {
  const holes = ev.sounds.every((s) => s.type === 'hole');
  const allDraw = holes && ev.sounds.length > 1 && ev.sounds.every((s) => s.type === 'hole' && s.breath === 'draw');
  return (
    <>
      {allDraw && '-'}
      {ev.sounds.map((s, k) => (
        <HoleText key={k} text={s.type === 'hole' ? holeSoundText(s, allDraw) : soundText(s)} />
      ))}
    </>
  );
}

/** A note's pitches as names (Notes mode); a chord's notes sit side by side. */
function NoteNames({ midis, flats }: { midis: (number | null)[]; flats: boolean }) {
  return <>{midis.map((m) => (m === null ? '?' : midiToName(m, flats).replace('#', '♯').replace(/b(?=-?\d)/, '♭'))).join(' ')}</>;
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

/** The first lines of a tab in Simple Tab style, not clickable (library cards). */
export function SimpleTabPreview({ doc, lines = 2 }: { doc: TabDoc; lines?: number }) {
  const shown = doc.lines.map((l) => measuresOf(l.events)).filter((m) => m.length).slice(0, lines);
  if (!shown.length) return <span className="muted small">No notes yet</span>;
  return (
    <div className="simpletab preview">
      {shown.map((measures, li) => (
        <div className="st-line" key={li}>
          {measures.map((m, mi) => (
            <span className="st-measure" key={mi}>
              {m.map(({ ev, ei }) => (
                <span key={ei} className={`st-note ${breathClass(ev)}`}>
                  <Token ev={ev} />
                </span>
              ))}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

export function SimpleTabView({ parsed, activeEvents, selectedEvent, onSelect, readAs = 'holes' }: Props) {
  const { doc, indexByKey, score, harp } = parsed;
  const flats = keyUsesFlats(doc.meta.key ?? harp.spec.key);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!activeEvents.length || !root.current) return;
    followTo(root.current.querySelector(`[data-index="${activeEvents[activeEvents.length - 1]}"]`));
  }, [activeEvents]);

  const activeSet = new Set(activeEvents);
  const lines = doc.lines.map((l, li) => ({ li, measures: measuresOf(l.events) })).filter((l) => l.measures.length);
  if (!lines.length) return <div className="tab-empty"><p>This tab is empty.</p></div>;

  return (
    <div className={`simpletab ${readAs === 'notes' ? 'as-notes' : ''}`} ref={root}>
      {lines.map(({ li, measures }) => (
        <div className="st-line" key={li}>
          {measures.map((m, mi) => (
            <span className="st-measure" key={mi}>
              {m.map(({ ev, ei }) => {
                const idx = indexByKey.get(eventKey(li, ei));
                const active = idx !== undefined && activeSet.has(idx);
                const selected = idx !== undefined && idx === selectedEvent;
                return (
                  <button
                    key={ei}
                    data-index={idx}
                    className={`st-note ${breathClass(ev)} ${active ? 'active' : ''} ${selected ? 'selected' : ''}`}
                    onClick={() => idx !== undefined && onSelect?.(idx, ev)}
                  >
                    {readAs === 'notes' && idx !== undefined ? <NoteNames midis={score.events[idx]?.midis ?? []} flats={flats} /> : <Token ev={ev} />}
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
