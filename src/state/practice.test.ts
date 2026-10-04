// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

// No Web Audio here: the engine is a stub.
vi.mock('../audio/engine', () => {
  const names = ['ensureAudio', 'stopPlayback', 'previewMidis', 'setVoicing', 'setSoundMode', 'loadSamples', 'noteOn', 'noteOff', 'setPitch', 'playScore', 'pausePlayback', 'resumePlayback', 'setTempo', 'setMetronome', 'setLoop', 'allNotesOff'];
  const m: Record<string, unknown> = Object.fromEntries(names.map((n) => [n, vi.fn(async () => true)]));
  m.samplesReady = () => true;
  m.transportBeats = () => 0;
  m.isTransportRunning = () => false;
  return m;
});
import { holeSound } from '../core/types';
import { change, press, release } from '../live/livePlayer';
import { startPractice } from './practice';
import { useApp } from './store';

// Silent presses: what the microphone does, so no audio is needed. Ids other than "mic".
const play = (id: string, hole: number, breath: 'blow' | 'draw', bend = 0) => press(id, holeSound(hole, breath, { bend }), { silent: true });

describe('practice mode', () => {
  beforeEach(() => {
    useApp.getState().loadText("---\nharmonica: diatonic\nharp-key: C\n---\n-3' (4 5) 6 |\n");
    useApp.setState({ selectedEvent: null });
    startPractice();
  });
  const practice = () => useApp.getState().practice!;

  it('counts a note reached by bending while the hole is held', () => {
    play('k', 3, 'draw'); // -3, not yet the target
    expect(practice().index).toBe(0);
    change('k', holeSound(3, 'draw', { bend: 1 })); // bent down to -3'
    expect(practice().index).toBe(1);
    release('k');
    expect(practice().mistakes).toBe(0);
  });

  it('needs every note of a chord held together', () => {
    play('k', 3, 'draw', 1);
    release('k');
    play('a', 4, 'blow');
    expect(practice().index).toBe(1); // half the chord: waiting
    play('b', 5, 'blow');
    expect(practice().index).toBe(2);
    release('a');
    release('b');
    expect(practice().mistakes).toBe(0);
  });

  it('a held chord plays one chord, even when its keys change', () => {
    useApp.getState().loadText('---\nharmonica: diatonic\nharp-key: C\n---\n(4 5) (4 5) 6 |\n');
    startPractice();
    play('a', 4, 'blow');
    play('b', 5, 'blow');
    expect(practice().index).toBe(1);
    change('a', holeSound(4, 'blow')); // e.g. Shift pressed while holding: keys refresh
    change('b', holeSound(5, 'blow'));
    expect(practice().index).toBe(1);
    release('a');
    release('b');
    play('a', 4, 'blow');
    play('b', 5, 'blow');
    expect(practice().index).toBe(2);
  });

  it('counts a wrong note as a mistake when it is let go', () => {
    play('x', 7, 'blow');
    expect(practice().mistakes).toBe(0);
    release('x');
    expect(practice().mistakes).toBe(1);
    expect(practice().index).toBe(0);
  });
});
