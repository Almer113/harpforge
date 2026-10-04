// Whether the keyboard belongs to something else right now (typing, a dialog or menu),
// so harmonica keys and editor shortcuts stay out of the way.

const OVERLAYS = '.modal-backdrop, .menu, .key-choice, .harp-pop, .shortcuts';

/** Inputs you type text into (a slider or checkbox isn't one). */
const TEXT_INPUTS = new Set(['', 'text', 'search', 'email', 'url', 'tel', 'password', 'number']);

export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  return el.tagName === 'INPUT' && TEXT_INPUTS.has((el as HTMLInputElement).type);
}

/** Keys a focused slider or checkbox uses itself (the rest still play and edit). */
function controlKey(e: KeyboardEvent): boolean {
  const el = e.target as HTMLInputElement | null;
  if (el?.tagName !== 'INPUT') return false;
  if (el.type === 'range') return /^(Arrow|Page|Home$|End$)/.test(e.key);
  if (el.type === 'checkbox' || el.type === 'radio') return e.key === ' ' || e.key.startsWith('Arrow');
  return false;
}

export function overlayOpen(): boolean {
  return !!document.querySelector(OVERLAYS);
}

/** True when a key press shouldn't play or edit anything. */
export function keysTaken(e: KeyboardEvent): boolean {
  return isTyping(e.target) || controlKey(e) || overlayOpen();
}

// After you pick from a dropdown, the keyboard goes back to the harmonica and the editor
// (a focused dropdown would otherwise take every letter and number key).
if (typeof document !== 'undefined') {
  document.addEventListener('change', (e) => {
    const el = e.target as HTMLElement | null;
    if (el?.tagName === 'SELECT') el.blur();
  });
}
