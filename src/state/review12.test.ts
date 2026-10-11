// @vitest-environment happy-dom
// The review of Phase 12: changes while paused or looping start again from the same note; the
// microphone's silencing undone when it stops listening.

import { beforeEach, expect, it, vi } from 'vitest';

// (Like the real engine: no place while paused.)
const clock = vi.hoisted(() => ({ beat: 0 as number | null }));
vi.mock('../audio/engine', async () => (await import('../test/fakeEngine')).fakeEngine({ scoreBeatNow: () => clock.beat }));

import * as engine from '../audio/engine';
import { pause, play, stop } from './playback';
import { setAlong } from './playAlong';
import { DEFAULT_MIX, useApp } from './store';

const playScore = engine.playScore as unknown as ReturnType<typeof vi.fn>;
const s = () => useApp.getState();
type Opts = { startBeat?: number; range?: { start: number; end: number }; onEvent: (i: number, on: boolean) => void };
const last = () => (playScore.mock.lastCall as [unknown, Opts])[1];

beforeEach(() => {
  stop();
  setAlong(false);
  clock.beat = 0;
  s().loadText('---\ntitle: R\n---\n[C] 4 4 4 4 | [G] 5 5 5 5 | [C] 6 6 6 6 |\n', null);
  useApp.setState({ page: 'play', backing: 'off', mix: DEFAULT_MIX, loop: false, loopRange: null, selectedEvent: null, countIn: false, countEachLoop: false, droneOn: false, mic: { status: 'off', level: 0, reading: null } });
  playScore.mockClear();
});

it('the backing changed while paused: on from the note it paused at, not from the start', async () => {
  await play();
  last().onEvent(6, true);
  pause();
  clock.beat = null;
  useApp.setState({ backing: 'strum' });
  playScore.mockClear();
  await play();
  expect(playScore).toHaveBeenCalledTimes(1);
  expect(last().startBeat).toBe(6);
  stop();
});

it('changed while a passage loops: from the same note in it (not back to the passage’s start)', async () => {
  useApp.setState({ loop: true, loopRange: { start: 4, end: 8 } });
  await play();
  clock.beat = 6.2;
  playScore.mockClear();
  useApp.setState({ backing: 'pad' });
  await vi.waitFor(() => expect(playScore).toHaveBeenCalledTimes(1));
  expect(last().range).toEqual({ start: 4, end: 8 });
  expect(last().startBeat).toBe(6);
  stop();
});

it('the microphone listening silences the tune, the backing and the drone; stopping brings the tune and backing back', () => {
  useApp.setState({ droneOn: true });
  setAlong(true);
  useApp.setState({ mic: { status: 'on', level: 0, reading: null } });
  expect(s().mix.off).toMatchObject({ tune: true, backing: true });
  expect(s().droneOn).toBe(false);
  useApp.setState({ mic: { status: 'off', level: 0, reading: null } });
  expect(s().mix.off).toMatchObject({ tune: false, backing: false });
  // Turned back on while listening (headphones): left as it is afterwards too.
  useApp.setState({ mic: { status: 'on', level: 0, reading: null } });
  useApp.setState({ mix: { ...s().mix, off: { ...s().mix.off, backing: false } } });
  setAlong(false);
  expect(s().mix.off).toMatchObject({ tune: false, backing: false });
});

it('a backing style on a song with no chords doesn’t start playback again', async () => {
  s().loadText('---\ntitle: N\n---\n4 4 4 4 |\n', null);
  await play();
  playScore.mockClear();
  useApp.setState({ backing: 'strum' });
  await new Promise((r) => setTimeout(r, 0));
  expect(playScore).not.toHaveBeenCalled();
  stop();
});
