// @vitest-environment happy-dom
// Phase 9a: choosing a passage on the Play page and looping it.

import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('../audio/engine', async () => (await import('../test/fakeEngine')).fakeEngine());

import * as engine from '../audio/engine';
import { extendPassage, play, selectBar, selectEvent, stop, toggleLoop } from './playback';
import { useApp } from './store';

const TAB = '---\ntitle: Loop\n---\n4 4 4 4 | 5 5 5 5 | 6 6 6 6 | 7 7 7 7 |\n';
const s = () => useApp.getState();
const playScore = engine.playScore as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  stop();
  s().loadText(TAB, null);
  useApp.setState({ loop: false, loopRange: null, page: 'play' });
  playScore.mockClear();
});

it('Shift+click runs the passage from the selected note to the clicked one', () => {
  selectEvent(9);
  extendPassage(5);
  expect(s().passage).toEqual({ start: 5, end: 10 });
  expect(s().selectedEvent).toBe(9);
  // A plain click lets go of it.
  selectEvent(2);
  expect(s().passage).toBeNull();
});

it('a bar number selects the bar; with Shift, up to it', () => {
  selectBar({ start: 4, end: 8 }, false);
  expect(s().passage).toEqual({ start: 4, end: 8 });
  expect(s().selectedEvent).toBe(4);
  selectBar({ start: 12, end: 16 }, true);
  expect(s().passage).toEqual({ start: 4, end: 16 });
});

it('the loop button loops the passage, playing just it; again, it stops looping', async () => {
  selectBar({ start: 4, end: 8 }, false);
  toggleLoop();
  expect(s().loop).toBe(true);
  expect(s().loopRange).toEqual({ start: 4, end: 8 });
  await play();
  expect(playScore).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ loop: true, range: { start: 4, end: 8 } }));
  toggleLoop();
  expect(s()).toMatchObject({ loop: false, loopRange: null });
});

it('with no passage it loops the whole song, as before', async () => {
  selectEvent(3);
  toggleLoop();
  expect(s()).toMatchObject({ loop: true, loopRange: null });
  await play();
  expect(playScore).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ loop: true, range: undefined, startBeat: 3 }));
});

it('another song forgets the passage and its loop', () => {
  selectBar({ start: 4, end: 8 }, false);
  toggleLoop();
  s().loadText('---\n---\n4 5 6 |\n', null);
  expect(s()).toMatchObject({ passage: null, loopRange: null, loop: false });
});
