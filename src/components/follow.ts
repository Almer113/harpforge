// Following playback: the sheet scrolls to the playing note, but not while you're
// scrolling it yourself (and without smooth motion if you've asked for less motion).
// In performance mode it reads ahead: the playing line stays near the top, scrolling
// smoothly or a page at a time, and the page-turn keys (and pedals) turn pages.

import { useApp } from '../state/store';

let lastUserScroll = 0;
/** Turned ahead by hand: following waits for the music to reach the page you're on. */
let readingAhead = 0;

const HOLD_MS = 3000;
const AHEAD_MS = 20000;

if (typeof window !== 'undefined') {
  const mark = () => (lastUserScroll = Date.now());
  window.addEventListener('wheel', mark, { passive: true });
  window.addEventListener('touchmove', mark, { passive: true });
  // Keys that scroll the page — unless something used them first (harmonica keys, the editor's arrows).
  window.addEventListener('keydown', (e) => {
    if (!['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', ' '].includes(e.key)) return;
    setTimeout(() => !e.defaultPrevented && mark());
  });
  // Dragging a scrollbar.
  window.addEventListener('mousedown', (e) => {
    const el = e.target as HTMLElement;
    if (el === document.documentElement || (el.scrollHeight > el.clientHeight && e.offsetX > el.clientWidth)) mark();
  });
}

const reducedMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Scrolls `el` into view for playback, unless the user scrolled in the last few seconds. */
export function followTo(el: Element | null | undefined) {
  if (!el || Date.now() - lastUserScroll < HOLD_MS) return;
  if (useApp.getState().performing) {
    performFollow(el);
    return;
  }
  el.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
}

/** The part of the window the music shows in, below performance mode's bar. */
function musicArea(): { top: number; height: number } {
  const bar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--perform-bar-h')) || 0;
  return { top: bar, height: Math.max(1, window.innerHeight - bar) };
}

/**
 * How far to scroll (px, down is positive) to keep a playing note in view, or null to stay.
 * Scroll: the playing line rides between 10% and 45% of the way down, and moves back to 30%.
 * Pages: once it reaches the page's last quarter (its last line or so), that line becomes the
 * top of the next page, so you never lose your place at the turn.
 */
export function followDelta(move: 'scroll' | 'pages', r: { top: number; bottom: number }, area: { top: number; height: number }): number | null {
  const y = r.top - area.top;
  const bottom = r.bottom - area.top;
  if (move === 'pages') {
    if (y >= -1 && bottom <= area.height * 0.75) return null;
    return y - Math.min(16, area.height * 0.05);
  }
  if (y >= area.height * 0.1 && y <= area.height * 0.45 && bottom <= area.height) return null;
  return y - area.height * 0.3;
}

function performFollow(el: Element) {
  const r = el.getBoundingClientRect();
  const area = musicArea();
  // Turned ahead: wait (up to a while) until the music comes into the page.
  if (readingAhead) {
    const visible = r.bottom > area.top && r.top < area.top + area.height;
    const behind = r.bottom <= area.top;
    if (visible || !behind || Date.now() - readingAhead > AHEAD_MS) readingAhead = 0;
    if (behind && readingAhead) return;
  }
  const move = useApp.getState().performMove;
  const dy = followDelta(move, r, area);
  if (dy === null || Math.abs(dy) < 2) return;
  window.scrollBy({ top: dy, behavior: move === 'pages' || reducedMotion() ? 'auto' : 'smooth' });
}

/** Entering performance mode: from the top, or with the selected note a third of the way down. */
export function startPerformanceView(el: Element | null) {
  window.scrollTo({ top: 0, behavior: 'auto' });
  if (!el) return;
  const area = musicArea();
  const y = el.getBoundingClientRect().top - area.top;
  if (y > area.height * 0.45) window.scrollBy({ top: y - area.height * 0.3, behavior: 'auto' });
}

/**
 * Performance mode's page turn (Page Down / Up, the arrows, a pedal): three quarters of the
 * music area, so the last lines carry over. Following then holds, and waits for the music
 * if you turned ahead of it.
 */
export function turnPage(dir: 1 | -1) {
  const { height } = musicArea();
  lastUserScroll = Date.now();
  if (dir === 1) readingAhead = Date.now();
  else readingAhead = 0;
  const move = useApp.getState().performMove;
  window.scrollBy({ top: dir * height * 0.75, behavior: move === 'pages' || reducedMotion() ? 'auto' : 'smooth' });
}

/** Keys that turn pages: what page-turner pedals send (they come in pairs, as one of these). */
export function pageTurnKey(e: KeyboardEvent): 1 | -1 | null {
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return null;
  if (e.code === 'PageDown' || e.code === 'ArrowDown' || e.code === 'ArrowRight') return 1;
  if (e.code === 'PageUp' || e.code === 'ArrowUp' || e.code === 'ArrowLeft') return -1;
  return null;
}
