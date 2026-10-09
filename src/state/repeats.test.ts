// @vitest-environment happy-dom
// Phase 10d: repeats in playback, and the practice tools with them.

import { beforeEach, expect, it, vi } from 'vitest';

const clock = vi.hoisted(() => ({ beat: 0 as number | null }));
vi.mock('../audio/engine', async () => (await import('../test/fakeEngine')).fakeEngine({ scoreBeatNow: () => clock.beat }));

import * as engine from '../audio/engine';
import { holeSound } from '../core/types';
import { press, release } from '../live/livePlayer';
import type { Score } from '../core/score';
import { play, stop } from './playback';
import { setAlong } from './playAlong';
import { useApp } from './store';

// C harp at 60 bpm: 4 = C5, 5 = E5, 6 = G5. Played: 4 | 5 6 | 5 6 | 4 (8 beats).
const TAB = '---\ntempo: 60\n---\n4 |: 5 6 :| 4 |\n';
const s = () => useApp.getState();
const playScore = engine.playScore as unknown as ReturnType<typeof vi.fn>;
type Opts = { startBeat?: number; onEvent: (i: number, on: boolean) => void; range?: unknown; barStarts?: number[] };
const last = () => playScore.mock.lastCall as [Score, Opts];
const playAt = (beat: number, hole: number) => {
  clock.beat = beat;
  press('key:test', holeSound(hole, 'blow'));
  release('key:test');
};

beforeEach(() => {
  stop();
  setAlong(false);
  useApp.setState({ report: null });
  s().loadText(TAB, null);
  useApp.setState({ loop: false, loopRange: null, speed: 1, countIn: false, countEachLoop: false, playRepeats: true, selectedEvent: null, page: 'play', along: false, alongPasses: [] });
  playScore.mockClear();
});

it('plays the repeat: the engine gets the notes in the order played', async () => {
  await play();
  const [score, opts] = last();
  expect(score.events.map((e) => e.midis[0])).toEqual([72, 76, 79, 76, 79, 72]);
  expect(opts.barStarts).toEqual([0, 1, 3, 5]);
});

it('the sheet lights the written note, and knows the second time', async () => {
  await play();
  const { onEvent } = last()[1];
  onEvent(3, true);
  expect(s().activeEvents).toEqual([1]);
  expect(s().playPass).toBe(2);
  onEvent(3, false);
  onEvent(5, true);
  expect(s().activeEvents).toEqual([3]);
  expect(s().playPass).toBe(1);
  stop();
  expect(s().playPass).toBe(1);
});

it('starts at the selected note (its first time); off, or looping a passage, plays as written', async () => {
  useApp.setState({ selectedEvent: 2 });
  await play();
  expect(last()[1].startBeat).toBe(2);
  stop();
  useApp.setState({ playRepeats: false });
  await play();
  expect(last()[0].events).toHaveLength(4);
  stop();
  useApp.setState({ playRepeats: true, loop: true, loopRange: { start: 1, end: 3 }, selectedEvent: 1 });
  await play();
  expect(last()[0].events).toHaveLength(4);
  expect(last()[1].range).toEqual({ start: 1, end: 3 });
});

it('switching repeats off mid-song carries on from the same note', async () => {
  await play();
  // In the repeat: the second 6 (played at beat 4).
  clock.beat = 4.2;
  playScore.mockClear();
  useApp.setState({ playRepeats: false });
  await vi.waitFor(() => expect(playScore).toHaveBeenCalledTimes(1));
  expect(s().selectedEvent).toBe(2);
  expect(last()[0].events).toHaveLength(4);
  expect(last()[1].startBeat).toBe(2);
  stop();
});

it('playing along checks both times; marks and the report name the written notes', async () => {
  setAlong(true);
  clock.beat = 0;
  await play();
  // The first time through all in time, the repeat's 6 missed.
  playAt(0, 4);
  playAt(1, 5);
  playAt(2, 6);
  playAt(3, 5);
  // Stopped before the last note: the repeat's 6 (beat 4) has gone by.
  clock.beat = 4.6;
  // (The checker's timer marks the missed one.)
  await new Promise((r) => setTimeout(r, 130));
  expect(s().alongMarks).toMatchObject({ 0: 'hit', 1: 'hit', 2: 'missed' });
  stop();
  const pass = s().alongPasses.at(-1)!;
  expect(pass.total).toBe(5);
  expect(pass.hit).toBe(4);
  expect(pass.missedAt).toEqual([2]);
  setAlong(false);
  expect(s().report?.session.holes[0]).toMatchObject({ misses: 1 });
});
