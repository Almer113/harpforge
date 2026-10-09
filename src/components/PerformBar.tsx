// Performance mode's one bar: the song, playback, speed, where you are, the view, the size
// and the way out. While the music plays it fades after a moment without the mouse, and
// comes back when the mouse moves.

import { useEffect, useMemo, useRef, useState } from 'react';
import { PlayStop, SpeedControl, useTransportKeys } from './Controls';
import { Popover } from './Popover';
import { ReadAsSwitch, ShowMenu, ViewSwitch } from './Sheet';
import { barAt, barStarts } from '../core/passage';
import { exitPerform, performResize } from '../state/perform';
import { PERFORM_SIZES, useApp, useParsed } from '../state/store';

const IDLE_MS = 2500;
const VIEW_NAMES = { simple: 'Simple tab', tab: 'Tab', staff: 'Staff', numbers: 'Numbers' };

export function PerformBar() {
  useTransportKeys();
  const { doc, score } = useParsed();
  const playing = useApp((s) => s.play === 'playing');
  const view = useApp((s) => s.sheetView);
  const readAs = useApp((s) => s.readAs);
  const size = useApp((s) => s.performSize);
  // Where you are: the playing note, else the selected one.
  const at = useApp((s) => s.activeEvents.at(-1) ?? s.selectedEvent);
  const starts = useMemo(() => barStarts(score), [score]);
  const ev = at !== null && at !== undefined ? score.events[at] : undefined;
  const bar = ev ? barAt(score, ev.start, starts) + 1 : null;

  const idle = useIdle(playing);
  const bar0 = useRef<HTMLDivElement>(null);
  // The bar's height, so the music starts below it and following keeps notes out from under it.
  useEffect(() => {
    const el = bar0.current;
    if (!el) return;
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty('--perform-bar-h', `${el.offsetHeight}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={bar0} className={`perform-bar ${idle ? 'idle' : ''}`} role="toolbar" aria-label="Performance mode">
      <span className="pf-title" title={doc.meta.title || 'Untitled'}>{doc.meta.title || 'Untitled'}</span>
      <PlayStop />
      <SpeedControl />
      <span className="pf-where t-value" aria-live="off">
        {bar ? `Bar ${bar} of ${starts.length}` : `${starts.length} bars`}
      </span>
      <div className="pf-group">
        {view !== 'simple' && <ShowMenu view={view} />}
        {/* The view and Holes | Notes, in one menu: the bar stays one row on a laptop. */}
        <Popover label={`${VIEW_NAMES[view]}${(view === 'tab' || view === 'simple') && readAs === 'notes' ? ' · Notes' : ''} ▾`} title="Choose the view" kind="panel" panelClass="menu pf-view-menu" panelLabel="View">
          <ViewSwitch short />
          {(view === 'tab' || view === 'simple') && <ReadAsSwitch />}
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
