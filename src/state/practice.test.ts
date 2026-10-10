// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

// No Web Audio here: the engine is a stub.
vi.mock('../audio/engine', async () => (await import('../test/fakeEngine')).fakeEngine());
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

describe('practice mode follows the order played', () => {
  const tap = (hole: number) => {
    play('k', hole, 'blow');
    release('k');
  };
  it('through the repeat and its endings (and not with repeats off)', async () => {
    const { practiceTotal } = await import('./practice');
    useApp.getState().loadText('---\nharmonica: diatonic\nharp-key: C\n---\n|: 4 | [1.] 5 :| [2.] 6 |\n');
    useApp.setState({ selectedEvent: null, playRepeats: true });
    startPractice();
    expect(practiceTotal()).toBe(4);
    const seen = [useApp.getState().practice!.index];
    for (const hole of [4, 5, 4]) {
      tap(hole);
      seen.push(useApp.getState().practice!.index);
    }
    // 4, the 1st ending's 5, 4 again, then the 2nd ending's 6.
    expect(seen).toEqual([0, 1, 0, 2]);
    useApp.setState({ practice: null, playRepeats: false });
    startPractice();
    expect(practiceTotal()).toBe(3);
    useApp.setState({ practice: null, playRepeats: true });
  });
});

it('switching repeats off mid-practice goes on from the same note', () => {
  useApp.getState().loadText('---\nharmonica: diatonic\nharp-key: C\n---\n|: 4 5 :| 6 |\n', null);
  useApp.setState({ selectedEvent: null, playRepeats: true });
  startPractice();
  for (const hole of [4, 5, 4]) {
    play('k', hole, 'blow');
    release('k');
  }
  // The second time through, at its 5.
  expect(useApp.getState().practice!.index).toBe(1);
  useApp.setState({ playRepeats: false });
  play('k', 5, 'blow');
  release('k');
  // As written now: on to the 6.
  expect(useApp.getState().practice!.index).toBe(2);
  useApp.setState({ practice: null, playRepeats: true });
});
