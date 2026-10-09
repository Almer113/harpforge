// Performance mode's one bar: the song, playback, speed, where you are, the view, the size
// and the way out. While the music plays it fades after a moment without the mouse (a small
// badge keeps the bar number), and comes back when the mouse moves.

import { useEffect, useMemo, useRef, useState } from 'react';
import { PlayStop, SpeedControl, useTransportKeys } from './Controls';
import { pageTurnKey, startPerformanceView, turnPage } from './follow';
import { Popover } from './Popover';
import { keysTaken } from '../live/focus';
import { ReadAsSwitch, ShowItems, ViewSwitch } from './Sheet';
import { barAt, barStarts } from '../core/passage';
import { songVerses } from '../core/verses';
import { exitPerform, performResize } from '../state/perform';
import { setAlong } from '../state/playAlong';
import { DEFAULT_PERFORM_SIZE, PERFORM_SIZES, useApp, useParsed } from '../state/store';

const IDLE_MS = 2500;
/** The note last heard: "Bar 5" stays up through the gaps between notes. */
let lastPlayed: number | null = null;
/** The first fade of a visit says how to get the bar back. */
let hinted = false;
const VIEW_NAMES = { simple: 'Simple tab', tab: 'Tab', staff: 'Staff', numbers: 'Numbers', lyrics: 'Lyrics' };

export function PerformBar() {
  useTransportKeys();
  const { doc, score } = useParsed();
  const playing = useApp((s) => s.play === 'playing');
  const view = useApp((s) => s.sheetView);
  const move = useApp((s) => s.performMove);
  const silent = useApp((s) => s.performSilent);
  const size = useApp((s) => s.performSize);
  const along = useApp((s) => s.along);
  const alongPasses = useApp((s) => s.alongPasses.length);
  // Playing along without the tune: it's silent already, whatever this button says.
  const alongSilent = useApp((s) => s.along && !s.alongMelody);
  // Where you are: the playing note (or the last one, between notes), else the selected one.
  const at = useApp((s) => {
    const now = s.activeEvents.at(-1);
    if (now !== undefined || s.play === 'stopped') lastPlayed = now ?? null;
    return now ?? lastPlayed ?? s.selectedEvent;
  });
  const starts = useMemo(() => barStarts(score), [score]);
  const second = useApp((s) => s.play !== 'stopped' && s.playPass === 2);
  // With several verses: which one is being sung (else "2nd time" in a repeat).
  const verseCount = useMemo(() => songVerses(doc), [doc]);
  const verse = useApp((s) => (s.play !== 'stopped' && s.playVerses && verseCount > 1 ? s.playVerse + 1 : null));
  const ev = at !== null && at !== undefined ? score.events[at] : undefined;
  const bar = ev ? barAt(score, ev.start, starts) + 1 : null;
  const where = bar ? `Bar ${bar} of ${starts.length}${verse ? ` · Verse ${verse}` : second ? ' · 2nd time' : ''}` : `${starts.length} bars`;

  const { idle, hint } = useIdle(playing);

  // Page Down / Up and the arrows (and the pedals that send them) turn pages; first, so the
  // harmonica's arrow keys and the page's own scrolling don't take them.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const dir = pageTurnKey(e);
      if (dir === null || keysTaken(e)) return;
      e.preventDefault();
      e.stopPropagation();
      turnPage(dir);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  const bar0 = useRef<HTMLDivElement>(null);
  // The bar's height, so the music starts below it and following keeps notes out from under it.
  useEffect(() => {
    const el = bar0.current;
    if (!el) return;
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty('--perform-bar-h', `${el.offsetHeight}px`));
    ro.observe(el);
    // The page under it has changed completely: start at the top, or at the selected note.
    document.documentElement.style.setProperty('--perform-bar-h', `${el.offsetHeight}px`);
    const sel = useApp.getState().selectedEvent;
    startPerformanceView(sel !== null ? document.querySelector(`.sheet [data-index="${sel}"]`) : null);
    return () => ro.disconnect();
  }, []);

  const sizeButton = (dir: -1 | 1, label: string, title: string) => {
    // (Not disabled at the ends, which would drop the keyboard's place: it just does nothing.)
    const end = dir < 0 ? size <= PERFORM_SIZES[0] : size >= PERFORM_SIZES[PERFORM_SIZES.length - 1];
    return (
      <button onClick={() => !end && performResize(dir)} aria-disabled={end} className={end ? 'at-end' : ''} title={title} aria-label={dir < 0 ? 'Smaller' : 'Bigger'}>
        {label}
      </button>
    );
  };
  const usual = Math.round(DEFAULT_PERFORM_SIZE * 100);

  return (
    <>
      <div ref={bar0} className={`perform-bar ${idle ? 'idle' : ''}`} role="region" aria-label="Performance mode controls">
        <span className="pf-title" title={doc.meta.title || 'Untitled'}>{doc.meta.title || 'Untitled'}</span>
        <PlayStop perform />
        <button
          className={`t-btn toggle ${silent || alongSilent ? 'on' : ''}`}
          onClick={() => !alongSilent && useApp.setState({ performSilent: !silent })}
          aria-disabled={alongSilent}
          title={
            alongSilent
              ? 'Silent: the tune is off while you play along'
              : silent
                ? 'Silent: the music moves at tempo without the tune (click for the tune; the metronome gives a click)'
                : 'Silent: the music moves at tempo without the tune, for playing it yourself (the metronome gives a click)'
          }
          aria-label="Silent"
          aria-pressed={silent || alongSilent}
        >
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 9h4l5-4v14l-5-4H4z" />
            {silent || alongSilent ? <path d="M17 9l5 6M22 9l-5 6" /> : <path d="M17 8.5a5 5 0 0 1 0 7M19.5 6a8.5 8.5 0 0 1 0 12" />}
          </svg>
        </button>
        <SpeedControl />
        <span className="pf-where t-value">{where}</span>
        {along && (
          <span className="loop-chip along-chip">
            <span role="status">Playing along{alongPasses ? ` · ${alongPasses} pass${alongPasses === 1 ? '' : 'es'}` : ''}</span>
            <button className="loop-chip-x" onClick={() => setAlong(false)} title="Finish playing along: shows how it went" aria-label="Finish playing along">
              ✓
            </button>
          </span>
        )}
        {/* The view, what it shows and how it moves, in one menu: the bar stays one row on a laptop. */}
        <Popover label={`${VIEW_NAMES[view]} ▾`} title="Choose the view, what it shows, and how the music moves as it plays" kind="panel" panelClass="menu pf-view-menu" wrapClass="pf-view-wrap" panelLabel="View">
          <ViewSwitch short />
          {(view === 'tab' || view === 'simple' || view === 'lyrics') && <ReadAsSwitch />}
          {view !== 'simple' && (
            <div className="pf-show">
              <span className="pb-head">Show</span>
              <ShowItems view={view} />
            </div>
          )}
          <span className="pb-head">As it plays</span>
          <div className="seg" role="radiogroup" aria-label="How the music moves as it plays">
            <button role="radio" aria-checked={move === 'scroll'} className={move === 'scroll' ? 'on' : ''} onClick={() => useApp.setState({ performMove: 'scroll' })} title="The music scrolls smoothly, keeping the playing line near the top">
              Scroll
            </button>
            <button role="radio" aria-checked={move === 'pages'} className={move === 'pages' ? 'on' : ''} onClick={() => useApp.setState({ performMove: 'pages' })} title="The music stays still and turns a page at a time; the line you're on carries over">
              Pages
            </button>
          </div>
          <span className="mi-hint">Page Down / Up or the arrow keys turn pages (as do page-turner pedals).</span>
        </Popover>
        <div className="seg pf-size" role="group" aria-label="Music size">
          {sizeButton(-1, 'A−', 'Smaller (Ctrl+−)')}
          <button onClick={() => performResize(0)} title={`Back to ${usual}% (Ctrl+0)`} aria-label={`Music size ${Math.round(size * 100)}%: back to ${usual}%`}>
            {Math.round(size * 100)}%
          </button>
          {sizeButton(1, 'A+', 'Bigger (Ctrl+=)')}
        </div>
        <button className="btn small ghost pf-exit" onClick={exitPerform} title="Leave performance mode (F or Esc)">
          Exit
        </button>
      </div>
      {/* While the bar is away: where you are, and (the first time) how to get it back. */}
      <span className={`pf-badge ${idle ? 'shown' : ''}`} aria-hidden>
        {where}
        {hint && ' · move the mouse for the controls'}
      </span>
    </>
  );
}

/**
 * Whether the bar can fade: while playing, a moment after the mouse last moved — not while
 * the mouse is on the bar, the keyboard is in it, or one of its menus is open. A click while
 * it's away only brings it back (it doesn't reach the music underneath).
 */
function useIdle(playing: boolean): { idle: boolean; hint: boolean } {
  const [idle, setIdle] = useState(false);
  const [hint, setHint] = useState(false);
  const away = useRef(false);
  useEffect(() => {
    if (!playing) return;
    let timer = 0;
    let swallow = false;
    const busy = () => !!document.querySelector('.perform-bar:hover, .perform-bar :focus-visible, .pop-panel, .modal-backdrop');
    const wake = () => {
      away.current = false;
      setIdle(false);
      clearTimeout(timer);
      timer = window.setTimeout(function check() {
        if (busy()) timer = window.setTimeout(check, IDLE_MS);
        else {
          away.current = true;
          setIdle(true);
          if (!hinted) {
            hinted = true;
            setHint(true);
            setTimeout(() => setHint(false), 5000);
          }
        }
      }, IDLE_MS);
    };
    wake();
    // (Of the keys, only Tab, going to the bar: page turns and harmonica keys leave it be.)
    const tab = (e: KeyboardEvent) => e.key === 'Tab' && wake();
    const down = (e: PointerEvent) => {
      if (away.current) {
        e.preventDefault();
        e.stopPropagation();
        swallow = true;
      }
      wake();
    };
    const click = (e: MouseEvent) => {
      if (!swallow) return;
      swallow = false;
      e.preventDefault();
      e.stopPropagation();
    };
    const events = ['mousemove', 'wheel'] as const;
    for (const e of events) window.addEventListener(e, wake, { passive: true });
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('click', click, true);
    window.addEventListener('keydown', tab);
    return () => {
      clearTimeout(timer);
      for (const e of events) window.removeEventListener(e, wake);
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('click', click, true);
      window.removeEventListener('keydown', tab);
      away.current = false;
      setIdle(false);
    };
  }, [playing]);
  return { idle: playing && idle, hint };
}
