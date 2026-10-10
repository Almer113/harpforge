// Simple tab: just the holes, all the same size, a small gap between measures and
// the tab's own line breaks, with the sections' names and the repeat signs. No rhythm,
// chords, lyrics or rests.

import { memo, useEffect, useRef } from 'react';
import { holeSoundText, soundText } from '../core/htab/serializer';
import type { NoteEvent, TabDoc, TabEvent } from '../core/htab/types';
import { eventKey } from '../core/score';
import { eventsIn, type Passage } from '../core/passage';
import type { Parsed, ReadAs } from '../state/store';
import { midiToName, keySpelling, type Spelling } from '../core/pitch';
import { followTo } from './follow';
import { indexesByLine, markClass, markMap, marksPerLine, useStableClick } from './TabView';
import type { Mark } from '../core/playAlong';
import { endingLabel, ordinal } from '../core/endings';

interface Props {
  parsed: Parsed;
  activeEvents: number[];
  selectedEvent: number | null;
  /** `extend`: Shift was held (the passage runs to this note). */
  onSelect?: (scoreIndex: number, ev: NoteEvent, extend?: boolean) => void;
  /** The chosen passage and the looped one, shown as bands behind their notes. */
  passage?: Passage | null;
  loopRange?: Passage | null;
  /** Play-along marks by score index, and the last pass's. */
  marks?: Record<number, Mark>;
  marksPrev?: Record<number, Mark>;
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
export function Token({ ev }: { ev: NoteEvent }) {
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
export function NoteNames({ midis, flats }: { midis: (number | null)[]; flats: Spelling }) {
  return <>{midis.map((m) => (m === null ? '?' : midiToName(m, flats).replace('#', '♯').replace(/b(?=-?\d)/, '♭'))).join(' ')}</>;
}

export function breathClass(ev: NoteEvent): string {
  if (ev.sounds.every((s) => s.type === 'hole' && s.breath === 'blow')) return 'blow';
  if (ev.sounds.every((s) => s.type === 'hole' && s.breath === 'draw')) return 'draw';
  return 'other';
}

interface SimpleMeasure {
  notes: { ev: NoteEvent; ei: number }[];
  /** A repeat starts here ("|:") / ends here (":|", played `times` times through when more than twice). */
  open?: boolean;
  close?: boolean;
  times?: number;
  /** It starts a 1st/2nd… ending. */
  ending?: number[];
}

/**
 * Splits a line into measures of played notes (rests and ties are left out), with the repeat
 * signs: one by a measure of rests only goes on the nearest measure with notes.
 */
function measuresOf(events: TabEvent[]): SimpleMeasure[] {
  const out: SimpleMeasure[] = [{ notes: [] }];
  let open = false;
  events.forEach((ev, ei) => {
    if (ev.kind === 'bar') {
      if (ev.style === 'repeat-end') {
        const last = [...out].reverse().find((m) => m.notes.length);
        if (last) {
          last.close = true;
          if (ev.times && ev.times > 2) last.times = ev.times;
        }
      }
      if (out[out.length - 1].notes.length) out.push({ notes: [] });
      if (ev.style === 'repeat-start') open = true;
    } else if (ev.kind !== 'note' || ev.tied || !ev.sounds.length) {
      // (A bar starting with a rest: its ending still shows, at its first hole.)
      if (ev.ending && !out[out.length - 1].notes.length) out[out.length - 1].ending = ev.ending;
    } else {
      const m = out[out.length - 1];
      if (ev.ending && !m.notes.length) m.ending = ev.ending;
      if (open && !m.notes.length) m.open = true;
      open = false;
      m.notes.push({ ev, ei });
    }
  });
  return out.filter((m) => m.notes.length);
}

/** The first lines of a tab in Simple Tab style, not clickable (library cards). */
export function SimpleTabPreview({ doc, lines = 2 }: { doc: TabDoc; lines?: number }) {
  const shown = doc.lines.map((l) => measuresOf(l.events).map((m) => m.notes)).filter((m) => m.length).slice(0, lines);
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

export function SimpleTabView({ parsed, activeEvents, selectedEvent, onSelect, passage, loopRange, marks, marksPrev, readAs = 'holes' }: Props) {
  const { doc, score, harp } = parsed;
  const flats = keySpelling(doc.meta.key ?? harp.spec.key);
  const root = useRef<HTMLDivElement>(null);
  const click = useStableClick(onSelect);

  useEffect(() => {
    if (!activeEvents.length || !root.current) return;
    followTo(root.current.querySelector(`[data-index="${activeEvents[activeEvents.length - 1]}"]`));
  }, [activeEvents]);

  const lines = doc.lines.map((l, li) => ({ li, has: l.events.some((e) => e.kind !== 'bar') })).filter((l) => l.has);
  if (!lines.length) return <div className="tab-empty"><p>This tab is empty.</p></div>;

  // Each line redraws only when its own notes start or stop sounding (or are selected).
  const activeByLine = indexesByLine(score, activeEvents);
  const passageByLine = indexesByLine(score, passage ? eventsIn(score, passage) : []);
  const loopByLine = indexesByLine(score, loopRange ? eventsIn(score, loopRange) : []);
  const marksByLine = marksPerLine(score, marks, marksPrev);
  const selectedLine = selectedEvent !== null ? score.events[selectedEvent]?.line : undefined;
  return (
    <div className={`simpletab ${readAs === 'notes' ? 'as-notes' : ''}`} ref={root}>
      {lines.map(({ li }) => (
        <SimpleLine key={li} parsed={parsed} li={li} active={activeByLine.get(li) ?? ''} inPassage={passageByLine.get(li) ?? ''} inLoop={loopByLine.get(li) ?? ''} marks={marksByLine.get(li) ?? ''} selected={selectedLine === li ? selectedEvent : null} asNotes={readAs === 'notes'} flats={flats} onSelect={click} />
      ))}
    </div>
  );
}

/** One line of the simple tab (redrawn only when something in it changes). */
const SimpleLine = memo(function SimpleLine({
  parsed,
  li,
  active,
  inPassage,
  inLoop,
  marks,
  selected,
  asNotes,
  flats,
  onSelect,
}: {
  parsed: Parsed;
  li: number;
  active: string;
  inPassage: string;
  inLoop: string;
  marks: string;
  selected: number | null;
  asNotes: boolean;
  flats: Spelling;
  onSelect: (scoreIndex: number, ev: NoteEvent, extend?: boolean) => void;
}) {
  const { doc, indexByKey, score } = parsed;
  const set = (list: string) => new Set(list ? list.split(',').map(Number) : []);
  const activeSet = set(active);
  const passageSet = set(inPassage);
  const loopSet = set(inLoop);
  const markOf = markMap(marks);
  const section = doc.lines[li].section;
  return (
    <>
    {section && <div className="st-section">{section}</div>}
    <div className="st-line">
      {measuresOf(doc.lines[li].events).map((m, mi) => (
        <span className="st-measure" key={mi}>
          {m.open && <span className="st-repeat" aria-label="Repeat from here" title="Repeat from here">|:</span>}
          {m.ending && (
            <span className="st-ending" title={`An ending: played the ${m.ending.map(ordinal).join(' and ')} time through`}>
              {endingLabel(m.ending)}
            </span>
          )}
          {m.notes.map(({ ev, ei }) => {
            const idx = indexByKey.get(eventKey(li, ei));
            const isActive = idx !== undefined && activeSet.has(idx);
            const isSelected = idx !== undefined && idx === selected;
            const mark = markClass(idx !== undefined ? markOf.get(idx) : undefined);
            const band = idx === undefined ? '' : `${passageSet.has(idx) ? 'in-passage' : ''} ${loopSet.has(idx) ? 'in-loop' : ''} ${mark.cls}`;
            return (
              <button
                key={ei}
                data-index={idx}
                className={`st-note ${breathClass(ev)} ${isActive ? 'active' : ''} ${isSelected ? 'selected' : ''} ${band}`}
                onClick={(e) => idx !== undefined && onSelect(idx, ev, e.shiftKey)}
                title={mark.words || undefined}
              >
                {asNotes && idx !== undefined ? <NoteNames midis={score.events[idx]?.midis ?? []} flats={flats} /> : <Token ev={ev} />}
              </button>
            );
          })}
          {m.close && (
            <span className="st-repeat" aria-label={m.times ? `Repeat back, ${m.times} times in all` : 'Repeat back'} title={m.times ? `Repeat back: ${m.times} times through in all` : 'Repeat back to the |: (or the start)'}>
              :|{m.times ? `×${m.times}` : ''}
            </span>
          )}
        </span>
      ))}
    </div>
    </>
  );
});
