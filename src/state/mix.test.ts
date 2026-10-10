// @vitest-environment happy-dom
// Phase 12a: the mix — the master volume and each part's level and switch, heard by the
// engine; the tune's switch is Silent and playing along without the tune.

import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('../audio/engine', async () => (await import('../test/fakeEngine')).fakeEngine({ scoreBeatNow: () => 0 }));

import * as engine from '../audio/engine';
import { play, stop } from './playback';
import { DEFAULT_MIX, setPartOff, useApp } from './store';

const setMix = engine.setMix as unknown as ReturnType<typeof vi.fn>;
const setTuneOff = engine.setTuneOff as unknown as ReturnType<typeof vi.fn>;
const playScore = engine.playScore as unknown as ReturnType<typeof vi.fn>;
const s = () => useApp.getState();

beforeEach(() => {
  stop();
  useApp.setState({ mix: DEFAULT_MIX, page: 'play', along: false, metronome: false });
  s().loadText('---\ntitle: M\n---\n4 5 6 7 |\n', null);
  setMix.mockClear();
  setTuneOff.mockClear();
  playScore.mockClear();
});

it('the engine hears each part’s level, and nothing from a part that’s off (its level kept)', () => {
  useApp.setState({ mix: { ...DEFAULT_MIX, master: 0.5, levels: { ...DEFAULT_MIX.levels, clicks: 0.6 } } });
  expect(setMix).toHaveBeenLastCalledWith({ master: 0.5, parts: { tune: 1, backing: 0.7, clicks: 0.6, you: 1 } });
  setPartOff('clicks', true);
  expect(setMix.mock.lastCall?.[0].parts.clicks).toBe(0);
  expect(s().mix.levels.clicks).toBe(0.6);
  setPartOff('clicks', false);
  expect(setMix.mock.lastCall?.[0].parts.clicks).toBe(0.6);
});

it('the tune off plays without it; switched while playing, it goes off and on there and then', async () => {
  setPartOff('tune', true);
  await play();
  expect(playScore.mock.lastCall?.[1]).toMatchObject({ muted: true });
  setPartOff('tune', false);
  expect(setTuneOff).toHaveBeenLastCalledWith(false);
  // (No restart: the same playback goes on.)
  expect(playScore).toHaveBeenCalledTimes(1);
});

it('playing along without the tune, the clicks keep time (and go when the tune comes back)', async () => {
  const setMetronome = engine.setMetronome as unknown as ReturnType<typeof vi.fn>;
  useApp.setState({ along: true });
  await play();
  setMetronome.mockClear();
  setPartOff('tune', true);
  expect(setMetronome).toHaveBeenLastCalledWith(4);
  setPartOff('tune', false);
  expect(setMetronome).toHaveBeenLastCalledWith(null);
  stop();
  useApp.setState({ along: false });
});
