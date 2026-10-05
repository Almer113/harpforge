// @vitest-environment happy-dom
// Phase 5c: live input (microphone, recording, keyboard) can't run away or lose a take.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/engine', async () => (await import('../test/fakeEngine')).fakeEngine());

import { getHarmonica } from '../core/instruments';
import { holeSound } from '../core/types';
import { setHarmonica } from '../state/actions';
import { useApp } from '../state/store';
import { keysTaken } from './focus';
import { startMic, stopMic } from './inputs';
import { press, release } from './livePlayer';
import { startRecording } from './recorder';

const settle = () => new Promise((r) => setTimeout(r, 0));
const C_TAB = '---\nharmonica: diatonic\nharp-key: C\n---\n';

describe('a recording something else takes over from', () => {
  beforeEach(() => {
    useApp.getState().loadText(C_TAB, null, true);
    useApp.setState({ page: 'play', recordAppend: true });
  });
  /** Three notes a quarter second apart (free mode takes notes played together as a chord). */
  const playNotes = () => {
    const now = vi.spyOn(performance, 'now');
    let t = performance.now();
    for (const h of [4, 5, 6]) {
      now.mockReturnValue((t += 250));
      press('k', holeSound(h, 'blow'), { silent: true });
      release('k');
    }
    now.mockRestore();
  };

  it('is written into the tab before the harmonica changes', async () => {
    await startRecording('free');
    playNotes();
    setHarmonica(getHarmonica({ family: 'diatonic', tuning: 'richter', key: 'G' }).spec, 'notes');
    const s = useApp.getState();
    expect(s.recording).toBeNull();
    // C5 E5 G5 on a G harp: the take was re-tabbed with the rest, not lost.
    expect(s.text).toMatch(/harp-key: G/);
    expect(s.text).toMatch(/-5 -6 7/);
  });

  it('ends (keeping the notes) when you leave the Play page', async () => {
    await startRecording('free');
    playNotes();
    useApp.getState().setPage('editor');
    expect(useApp.getState().recording).toBeNull();
    expect(useApp.getState().text).toMatch(/4 5 6/);
  });
});

describe('the microphone', () => {
  type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void };
  const deferred = <T,>(): Deferred<T> => {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((a, b) => {
      resolve = a;
      reject = b;
    });
    return { promise, resolve, reject };
  };
  let permission: Deferred<MediaStream>;
  let addModule: () => Promise<void>;
  let stopped: boolean[];
  let closed: number;

  beforeEach(() => {
    stopped = [];
    closed = 0;
    addModule = async () => undefined;
    permission = deferred<MediaStream>();
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: () => permission.promise } });
    class FakeContext {
      state = 'running';
      sampleRate = 48000;
      destination = {};
      audioWorklet = { addModule: () => addModule() };
      resume = async () => undefined;
      close = async () => {
        this.state = 'closed';
        closed++;
      };
      createMediaStreamSource = () => ({ connect: (n: unknown) => n, disconnect: () => undefined });
      createGain = () => ({ gain: { value: 1 }, connect: (n: unknown) => n });
    }
    vi.stubGlobal('AudioContext', FakeContext);
    vi.stubGlobal('AudioWorkletNode', class {
      port = { onmessage: null };
      connect = (n: unknown) => n;
    });
    stopMic();
  });
  const stream = () => {
    const k = stopped.length;
    stopped.push(false);
    return { getTracks: () => [{ stop: () => (stopped[k] = true) }] } as unknown as MediaStream;
  };

  it('stays off when cancelled while the permission prompt is open', async () => {
    const starting = startMic();
    expect(useApp.getState().mic.status).toBe('starting');
    stopMic();
    permission.resolve(stream());
    await starting;
    expect(useApp.getState().mic.status).toBe('off');
    expect(stopped).toEqual([true]); // the browser's recording light goes off
  });

  it('gives the microphone back if setting up fails after permission', async () => {
    addModule = async () => {
      throw new Error('worklet failed');
    };
    const starting = startMic();
    permission.resolve(stream());
    await starting;
    expect(useApp.getState().mic.status).toBe('error');
    expect(stopped).toEqual([true]);
    expect(closed).toBe(1);
  });

  it('start, stop, start leaves exactly one stream open', async () => {
    const first = startMic();
    stopMic();
    const firstPermission = permission;
    permission = deferred<MediaStream>();
    const second = startMic();
    firstPermission.resolve(stream());
    permission.resolve(stream());
    await Promise.all([first, second]);
    await settle();
    expect(useApp.getState().mic.status).toBe('on');
    expect(stopped).toEqual([true, false]);
    stopMic();
    expect(stopped).toEqual([true, true]);
  });
});

describe('the keyboard', () => {
  it('starts at the first hole again on another harmonica', () => {
    useApp.getState().loadText('---\nharmonica: chromatic\ntuning: solo-16\nharp-key: C\n---\n4 |\n');
    useApp.setState({ keyOffset: 4 });
    useApp.getState().loadText(C_TAB + '4 |\n');
    expect(useApp.getState().keyOffset).toBe(0);
  });

  it('isn’t taken by a slider or checkbox, except for the keys they use', () => {
    const key = (type: string, k: string) => {
      const input = document.createElement('input');
      input.type = type;
      const e = new KeyboardEvent('keydown', { key: k });
      Object.defineProperty(e, 'target', { value: input });
      return keysTaken(e);
    };
    expect(key('range', 'q')).toBe(false);
    expect(key('range', 'ArrowLeft')).toBe(true);
    expect(key('checkbox', '4')).toBe(false);
    expect(key('checkbox', ' ')).toBe(true);
    expect(key('text', 'q')).toBe(true);
  });
});
