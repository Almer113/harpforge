// The theme the page is showing: the `data-theme` on <html> (none: Dark). Most of the app
// follows it through the stylesheet's colour names alone; what draws with colours read once
// (the staff) watches it to draw again.

import { useSyncExternalStore } from 'react';

export type ThemeName = 'dark' | 'light' | 'paper';

export function shownTheme(): ThemeName {
  if (typeof document === 'undefined') return 'dark';
  const t = document.documentElement.dataset.theme;
  return t === 'light' || t === 'paper' ? t : 'dark';
}

function watch(changed: () => void) {
  const seen = new MutationObserver(changed);
  seen.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => seen.disconnect();
}

/** The theme shown now; a component using it draws again when it changes. */
export function useShownTheme(): ThemeName {
  return useSyncExternalStore(watch, shownTheme, () => 'dark');
}
