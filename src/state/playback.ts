// Playback controls that tie the audio engine to app state.

import * as engine from '../audio/engine';
import { beatsPerBar } from '../core/htab/types';
import { soundPitch } from '../core/instruments';
import { eventPassage, joinPassages, type Passage } from '../core/passage';
import { findItem, fromDoc, realBeat } from '../core/edit/model';
import { getParsed, useApp } from './store';

function onEvent(index: number, on: boolean) {
  useApp.setState((st) => ({
    activeEvents: on ? [...st.activeEvents.filter((x) => x !== index), index] : st.activeEvents.filter((x) => x !== index),
  }));
}

// Bumped by stop(): a play() still waiting for the audio to start then doesn't go ahead.
let generation = 0;

export async function play() {
  const s = useApp.getState();
  if (s.recording) return;
  const gen = ++generation;
  await engine.ensureAudio();
  if (gen !== generation) return;
  if (s.play === 'paused') {
    engine.resumePlayback();
    useApp.setState({ play: 'playing' });
    return;
  }
  const p = getParsed(s.text);
  if (!p.score.events.length) {
    s.notify('Nothing to play yet — add some tab first.');
    return;
  }
  const sel = s.selectedEvent !== null ? p.score.events[s.selectedEvent] : undefined;
  const range = s.loop && s.loopRange ? s.loopRange : undefined;
  engine.playScore(p.score, {
    tempo: p.doc.meta.tempo * s.speed,
    startBeat: sel?.start ?? 0,
    range,
    loop: s.loop,
    metronomeBeatsPerBar: s.metronome ? beatsPerBar(p.doc.meta) : undefined,
    onEvent,
    onEnd: () => useApp.setState({ play: 'stopped', activeEvents: [] }),
  });
  useApp.setState({ play: 'playing', activeEvents: [] });
}

export function pause() {
  engine.pausePlayback();
  useApp.setState({ play: 'paused', activeEvents: [] });
}

/** Called before playback stops (the recorder finishes a recording, keeping what was played). */
let beforeStop: (() => void) | null = null;
export function onBeforeStop(fn: () => void) {
  beforeStop = fn;
}

export function stop() {
  beforeStop?.();
  generation++;
  engine.stopPlayback();
  useApp.setState({ play: 'stopped', activeEvents: [] });
}

export function togglePlay() {
  const { play: state } = useApp.getState();
  if (state === 'playing') pause();
  else void play();
}

/** Plays a single score event immediately (clicking a card) and selects it. */
/** Plays from event `index` (clicking a card while playing jumps there). */
export function playFrom(index: number) {
  if (useApp.getState().recording) return;
  stop();
  useApp.setState({ selectedEvent: index });
  void play();
}

/**
 * A click on a card in the sheet: while playing, playback jumps there; otherwise the note
 * sounds and becomes where playback starts (a paused song starts over from it).
 */
export function selectEvent(index: number) {
  useApp.setState({ passage: null });
  const st = useApp.getState().play;
  if (st === 'playing') return playFrom(index);
  if (st === 'paused') stop();
  void previewEvent(index);
}

export async function previewEvent(index: number) {
  const s = useApp.getState();
  useApp.setState({ selectedEvent: index });
  if (s.play !== 'stopped') return;
  await engine.ensureAudio();
  const p = getParsed(s.text);
  const ev = p.score.events[index];
  if (!ev || ev.rest) return;
  const secs = Math.min(1.2, (ev.beats * 60) / (p.doc.meta.tempo * s.speed));
  const midis: number[] = [];
  const glides: (number | undefined)[] = [];
  ev.sounds.forEach((snd, k) => {
    const m = ev.midis[k];
    if (m === null) return;
    midis.push(m);
    glides.push(snd.type === 'hole' && snd.bend > 0 && soundPitch(p.harp, { ...snd, bend: 0 }) !== null ? m + snd.bend : undefined);
  });
  engine.previewMidis(midis, secs, glides);
  onEvent(index, true);
  setTimeout(() => onEvent(index, false), secs * 1000);
}

// Highlights switched off while the tab was hidden may have been dropped: clear them.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && useApp.getState().activeEvents.length) useApp.setState({ activeEvents: [] });
  });
}

// Sound that can't start because the engine couldn't be downloaded says so (the next note tries again).
engine.setAudioLoadFailed(() => useApp.getState().notify('The sound couldn’t be loaded. Check your connection; it tries again at the next note.'));

// The sound follows the current harmonica (single reed, tremolo, octave).
engine.setVoicing(getParsed(useApp.getState().text).harp.voicing);

// Recorded samples load in the background; the synth plays until they're ready.
function applySoundMode() {
  const mode = useApp.getState().soundMode;
  engine.setSoundMode(mode);
  if (mode !== 'samples' || engine.samplesReady()) {
    if (engine.samplesReady()) useApp.setState({ samplesStatus: 'ready' });
    return;
  }
  useApp.setState({ samplesStatus: 'loading' });
  void engine.loadSamples().then((ok) => useApp.setState({ samplesStatus: ok ? 'ready' : 'error' }));
}
applySoundMode();

// Live reactions to settings while playing.
useApp.subscribe((s, prev) => {
  if (s.text !== prev.text) engine.setVoicing(getParsed(s.text).harp.voicing);
  if (s.soundMode !== prev.soundMode) applySoundMode();
  if (s.speed !== prev.speed && s.play !== 'stopped') {
    engine.setTempo(getParsed(s.text).doc.meta.tempo * s.speed);
  }
  if (s.metronome !== prev.metronome && s.play !== 'stopped' && !s.recording) {
    engine.setMetronome(s.metronome ? beatsPerBar(getParsed(s.text).doc.meta) : null);
  }
  // Looping switches on and off in place; playback keeps going.
  if (s.loop !== prev.loop && s.play !== 'stopped') engine.setLoop(s.loop);
  if (s.text !== prev.text && s.play !== 'stopped' && !s.recording) stop();
});

// ---- Passages and looping one --------------------------------------------------------

/** Shift+click on a card: the passage runs from the selected note to this one (no sound). */
export function extendPassage(index: number) {
  const s = useApp.getState();
  const { score } = getParsed(s.text);
  const ev = score.events[index];
  if (!ev) return;
  const anchor = s.selectedEvent !== null ? score.events[s.selectedEvent] : undefined;
  if (!anchor) return selectEvent(index);
  useApp.setState({ passage: joinPassages(eventPassage(anchor), eventPassage(ev)) });
}

/** A click on a bar number selects that bar; with Shift, from the selected note to it. */
export function selectBar(bar: Passage, extend: boolean) {
  const s = useApp.getState();
  const { score } = getParsed(s.text);
  const first = score.events.find((ev) => ev.start >= bar.start - 1e-6 && ev.start < bar.end - 1e-6);
  if (!first) return;
  const anchor = s.selectedEvent !== null ? score.events[s.selectedEvent] : undefined;
  if (extend && anchor) {
    useApp.setState({ passage: joinPassages(s.passage ?? eventPassage(anchor), bar) });
    return;
  }
  if (s.play === 'paused') stop();
  useApp.setState({ selectedEvent: first.index, passage: bar });
}

/** The passage the loop button would loop: the editor's selection there, else the Play page's. */
export function currentPassage(): Passage | null {
  const s = useApp.getState();
  if (s.page === 'editor' && s.editorMode !== 'text') {
    const sel = s.ve.selection;
    if (sel.length < 2) return null;
    const song = fromDoc(getParsed(s.text).doc);
    let start = Infinity;
    let end = -Infinity;
    for (const p of sel) {
      const it = findItem(song, p);
      if (!it) continue;
      const at = realBeat(song, p);
      start = Math.min(start, at);
      end = Math.max(end, at + it.dur);
    }
    return end > start ? { start, end } : null;
  }
  return s.passage;
}

/**
 * The loop button (and L): loops the chosen passage, or the whole song with none chosen;
 * pressed again, stops looping. Starting a passage loop while playing jumps to it.
 */
export function toggleLoop() {
  const s = useApp.getState();
  if (s.loop) {
    useApp.setState({ loop: false, loopRange: null });
    return;
  }
  const range = currentPassage();
  useApp.setState({ loop: true, loopRange: range });
  if (range && s.play !== 'stopped') {
    stop();
    void play();
  }
}

/** Ends a passage loop (the loop chip's ✕); if it's playing, this pass is the last. */
export function endPassageLoop() {
  useApp.setState({ loop: false, loopRange: null });
}
