import { useLayoutEffect, type RefObject } from 'react';

/**
 * Keeps an open dropdown inside the window: it opens under its button, lined up with
 * whichever edge leaves it fully visible (and above the button if there's no room below).
 */
export function useKeepInView(open: boolean, wrap: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const menu = wrap.current?.querySelector<HTMLElement>(':scope > .menu');
    if (!open || !menu) return;
    menu.style.left = '0';
    menu.style.right = 'auto';
    menu.style.top = 'calc(100% + 6px)';
    menu.style.bottom = 'auto';
    let r = menu.getBoundingClientRect();
    if (r.right > window.innerWidth - 8) {
      menu.style.left = 'auto';
      menu.style.right = '0';
      r = menu.getBoundingClientRect();
      if (r.left < 8) menu.style.right = `${r.left - 8}px`;
    }
    // Up or down, whichever has more room; a list taller than that scrolls inside.
    menu.style.maxHeight = '';
    const button = wrap.current!.getBoundingClientRect();
    const topBar = document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0;
    const below = window.innerHeight - button.bottom - 14;
    const above = button.top - topBar - 14;
    if (r.height > below) {
      const up = above > below;
      if (up) {
        menu.style.top = 'auto';
        menu.style.bottom = 'calc(100% + 6px)';
      }
      const room = up ? above : below;
      if (r.height > room) {
        menu.style.maxHeight = `${Math.max(160, room)}px`;
        menu.style.overflowY = 'auto';
      }
    }
  }, [open, wrap]);
}
