// Practice mode: the app shows the next note and waits until you play it (with the
// keyboard, mouse, a MIDI keyboard or your real harmonica through the microphone).

import { previewMidis, ensureAudio } from '../audio/engine';
import { soundPitch } from '../core/instruments';
import { MIC_ID } from '../live/inputs';
import { onLive } from '../live/livePlayer';
import { stop as stopPlayback } from './playback';
import { getParsed, useApp } from './store';

function nextPlayable(from: number): number | null {
  const { score } = getParsed(useApp.getState().text);
  for (let i = Math.max(0, from); i < score.events.length; i++) {
    const ev = score.events[i];
    if (!ev.rest && !ev.tied && ev.midis.some((m) => m !== null)) return i;
  }
  return null;
}

export function startPractice() {
  const s = useApp.getState();
  missed.clear();
  used.clear();
  stopPlayback();
  const first = nextPlayable(s.selectedEvent ?? 0) ?? nextPlayable(0);
  if (first === null) {
    s.notify('Nothing to practise yet — this tab has no playable notes.');
    return;
  }
  useApp.setState({ practice: { index: first, played: 0, mistakes: 0, startedAt: Date.now(), wrongAt: 0 }, selectedEvent: first });
}

export function stopPractice() {
  useApp.setState({ practice: null });
}

/** Plays the note you're supposed to play next. */
export async function hint() {
  const p = useApp.getState().practice;
  if (!p) return;
  await ensureAudio();
  const ev = getParsed(useApp.getState().text).score.events[p.index];
  const midis = ev?.midis.filter((m): m is number => m !== null) ?? [];
  if (midis.length) previewMidis(midis, 0.7);
  hintUntil = Date.now() + 1200;
}

function finish() {
  const s = useApp.getState();
  const p = s.practice!;
  const secs = Math.round((Date.now() - p.startedAt) / 1000);
  const time = secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`;
  const accuracy = Math.round((p.played / Math.max(1, p.played + p.mistakes)) * 100);
  useApp.setState({ practice: null });
  s.notify(`Finished! ${p.played} notes in ${time} · ${p.mistakes} mistake${p.mistakes === 1 ? '' : 's'} · ${accuracy}% accuracy`);
}

// A note counts when its pitch is reached while the hole is held, so bending into it
// (Shift or dragging the mouse) works: a wrong pitch is only a mistake if the hole is
// let go without reaching the right one. Chords need all their notes held at once.
const missed = new Set<string>(); // held with a wrong pitch so far
const used = new Set<string>(); // already played a note; bends on it don't play another
let hintUntil = 0;

function heldPitches(): Set<number> {
  const st = useApp.getState();
  const harp = getParsed(st.text).harp;
  const out = new Set<number>();
  for (const snd of Object.values(st.held)) {
    const m = soundPitch(harp, snd);
    if (m !== null) out.add(m);
  }
  return out;
}

function advance(id: string) {
  const s = useApp.getState();
  const p = s.practice!;
  used.add(id);
  missed.clear();
  const next = nextPlayable(p.index + 1);
  if (next === null) {
    useApp.setState({ practice: { ...p, played: p.played + 1 } });
    finish();
    return;
  }
  useApp.setState({ practice: { ...p, index: next, played: p.played + 1 }, selectedEvent: next });
}

onLive((e) => {
  const s = useApp.getState();
  const p = s.practice;
  if (!p) return;
  if (e.type === 'release') {
    used.delete(e.id);
    if (missed.delete(e.id)) useApp.setState({ practice: { ...p, mistakes: p.mistakes + 1, wrongAt: Date.now() } });
    return;
  }
  if (e.type === 'change' && used.has(e.id)) return;
  // The microphone also hears the app's own hint.
  if (e.id === MIC_ID && Date.now() < hintUntil) return;
  const ev = getParsed(s.text).score.events[p.index];
  if (!ev) return;
  const targets = [...new Set(ev.midis.filter((m): m is number => m !== null))];
  // A real harp through the microphone is heard one note at a time: any chord note counts.
  if (targets.length > 1 && e.id !== MIC_ID) {
    const held = heldPitches();
    if (targets.every((m) => held.has(m))) advance(e.id);
    else if (targets.includes(e.midi)) missed.delete(e.id);
    else missed.add(e.id);
    return;
  }
  if (targets.includes(e.midi)) {
    missed.delete(e.id);
    advance(e.id);
  } else missed.add(e.id);
});

/** Total notes to play in practice (ties and rests aren't played). */
export function practiceTotal(): number {
  const { score } = getParsed(useApp.getState().text);
  return score.events.filter((ev) => !ev.rest && !ev.tied && ev.midis.some((m) => m !== null)).length;
}

// Editing the tab ends practice.
useApp.subscribe((s, prev) => {
  if (s.practice && s.text !== prev.text) useApp.setState({ practice: null });
});
