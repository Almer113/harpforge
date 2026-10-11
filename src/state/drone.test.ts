// @vitest-environment happy-dom
// Phase 12c: the drone — on its own (held until it's stopped, following the song's key), and
// as the backing while a song plays.

import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('../audio/engine', async () => (await import('../test/fakeEngine')).fakeEngine({ scoreBeatNow: () => 0 }));

import * as engine from '../audio/engine';
import { droneMidis } from '../core/backing';
import { droneName, droneNotes, toggleDrone } from './drone';
import { play, stop } from './playback';
import { useApp } from './store';

const setDrone = engine.setDrone as unknown as ReturnType<typeof vi.fn>;
const playScore = engine.playScore as unknown as ReturnType<typeof vi.fn>;
const s = () => useApp.getState();
const SONG = (key: string) => `---\ntitle: D\nharp-key: C\nkey: ${key}\n---\n-2 -3 4 -4 |\n`;

beforeEach(() => {
  stop();
  toggleDrone(false);
  useApp.setState({ droneRoot: 'song', droneFifth: true, backing: 'off', page: 'play' });
  s().loadText(SONG('G'), null);
  setDrone.mockClear();
  playScore.mockClear();
});

it('its notes: the root low, the fifth, the root an octave up', () => {
  expect(droneMidis(7, true)).toEqual([43, 50, 55]); // G2 D3 G3
  expect(droneMidis(0, false)).toEqual([48, 60]); // C3 C4
});

it('holds the song’s key (2nd position on a C harp: G), the harmonica’s, or a note picked', () => {
  expect(droneName(s())).toBe('G + D');
  useApp.setState({ droneRoot: 'harp' });
  expect(droneName(s())).toBe('C + G');
  useApp.setState({ droneRoot: 9, droneFifth: false });
  expect(droneName(s())).toBe('A');
});

it('on its own: sounds until switched off, and follows the song open', () => {
  toggleDrone(true);
  expect(setDrone).toHaveBeenLastCalledWith([43, 50, 55]);
  s().loadText(SONG('D'), null);
  expect(setDrone).toHaveBeenLastCalledWith(droneMidis(2, true));
  // (Playback starting and stopping leaves it be.)
  setDrone.mockClear();
  stop();
  expect(setDrone).not.toHaveBeenCalled();
  toggleDrone(false);
  expect(setDrone).toHaveBeenLastCalledWith(null);
});

it('as the backing: held under the song; not doubled when it sounds on its own already', async () => {
  useApp.setState({ backing: 'drone' });
  await play();
  const opts = playScore.mock.lastCall![1] as { backing?: { style: string; notes: { midis: number[]; dur: number }[] } };
  expect(opts.backing?.style).toBe('drone');
  expect(opts.backing?.notes).toEqual([expect.objectContaining({ midis: droneNotes(s()), dur: 4 })]);
  stop();
  toggleDrone(true);
  await play();
  expect((playScore.mock.lastCall as [unknown, { backing?: unknown }])[1].backing).toBeUndefined();
  stop();
});
