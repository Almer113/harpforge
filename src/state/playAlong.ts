// Play along, checked: while the song plays, the notes you play (computer keys, mouse,
// MIDI or your harmonica through the microphone) are matched to the song's notes, which
// light up green (in time), amber (early or late) or red (missed). Each pass of a loop is
// scored (see alongPasses); the tempo trainer can wait for a clean one.

import * as engine from '../audio/engine';
import { AlongChecker, expectedNotes, latencyFrom, windows, type Mark, type PassResult } from '../core/playAlong';
import type { Passage } from '../core/passage';
import { writtenScore, type PlaybackScore } from '../core/repeats';
import { startMic } from '../live/inputs';
import { onLive } from '../live/livePlayer';
import { setAlongHooks, stop } from './playback';
import { alongReport } from '../core/report';
import { showReport } from './report';
import { getParsed, useApp } from './store';

/** The microphone's delay when it hasn't been calibrated (a typical laptop). */
export const DEFAULT_MIC_LATENCY = 120;
const MIC_ID = 'mic';

let checker: AlongChecker | null = null;
let unlisten: (() => void) | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
// The loop being checked (null: no loop) and whether each pass starts with a count.
let loop: Passage | null = null;
let counted = false;
// The text being checked: an edit (or another song) makes the session's notes meaningless.
let checkedText = '';
// Where the song was at the last look (raw, to notice the loop coming round), and where the
// checker was (for scoring a stop made while paused).
let lastBeat = -Infinity;
let lastAt: number | null = null;
// A pass that began early (a note just before the wrap) runs a loop's length behind the
// song's position until the wrap.
let startedEarly = false;
// The engine's "loop came round" and the position jumping back can arrive in either order:
// whichever comes first ends the pass, and the other only catches up.
let endedAhead = 0;
let jumpPending = false;
let lastResult: PassResult | null = null;
// The notes are checked as they're played (repeats twice); marks and results name the written ones.
let written: (i: number) => number = (i) => i;

/** A pass's result with its notes named as written (a repeat's notes count each time). */
const asWritten = (r: PassResult): PassResult => ({ ...r, missedAt: r.missedAt.map(written), offAt: r.offAt.map(written) });

const bpm = () => {
  const s = useApp.getState();
  return getParsed(s.text).doc.meta.tempo * s.speed;
};

function showMarks() {
  if (!checker) return;
  const marks: Record<number, Mark> = {};
  // (A repeated note shows how it went the latest time.)
  for (const [i, m] of checker.marks) marks[written(i)] = m;
  useApp.setState({ alongMarks: marks });
}

const loopLength = () => (loop ? loop.end - loop.start : 0);
const playedSomething = (c: AlongChecker) => [...c.marks.values()].some((m) => m !== 'missed');

/**
 * Where the checker is in the song now (null when not playing), noticing the loop coming
 * round from the position jumping back.
 */
function now(): number | null {
  const beat = engine.scoreBeatNow();
  if (beat === null) return null;
  if (loop && beat < lastBeat - Math.min(0.5, loopLength() / 2)) {
    if (startedEarly) startedEarly = false;
    else if (jumpPending) jumpPending = false;
    else {
      endPass(true);
      endedAhead++;
    }
  }
  lastBeat = beat;
  lastAt = startedEarly ? beat - loopLength() : beat;
  return lastAt;
}

/**
 * Starts checking the notes in `range`: the loop's passage when `looping`, else from where
 * playback starts. `withCount`: each pass of the loop has a count before it.
 */
export function startChecking(range: Passage, looping = false, withCount = false, played?: PlaybackScore) {
  stopChecking(false);
  const p = played ?? writtenScore(getParsed(useApp.getState().text).score);
  written = (i) => p.orig[i] ?? i;
  checker = new AlongChecker(expectedNotes(p.score, range));
  loop = looping ? range : null;
  counted = withCount;
  checkedText = useApp.getState().text;
  lastBeat = -Infinity;
  lastAt = null;
  startedEarly = false;
  endedAhead = 0;
  jumpPending = false;
  lastResult = null;
  useApp.setState({ alongMarks: {}, alongPrev: {} });
  unlisten = onLive((e) => {
    if (e.type !== 'press' || !checker) return;
    const at = now();
    if (at === null) return;
    // The microphone hears a note a moment after you play it.
    const s = useApp.getState();
    const delayMs = e.id === MIC_ID ? (s.micLatency ?? DEFAULT_MIC_LATENCY) : 0;
    let beat = at - (delayMs / 1000) * (bpm() / 60);
    const win = windows(bpm());
    // Just before the loop comes round (with no count between passes), a note that isn't one
    // of this pass's but is the loop's first is the next pass's, played a little early.
    if (loop && !counted && !startedEarly && beat > loop.end - win.ok && !checker.match(beat, e.midi, win)) {
      const first = checker.expected[0];
      if (first && first.midis.includes(Math.round(e.midi))) {
        endPass(true);
        endedAhead++;
        startedEarly = true;
        jumpPending = false;
        beat -= loopLength();
      }
    }
    if (checker.attack(beat, e.midi, win)) showMarks();
  });
  // Notes whose moment has passed without being played turn red as the song goes on.
  timer = setInterval(() => {
    const beat = now();
    if (checker && beat !== null && checker.missedBy(beat, windows(bpm())).length) showMarks();
  }, 100);
}

/**
 * Stops listening. Stopped part way (by you, `record`), the stretch played so far is scored
 * too if you played in it; the marks stay on the notes until playback starts again.
 */
export function stopChecking(record = true) {
  const at = now() ?? lastAt;
  if (record && checker && at !== null && playedSomething(checker) && useApp.getState().text === checkedText) {
    const result = asWritten(checker.result(at - windows(bpm()).ok));
    if (result.total) useApp.setState((s) => ({ alongPasses: [...s.alongPasses, result].slice(-200) }));
  }
  unlisten?.();
  unlisten = null;
  if (timer !== null) clearInterval(timer);
  timer = null;
  checker = null;
  loop = null;
}

/**
 * Scores the pass (if it had notes) and starts the next. `wrap`: the loop came round, so
 * this pass's marks fade (until each note comes round again) and the sheet starts afresh.
 */
function endPass(wrap: boolean) {
  if (!checker) return;
  const result = asWritten(checker.result());
  const marks = useApp.getState().alongMarks;
  checker.reset();
  if (result.total === 0) return;
  lastResult = result;
  useApp.setState((s) => ({ alongPasses: [...s.alongPasses, result].slice(-200), ...(wrap ? { alongMarks: {}, alongPrev: marks } : {}) }));
}

/**
 * A pass ended: `loop`, the engine says the loop came round (its result, for the tempo
 * trainer); `end`, the song finished (scored if you played in it).
 */
export function passEnded(reason: 'loop' | 'end' = 'loop'): PassResult | null {
  if (!checker) return null;
  if (reason === 'end') {
    if (playedSomething(checker)) endPass(false);
    else lastResult = null;
    return lastResult;
  }
  now();
  if (endedAhead > 0) endedAhead--;
  else {
    endPass(true);
    jumpPending = true;
  }
  return lastResult;
}

// The microphone turned on while playing along (or play along turned on with it on): the tune
// goes off, so the microphone hears only you.
useApp.subscribe((s, prev) => {
  const micOn = s.mic.status === 'on';
  if (!s.along || !micOn || !s.alongMelody) return;
  if (prev.mic.status !== 'on' || !prev.along) {
    useApp.setState({ alongMelody: false });
    s.notify('The tune is off while the microphone listens, so it hears only you.');
  }
});

// An edit (or another song) ends the session's checking without scoring it: its notes
// (and their marks) belong to the old text.
useApp.subscribe((s, prev) => {
  if (s.text === prev.text) return;
  if (checker) stopChecking(false);
  if (Object.keys(s.alongMarks).length || Object.keys(s.alongPrev).length || s.alongPasses.length) useApp.setState({ alongMarks: {}, alongPrev: {}, alongPasses: [] });
});

setAlongHooks({ startChecking, stopChecking, passEnded });

/** Play along on or off (it and practice mode take turns). */
export function setAlong(on: boolean) {
  if (on) useApp.setState({ along: true, practice: null, alongPasses: [], alongMarks: {}, alongPrev: {} });
  else {
    stopChecking();
    const passes = useApp.getState().alongPasses;
    useApp.setState({ along: false, alongMarks: {}, alongPrev: {} });
    // After at least a scored pass, the report shows how the session went.
    if (passes.length) showReport(alongReport(getParsed(useApp.getState().text).score, passes), true);
  }
}

/** "11 of 12 notes · 1 late", for a pass. */
export function describePass(r: PassResult): string {
  const played = r.hit + r.early + r.late;
  const parts = [`${played} of ${r.total} notes`];
  if (r.early) parts.push(`${r.early} early`);
  if (r.late) parts.push(`${r.late} late`);
  if (r.missed) parts.push(`${r.missed} missed`);
  if (r.strays) parts.push(`${r.strays} wrong`);
  return parts.join(' · ');
}

// ---- Calibrating the microphone ----------------------------------------------------------

const CAL_BPM = 80;
const CAL_LEAD = 4;
const CAL_CLICKS = 8;

/**
 * Measures the microphone's delay: plays a bar of clicks to get ready, then 8 more; you play
 * any note on your harmonica with each of those. Saves and returns the delay in ms (null if
 * too few notes were heard near the clicks).
 */
export async function calibrateMic(): Promise<number | null> {
  stop();
  if (useApp.getState().mic.status !== 'on') await startMic();
  if (useApp.getState().mic.status !== 'on') return null;
  await engine.ensureAudio();
  useApp.setState({ calibrating: true });
  const offsets: number[] = [];
  const off = onLive((e) => {
    // (The clicks are D6 and A6: one of them heard by the microphone isn't you.)
    if (e.type !== 'press' || e.id !== MIC_ID || [86, 93].includes(Math.round(e.midi))) return;
    const beat = engine.transportBeats();
    if (beat >= CAL_LEAD - 0.45 && beat < CAL_LEAD + CAL_CLICKS - 0.45) offsets.push(beat - Math.round(beat));
  });
  const total = CAL_LEAD + CAL_CLICKS;
  engine.playScore(null, { tempo: CAL_BPM, countIn: total, beatsPerBar: 4 });
  // Listening until the clicks are done, or until Play takes over.
  const until = Date.now() + ((total + 1) * 60 * 1000) / CAL_BPM;
  while (Date.now() < until && useApp.getState().calibrating) await new Promise((r) => setTimeout(r, 100));
  off();
  if (!useApp.getState().calibrating) return null;
  useApp.setState({ calibrating: false });
  engine.stopPlayback();
  const ms = latencyFrom(offsets, CAL_BPM);
  if (ms !== null) useApp.setState({ micLatency: Math.max(0, ms) });
  return ms;
}
