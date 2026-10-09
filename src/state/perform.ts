// Performance mode: the Play page's music fills the screen (in full screen when the browser
// allows it), bigger, with the screen kept awake. Leaving full screen (Esc) leaves it too.

import { stopPractice } from './practice';
import { DEFAULT_PERFORM_SIZE, PERFORM_SIZES, useApp } from './store';

export function enterPerform() {
  const s = useApp.getState();
  if (s.recording || s.performing) return;
  if (s.page !== 'play') s.setPage('play');
  // (Practice mode waits at the harmonica, which isn't shown here.)
  if (s.practice) stopPractice();
  useApp.setState({ performing: true });
  // Refused (or not there): the page still fills the window, and Esc leaves.
  void document.documentElement.requestFullscreen?.().catch(() => undefined);
}

export function exitPerform() {
  if (!useApp.getState().performing) return;
  useApp.setState({ performing: false });
  if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
}

export function togglePerform() {
  if (useApp.getState().performing) exitPerform();
  else enterPerform();
}

/** A size bigger (1) or smaller (-1); 0 goes back to the usual size. */
export function performResize(dir: -1 | 0 | 1) {
  const now = useApp.getState().performSize;
  if (dir === 0) {
    useApp.setState({ performSize: DEFAULT_PERFORM_SIZE });
    return;
  }
  const i = PERFORM_SIZES.findIndex((x) => x >= now - 1e-9);
  const next = PERFORM_SIZES[Math.max(0, Math.min(PERFORM_SIZES.length - 1, (i < 0 ? PERFORM_SIZES.length - 1 : i) + dir))];
  useApp.setState({ performSize: next });
}

// Another page (Back, a link) ends performance mode.
useApp.subscribe((s, prev) => {
  if (s.performing && s.page !== 'play' && prev.page === 'play') exitPerform();
});

let wakeLock: WakeLockSentinel | null = null;

async function keepAwake(on: boolean) {
  if (!on) {
    const lock = wakeLock;
    wakeLock = null;
    await lock?.release().catch(() => undefined);
    return;
  }
  if (wakeLock || document.visibilityState !== 'visible') return;
  try {
    wakeLock = (await navigator.wakeLock?.request('screen')) ?? null;
    // (The browser lets go of it when the tab is hidden: asked for again on return.)
    wakeLock?.addEventListener('release', () => (wakeLock = null));
  } catch {
    /* not allowed (battery saver, an old browser): the screen may dim */
  }
}

if (typeof document !== 'undefined') {
  useApp.subscribe((s, prev) => {
    if (s.performing === prev.performing) return;
    document.documentElement.classList.toggle('performing', s.performing);
    void keepAwake(s.performing);
  });
  document.addEventListener('visibilitychange', () => {
    if (useApp.getState().performing) void keepAwake(true);
  });
  // Leaving full screen (Esc, F11) leaves performance mode; the music plays on.
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) exitPerform();
  });
}
