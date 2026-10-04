// Whether the keyboard belongs to something else right now (typing, a dialog or menu),
// so harmonica keys and editor shortcuts stay out of the way.

const OVERLAYS = '.modal-backdrop, .menu, .key-choice, .harp-pop, .shortcuts';

export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

export function overlayOpen(): boolean {
  return !!document.querySelector(OVERLAYS);
}

/** True when a key press shouldn't play or edit anything. */
export function keysTaken(e: KeyboardEvent): boolean {
  return isTyping(e.target) || overlayOpen();
}
