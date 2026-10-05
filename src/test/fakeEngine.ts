// The audio engine, faked for tests (there is no Web Audio there). Every function the
// engine exports becomes a mock that resolves; the names are read from the engine's own
// source, so the fake never falls behind when the engine gains a function.
//
//   vi.mock('../audio/engine', async () => (await import('../test/fakeEngine')).fakeEngine());

import { vi } from 'vitest';
import SOURCE from '../audio/engine.ts?raw';

const NAMES = [
  ...new Set([
    ...[...SOURCE.matchAll(/^export (?:async )?function (\w+)/gm)].map((m) => m[1]),
    ...[...SOURCE.matchAll(/^export \{([^}]+)\} from/gm)].flatMap((m) =>
      m[1]
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s && !s.startsWith('type ')),
    ),
  ]),
];

/** A fake engine: mocks for everything, quiet defaults, and `overrides` on top. */
export function fakeEngine(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const mocks = Object.fromEntries(NAMES.map((n) => [n, vi.fn(async () => true)]));
  return {
    ...mocks,
    samplesReady: () => true,
    transportBeats: () => 0,
    appSounding: () => false,
    ...overrides,
  };
}
