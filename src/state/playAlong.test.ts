// @vitest-environment happy-dom
// Phase 9d: playing along with the song, checked: marks on the notes, each pass scored, the
// microphone's delay allowed for, a tempo trainer that waits for a clean pass, and (9e) the
// practice report.

import { beforeEach, expect, it, vi } from 'vitest';

const clock = vi.hoisted(() => ({ beat: 0 as number | null }));
vi.mock('../audio/engine', async () => (await import('../test/fakeEngine')).fakeEngine({ scoreBeatNow: () => clock.beat }));

import { holeSound } from '../core/types';
import { press, release } from '../live/livePlayer';
import { loopPassed, play, selectBar, startTrainer, stop } from './playback';
import { setAlong } from './playAlong';
import { drill } from './report';
import { songLog } from '../storage/practiceLog';
import { DEFAULT_TRAINER, useApp } from './store';

// C harp at 60 bpm (a beat is a second): 4 = C5, 5 = E5.
const TAB = '---\ntempo: 60\n---\n4 5 4 5 | 4 4 4 4 |\n';
const s = () => useApp.getState();
const settle = () => new Promise((r) => setTimeout(r, 0));
/** The loop over bar 2 (beats 4–8) comes round: the song reaches its end (one check there), then is back at its start. */
const comeRound = async () => {
  clock.beat = 7.99;
  await new Promise((r) => setTimeout(r, 130));
  clock.beat = 4.01;
  loopPassed();
};
const playAt = (beat: number, hole: number, id = 'key:test') => {
  clock.beat = beat;
  press(id, holeSound(hole, 'blow'));
  release(id);
};

beforeEach(async () => {
  stop();
  s().loadText(TAB, null);
  useApp.setState({ loop: false, loopRange: null, speed: 1, countIn: false, countEachLoop: false, trainer: DEFAULT_TRAINER, training: null, trainerCleanOnly: false, micLatency: null, page: 'play' });
  setAlong(true);
});

it('marks the notes you play in time, early or late; a wrong note marks nothing', async () => {
  await play();
  playAt(0.02, 4);
  playAt(0.8, 5);
  playAt(2.2, 4);
  playAt(3, 6);
  expect(s().alongMarks).toEqual({ 0: 'hit', 1: 'early', 2: 'late' });
});

it('the microphone is heard late: its notes count from before they arrive', async () => {
  useApp.setState({ micLatency: 200 });
  await play();
  // Heard at 1.2, played at 1.0: in time.
  playAt(1.2, 5, 'mic');
  expect(s().alongMarks[1]).toBe('hit');
});

it('each pass of a loop is scored and starts afresh', async () => {
  selectBar({ start: 4, end: 8 }, false);
  useApp.setState({ loop: true, loopRange: { start: 4, end: 8 } });
  await play();
  for (const b of [4, 5, 6, 7]) playAt(b, 4);
  await comeRound();
  expect(s().alongPasses.at(-1)).toMatchObject({ hit: 4, missed: 0, clean: true });
  expect(s().alongMarks).toEqual({});
  playAt(4, 4);
  await comeRound();
  expect(s().alongPasses.at(-1)).toMatchObject({ hit: 1, missed: 3, clean: false, missedAt: [5, 6, 7] });
});

it('the trainer can wait for a clean pass', async () => {
  useApp.setState({ trainerCleanOnly: true });
  selectBar({ start: 4, end: 8 }, false);
  startTrainer();
  await settle();
  playAt(4, 4);
  await comeRound();
  expect(s().speed).toBe(0.6);
  for (const b of [4, 5, 6, 7]) playAt(b, 4);
  await comeRound();
  expect(s().speed).toBe(0.65);
});

it('practice mode and play along take turns', () => {
  expect(s().along).toBe(true);
  setAlong(false);
  expect(s().along).toBe(false);
});

// ---- Phase 9e: the practice report

it('stopping play along after a pass shows the report and keeps it in the song history', async () => {
  localStorage.clear();
  s().loadText(TAB, 'song-1', true);
  setAlong(true);
  useApp.setState({ loop: true, loopRange: { start: 4, end: 8 } });
  await play();
  for (const b of [4, 6]) playAt(b, 4);
  await comeRound();
  setAlong(false);
  const r = s().report!;
  expect(r.session).toMatchObject({ mode: 'along', passes: 1, clean: 0, notes: 4, played: 2 });
  expect(r.session.bars[0]).toMatchObject({ bar: 2, misses: 2 });
  expect(r.history).toEqual([]);
  expect(songLog('song-1')).toMatchObject([{ accuracy: 50, passes: 1, holes: ['4'] }]);
});

it('Drill loops the bar slowly with the trainer, playing along', async () => {
  drill({ start: 4, end: 8 });
  await settle();
  expect(s()).toMatchObject({ report: null, along: true, loop: true, loopRange: { start: 4, end: 8 }, speed: 0.6, training: { pass: 0 } });
});

it("a note played just before the loop comes round is the next pass's first, a little early", async () => {
  useApp.setState({ loop: true, loopRange: { start: 4, end: 8 } });
  await play();
  for (const b of [4, 5, 6, 7]) playAt(b, 4);
  // Beat 7.9 (just before the wrap) is the next pass's beat 3.9: its first note, early.
  playAt(7.9, 4);
  expect(s().alongPasses.at(-1)).toMatchObject({ hit: 4, clean: true });
  expect(s().alongMarks).toEqual({ 4: 'hit' });
  // The wrap itself then doesn't end that new pass again.
  await comeRound();
  expect(s().alongPasses).toHaveLength(1);
  expect(s().alongMarks).toEqual({ 4: 'hit' });
});
