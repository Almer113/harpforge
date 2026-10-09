// @vitest-environment happy-dom
// Phase 10a: performance mode.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../audio/engine', async () => (await import('../test/fakeEngine')).fakeEngine());

import { PlayPage } from '../pages/PlayPage';
import { enterPerform, exitPerform, performResize, togglePerform } from './perform';
import { play, stop } from './playback';
import { DEFAULT_PERFORM_SIZE, PERFORM_SIZES, useApp } from './store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TAB = '---\ntitle: Perform\n---\n4 4 4 4 | 5 5 5 5 | 6 6 6 6 |\n';
const s = () => useApp.getState();

beforeEach(() => {
  stop();
  s().loadText(TAB, null);
  useApp.setState({ page: 'play', performing: false, performSize: DEFAULT_PERFORM_SIZE, recording: null, practice: null, sheetView: 'tab' });
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
