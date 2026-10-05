// The audio engine loads separately (engine.ts in front of engineImpl.ts). Before it
// arrives, nothing is lost: a held note starts when it does, a released one doesn't,
// and sound settings made meanwhile are handed over.

import { describe, expect, it, vi } from 'vitest';

let release: () => void = () => {};
const arrived = new Promise<void>((r) => (release = r));
const impl = {
  noteOn: vi.fn(),
  noteOff: vi.fn(),
  setPitch: vi.fn(),
  setVoicing: vi.fn(),
  setSoundMode: vi.fn(),
  previewMidis: vi.fn(),
  playScore: vi.fn(),
  ensureAudio: vi.fn(async () => {}),
  loadSamples: vi.fn(async () => true),
  samplesReady: vi.fn(() => true),
  appSounding: vi.fn(() => true),
  transportBeats: vi.fn(() => 7),
};
vi.mock('./engineImpl', async () => {
  await arrived;
  return impl;
});

import * as engine from './engine';

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('before the engine has loaded', () => {
  it('a held note starts when it arrives; a released one does not; settings are handed over', async () => {
    engine.setVoicing('tremolo');
    engine.setSoundMode('synth');
    engine.noteOn('a', 60);
    engine.setPitch('a', 61);
    engine.noteOn('b', 64);
    engine.noteOff('b');
    // Not loaded yet: quiet answers.
    expect(engine.appSounding()).toBe(false);
    expect(engine.samplesReady()).toBe(false);
    expect(engine.transportBeats()).toBe(0);

    release();
    await engine.ensureAudio();
    await settle();
    expect(impl.setVoicing).toHaveBeenCalledWith('tremolo');
    expect(impl.setSoundMode).toHaveBeenCalledWith('synth');
    expect(impl.noteOn).toHaveBeenCalledTimes(1);
    expect(impl.noteOn).toHaveBeenCalledWith('a', 61, undefined);
    // Loaded: straight through.
    engine.noteOn('c', 67);
    expect(impl.noteOn).toHaveBeenLastCalledWith('c', 67, undefined);
    expect(engine.transportBeats()).toBe(7);
    expect(engine.appSounding()).toBe(true);
  });
});
