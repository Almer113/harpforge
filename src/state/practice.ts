// Practice mode: the app shows the next note and waits until you play it (with the
// keyboard, mouse, a MIDI keyboard or your real harmonica through the microphone).

import { previewMidis, ensureAudio } from '../audio/engine';
import { onPlayed } from '../live/livePlayer';
import { stop as stopPlayback } from './playback';
import { getParsed, useApp } from './store';

function nextPlayable(from: number): number | null {
  const { score } = getParsed(useApp.getState().text);
  for (let i = Math.max(0, from); i < score.events.length; i++) {
    const ev = score.events[i];
    if (!ev.rest && ev.midis.some((m) => m !== null)) return i;
  }
  return null;
}

export function startPractice() {
  const s = useApp.getState();
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

onPlayed((midi) => {
  const s = useApp.getState();
  const p = s.practice;
  if (!p) return;
  const ev = getParsed(s.text).score.events[p.index];
  if (!ev) return;
  if (ev.midis.includes(midi)) {
    const next = nextPlayable(p.index + 1);
    if (next === null) {
      useApp.setState({ practice: { ...p, played: p.played + 1 } });
      finish();
      return;
    }
    useApp.setState({ practice: { ...p, index: next, played: p.played + 1 }, selectedEvent: next });
  } else {
    useApp.setState({ practice: { ...p, mistakes: p.mistakes + 1, wrongAt: Date.now() } });
  }
});

// Editing the tab ends practice.
useApp.subscribe((s, prev) => {
  if (s.practice && s.text !== prev.text) useApp.setState({ practice: null });
});
