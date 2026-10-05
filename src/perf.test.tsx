// @vitest-environment happy-dom
// Speed guard (Phase 8a): on a long song, a caret move, a selection or a playback step
// redraws only the measures or cards involved, not the whole score. React's Profiler
// reports how long an update took ("actual") and how long redrawing everything would take
// ("base"); the share must stay small, on any machine.

import { act, Profiler, StrictMode, type ProfilerOnRenderCallback } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('./audio/engine', async () => (await import('./test/fakeEngine')).fakeEngine());
vi.mock('./storage/library', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./storage/library')>()),
  listTabs: async () => [],
  saveTab: async () => 'id',
  persistStorage: async () => true,
  seedDemos: async () => undefined,
}));

import { App } from './App';
import { DEMOS } from './demo/songs';
import { useApp } from './state/store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let updates: { actual: number; base: number }[] = [];
const onRender: ProfilerOnRenderCallback = (_id, phase, actual, base) => {
  if (phase !== 'mount') updates.push({ actual, base });
};
const settle = async (ms = 0) => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
};
/** What share of a full redraw an update costs. */
async function share(change: () => void): Promise<number> {
  updates = [];
  await act(async () => change());
  await settle();
  const actual = updates.reduce((a, u) => a + u.actual, 0);
  const base = Math.max(...updates.map((u) => u.base), 1e-6);
  return actual / base;
}

beforeAll(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(
      <StrictMode>
        <Profiler id="app" onRender={onRender}>
          <App />
        </Profiler>
      </StrictMode>,
    );
  });
  // A long song: the Twinkle demo 12 times over (about 500 notes).
  const text = DEMOS[0].text;
  const body = text.slice(text.indexOf('---', 4) + 4);
  await act(async () => useApp.getState().loadText(text.slice(0, text.indexOf('---', 4) + 4) + Array.from({ length: 12 }, () => body).join('\n')));
  await settle(20);
});

afterAll(async () => {
  await act(async () => root.unmount());
});

describe('a long song stays quick', () => {
  it('Play: a playback step redraws only the cards that start or stop sounding', async () => {
    await act(async () => useApp.getState().setPage('play'));
    await settle(20);
    await share(() => useApp.setState({ activeEvents: [10] }));
    expect(await share(() => useApp.setState({ activeEvents: [11] }))).toBeLessThan(0.15);
    expect(await share(() => useApp.setState({ activeEvents: [200] }))).toBeLessThan(0.15);
    await act(async () => useApp.setState({ activeEvents: [] }));
  });

  it('Edit: a caret move, a selection and a playback step redraw only their measures', async () => {
    await act(async () => useApp.getState().setPage('editor'));
    for (let i = 0; i < 60 && !document.querySelector('.ve-item'); i++) await settle(50);
    expect(document.querySelectorAll('.ve-item').length).toBeGreaterThan(400);
    // (A caret move or a selection also updates the Inspector, the bar and the status line, as
    // it should; redrawing the whole score would cost all of it, about 1.)
    expect(await share(() => useApp.getState().setVe({ caret: { m: 30, start: 1 }, selection: [] }))).toBeLessThan(0.5);
    expect(await share(() => useApp.getState().setVe({ caret: { m: 31, start: 0 } }))).toBeLessThan(0.5);
    expect(await share(() => useApp.getState().setVe({ selection: [{ m: 40, start: 0 }], anchor: { m: 40, start: 0 }, measure: 40 }))).toBeLessThan(0.5);
    expect(await share(() => useApp.setState({ activeEvents: [100] }))).toBeLessThan(0.3);
  });
});
