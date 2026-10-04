// Following playback: the sheet scrolls to the playing note, but not while you're
// scrolling it yourself (and without smooth motion if you've asked for less motion).

let lastUserScroll = 0;

if (typeof window !== 'undefined') {
  const mark = () => (lastUserScroll = Date.now());
  window.addEventListener('wheel', mark, { passive: true });
  window.addEventListener('touchmove', mark, { passive: true });
  window.addEventListener('keydown', (e) => {
    if (['PageUp', 'PageDown', 'Home', 'End'].includes(e.key)) mark();
  });
  // Dragging a scrollbar.
  window.addEventListener('mousedown', (e) => {
    const el = e.target as HTMLElement;
    if (el === document.documentElement || (el.scrollHeight > el.clientHeight && e.offsetX > el.clientWidth)) mark();
  });
}

/** Scrolls `el` into view for playback, unless the user scrolled in the last few seconds. */
export function followTo(el: Element | null | undefined) {
  if (!el || Date.now() - lastUserScroll < 3000) return;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
}
