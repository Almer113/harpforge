// Performance mode's one bar: the song, playback, speed, where you are, the view, the size
// and the way out. While the music plays it fades after a moment without the mouse, and
// comes back when the mouse moves.

import { useEffect, useMemo, useRef, useState } from 'react';
import { PlayStop, SpeedControl, useTransportKeys } from './Controls';
import { pageTurnKey, startPerformanceView, turnPage } from './follow';
import { Popover } from './Popover';
import { keysTaken } from '../live/focus';
import { ReadAsSwitch, ShowMenu, ViewSwitch } from './Sheet';
import { barAt, barStarts } from '../core/passage';
import { exitPerform, performResize } from '../state/perform';
import { PERFORM_SIZES, useApp, useParsed } from '../state/store';

const IDLE_MS = 2500;
/** The note last heard: "Bar 5" stays up through the gaps between notes. */
let lastPlayed: number | null = null;
const VIEW_NAMES = { simple: 'Simple tab', tab: 'Tab', staff: 'Staff', numbers: 'Numbers', lyrics: 'Lyrics' };

export function PerformBar() {
  useTransportKeys();
  const { doc, score } = useParsed();
  const playing = useApp((s) => s.play === 'playing');
  const view = useApp((s) => s.sheetView);
  const readAs = useApp((s) => s.readAs);
  const move = useApp((s) => s.performMove);
  const silent = useApp((s) => s.performSilent);
  const size = useApp((s) => s.performSize);
  // Where you are: the playing note (or the last one, between notes), else the selected one.
  const at = useApp((s) => {
    const now = s.activeEvents.at(-1);
    if (now !== undefined || s.play === 'stopped') lastPlayed = now ?? null;
    return now ?? lastPlayed ?? s.selectedEvent;
  });
  const starts = useMemo(() => barStarts(score), [score]);
  const ev = at !== null && at !== undefined ? score.events[at] : undefined;
  const bar = ev ? barAt(score, ev.start, starts) + 1 : null;

  const idle = useIdle(playing);
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

  return (
    <div ref={bar0} className={`perform-bar ${idle ? 'idle' : ''}`} role="toolbar" aria-label="Performance mode">
      <span className="pf-title" title={doc.meta.title || 'Untitled'}>{doc.meta.title || 'Untitled'}</span>
      <PlayStop />
      <button
        className={`t-btn toggle ${silent ? 'on' : ''}`}
        onClick={() => useApp.setState({ performSilent: !silent })}
        title={silent ? 'Silent: the music moves at tempo without the tune (click for the tune)' : 'Silent: the music moves at tempo without the tune, for playing it yourself'}
        aria-label="Silent"
        aria-pressed={silent}
      >
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M4 9h4l5-4v14l-5-4H4z" />
          {silent ? <path d="M17 9l5 6M22 9l-5 6" /> : <path d="M17 8.5a5 5 0 0 1 0 7M19.5 6a8.5 8.5 0 0 1 0 12" />}
        </svg>
      </button>
      <SpeedControl />
      <span className="pf-where t-value" aria-live="off">
        {bar ? `Bar ${bar} of ${starts.length}` : `${starts.length} bars`}
      </span>
      <div className="pf-group">
        {view !== 'simple' && <ShowMenu view={view} />}
        {/* The view and Holes | Notes, in one menu: the bar stays one row on a laptop. */}
        <Popover label={`${VIEW_NAMES[view]}${(view === 'tab' || view === 'simple' || view === 'lyrics') && readAs === 'notes' ? ' · Notes' : ''}${move === 'pages' ? ' · Pages' : ''} ▾`} title="Choose the view, and how it keeps up" kind="panel" panelClass="menu pf-view-menu" panelLabel="View">
          <ViewSwitch short />
          {(view === 'tab' || view === 'simple' || view === 'lyrics') && <ReadAsSwitch />}
          <div className="seg" role="radiogroup" aria-label="Keeping up">
            <button role="radio" aria-checked={move === 'scroll'} className={move === 'scroll' ? 'on' : ''} onClick={() => useApp.setState({ performMove: 'scroll' })} title="The music scrolls smoothly, keeping the playing line near the top">
              Scroll
            </button>
            <button role="radio" aria-checked={move === 'pages'} className={move === 'pages' ? 'on' : ''} onClick={() => useApp.setState({ performMove: 'pages' })} title="The music stays still and turns a page at a time; the line you're on carries over">
              Pages
            </button>
          </div>
          <span className="mi-hint">Page Down / Up or the arrow keys turn pages (as do page-turner pedals).</span>
        </Popover>
      </div>
      <div className="seg pf-size" role="group" aria-label="Music size">
        <button onClick={() => performResize(-1)} disabled={size <= PERFORM_SIZES[0]} title="Smaller (Ctrl+−)" aria-label="Smaller">A−</button>
        <button onClick={() => performResize(0)} title="The usual size (Ctrl+0)" aria-label={`Size ${Math.round(size * 100)}%: back to the usual size`}>{Math.round(size * 100)}%</button>
        <button onClick={() => performResize(1)} disabled={size >= PERFORM_SIZES[PERFORM_SIZES.length - 1]} title="Bigger (Ctrl+=)" aria-label="Bigger">A+</button>
      </div>
      <button className="btn small ghost pf-exit" onClick={exitPerform} title="Leave performance mode (F or Esc)">
        Exit
      </button>
    </div>
  );
}

/**
 * Whether the bar can fade: while playing, a moment after the mouse or keyboard last
 * moved — not while the keyboard is in the bar or one of its menus is open.
 */
function useIdle(playing: boolean): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    if (!playing) return;
    let timer = 0;
    const busy = () => !!document.querySelector('.perform-bar:focus-within, .perform-bar .pop-panel, .modal-backdrop');
    const wake = () => {
      setIdle(false);
      clearTimeout(timer);
      timer = window.setTimeout(function check() {
        if (busy()) timer = window.setTimeout(check, IDLE_MS);
        else setIdle(true);
      }, IDLE_MS);
    };
    wake();
    // (Of the keys, only Tab, going to the bar: page turns and harmonica keys leave it be.)
    const tab = (e: KeyboardEvent) => e.key === 'Tab' && wake();
    const events = ['mousemove', 'pointerdown', 'wheel'] as const;
    for (const e of events) window.addEventListener(e, wake, { passive: true });
    window.addEventListener('keydown', tab);
    return () => {
      clearTimeout(timer);
      for (const e of events) window.removeEventListener(e, wake);
      window.removeEventListener('keydown', tab);
      setIdle(false);
    };
  }, [playing]);
  return playing && idle;
}
