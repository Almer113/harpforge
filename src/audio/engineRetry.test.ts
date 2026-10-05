// When the engine can't be downloaded, the failure is reported (not for the quiet
// background preload), the sample status doesn't hang, and the next sound tries again.

import { expect, it, vi } from 'vitest';

const net = vi.hoisted(() => ({ down: true }));
const impl = vi.hoisted(() => ({ ensureAudio: vi.fn(async () => {}), loadSamples: vi.fn(async () => true), previewMidis: vi.fn() }));
vi.mock('./engineImpl', async () => {
  if (net.down) throw new Error('Failed to fetch dynamically imported module');
  return impl;
});

import * as engine from './engine';

const settle = () => new Promise((r) => setTimeout(r, 0));

it('reports a failed download and tries again at the next sound', async () => {
  const failed = vi.fn();
  engine.setAudioLoadFailed(failed);
  engine.preloadAudio();
  await settle();
  expect(failed).not.toHaveBeenCalled();

  await expect(engine.ensureAudio()).rejects.toBeInstanceOf(Error);
  expect(failed).toHaveBeenCalledTimes(1);
  expect(await engine.loadSamples()).toBe(false);
  engine.previewMidis([60]);
  await settle();

  net.down = false;
  await engine.ensureAudio();
  expect(impl.ensureAudio).toHaveBeenCalled();
  engine.previewMidis([62]);
  expect(impl.previewMidis).toHaveBeenCalledWith([62], undefined, undefined);
});
