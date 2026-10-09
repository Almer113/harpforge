// @vitest-environment happy-dom
// Phases 9a–9c: choosing a passage on the Play page, looping it, counting in, and the tempo trainer.

import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('../audio/engine', async () => (await import('../test/fakeEngine')).fakeEngine());

import * as engine from '../audio/engine';
import { countBeats, extendPassage, holdTrainer, loopPassed, play, playFrom, selectBar, selectEvent, startTrainer, stop, stopTrainer, toggleLoop, trainerLabel } from './playback';
import { DEFAULT_TRAINER } from './store';
import { useApp } from './store';

const TAB = '---\ntitle: Loop\n---\n4 4 4 4 | 5 5 5 5 | 6 6 6 6 | 7 7 7 7 |\n';
const s = () => useApp.getState();
const playScore = engine.playScore as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  stop();
  s().loadText(TAB, null);
  useApp.setState({ loop: false, loopRange: null, page: 'play', countIn: false, countEachLoop: false, speed: 1, trainer: DEFAULT_TRAINER, training: null });
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

// ---- Phase 9b: counting in

it('a bar is counted in, two when a bar goes by in under 1.6 seconds', () => {
  expect(countBeats(4, 96)).toBe(4);
  expect(countBeats(4, 160)).toBe(8);
  expect(countBeats(3, 120)).toBe(6);
});

it('counts in before playing when asked, but not when jumping to a note mid-play', async () => {
  useApp.setState({ countIn: true });
  await play();
  expect(playScore).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ countIn: 4, countEachLoop: false }));
  playFrom(6);
  await Promise.resolve();
  await Promise.resolve();
  expect(playScore).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ countIn: 0, startBeat: 6 }));
});

it('a loop can count in before each pass (and so before the first)', async () => {
  useApp.setState({ countEachLoop: true });
  selectBar({ start: 4, end: 8 }, false);
  toggleLoop();
  await play();
  expect(playScore).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ countIn: 4, countEachLoop: true, range: { start: 4, end: 8 } }));
  // Not looping: no count (the setting is only for loops).
  toggleLoop();
  await play();
  expect(playScore).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ countIn: 0 }));
});

// ---- Phase 9c: the tempo trainer

it('the trainer loops the passage from its start speed, a step faster each pass, up to the goal', async () => {
  selectBar({ start: 4, end: 8 }, false);
  startTrainer();
  await new Promise((r) => setTimeout(r, 0));
  expect(s()).toMatchObject({ speed: 0.6, loop: true, loopRange: { start: 4, end: 8 }, training: { pass: 0, holding: false } });
  expect(playScore).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ onLoop: loopPassed }));
  loopPassed();
  expect(s().speed).toBe(0.65);
  for (let k = 0; k < 20; k++) loopPassed();
  expect(s().speed).toBe(1);
  expect(trainerLabel(s().training!, s().speed, 1)).toBe('Trainer at 100% ✓');
});

it('steps every few passes, holds when asked, and stops with the loop', () => {
  useApp.setState({ trainer: { ...DEFAULT_TRAINER, every: 2, step: 0.1 } });
  startTrainer();
  loopPassed();
  expect(s().speed).toBe(0.6);
  loopPassed();
  expect(s().speed).toBe(0.7);
  expect(trainerLabel(s().training!, s().speed, 1)).toBe('Trainer · pass 3 · 70%');
  holdTrainer(true);
  loopPassed();
  loopPassed();
  expect(s().speed).toBe(0.7);
  holdTrainer(false);
  toggleLoop();
  expect(s()).toMatchObject({ loop: false, training: null });
  // Stopped, a pass does nothing.
  loopPassed();
  expect(s().speed).toBe(0.7);
});

it('stopping the trainer keeps the loop going at its speed', () => {
  startTrainer();
  loopPassed();
  stopTrainer();
  expect(s()).toMatchObject({ loop: true, training: null, speed: 0.65 });
});

// ---- Review fixes

it('an edit that shortens the song cuts the chosen and looped passages (or drops them)', () => {
  selectBar({ start: 12, end: 16 }, false);
  toggleLoop();
  s().setText('---\ntitle: Loop\n---\n4 4 4 4 | 5 5 5 5 |\n');
  expect(s()).toMatchObject({ passage: null, loopRange: null, loop: false });
  selectBar({ start: 4, end: 8 }, false);
  useApp.setState({ passage: { start: 4, end: 12 } });
  s().setText('---\ntitle: Loop\n---\n4 4 4 4 | 5 5 5 5 | 6 6 |\n');
  expect(s().passage).toEqual({ start: 4, end: 10 });
});

it('Split view: the loop uses the preview’s passage, not the hidden visual editor’s selection', () => {
  useApp.setState({ page: 'editor', editorMode: 'split', passage: { start: 4, end: 8 } });
  s().setVe({ selection: [] });
  toggleLoop();
  expect(s().loopRange).toEqual({ start: 4, end: 8 });
});

it('in the visual editor one selected note loops its bar', () => {
  useApp.setState({ page: 'editor', editorMode: 'visual' });
  s().setVe({ selection: [{ m: 2, start: 1 }] });
  toggleLoop();
  expect(s().loopRange).toEqual({ start: 8, end: 12 });
});

it('the trainer never starts above its goal', () => {
  useApp.setState({ trainer: { ...DEFAULT_TRAINER, start: 0.9, goal: 0.8 } });
  startTrainer();
  expect(s().speed).toBe(0.8);
});

it('Play ends a microphone calibration that is still listening', async () => {
  useApp.setState({ calibrating: true });
  await play();
  expect(s().calibrating).toBe(false);
});
