// Playback controls that tie the audio engine to app state.

import * as engine from '../audio/engine';
import { beatsPerBar } from '../core/htab/types';
import { soundPitch } from '../core/instruments';
import { getParsed, useApp } from './store';

function onEvent(index: number, on: boolean) {
  useApp.setState((st) => ({
    activeEvents: on ? [...st.activeEvents.filter((x) => x !== index), index] : st.activeEvents.filter((x) => x !== index),
  }));
}

export async function play() {
  const s = useApp.getState();
  if (s.recording) return;
  await engine.ensureAudio();
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
  engine.playScore(p.score, {
    tempo: p.doc.meta.tempo * s.speed,
    startBeat: sel?.start ?? 0,
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

export function stop() {
  engine.stopPlayback();
  useApp.setState({ play: 'stopped', activeEvents: [] });
}

export function togglePlay() {
  const { play: state } = useApp.getState();
  if (state === 'playing') pause();
  else void play();
}

/** Plays a single score event immediately (clicking a card) and selects it. */
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

// Live reactions to settings while playing.
useApp.subscribe((s, prev) => {
  if (s.speed !== prev.speed && s.play !== 'stopped') {
    engine.setTempo(getParsed(s.text).doc.meta.tempo * s.speed);
  }
  if (s.metronome !== prev.metronome && s.play !== 'stopped' && !s.recording) {
    engine.setMetronome(s.metronome ? beatsPerBar(getParsed(s.text).doc.meta) : null);
  }
  if (s.loop !== prev.loop && s.play === 'playing') {
    stop();
    void play();
  }
  if (s.text !== prev.text && s.play !== 'stopped' && !s.recording) stop();
});
