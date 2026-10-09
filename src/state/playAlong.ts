// Play along, checked: while the song plays, the notes you play (computer keys, mouse,
// MIDI or your harmonica through the microphone) are matched to the song's notes, which
// light up green (in time), amber (early or late) or red (missed). Each pass of a loop is
// scored (see alongPasses); the tempo trainer can wait for a clean one.

import * as engine from '../audio/engine';
import { AlongChecker, expectedNotes, latencyFrom, windows, type Mark, type PassResult } from '../core/playAlong';
import type { Passage } from '../core/passage';
import { startMic } from '../live/inputs';
import { onLive } from '../live/livePlayer';
import { setAlongHooks, stop } from './playback';
import { getParsed, useApp } from './store';

/** The microphone's delay when it hasn't been calibrated (a typical laptop). */
export const DEFAULT_MIC_LATENCY = 120;
const MIC_ID = 'mic';

let checker: AlongChecker | null = null;
let unlisten: (() => void) | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

const bpm = () => {
  const s = useApp.getState();
  return getParsed(s.text).doc.meta.tempo * s.speed;
};

function showMarks() {
  if (!checker) return;
  const marks: Record<number, Mark> = {};
  for (const [i, m] of checker.marks) marks[i] = m;
  useApp.setState({ alongMarks: marks });
}

/** Starts checking the notes in `range` (the loop's passage, or from where playback starts). */
export function startChecking(range: Passage) {
  stopChecking();
  checker = new AlongChecker(expectedNotes(getParsed(useApp.getState().text).score, range));
  useApp.setState({ alongMarks: {} });
  unlisten = onLive((e) => {
    if (e.type !== 'press' || !checker) return;
    const now = engine.scoreBeatNow();
    if (now === null) return;
    // The microphone hears a note a moment after you play it.
    const s = useApp.getState();
    const delayMs = e.id === MIC_ID ? (s.micLatency ?? DEFAULT_MIC_LATENCY) : 0;
    const beat = now - (delayMs / 1000) * (bpm() / 60);
    if (checker.attack(beat, e.midi, windows(bpm()))) showMarks();
  });
  // Notes whose moment has passed without being played turn red as the song goes on.
  timer = setInterval(() => {
    const beat = engine.scoreBeatNow();
    if (checker && beat !== null && checker.missedBy(beat, windows(bpm())).length) showMarks();
  }, 100);
}

/**
 * Stops listening. Stopped part way (by you), the stretch played so far is scored too; the
 * marks stay on the notes until playback starts again.
 */
export function stopChecking() {
  const beat = engine.scoreBeatNow();
  if (checker && beat !== null && checker.marks.size) {
    const result = checker.result(beat - windows(bpm()).ok);
    if (result.total) useApp.setState((s) => ({ alongPasses: [...s.alongPasses, result].slice(-200) }));
  }
  unlisten?.();
  unlisten = null;
  if (timer !== null) clearInterval(timer);
  timer = null;
  checker = null;
}

/** A pass ended (a loop came round, or the song finished): scores it and starts the next. */
export function passEnded(): PassResult | null {
  if (!checker) return null;
  const result = checker.result();
  checker.reset();
  useApp.setState((s) => ({ alongPasses: [...s.alongPasses, result].slice(-200), alongMarks: {} }));
  return result;
}

setAlongHooks({ startChecking, stopChecking, passEnded });

/** Play along on or off (it and practice mode take turns). */
export function setAlong(on: boolean) {
  if (on) useApp.setState({ along: true, practice: null, alongPasses: [], alongMarks: {} });
  else {
    stopChecking();
    useApp.setState({ along: false, alongMarks: {} });
  }
}

/** "11 of 12 · 1 late", for a pass. */
export function describePass(r: PassResult): string {
  const played = r.hit + r.early + r.late;
  const parts = [`${played} of ${r.total}`];
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
  const offsets: number[] = [];
  const off = onLive((e) => {
    // (The clicks are D6 and A6: one of them heard by the microphone isn't you.)
    if (e.type !== 'press' || e.id !== MIC_ID || [86, 93].includes(Math.round(e.midi))) return;
    const beat = engine.transportBeats();
    if (beat >= CAL_LEAD - 0.45 && beat < CAL_LEAD + CAL_CLICKS - 0.45) offsets.push(beat - Math.round(beat));
  });
  const total = CAL_LEAD + CAL_CLICKS;
  engine.playScore(null, { tempo: CAL_BPM, countIn: total, beatsPerBar: 4 });
  await new Promise((r) => setTimeout(r, ((total + 1) * 60 * 1000) / CAL_BPM));
  off();
  engine.stopPlayback();
  const ms = latencyFrom(offsets, CAL_BPM);
  if (ms !== null) useApp.setState({ micLatency: Math.max(0, ms) });
  return ms;
}
