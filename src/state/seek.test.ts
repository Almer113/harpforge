// @vitest-environment happy-dom
// Clicking a card while the song plays jumps there; while paused, the next play starts from it.

import { describe, expect, it, vi } from 'vitest';

const playScore = vi.fn();
vi.mock('../audio/engine', () => {
  const names = ['ensureAudio', 'stopPlayback', 'previewMidis', 'setVoicing', 'setSoundMode', 'loadSamples', 'noteOn', 'noteOff', 'setPitch', 'pausePlayback', 'resumePlayback', 'setTempo', 'setMetronome', 'setLoop', 'allNotesOff'];
  const m: Record<string, unknown> = Object.fromEntries(names.map((n) => [n, vi.fn(async () => true)]));
  m.playScore = (...a: unknown[]) => playScore(...a);
  m.samplesReady = () => true;
  m.transportBeats = () => 0;
  m.appSounding = () => false;
  return m;
});

import { play, selectEvent } from './playback';
import { useApp } from './store';

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('clicking a card', () => {
  it('while playing, plays on from that note', async () => {
    useApp.getState().loadText('---\ntime: 4/4\n---\n4 5 6 7 | -4 -5 -6 -7 |\n');
    await play();
    expect(useApp.getState().play).toBe('playing');
    selectEvent(5);
    await settle();
    const opts = playScore.mock.calls.at(-1)?.[1] as { startBeat: number };
    expect(opts.startBeat).toBe(5);
    expect(useApp.getState().selectedEvent).toBe(5);
  });

  it('while paused, makes the next play start from it', async () => {
    useApp.setState({ play: 'paused' });
    selectEvent(2);
    await settle();
    expect(useApp.getState().play).toBe('stopped');
    await play();
    expect((playScore.mock.calls.at(-1)?.[1] as { startBeat: number }).startBeat).toBe(2);
  });
});
