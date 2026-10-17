// Phase 18: the contour view — the melody's shape. Each line of the tab is a row; each note a
// bar as long as it lasts and as high as it sounds, on lanes for the pitches the song uses
// (named in the margin with the holes played on them). Blow and draw in their colours; the
// playing note, the selection, a passage, a loop and play-along marks as in the other views.

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { contourLayout, namedLanes, semitoneHeight, wrapRow, type ContourLayout, type ContourRow } from '../core/contourLayout';
import { endingLabel, ordinal } from '../core/endings';
import { holeSoundText } from '../core/htab/serializer';
import type { NoteEvent, RestEvent } from '../core/htab/types';
import { eventsIn, type Passage } from '../core/passage';
import type { Mark } from '../core/playAlong';
import { keySpelling, midiToName, type Spelling } from '../core/pitch';
import { isHeld, lineShown, lyricOf } from '../core/verses';
import type { Parsed, ReadAs } from '../state/store';
import { followTo } from './follow';
import { indexesByLine, markClass, markMap, marksPerLine, useStableClick } from './TabView';

export interface ContourShow {
  /** The holes (or notes) on the bars. */
  holes: boolean;
  chords: boolean;
  lyrics: boolean;
  /** A thin line from note to note: the tune's outline. */
  line: boolean;
}
export const CONTOUR_SHOW: ContourShow = { holes: true, chords: true, lyrics: true, line: false };

interface Props {
  parsed: Parsed;
  activeEvents: number[];
  selectedEvent: number | null;
  onSelect?: (scoreIndex: number, ev: NoteEvent | RestEvent, extend?: boolean) => void;
  passage?: Passage | null;
  loopRange?: Passage | null;
  marks?: Record<number, Mark>;
  marksPrev?: Record<number, Mark>;
  readAs?: ReadAs;
  show?: ContourShow;
  /** The verses to show (0-based): a line of words each. */
  verses?: number[];
  /** The verse being sung (the others dim), or null. */
  singing?: number | null;
}

/** Room for the lane names on the left, and the most room a beat gets. */
const GUTTER = 66;
const MAX_BEAT = 46;
// (Narrower than this, a row is broken at its bar lines instead, as the Tab view wraps.)
const MIN_BEAT = 24;
/** As wide as a beat gets so the shorter notes have room for their holes ("-3'"). */
const LABEL_BEAT = 72;
/** A note bar's height, and the rows above and below the lanes. */
const BAR = 16;
const CHORDS = 18;
const ENDINGS = 16;
const WORDS = 17;

export function ContourView({ parsed, activeEvents, selectedEvent, onSelect, passage, loopRange, marks, marksPrev, readAs = 'holes', show = CONTOUR_SHOW, verses = [0], singing = null }: Props) {
  const { doc, score, harp, indexByKey } = parsed;
  const layout = useMemo(() => contourLayout(doc, score, indexByKey), [doc, score, indexByKey]);
  const flats = keySpelling(doc.meta.key ?? harp.spec.key);
  const root = useRef<HTMLDivElement | null>(null);
  const click = useStableClick(onSelect);
  // A beat's width: the longest line fits the width there is (within limits).
  const [width, setWidth] = useState(760);
  // (Measured whenever the view's box appears: an empty tab draws none until notes come.)
  const observer = useRef<ResizeObserver | null>(null);
  const measure = useCallback((el: HTMLDivElement | null) => {
    root.current = el;
    observer.current?.disconnect();
    observer.current = null;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth || 760));
    ro.observe(el);
    observer.current = ro;
    setWidth(el.clientWidth || 760);
  }, []);
  const room = Math.max(120, width - GUTTER - 10);
  // The longest line fits the width if it can; but nearly every note (all but the shortest
  // tenth) gets room for its hole on it — a quick bent note is the one most worth labelling —
  // the rows broken at bar lines to fit.
  const short = useMemo(() => {
    const ws = layout.rows.flatMap((r) => r.bars.map((b) => b.w)).sort((a, b) => a - b);
    return ws.length ? ws[Math.floor(ws.length / 10)] : 1;
  }, [layout]);
  const beat = Math.min(room / 2, Math.max(MIN_BEAT, Math.min(MAX_BEAT, room / layout.maxBeats), Math.min(LABEL_BEAT, 28 / short)));
  const parts = useMemo(() => layout.rows.flatMap((row) => wrapRow(row, room / beat).map((part, k) => ({ part, key: `${row.li}.${k}` }))), [layout, room, beat]);

  useEffect(() => {
    if (!activeEvents.length || !root.current) return;
    // (The whole row: its chords and words stay in view, and a page turns at its top.)
    const note = root.current.querySelector(`[data-index="${activeEvents[activeEvents.length - 1]}"]`);
    followTo(note?.closest('.ct-row') ?? note);
  }, [activeEvents]);

  // A note selected elsewhere (the editor's caret, an issue clicked): into view.
  useEffect(() => {
    if (selectedEvent === null || !root.current) return;
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    root.current.querySelector(`[data-index="${selectedEvent}"]`)?.scrollIntoView({ block: 'nearest', behavior: calm ? 'auto' : 'smooth' });
  }, [selectedEvent]);

  if (!layout.rows.length) return <div className="tab-empty"><p>This tab is empty.</p></div>;

  const activeByLine = indexesByLine(score, activeEvents);
  const passageByLine = indexesByLine(score, passage ? eventsIn(score, passage) : []);
  const loopByLine = indexesByLine(score, loopRange ? eventsIn(score, loopRange) : []);
  const marksByLine = marksPerLine(score, marks, marksPrev);
  const selectedLine = selectedEvent !== null ? score.events[selectedEvent]?.line : undefined;
  return (
    <div className={`contourview ${readAs === 'notes' ? 'as-notes' : ''}`} ref={measure}>
      {parts.map(({ part: row, key }) => (
        <ContourLine
          key={key}
          parsed={parsed}
          layout={layout}
          row={row}
          beat={beat}
          flats={flats}
          asNotes={readAs === 'notes'}
          show={`${+show.holes}${+show.chords}${+show.lyrics}${+show.line}`}
          verses={verses.join(',')}
          singing={singing ?? -1}
          active={activeByLine.get(row.li) ?? ''}
          inPassage={passageByLine.get(row.li) ?? ''}
          inLoop={loopByLine.get(row.li) ?? ''}
          marks={marksByLine.get(row.li) ?? ''}
          selected={selectedLine === row.li ? selectedEvent : null}
          onSelect={click}
        />
      ))}
    </div>
  );
}

interface LineProps {
  parsed: Parsed;
  layout: ContourLayout;
  row: ContourRow;
  beat: number;
  flats: Spelling;
  asNotes: boolean;
  /** What's shown, as "1101" (holes, chords, lyrics, line). */
  show: string;
  verses: string;
  singing: number;
  active: string;
  inPassage: string;
  inLoop: string;
  marks: string;
  selected: number | null;
  onSelect: (scoreIndex: number, ev: NoteEvent | RestEvent, extend?: boolean) => void;
}

const set = (list: string) => new Set(list ? list.split(',').map(Number) : []);

/** About how wide a word is drawn (12px Inter, generously), to keep words from running into each other. */
const wordWidth = (text: string) => text.length * 7.2 + 6;
/** Words under their notes, each moved right only as far as the word before it needs. */
export function placeWords<W extends { x: number; text: string }>(words: W[]): W[] {
  let end = -Infinity;
  return words.map((w) => {
    const x = Math.max(w.x, end);
    end = x + wordWidth(w.text);
    return { ...w, x };
  });
}

/** One row (redrawn only when something in it changes). */
const ContourLine = memo(function ContourLine({ parsed, layout, row, beat, flats, asNotes, show, verses: versesKey, singing, active, inPassage, inLoop, marks, selected, onSelect }: LineProps) {
  const [holes, chords, lyrics, joined] = show.split('').map((c) => c === '1');
  const line = parsed.doc.lines[row.li];
  const { lo, hi, lanes } = layout;
  const step = semitoneHeight(lo, hi);
  const top = (row.endings.length ? ENDINGS : 0) + (chords && row.chords.length ? CHORDS : 0) + 4;
  const plot = (hi - lo) * step + BAR;
  const shownVerses = lineShown(line, versesKey.split(',').map(Number));
  const X = (b: number) => GUTTER + b * beat;
  // (A note not on this harmonica has no pitch: its "?" sits at the top.)
  const Y = (midi: number) => top + (Number.isNaN(midi) ? 0 : (hi - midi) * step);
  // A row of words for each verse shown that has words on this line.
  const sung = (v: number) => row.slots.some((s) => !!lyricOf(line.events[s.ei] as NoteEvent | RestEvent, v)?.trim() || isHeld(line.events[s.ei] as NoteEvent | RestEvent, v));
  const wordRows = (lyrics ? shownVerses.filter(sung) : []).map((v) => ({
    v,
    words: placeWords(
      row.slots.flatMap((s) => {
        const e = line.events[s.ei] as NoteEvent | RestEvent;
        const word = lyricOf(e, v)?.trim();
        return word || isHeld(e, v) ? [{ ei: s.ei, x: X(s.x) + 2, text: word || '—', held: isHeld(e, v) }] : [];
      }),
    ),
  }));
  const height = top + plot + wordRows.length * WORDS + 6;
  // (As wide as its music, or its words where they run on past it.)
  const width = Math.max(GUTTER + row.beats * beat + 8, ...wordRows.flatMap((r) => r.words.map((w) => w.x + wordWidth(w.text))));
  const named = namedLanes(lanes, step);
  const on = { active: set(active), passage: set(inPassage), loop: set(inLoop) };
  const marked = markMap(marks);
  const ev = (index: number) => {
    const sev = parsed.score.events[index];
    return line.events[sev?.eventIndex ?? -1] as NoteEvent | RestEvent | undefined;
  };
  // The outline: from each note (a chord's top one) to the next.
  const path = joined
    ? row.bars
        .filter((b, _, all) => !b.off && !all.some((o) => o.index === b.index && o.midi > b.midi))
        .map((b, k) => `${k ? 'L' : 'M'}${X(b.x) + 3},${Y(b.midi) + BAR / 2} L${X(b.x + b.w) - 3},${Y(b.midi) + BAR / 2}`)
        .join(' ')
    : '';

  return (
    <div className="ct-row">
      {row.section !== undefined && <h3 className="ct-section">{row.section}</h3>}
      {(row.bars.length > 0 || row.slots.length > 0 || row.chords.length > 0) && (
        <svg className="ct-svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="group" aria-label={row.section ? `${row.section}: the tune’s shape` : 'The tune’s shape'}>
          {/* Lanes: the pitches the song uses, named with their holes. */}
          {lanes.map((l) => (
            <g key={l.midi} className="ct-lane">
              <line x1={GUTTER - 4} x2={width - 4} y1={Y(l.midi) + BAR / 2} y2={Y(l.midi) + BAR / 2} />
              {/* (Where lanes crowd each other, the one played more is named.) */}
              {named.has(l.midi) && (
                <text x={GUTTER - 8} y={Y(l.midi) + BAR / 2 + 3.5} textAnchor="end">
                  {midiToName(l.midi, flats)}
                  {l.holes[0] !== undefined && <tspan className="ct-lane-hole"> {l.holes.slice(0, 2).join(' ')}</tspan>}
                </text>
              )}
            </g>
          ))}
          {/* Bar lines and repeat signs. */}
          {row.barLines.map((b, k) => (
            <g key={k} className={`ct-barline ${b.style}`}>
              <line x1={X(b.x)} x2={X(b.x)} y1={top - 2} y2={top + plot + 2} />
              {(b.style === 'final' || b.style === 'double' || b.style === 'repeat-end' || b.style === 'repeat-start') && (
                <line className="thick" x1={X(b.x) + (b.style === 'repeat-start' ? -2 : 2)} x2={X(b.x) + (b.style === 'repeat-start' ? -2 : 2)} y1={top - 2} y2={top + plot + 2} />
              )}
              {(b.style === 'repeat-end' || b.style === 'repeat-start') && (
                <text className="ct-repeat" x={X(b.x) + (b.style === 'repeat-end' ? -5 : 5)} y={top + plot / 2 + 4} textAnchor="middle">
                  {b.style === 'repeat-end' ? (b.times ? `×${b.times}` : ':') : ':'}
                </text>
              )}
            </g>
          ))}
          {/* 1st / 2nd endings. */}
          {row.endings.map((e, k) => (
            <g key={k} className="ct-ending">
              <path d={`M${X(e.from) + 2},${ENDINGS - 2} L${X(e.from) + 2},4 L${X(e.to) - 2},4${e.closed ? ` L${X(e.to) - 2},${ENDINGS - 2}` : ''}`} />
              {!e.continued && (
                <text x={X(e.from) + 6} y={13}>
                  <title>{`Played the ${e.nums.map(ordinal).join(' and ')} time through`}</title>
                  {endingLabel(e.nums)}
                </text>
              )}
            </g>
          ))}
          {chords &&
            row.chords.map((c, k) => (
              <text key={k} className="ct-chord" x={X(c.x) + 2} y={(row.endings.length ? ENDINGS : 0) + 13}>
                {c.text}
              </text>
            ))}
          {path && <path className="ct-outline" d={path} />}
          {/* The rests: a place to click, and to light up while they pass. */}
          {row.slots
            .filter((sl) => line.events[sl.ei]?.kind === 'rest' && sl.w > 0)
            .map((sl) => {
              const cls = ['ct-rest', on.active.has(sl.index) ? 'active' : '', selected === sl.index ? 'selected' : '', on.passage.has(sl.index) ? 'in-passage' : '', on.loop.has(sl.index) ? 'in-loop' : ''].join(' ');
              return (
                <g
                  key={`r${sl.index}`}
                  className={cls}
                  data-index={sl.index}
                  onClick={(e) => {
                    const event = ev(sl.index);
                    if (event) onSelect(sl.index, event, e.shiftKey);
                  }}
                >
                  <title>A rest</title>
                  <rect x={X(sl.x) + 1} y={top} width={Math.max(3, sl.w * beat - 2)} height={plot} rx={4} />
                </g>
              );
            })}
          {/* The notes. */}
          {row.bars.map((b, k) => {
            const sound = b.sound;
            const breath = sound.type === 'hole' ? sound.breath : 'pitch';
            const name = b.off ? 'not on this harmonica' : midiToName(b.midi, flats);
            const hole = sound.type === 'hole' ? holeSoundText(sound) : midiToName(sound.midi, flats);
            const label = b.off ? '?' : asNotes ? name : hole;
            // (Tied on from a note before it in this row: joined to it.)
            const join = b.tied && b.x > 1e-6 ? 3 : 0;
            const w = Math.max(3, b.w * beat - 2 + join);
            const x = X(b.x) + 1 - join;
            const mark = markClass(marked.get(b.index));
            const cls = [
              'ct-note',
              breath,
              b.off ? 'bad' : '',
              b.tied ? 'tied' : '',
              on.active.has(b.index) ? 'active' : '',
              selected === b.index ? 'selected' : '',
              on.passage.has(b.index) ? 'in-passage' : '',
              on.loop.has(b.index) ? 'in-loop' : '',
              mark.cls,
            ].join(' ');
            const what = sound.type === 'hole' ? `${sound.hole} ${sound.breath}${sound.bend ? `, bent ${sound.bend === 1 ? 'a half step' : `${sound.bend} half steps`}` : ''}${sound.over ? ', overblow' : ''}${sound.slide ? ', slide in' : ''}` : name;
            const first = !row.bars.some((o, j) => j < k && o.index === b.index);
            return (
              <g
                key={k}
                className={cls}
                data-index={first ? b.index : undefined}
                role={first ? 'button' : undefined}
                tabIndex={first ? 0 : undefined}
                aria-label={first ? `${what}, ${name}${b.chord ? ' (a chord)' : ''}${b.tied ? ', held on' : ''}${mark.words ? `, ${mark.words}` : ''}` : undefined}
                onClick={(e) => {
                  const event = ev(b.index);
                  if (event) onSelect(b.index, event, e.shiftKey);
                }}
                // Space selects a focused note, as on the other views' cards (Enter plays from it).
                onKeyDown={(e) => {
                  if (e.key !== ' ') return;
                  e.preventDefault();
                  e.stopPropagation();
                  const event = ev(b.index);
                  if (event) onSelect(b.index, event, e.shiftKey);
                }}
              >
                {first && <title>{`${hole === name ? name : `${hole} · ${name}`}`}</title>}
                <rect className="ct-under" x={x} y={Y(b.midi)} width={w} height={BAR} rx={4} />
                <rect className="ct-bar" x={x} y={Y(b.midi)} width={w} height={BAR} rx={4} />
                {holes && w >= label.length * 6.6 + 4 && (
                  <text x={x + 4} y={Y(b.midi) + BAR - 4.5}>
                    {label}
                  </text>
                )}
              </g>
            );
          })}
          {/* The words, a row per verse shown. */}
          {wordRows.map(({ v, words }, r) => (
            <g key={v} className={`ct-words ${singing >= 0 && singing !== v && wordRows.length > 1 ? 'dim' : ''}`}>
              {wordRows.length > 1 && (
                <text className="ct-verse" x={GUTTER - 8} y={top + plot + (r + 1) * WORDS} textAnchor="end">
                  {v + 1}.
                </text>
              )}
              {words.map((w) => (
                <text key={w.ei} x={w.x} y={top + plot + (r + 1) * WORDS} className={w.held ? 'held' : ''}>
                  {w.text}
                </text>
              ))}
            </g>
          ))}
        </svg>
      )}
    </div>
  );
});
