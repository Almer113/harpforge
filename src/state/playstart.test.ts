// @vitest-environment happy-dom
// Where playback starts: the editor's caret or selection, back to the start (Stop again, Esc).

import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('../audio/engine', async () => (await import('../test/fakeEngine')).fakeEngine({ scoreBeatNow: () => 0 }));

import * as engine from '../audio/engine';
import { arrowStops } from '../components/editor/VisualEditor';
import { fromDoc } from '../core/edit/model';
import { atStart, backToStart, editorStart, pause, play, startLabel, stop } from './playback';
import { getParsed, useApp } from './store';

// Starts with three beats' rest, as songs with a pickup often do.
const TAB = '---\ntitle: S\ntempo: 60\n---\n.~~ {5 -5} | 6 6 7 {-7 -6} | 4 5 6 -6 |\n';
const s = () => useApp.getState();
const playScore = engine.playScore as unknown as ReturnType<typeof vi.fn>;
const last = () => playScore.mock.lastCall as [unknown, { startBeat?: number; range?: { start: number; end: number }; loop?: boolean }];
const editor = (patch: Partial<ReturnType<typeof s>['ve']> = {}) => useApp.setState((st) => ({ page: 'editor', editorMode: 'visual', ve: { ...st.ve, selection: [], caret: { m: 0, start: 0 }, ...patch } }));

beforeEach(() => {
  stop();
  s().loadText(TAB, null);
  useApp.setState({ page: 'play', loop: false, loopRange: null, passage: null, training: null, countIn: false, selectedEvent: null });
  playScore.mockClear();
});

it('the editor plays from the caret, the rest at the start included', async () => {
  editor();
  expect(editorStart(s())).toEqual({ beat: 0 });
  await play();
  expect(last()[1].startBeat).toBe(0);
  stop();
  // A caret part way into bar 2's beats (bar 1 is 4 beats).
  editor({ caret: { m: 1, start: 1 } });
  await play();
  expect(last()[1].startBeat).toBe(5);
  stop();
  // Past the last note: from the start.
  editor({ caret: { m: 3, start: 0 } });
  expect(editorStart(s())?.beat).toBe(0);
});

it('one note selected plays from it; several play just them', async () => {
  editor({ selection: [{ m: 0, start: 3 }] });
  await play();
  expect(last()[1].startBeat).toBe(3);
  stop();
  editor({ selection: [{ m: 1, start: 0 }, { m: 1, start: 1 }] });
  await play();
  expect(last()[1].range).toEqual({ start: 4, end: 6 });
  expect(last()[1].loop).toBe(false);
  expect(startLabel(s())).toBe('the selection, bar 2');
});

it('a new place chosen while paused starts fresh from there', async () => {
  editor({ caret: { m: 1, start: 0 } });
  await play();
  pause();
  playScore.mockClear();
  editor({ caret: { m: 2, start: 0 } });
  await play();
  expect(playScore).toHaveBeenCalledTimes(1);
  expect(last()[1].startBeat).toBe(8);
  stop();
});

it('back to the start: the Play page forgets the note clicked; the editor puts the caret at the beginning', () => {
  useApp.setState({ selectedEvent: 3 });
  expect(atStart(s())).toBe(false);
  expect(startLabel(s())).toBe('from bar 2');
  backToStart();
  expect(s().selectedEvent).toBeNull();
  expect(startLabel(s())).toBe('from the start');
  editor({ selection: [{ m: 1, start: 0 }], caret: { m: 1, start: 1 } });
  backToStart();
  expect(s().ve.selection).toEqual([]);
  expect(s().ve.caret).toEqual({ m: 0, start: 0 });
  expect(atStart(s())).toBe(true);
});

it('the arrow keys stop at each note and each bar start', () => {
  const stops = arrowStops(fromDoc(getParsed(TAB).doc));
  // Bar 1: its empty start, then the 5 and -5 (on beats 4 and 4½); bar 2 starts with a note.
  expect(stops.slice(0, 4)).toEqual([
    { m: 0, start: 0 },
    { m: 0, start: 3 },
    { m: 0, start: 3.5 },
    { m: 1, start: 0 },
  ]);
});
