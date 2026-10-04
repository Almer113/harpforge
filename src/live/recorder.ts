// Records live playing into tab events.
//
// Timed mode follows the metronome and snaps notes to a grid; free mode just
// keeps the order (each note one beat, simultaneous presses become chords).

import * as engine from '../audio/engine';
import { splitHeader } from '../core/htab/parser';
import { bodyText, wrapEvents } from '../core/htab/serializer';
import { beatsPerBar, type TabEvent } from '../core/htab/types';
import { sameHoleSound, type HoleSound } from '../core/types';
import { clustersToEvents, quantize } from '../core/timeline';
import { getParsed, useApp } from '../state/store';
import { onBeforeStop, stop as stopPlayback } from '../state/playback';

interface Take {
  id: string;
  sound: HoleSound;
  start: number; // beats (timed) or seconds (free)
  end?: number;
}

let takes: Take[] = [];
let countIn = 0;
let phaseTimer: ReturnType<typeof setInterval> | undefined;

function now(mode: 'timed' | 'free'): number {
  return mode === 'timed' ? engine.transportBeats() - countIn : performance.now() / 1000;
}

export async function startRecording(mode: 'timed' | 'free') {
  const s = useApp.getState();
  stopPlayback();
  await engine.ensureAudio();
  takes = [];
  if (mode === 'timed') {
    const p = getParsed(s.text);
    const bpb = beatsPerBar(p.doc.meta);
    countIn = bpb;
    engine.playScore(null, { tempo: p.doc.meta.tempo * s.speed, countIn, metronomeBeatsPerBar: bpb });
    useApp.setState({ recording: { mode, phase: 'count-in' }, play: 'stopped' });
    clearInterval(phaseTimer);
    phaseTimer = setInterval(() => {
      if (engine.transportBeats() >= countIn) {
        clearInterval(phaseTimer);
        const r = useApp.getState().recording;
        if (r) useApp.setState({ recording: { ...r, phase: 'recording' } });
      }
    }, 30);
  } else {
    countIn = 0;
    useApp.setState({ recording: { mode, phase: 'recording' } });
  }
}

export function recordPress(id: string, sound: HoleSound) {
  const r = useApp.getState().recording;
  if (!r) return;
  takes.push({ id, sound: { ...sound }, start: now(r.mode) });
}

/** Keeps the deepest bend reached while a note was held. */
export function recordUpdate(id: string, sound: HoleSound) {
  const t = findOpen(id);
  if (!t) return;
  if (sound.hole === t.sound.hole && sound.breath === t.sound.breath) {
    if (sound.bend > t.sound.bend) t.sound = { ...t.sound, bend: sound.bend };
    if (sound.slide !== t.sound.slide) t.sound = { ...t.sound, slide: sound.slide };
  }
}

export function recordRelease(id: string) {
  const r = useApp.getState().recording;
  const t = findOpen(id);
  if (r && t) t.end = now(r.mode);
}

function findOpen(id: string): Take | undefined {
  for (let i = takes.length - 1; i >= 0; i--) if (takes[i].id === id && takes[i].end === undefined) return takes[i];
  return undefined;
}

function uniqueSounds(sounds: HoleSound[]): HoleSound[] {
  const out: HoleSound[] = [];
  for (const s of sounds) if (!out.some((o) => sameHoleSound(o, s))) out.push(s);
  return out.sort((a, b) => a.hole - b.hole);
}

function buildFree(list: Take[]): TabEvent[] {
  const events: TabEvent[] = [];
  let cluster: Take[] = [];
  const flush = () => {
    if (cluster.length) events.push({ kind: 'note', sounds: uniqueSounds(cluster.map((c) => c.sound)), beats: 1 });
    cluster = [];
  };
  for (const t of list) {
    if (cluster.length && t.start - cluster[0].start > 0.08) flush();
    cluster.push(t);
  }
  flush();
  return events;
}

function buildTimed(list: Take[], grid: number, bpb: number, endBeat: number): TabEvent[] {
  const notes = list.map((t) => ({ start: t.start, end: t.end ?? endBeat, sound: t.sound }));
  const clusters = quantize(notes, grid, (a, b) => a.type === 'hole' && b.type === 'hole' && sameHoleSound(a, b));
  for (const c of clusters) c.sounds = uniqueSounds(c.sounds as HoleSound[]);
  return clustersToEvents(clusters, bpb);
}

/**
 * Ends a recording that something else is taking over from (another tab opened, the
 * harmonica changed, leaving the Play page): what was played is written into the tab it
 * was recorded in, as with Stop.
 */
export function finishRecording() {
  if (useApp.getState().recording) stopRecording();
}
// Stopping playback (which also stops the metronome) ends the recording too.
onBeforeStop(finishRecording);
// Recording is controlled from the Play page; leaving it ends the recording.
useApp.subscribe((s, prev) => {
  if (s.page !== prev.page && prev.page === 'play' && s.recording) stopRecording();
});

export function stopRecording() {
  const s = useApp.getState();
  const r = s.recording;
  if (!r) return;
  clearInterval(phaseTimer);
  const end = now(r.mode);
  for (const t of takes) if (t.end === undefined) t.end = end;
  engine.stopPlayback();
  useApp.setState({ recording: null, play: 'stopped' });

  const list = takes.filter((t) => r.mode === 'free' || t.end! > 0).sort((a, b) => a.start - b.start);
  takes = [];
  if (!list.length) {
    s.notify('Nothing recorded.');
    return;
  }
  const p = getParsed(s.text);
  const events = r.mode === 'free' ? buildFree(list) : buildTimed(list, s.recordGrid, beatsPerBar(p.doc.meta), end);
  const body = bodyText(wrapEvents(events, 4, 8));
  const base = s.recordAppend ? s.text : s.text.slice(0, splitHeader(s.text).bodyStart);
  const sep = base.endsWith('\n') ? '' : '\n';
  s.setText(base + sep + body + '\n');
  s.notify(`Recorded ${list.length} note${list.length === 1 ? '' : 's'} ✓`);
}
