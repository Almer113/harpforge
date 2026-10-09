// Lyrics view: the words read as text, like a chord sheet, with each syllable's hole (or
// note) small above it and the chords above that. Notes held over a syllable sit beside its
// note; lines without words show as a compact line of holes. Section headings stand out.

import { memo, useEffect, useMemo, useRef } from 'react';
import type { NoteEvent, RestEvent } from '../core/htab/types';
import { hasWords, lyricsLine, type LyNote } from '../core/lyricsLayout';
import { eventsIn, type Passage } from '../core/passage';
import type { Mark } from '../core/playAlong';
import { eventKey } from '../core/score';
import { keySpelling, midiToName, type Spelling } from '../core/pitch';
import type { Parsed, ReadAs } from '../state/store';
import { followTo } from './follow';
import { breathClass, NoteNames, Token } from './SimpleTabView';
import { indexesByLine, markClass, markMap, marksPerLine, useStableClick } from './TabView';

interface Props {
  parsed: Parsed;
  activeEvents: number[];
  selectedEvent: number | null;
  /** `extend`: Shift was held (the passage runs to this note). */
  onSelect?: (scoreIndex: number, ev: NoteEvent | RestEvent, extend?: boolean) => void;
  passage?: Passage | null;
  loopRange?: Passage | null;
  marks?: Record<number, Mark>;
  marksPrev?: Record<number, Mark>;
  readAs?: ReadAs;
  /** The holes (or notes) above the words, and the chords above them. */
  show?: { holes: boolean; chords: boolean };
}

export function LyricsView({ parsed, activeEvents, selectedEvent, onSelect, passage, loopRange, marks, marksPrev, readAs = 'holes', show = { holes: true, chords: true } }: Props) {
  const { doc, score, harp } = parsed;
  const flats = keySpelling(doc.meta.key ?? harp.spec.key);
  const root = useRef<HTMLDivElement>(null);
  const click = useStableClick(onSelect);
  const anyWords = useMemo(() => doc.lines.some((l) => l.events.some((e) => e.kind !== 'bar' && !!e.lyric?.trim())), [doc]);

  // Following goes by the syllable (always shown, even with the holes hidden).
  useEffect(() => {
    if (!activeEvents.length || !root.current) return;
    const el = root.current.querySelector(`[data-index="${activeEvents[activeEvents.length - 1]}"]`);
    followTo(el?.closest('.ly-syl') ?? el);
  }, [activeEvents]);

  const lines = doc.lines.map((l, li) => ({ li, has: l.events.some((e) => e.kind !== 'bar') || l.section !== undefined })).filter((l) => l.has);
  if (!lines.length) return <div className="tab-empty"><p>This tab is empty.</p></div>;

  const activeByLine = indexesByLine(score, activeEvents);
  const passageByLine = indexesByLine(score, passage ? eventsIn(score, passage) : []);
  const loopByLine = indexesByLine(score, loopRange ? eventsIn(score, loopRange) : []);
  const marksByLine = marksPerLine(score, marks, marksPrev);
  const selectedLine = selectedEvent !== null ? score.events[selectedEvent]?.line : undefined;
  return (
    <div className={`lyricsview ${readAs === 'notes' ? 'as-notes' : ''} ${show.holes ? '' : 'no-holes'}`} ref={root}>
      {!anyWords && <p className="muted small ly-none">This song has no words yet. Add them in the editor, on a <code>w:</code> line under the tab.</p>}
      {lines.map(({ li }) => (
        <LyricsLine
          key={li}
          parsed={parsed}
          li={li}
          active={activeByLine.get(li) ?? ''}
          inPassage={passageByLine.get(li) ?? ''}
          inLoop={loopByLine.get(li) ?? ''}
          marks={marksByLine.get(li) ?? ''}
          selected={selectedLine === li ? selectedEvent : null}
          asNotes={readAs === 'notes'}
          chords={show.chords}
          holes={show.holes}
          flats={flats}
          onSelect={onSelect ? click : undefined}
        />
      ))}
    </div>
  );
}

/** One line of the lyrics view (redrawn only when something in it changes). */
const LyricsLine = memo(function LyricsLine({
  parsed,
  li,
  active,
  inPassage,
  inLoop,
  marks,
  selected,
  asNotes,
  chords,
  holes,
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
  chords: boolean;
  holes: boolean;
  flats: Spelling;
  /** None on paper (Print): nothing to click. */
  onSelect?: (scoreIndex: number, ev: NoteEvent | RestEvent, extend?: boolean) => void;
}) {
  const { doc, indexByKey, score } = parsed;
  const line = doc.lines[li];
  const words = useMemo(() => lyricsLine(line), [line]);
  const set = (list: string) => new Set(list ? list.split(',').map(Number) : []);
  const activeSet = set(active);
  const passageSet = set(inPassage);
  const loopSet = set(inLoop);
  const markOf = markMap(marks);
  // A chord row only where the line has chords, so lines without stay compact.
  const chordRow = chords && words.some((w) => w.syllables.some((s) => s.notes.some((n) => n.chord)));
  const indexOf = (n: LyNote) => indexByKey.get(eventKey(li, n.ei));
  /** A note's states, as classes ("selected in-loop mark-late"), and its mark in words. */
  const states = (idx: number | undefined) => {
    if (idx === undefined) return { cls: '', words: '' };
    const mark = markClass(markOf.get(idx));
    return { cls: `${idx === selected ? 'selected' : ''} ${passageSet.has(idx) ? 'in-passage' : ''} ${loopSet.has(idx) ? 'in-loop' : ''} ${mark.cls}`, words: mark.words };
  };
  const names = (idx: number | undefined) => (idx === undefined ? '' : (score.events[idx]?.midis ?? []).map((m) => (m === null ? '?' : midiToName(m, flats))).join(' + '));

  const column = (n: LyNote, wordHere: boolean) => {
    const ev = line.events[n.ei] as NoteEvent | RestEvent;
    const idx = indexOf(n);
    const isActive = idx !== undefined && activeSet.has(idx);
    const st = states(idx);
    const chord = chordRow && <span className="ly-chord">{n.chord ?? ''}</span>;
    if (n.kind !== 'note' || ev.kind !== 'note') {
      return (
        <span key={n.ei} className={`ly-note ly-rest ${isActive ? 'active' : ''}`} data-index={idx}>
          {chord}
          <span className="ly-hole" />
        </span>
      );
    }
    // With the holes hidden, a word's note has nothing to show: its syllable takes the
    // keyboard instead (and shows the note's states).
    const hidden = !holes && wordHere;
    return (
      <button
        key={n.ei}
        data-index={idx}
        className={`ly-note ${breathClass(ev)} ${isActive ? 'active' : ''} ${st.cls}`}
        onClick={(e) => idx !== undefined && onSelect?.(idx, ev, e.shiftKey)}
        tabIndex={hidden || !onSelect ? -1 : undefined}
        aria-label={`${names(idx)}${st.words ? ` · ${st.words}` : ''}`}
        title={`${names(idx)}${st.words ? ` · ${st.words}` : ''}`}
      >
        {chord}
        <span className="ly-hole">{asNotes && idx !== undefined ? <NoteNames midis={score.events[idx]?.midis ?? []} flats={flats} /> : <Token ev={ev} />}</span>
      </button>
    );
  };

  return (
    <div className="ly-block">
      {line.section !== undefined && <div className="tab-section ly-section">{line.section}</div>}
      {words.length > 0 && (
        <div className={`ly-line ${hasWords(words) ? '' : 'ly-fills'}`}>
          {words.map((w, wi) => (
            <span className="ly-word" key={wi}>
              {w.syllables.map((s, si) => {
                const first = s.notes[0];
                const idx = first && indexOf(first);
                const select = (extend: boolean) => {
                  const ev = first && line.events[first.ei];
                  if (idx !== undefined && ev && ev.kind !== 'bar') onSelect?.(idx, ev, extend);
                };
                const on = s.notes.some((n) => {
                  const i = indexOf(n);
                  return i !== undefined && activeSet.has(i);
                });
                return (
                  <span key={si} className={`ly-syl ${s.joined ? 'joined' : ''} ${on ? 'active' : ''} ${s.text ? '' : 'fill'}`}>
                    <span className="ly-notes">{s.notes.map((n, k) => column(n, k === 0 && !!s.text))}</span>
                    {s.text && (
                      // The words play from their note too. The note above is the button for the
                      // keyboard, unless the holes are hidden: then the syllable is.
                      <span
                        className={`ly-text ${holes ? '' : states(idx).cls}`}
                        role={!holes && onSelect ? 'button' : undefined}
                        tabIndex={!holes && onSelect ? 0 : undefined}
                        aria-label={!holes && onSelect ? `${s.text}: ${names(idx)}${states(idx).words ? ` · ${states(idx).words}` : ''}` : undefined}
                        onClick={(e) => select(e.shiftKey)}
                        onKeyDown={(e) => {
                          if (holes || (e.key !== 'Enter' && e.key !== ' ')) return;
                          e.preventDefault();
                          e.stopPropagation();
                          select(e.shiftKey);
                        }}
                      >
                        {s.text}
                      </span>
                    )}
                  </span>
                );
              })}
            </span>
          ))}
        </div>
      )}
    </div>
  );
});
