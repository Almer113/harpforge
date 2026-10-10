// @vitest-environment happy-dom
// Phases 10a–10b: performance mode, and reading ahead in it.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../audio/engine', async () => (await import('../test/fakeEngine')).fakeEngine());

import * as engine from '../audio/engine';
import { followDelta, pageTurnKey } from '../components/follow';
import { PlayPage } from '../pages/PlayPage';
import { enterPerform, exitPerform, performResize, togglePerform } from './perform';
import { play, stop } from './playback';
import { DEFAULT_MIX, DEFAULT_PERFORM_SIZE, PERFORM_SIZES, useApp } from './store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TAB = '---\ntitle: Perform\n---\n4 4 4 4 | 5 5 5 5 | 6 6 6 6 |\n';
const s = () => useApp.getState();

beforeEach(() => {
  stop();
  s().loadText(TAB, null);
  useApp.setState({ page: 'play', performing: false, performSize: DEFAULT_PERFORM_SIZE, performMove: 'scroll', mix: DEFAULT_MIX, along: false, recording: null, practice: null, sheetView: 'tab' });
});
afterEach(() => exitPerform());

it('goes in and out, and asks for full screen', () => {
  const full = vi.fn(() => Promise.resolve());
  document.documentElement.requestFullscreen = full;
  enterPerform();
  expect(s().performing).toBe(true);
  expect(full).toHaveBeenCalled();
  expect(document.documentElement.classList.contains('performing')).toBe(true);
  togglePerform();
  expect(s().performing).toBe(false);
  expect(document.documentElement.classList.contains('performing')).toBe(false);
});

it('takes you to Play first, and not while recording', () => {
  useApp.setState({ page: 'editor' });
  enterPerform();
  expect(s().page).toBe('play');
  expect(s().performing).toBe(true);
  exitPerform();
  useApp.setState({ recording: { kind: 'x' } as never });
  enterPerform();
  expect(s().performing).toBe(false);
});

it('another page ends it, and so does leaving full screen; the music plays on', async () => {
  enterPerform();
  s().setPage('library');
  expect(s().performing).toBe(false);
  s().setPage('play');
  enterPerform();
  await play();
  document.dispatchEvent(new Event('fullscreenchange'));
  expect(s().performing).toBe(false);
  expect(s().play).toBe('playing');
});

it('sizes step through the list, stopping at the ends', () => {
  performResize(1);
  expect(s().performSize).toBe(PERFORM_SIZES[PERFORM_SIZES.indexOf(DEFAULT_PERFORM_SIZE) + 1]);
  for (let i = 0; i < 20; i++) performResize(1);
  expect(s().performSize).toBe(PERFORM_SIZES.at(-1));
  for (let i = 0; i < 20; i++) performResize(-1);
  expect(s().performSize).toBe(PERFORM_SIZES[0]);
  performResize(0);
  expect(s().performSize).toBe(DEFAULT_PERFORM_SIZE);
});

it('the page shows the bar and the music alone; F and Esc go in and out', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<PlayPage />));
  expect(host.querySelector('.perform-bar')).toBeNull();
  expect(host.querySelector('.stage')).not.toBeNull();
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF', key: 'f' })));
  expect(s().performing).toBe(true);
  expect(host.querySelector('.perform-bar')).not.toBeNull();
  expect(host.querySelector('.stage')).toBeNull();
  expect(host.querySelector('.pf-where')?.textContent).toBe('3 bars');
  await act(async () => useApp.setState({ selectedEvent: 5 }));
  expect(host.querySelector('.pf-where')?.textContent).toBe('Bar 2 of 3');
  // Ctrl+= makes the music bigger, not the page.
  const zoom = new KeyboardEvent('keydown', { code: 'Equal', key: '=', ctrlKey: true, cancelable: true });
  await act(async () => window.dispatchEvent(zoom));
  expect(zoom.defaultPrevented).toBe(true);
  expect(s().performSize).toBeGreaterThan(DEFAULT_PERFORM_SIZE);
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape' })));
  expect(s().performing).toBe(false);
  expect(host.querySelector('.stage')).not.toBeNull();
  await act(async () => root.unmount());
  host.remove();
});

const area = { top: 50, height: 700 };
const at = (y: number, h = 100) => ({ top: area.top + y, bottom: area.top + y + h });

it('scrolling keeps the playing line between 10% and 45% down, back to 30%', () => {
  expect(followDelta('scroll', at(100), area)).toBeNull();
  expect(followDelta('scroll', at(300), area)).toBeNull();
  // Past 45%: it comes up to 30% (210 px).
  expect(followDelta('scroll', at(400), area)).toBe(400 - 210);
  // Behind (a loop starting again): back down to 30%.
  expect(followDelta('scroll', at(-500), area)).toBe(-500 - 210);
  // Too tall to fit below (a big staff line): moved up.
  expect(followDelta('scroll', at(300, 450), area)).toBe(300 - 210);
});

it('pages stay still until the last quarter, then that line tops the next page', () => {
  expect(followDelta('pages', at(0), area)).toBeNull();
  expect(followDelta('pages', at(400), area)).toBeNull();
  // The last line (bottom past 75%): it becomes the top, just under the bar.
  expect(followDelta('pages', at(480), area)).toBe(480 - 16);
  // Off the page either way: turned to it.
  expect(followDelta('pages', at(900), area)).toBe(900 - 16);
  expect(followDelta('pages', at(-300), area)).toBe(-300 - 16);
});

it('the page-turn keys are the pedals’ keys, without modifiers', () => {
  const key = (code: string, extra: KeyboardEventInit = {}) => pageTurnKey(new KeyboardEvent('keydown', { code, ...extra }));
  expect(key('PageDown')).toBe(1);
  expect(key('ArrowRight')).toBe(1);
  expect(key('ArrowDown')).toBe(1);
  expect(key('PageUp')).toBe(-1);
  expect(key('ArrowLeft')).toBe(-1);
  expect(key('ArrowUp')).toBe(-1);
  expect(key('Space')).toBeNull();
  expect(key('ArrowDown', { shiftKey: true })).toBeNull();
});

it('silent is the mix’s Tune off: it plays without the tune (no clicks unless the metronome is on), on either page', async () => {
  const playScore = engine.playScore as unknown as ReturnType<typeof vi.fn>;
  useApp.setState({ mix: { ...DEFAULT_MIX, off: { ...DEFAULT_MIX.off, tune: true } }, metronome: false });
  enterPerform();
  await play();
  expect(playScore.mock.lastCall?.[1]).toMatchObject({ muted: true, metronomeBeatsPerBar: undefined });
  // Leaving performance mode mid-song: it carries on as it was (one switch), with no restart.
  playScore.mockClear();
  exitPerform();
  await new Promise((r) => setTimeout(r, 0));
  expect(playScore).not.toHaveBeenCalled();
  stop();
  useApp.setState({ mix: DEFAULT_MIX });
});

it('in performance mode the arrows turn pages instead of reaching the harmonica', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const scrollBy = vi.fn();
  window.scrollBy = scrollBy as never;
  enterPerform();
  await act(async () => root.render(<PlayPage />));
  const later = vi.fn();
  window.addEventListener('keydown', later);
  const e = new KeyboardEvent('keydown', { code: 'PageDown', key: 'PageDown', cancelable: true });
  await act(async () => window.dispatchEvent(e));
  expect(e.defaultPrevented).toBe(true);
  expect(scrollBy).toHaveBeenCalledTimes(1);
  expect(scrollBy.mock.lastCall?.[0].top).toBeGreaterThan(0);
  expect(later).not.toHaveBeenCalled();
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowLeft', key: 'ArrowLeft' })));
  expect(scrollBy.mock.lastCall?.[0].top).toBeLessThan(0);
  window.removeEventListener('keydown', later);
  await act(async () => root.unmount());
  host.remove();
});

it('entering stops practice without its report over the music', () => {
  useApp.setState({ practice: { index: 6, played: 6, mistakes: 1, startedAt: 0, wrongAt: 0, mistakesAt: { 2: 1 } }, report: null });
  enterPerform();
  expect(s().practice).toBeNull();
  expect(s().report).toBeNull();
});

it('a screen lock that arrives after leaving is let go', async () => {
  let resolve: (l: unknown) => void = () => {};
  const release = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: () => new Promise((r) => (resolve = r)) } });
  enterPerform();
  exitPerform();
  resolve({ release, addEventListener: () => {} });
  await new Promise((r) => setTimeout(r, 0));
  expect(release).toHaveBeenCalled();
  Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: undefined });
});
