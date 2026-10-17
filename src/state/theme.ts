// The theme: Dark (the usual), Light, Paper, or Match system (Dark or Light, as the computer
// is set — never Paper). Chosen per device: this browser remembers it, not the account.
//
// It's shown as `data-theme` on <html>; the stylesheet's colour names do the rest. index.html
// sets it before anything draws (no flash of Dark), with the same rules as `resolve` here.
// What draws with colours read once (the staff) watches `useShownTheme` to draw again.

import { useSyncExternalStore } from 'react';

export type ThemeName = 'dark' | 'light' | 'paper';
export type ThemeChoice = ThemeName | 'system';

export const THEME_KEY = 'harpforge:theme';
export const THEME_NAMES: Record<ThemeChoice, string> = { dark: 'Dark', light: 'Light', paper: 'Paper', system: 'Match system' };
/** The ◐ button's order. */
const CYCLE: ThemeName[] = ['dark', 'light', 'paper'];

const isChoice = (v: unknown): v is ThemeChoice => v === 'dark' || v === 'light' || v === 'paper' || v === 'system';

/** This device's choice (Dark until one is made). */
export function themeChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return isChoice(v) ? v : 'dark';
  } catch {
    return 'dark';
  }
}

const systemQuery = () => (typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : null);
/** What the computer is set to (Dark if it doesn't say). */
export const systemTheme = (): ThemeName => (systemQuery()?.matches ? 'light' : 'dark');

export function resolve(choice: ThemeChoice): ThemeName {
  return choice === 'system' ? systemTheme() : choice;
}

export function shownTheme(): ThemeName {
  if (typeof document === 'undefined') return 'dark';
  const t = document.documentElement.dataset.theme;
  return t === 'light' || t === 'paper' ? t : 'dark';
}

const listeners = new Set<() => void>();
const changed = () => listeners.forEach((fn) => fn());

/** Shows the theme `choice` comes to (now). */
function show(choice: ThemeChoice) {
  const root = document.documentElement;
  const name = resolve(choice);
  if (name !== shownTheme()) {
    // (Everything changes colour at once, not each button fading at its own pace.)
    root.classList.add('theme-switching');
    if (name === 'dark') delete root.dataset.theme;
    else root.dataset.theme = name;
    // (The new colours are in place once the page is measured; transitions can come back
    // after that. Not on the next frame: a tab in the background has none until it's seen.)
    void root.offsetWidth;
    setTimeout(() => root.classList.remove('theme-switching'), 0);
  }
  // The browser's own bar and frame, in the page's colour.
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
  if (meta && bg) meta.content = bg;
  changed();
}

/** Chooses the theme for this device (and shows it). */
export function setTheme(choice: ThemeChoice) {
  try {
    localStorage.setItem(THEME_KEY, choice);
  } catch {
    // (Not kept: shown for now all the same.)
  }
  chosen = choice;
  show(choice);
}

/** ◐: the next of Dark → Light → Paper from what's shown, chosen for this device. */
export function nextTheme(): ThemeName {
  return CYCLE[(CYCLE.indexOf(shownTheme()) + 1) % CYCLE.length];
}
export function cycleTheme() {
  setTheme(nextTheme());
}

let chosen: ThemeChoice = themeChoice();
let system: ThemeName = systemTheme();
let stop: (() => void) | null = null;
/**
 * Shows this device's theme and follows changes: the computer's setting, another tab's pick.
 * (Returns how to stop following them.)
 */
export function startTheme(): () => void {
  if (stop || typeof document === 'undefined') return () => {};
  chosen = themeChoice();
  system = systemTheme();
  show(chosen);
  // (Kept: a media query nothing refers to may be thrown away, its listener with it.)
  const query = systemQuery();
  const onSystem = () => {
    system = systemTheme();
    if (chosen === 'system') show(chosen);
    else changed();
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key !== THEME_KEY && e.key !== null) return;
    chosen = themeChoice();
    show(chosen);
  };
  query?.addEventListener('change', onSystem);
  window.addEventListener('storage', onStorage);
  stop = () => {
    query?.removeEventListener('change', onSystem);
    window.removeEventListener('storage', onStorage);
    stop = null;
  };
  return stop;
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** This device's choice; a component using it draws again when it changes. */
export function useThemeChoice(): ThemeChoice {
  return useSyncExternalStore(subscribe, () => chosen, () => 'dark');
}

/** What the computer is set to; a component using it draws again when that changes. */
export function useSystemTheme(): ThemeName {
  return useSyncExternalStore(subscribe, () => system, () => 'dark');
}

function watch(fn: () => void) {
  const seen = new MutationObserver(fn);
  seen.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => seen.disconnect();
}

/** The theme shown now; a component using it draws again when it changes. */
export function useShownTheme(): ThemeName {
  return useSyncExternalStore(watch, shownTheme, () => 'dark');
}
