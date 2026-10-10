// @vitest-environment happy-dom
// The Phase 9–11 review's fixes: verses in turn with repeats, play along's timing (the
// microphone, a missed note), restarting while paused, clicking during a repeat, the note
// chosen to play from after an edit, the trainer's clean passes, a session kept on leaving.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const clock = vi.hoisted(() => ({ beat: 0 as number | null }));
vi.mock('../audio/engine', async () => (await import('../test/fakeEngine')).fakeEngine({ scoreBeatNow: () => clock.beat }));

import * as engine from '../audio/engine';
import { AlongChecker } from '../core/playAlong';
import { playbackScore } from '../core/repeats';
import { holeSound } from '../core/types';
import { press, release } from '../live/livePlayer';
import { songLog } from '../storage/practiceLog';
import { loopPassed, pause, play, playFrom, selectBar, startTrainer, stop } from './playback';
import { setAlong } from './playAlong';
import { DEFAULT_MIX, DEFAULT_TRAINER, getParsed, useApp } from './store';

const s = () => useApp.getState();
const settle = () => new Promise((r) => setTimeout(r, 0));
const playScore = engine.playScore as unknown as ReturnType<typeof vi.fn>;
const last = () => playScore.mock.lastCall as [unknown, { startBeat?: number; range?: unknown }];
const playAt = (beat: number, hole: number, id = 'key:test') => {
  clock.beat = beat;
  press(id, holeSound(hole, 'blow'));
  release(id);
};

beforeEach(() => {
  stop();
  setAlong(false);
  clock.beat = 0;
  useApp.setState({ page: 'play', loop: false, loopRange: null, speed: 1, countIn: false, countEachLoop: false, trainer: DEFAULT_TRAINER, training: null, trainerCleanOnly: false, micLatency: null, mix: DEFAULT_MIX, selectedEvent: null, playRepeats: true, playAllVerses: false, mic: { status: 'off', level: 0, reading: null } });
  playScore.mockClear();
});

describe('all verses, each line in its turn', () => {
  const verses = (text: string) => {
    const { doc, score } = getParsed(text);
    return playbackScore(doc, score, { allVerses: true }).verse;
  };
  it('an instrumental repeat before the words: every verse, in order', () => {
    // The intro is played twice each time through; the sung line once: three times through.
    const v = verses('---\ntitle: X\n---\n|: 4 5 :|\n6 7 |\nw: a b\nw: c d\nw: e f\n');
    expect(v).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 2, 2]);
  });
  it('three verses in a repeat: the third time is the last, not a fourth with verse 3 again', () => {
    expect(verses('---\ntitle: X\n---\n|: 4 5 :|\nw: a b\nw: c d\nw: e f\n')).toEqual([0, 0, 1, 1, 2, 2]);
  });
});

describe('play along timing', () => {
  const TAB = '---\ntempo: 60\n---\n4 5 4 5 | 4 4 4 4 |\n';
  beforeEach(() => {
    s().loadText(TAB, null);
    setAlong(true);
  });

  it('with the microphone, a note isn’t missed before the microphone could have heard it', async () => {
    useApp.setState({ micLatency: 200, mic: { status: 'on', level: 0, reading: null } });
    await play();
    // Played at 1.2 (a little late), heard at 1.4: at 1.3 it isn't missed yet.
    clock.beat = 1.3;
    await new Promise((r) => setTimeout(r, 130));
    expect(s().alongMarks[1]).toBeUndefined();
    playAt(1.4, 5, 'mic');
    expect(s().alongMarks[1]).toBe('late');
  });

  it('after a missed note, the next of the same pitch played in time is in time', () => {
    const c = new AlongChecker([0, 0.25, 0.5, 0.75].map((start, index) => ({ index, start, midis: [72] })));
    const win = { ok: 0.25, good: 0.125 };
    // The first skipped; the rest each on its beat.
    expect(c.attack(0.25, 72, win)?.mark).toBe('hit');
    expect(c.attack(0.5, 72, win)?.mark).toBe('hit');
    expect(c.attack(0.75, 72, win)).toEqual({ index: 3, mark: 'hit' });
  });

  it('play along turned on while paused is checked from Play', async () => {
    setAlong(false);
    await play();
    clock.beat = 1;
    pause();
    setAlong(true);
    await play();
    expect(playScore).toHaveBeenCalledTimes(2);
    playAt(2, 4);
    expect(s().alongMarks[2]).toBe('hit');
  });

  it('a clean-only trainer speeds up after every `every` clean passes, not passes', async () => {
    useApp.setState({ trainerCleanOnly: true, trainer: { ...DEFAULT_TRAINER, every: 2 } });
    selectBar({ start: 4, end: 8 }, false);
    startTrainer();
    await settle();
    const start = s().speed;
    const pass = async (clean: boolean) => {
      for (const b of clean ? [4, 5, 6, 7] : [4]) playAt(b, 4);
      clock.beat = 7.99;
      await new Promise((r) => setTimeout(r, 130));
      clock.beat = 4.01;
      loopPassed();
    };
    await pass(true);
    await pass(false);
    expect(s().speed).toBe(start);
    await pass(true);
    expect(s().speed).toBeGreaterThan(start);
  });

  it('opening another song keeps the play-along session in the old one’s history', async () => {
    s().loadText(TAB, 'song-a');
    setAlong(true);
    await play();
    for (const b of [0, 1, 2, 3]) playAt(b, b % 2 ? 5 : 4);
    clock.beat = 3.5;
    stop();
    expect(s().alongPasses.length).toBe(1);
    const before = songLog('song-a').length;
    s().loadText('---\ntitle: B\n---\n6 6 |\n', 'song-b');
    expect(songLog('song-a').length).toBe(before + 1);
  });
});

describe('where playback starts', () => {
  it('while paused, a new caret in a song with repeats starts from the caret', async () => {
    s().loadText('---\ntitle: R\n---\n|: 4 5 6 7 :| 4 4 4 4 |\n', null);
    useApp.setState((st) => ({ page: 'editor', editorMode: 'visual', ve: { ...st.ve, selection: [{ m: 0, start: 0 }, { m: 0, start: 1 }], caret: { m: 0, start: 0 } } }));
    await play();
    expect(last()[1].range).toBeTruthy();
    pause();
    useApp.setState((st) => ({ ve: { ...st.ve, selection: [], caret: { m: 1, start: 2 } } }));
    await play();
    expect(last()[1].range).toBeUndefined();
    // Bar 2 is played after the repeat: 8 beats in, and 2 more.
    expect(last()[1].startBeat).toBe(10);
  });

  it('a click while in a repeat’s second time goes to a later repeat’s first time', async () => {
    s().loadText('---\ntitle: R\n---\n|: 4 4 4 4 :| |: 5 5 5 5 :| 6 6 6 6 |\n', null);
    await play({ from: 1, pass: 2 });
    expect(last()[1].startBeat).toBe(5);
    playFrom(4);
    await settle();
    expect(last()[1].startBeat).toBe(8);
    // Within the same repeat, the second time stays the second time.
    playFrom(6);
    await settle();
    expect(last()[1].startBeat).toBe(10);
  });

  it('the note chosen on the Play page stays the note at that beat after an edit', () => {
    s().loadText('---\ntitle: E\n---\n4 5 6 7 |\n', null);
    useApp.setState({ selectedEvent: 2 });
    useApp.setState({ text: '---\ntitle: E\n---\n{4 4} 5 6 7 |\n' });
    expect(s().selectedEvent).toBe(3);
    // Nothing starts on that beat any more: back to the start.
    useApp.setState({ text: '---\ntitle: E\n---\n{4 4} 5~ 7 |\n' });
    expect(s().selectedEvent).toBeNull();
  });
});

describe('the pass shown while playing', () => {
  it('"Verse 2" only on lines with verses; "2nd time" in a repeat; nothing when stopped', async () => {
    const { passLabel } = await import('../components/Controls');
    // Line 0: an intro (one verse); line 1: two verses.
    const lines = [1, 2];
    const at = { play: 'playing' as const, playVerses: true, playVerse: 1, playPass: 2 };
    expect(passLabel({ ...at, playLine: 1 }, lines)).toBe('Verse 2');
    expect(passLabel({ ...at, playLine: 0 }, lines)).toBe('2nd time');
    expect(passLabel({ ...at, playLine: 0, playPass: 1 }, lines)).toBeNull();
    // (A repeat played three times, ":|x3".)
    expect(passLabel({ ...at, playLine: 0, playPass: 3 }, lines)).toBe('3rd time');
    expect(passLabel({ ...at, playLine: 1, play: 'stopped' }, lines)).toBeNull();
  });

  it('the line playing is kept between notes, and let go on stopping', async () => {
    s().loadText('---\ntitle: L\n---\n4 4 |\n|: 5 5 :|\nw: a b\nw: c d\n', null);
    useApp.setState({ playAllVerses: false });
    await play();
    const { onEvent } = last()[1] as unknown as { onEvent: (i: number, on: boolean) => void };
    onEvent(3, true);
    onEvent(3, false);
    expect(s().playLine).toBe(1);
    stop();
    expect(s().playLine).toBeNull();
  });
});

it('paused, the note you’re at is the one last played (performance mode goes back to it)', async () => {
  const { lastPlayedNote } = await import('./playback');
  s().loadText('---\ntitle: P\n---\n4 5 6 7 |\n', null);
  useApp.setState({ selectedEvent: 0 });
  await play();
  (last()[1] as unknown as { onEvent: (i: number, on: boolean) => void }).onEvent(2, true);
  pause();
  expect(s().activeEvents).toEqual([]);
  expect(lastPlayedNote()).toBe(2);
  stop();
  expect(lastPlayedNote()).toBeNull();
});
