// Performance mode: the Play page's music fills the screen (in full screen when the browser
// allows it), bigger, with the screen kept awake. Leaving full screen (Esc) leaves it too.

import { lastPlayedNote } from './playback';
import { stopPractice } from './practice';
import { DEFAULT_PERFORM_SIZE, PERFORM_SIZES, useApp } from './store';

export function enterPerform() {
  const s = useApp.getState();
  if (s.recording || s.performing) return;
  if (s.page !== 'play') s.setPage('play');
  // (Practice mode waits at the harmonica, which isn't shown here: the session is kept in
  // the song's history, without its report over the music.)
  if (s.practice) stopPractice({ show: false });
  useApp.setState({ performing: true });
  // Refused (or not there): the page still fills the window, and Esc leaves.
  void document.documentElement
    .requestFullscreen?.()
    .then(() => {
      // Left again before full screen came: out of it too.
      if (!useApp.getState().performing) return leaveFullscreen();
      // In full screen the browser takes Esc for itself; asking for it (Chrome, Edge) lets Esc
      // close a menu first. (Holding Esc still leaves full screen.)
      return (navigator as KeyboardLock).keyboard?.lock?.(['Escape']);
    })
    .catch(() => undefined);
  if (!told) {
    told = true;
    s.notify('Performance mode: F or Esc leaves');
  }
}

/** The first visit says how to leave. */
let told = false;

type KeyboardLock = Navigator & { keyboard?: { lock?: (keys: string[]) => Promise<void>; unlock?: () => void } };

export function exitPerform() {
  if (!useApp.getState().performing) return;
  useApp.setState({ performing: false });
  (navigator as KeyboardLock).keyboard?.unlock?.();
  void leaveFullscreen();
  // Back on the Play page: the keyboard on the Perform button, the music where you were.
  requestAnimationFrame(() => {
    const note = noteHere();
    (note ?? document.querySelector('.sheet'))?.scrollIntoView({ block: note ? 'center' : 'start' });
    document.querySelector<HTMLElement>('.perform-btn')?.focus({ preventScroll: true });
  });
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

/** The note you're at: the one playing (or paused at), else the selected one (its element on the sheet). */
function noteHere(): Element | null {
  const s = useApp.getState();
  const at = s.activeEvents.at(-1) ?? lastPlayedNote() ?? s.selectedEvent;
  return at !== null && at !== undefined ? document.querySelector(`.sheet [data-index="${at}"]`) : null;
}

// Bigger or smaller music, or another view, lays the page out afresh: back to the note you
// were at (while playing, following the music does that).
useApp.subscribe((s, prev) => {
  if (!s.performing || s.play === 'playing' || (s.performSize === prev.performSize && s.sheetView === prev.sheetView)) return;
  if (typeof requestAnimationFrame === 'undefined') return;
  // (A view loaded for the first time can take a few frames to be drawn.)
  let tries = 0;
  const go = () => {
    const note = noteHere();
    if (note) note.scrollIntoView({ block: 'center' });
    else if (++tries < 60) requestAnimationFrame(go);
  };
  requestAnimationFrame(() => requestAnimationFrame(go));
});

// Another page (Back, a link) ends performance mode.
useApp.subscribe((s, prev) => {
  if (s.performing && s.page !== 'play' && prev.page === 'play') exitPerform();
});

// Leaving full screen, still under way: its "full screen changed" isn't someone pressing Esc
// (going straight back in mustn't be thrown out by it).
let leaving = false;

async function leaveFullscreen() {
  if (!document.fullscreenElement) return;
  leaving = true;
  try {
    await document.exitFullscreen?.();
  } catch {
    /* already out */
  }
  leaving = false;
}

let wakeLock: WakeLockSentinel | null = null;
// Bumped by each change: a lock that arrives after performance mode ended is let go.
let lockTurn = 0;

async function keepAwake(on: boolean) {
  const turn = ++lockTurn;
  if (!on) {
    const lock = wakeLock;
    wakeLock = null;
    await lock?.release().catch(() => undefined);
    return;
  }
  if (wakeLock || document.visibilityState !== 'visible') return;
  try {
    const lock = await navigator.wakeLock?.request('screen');
    if (!lock) return;
    if (turn !== lockTurn || !useApp.getState().performing) {
      await lock.release().catch(() => undefined);
      return;
    }
    wakeLock = lock;
    // (The browser lets go of it when the tab is hidden: asked for again on return.)
    lock.addEventListener('release', () => {
      if (wakeLock === lock) wakeLock = null;
    });
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
    if (!document.fullscreenElement && !leaving) exitPerform();
  });
}
