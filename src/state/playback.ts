// Playback controls that tie the audio engine to app state.

import * as engine from '../audio/engine';
import { beatsPerBar } from '../core/htab/types';
import { soundPitch } from '../core/instruments';
import { barAt, barPassage, barStarts, describePassage, eventPassage, joinPassages, type Passage } from '../core/passage';
import { findItem, fromDoc, realBeat } from '../core/edit/model';
import type { PassResult } from '../core/playAlong';
import { playbackIndexOf, playbackScore, writtenScore, type PlaybackScore } from '../core/repeats';
import { getParsed, useApp, type AppState } from './store';

/**
 * Play along (playAlong.ts) checks the notes while the song plays. It plugs itself in here,
 * so playback doesn't load the live inputs it listens to.
 */
interface AlongHooks {
  /** `range` is in the beats of `played`, the score as it's played (with its repeats). */
  startChecking(range: Passage, looping: boolean, counted: boolean, played: PlaybackScore): void;
  stopChecking(record?: boolean): void;
  passEnded(reason?: 'loop' | 'end'): PassResult | null;
}
let along: AlongHooks | null = null;
export function setAlongHooks(hooks: AlongHooks) {
  along = hooks;
}

/**
 * A written note starts or stops sounding (`pass`: 2 when it's the repeat; `verse`: the
 * verse sung, 0-based).
 */
function onEvent(index: number, on: boolean, pass?: number, verse?: number) {
  useApp.setState((st) => ({
    activeEvents: on ? [...st.activeEvents.filter((x) => x !== index), index] : st.activeEvents.filter((x) => x !== index),
    ...(on && pass !== undefined && pass !== st.playPass ? { playPass: pass } : {}),
    ...(on && verse !== undefined && verse !== st.playVerse ? { playVerse: verse } : {}),
  }));
}

// The score being played: the written one with its repeats and verses played (see
// repeats.ts), and the last of its notes to start.
let playing: PlaybackScore | null = null;
let playingAt = -1;
// What the sound was started with: changed since (even while paused), it starts again.
let startedWith: { muted: boolean; played: PlaybackScore | null } = { muted: false, played: null };

/**
 * Where the visual editor plays from, as you see it there: several notes selected, just
 * them (`range`); one, from it; else from the caret (rests included) — from the start when
 * the caret is past the last note. Null off the visual editor (the Play page goes by the note
 * clicked, `selectedEvent`).
 */
export function editorStart(s: AppState): { beat: number; range?: Passage } | null {
  if (s.page !== 'editor' || s.editorMode !== 'visual') return null;
  const { doc, score } = getParsed(s.text);
  const song = fromDoc(doc);
  const sel = s.ve.selection.filter((p) => findItem(song, p));
  if (sel.length > 1) {
    let start = Infinity;
    let end = -Infinity;
    for (const p of sel) {
      const at = realBeat(song, p);
      start = Math.min(start, at);
      end = Math.max(end, at + findItem(song, p)!.dur);
    }
    return { beat: start, range: { start, end } };
  }
  if (sel.length === 1) return { beat: realBeat(song, sel[0]) };
  const beat = s.ve.caret.m >= song.measures.length ? score.totalBeats : realBeat(song, s.ve.caret);
  return { beat: beat >= score.totalBeats - 1e-6 ? 0 : Math.max(0, beat) };
}

/** The stretch playback keeps to: the looped passage, or (the editor) the notes selected. */
function playRange(s: AppState): Passage | undefined {
  const total = getParsed(s.text).score.totalBeats;
  const loop = s.loop && s.loopRange && usablePassage(s.loopRange, total);
  if (loop) return loop;
  const ed = editorStart(s)?.range;
  return (ed && usablePassage(ed, total)) || undefined;
}

/** The score as it would be played now: repeats and verses, unless a stretch is kept to. */
function playedScore(s: AppState): PlaybackScore {
  const p = getParsed(s.text);
  return playRange(s) ? writtenScore(p.score) : playbackScore(p.doc, p.score, { repeats: s.playRepeats, allVerses: s.playAllVerses });
}

/** What playback starts from now (when it changes while paused, the next Play starts fresh from it). */
function startKey(s: AppState): string {
  return s.page === 'editor' && s.editorMode === 'visual' ? JSON.stringify([s.ve.selection, s.ve.caret]) : String(s.selectedEvent);
}
let startedKey = '';

/** Whether playback would start from the very start (nothing chosen, caret at the beginning). */
export function atStart(s: AppState): boolean {
  if (s.page === 'editor' && s.editorMode === 'visual') return !s.ve.selection.length && s.ve.caret.m === 0 && s.ve.caret.start < 1e-6;
  return s.selectedEvent === null;
}

/** Back to the start: stopped, nothing chosen (the editor's caret at the beginning). */
export function backToStart() {
  const s = useApp.getState();
  if (s.play !== 'stopped') stop();
  useApp.setState({ selectedEvent: null });
  if (s.page === 'editor') s.setVe({ selection: [], caret: { m: 0, start: 0 }, measure: 0, lyricAt: undefined, restDraft: undefined });
}

/** Where playback starts, said ("from the start", "from bar 3, beat 2", "bars 5–6"). */
export function startLabel(s: AppState): string {
  const { score } = getParsed(s.text);
  const describe = (beat: number) => {
    if (beat < 1e-6) return 'from the start';
    const starts = barStarts(score);
    const bar = barAt(score, beat, starts);
    const inBar = +(beat - starts[bar] + 1).toFixed(2);
    return `from bar ${bar + 1}${inBar > 1 + 1e-6 ? `, beat ${inBar}` : ''}`;
  };
  if (s.loop && s.loopRange) return `the loop, ${describePassage(score, s.loopRange)}`;
  const ed = editorStart(s);
  if (ed?.range) return `the selection, ${describePassage(score, ed.range)}`;
  if (ed) return describe(ed.beat);
  const ev = s.selectedEvent !== null ? score.events[s.selectedEvent] : undefined;
  return describe(ev?.start ?? 0);
}

/** Whether the tune would be left out, and what would be played, if playback started now. */
function wanted(s: AppState): typeof startedWith {
  return { muted: tuneMuted(s), played: playedScore(s) };
}
const sameStart = (a: typeof startedWith, b: typeof startedWith) => a.muted === b.muted && a.played === b.played;

/**
 * Starts playback again from where it is: the same note, the same time through a repeat.
 * `record`: a play-along pass so far is scored (play along switched); else it's let go.
 */
function restartHere(record: boolean) {
  const s = useApp.getState();
  const beat = engine.scoreBeatNow();
  const pb = playing ?? writtenScore(getParsed(s.text).score);
  const at = beat === null ? undefined : [...pb.score.events].reverse().find((ev) => ev.start <= beat + 1e-6);
  stop({ record });
  const from = at ? pb.orig[at.index] : undefined;
  if (from !== undefined && editorStart(s) === null) useApp.setState({ selectedEvent: from });
  void play({ count: false, from, pass: at ? pb.pass[at.index] : undefined, round: at ? pb.round[at.index] : undefined });
}

// Bumped by stop(): a play() still waiting for the audio to start then doesn't go ahead.
let generation = 0;

/**
 * How many beats to count in: a bar, or two when a bar goes by in under 1.6 seconds
 * (fast tempos), so there's time to get ready.
 */
export function countBeats(bpb: number, bpm: number): number {
  return (bpb * 60) / bpm < 1.6 ? bpb * 2 : bpb;
}

/**
 * Starts (or resumes) playback. `count: false` skips the count-in (jumping to a note mid-play),
 * `count: true` counts in whatever the setting (a drill).
 */
export async function play(opts: { count?: boolean; from?: number; pass?: number; round?: number } = {}) {
  const s = useApp.getState();
  if (s.recording) return;
  // Playing ends a microphone calibration that's still listening.
  if (s.calibrating) useApp.setState({ calibrating: false });
  const gen = ++generation;
  await engine.ensureAudio();
  if (gen !== generation) return;
  if (s.play === 'paused') {
    // (Silent or repeats changed while paused: from the same note, the new way.)
    if (!sameStart(wanted(s), startedWith)) {
      restartHere(false);
      return;
    }
    // (A new place chosen while paused: from there, not on from the old one.)
    if (startKey(s) !== startedKey) {
      stop();
      void play(opts);
      return;
    }
    engine.resumePlayback();
    useApp.setState({ play: 'playing' });
    return;
  }
  const p = getParsed(s.text);
  if (!p.score.events.length) {
    s.notify('Nothing to play yet — add some tab first.');
    return;
  }
  const range = playRange(s);
  // Repeats (and all verses) play when the song plays through (a looped passage is its own
  // repeat). It starts from `from` (restarting), else (the editor) from the caret or the notes
  // selected, else (the Play page) the note clicked: its `pass`-th time in round `round`.
  const pb = playedScore(s);
  const ed = opts.from === undefined ? editorStart(s) : null;
  // (The editor's start is a beat: the written note there, and how far into it.)
  const written = ed && !ed.range ? [...p.score.events].reverse().find((ev) => ev.start <= ed.beat + 1e-6) : undefined;
  const fromIndex = opts.from ?? (ed ? written?.index : (s.selectedEvent ?? undefined));
  const selAt = fromIndex !== undefined ? playbackIndexOf(pb, fromIndex, opts.pass, opts.round) : undefined;
  const sel = selAt !== undefined ? pb.score.events[selAt] : undefined;
  const startBeat = sel ? sel.start + (written && ed ? Math.max(0, ed.beat - written.start) : 0) : 0;
  const bpb = beatsPerBar(p.doc.meta);
  const tempo = p.doc.meta.tempo * s.speed;
  // A loop that counts in before each pass counts in before the first one too (also when
  // jumping to a note in it: the count belongs to every pass).
  const eachLoop = s.loop && s.countEachLoop;
  const counting = opts.count === true || eachLoop || (s.countIn && opts.count !== false);
  // Playing along without the tune: the clicks keep time instead.
  const alongMuted = s.along && !s.alongMelody;
  const muted = tuneMuted(s);
  if (s.along) along?.startChecking(range ?? { start: startBeat, end: pb.score.totalBeats }, s.loop, eachLoop, pb);
  playing = pb;
  playingAt = selAt ?? 0;
  startedWith = { muted, played: pb };
  startedKey = startKey(s);
  engine.playScore(pb.score, {
    tempo,
    startBeat,
    range,
    loop: s.loop,
    countIn: counting ? countBeats(bpb, tempo) : 0,
    countEachLoop: eachLoop,
    barStarts: barStarts(pb.score),
    beatsPerBar: bpb,
    onLoop: loopPassed,
    muted,
    metronomeBeatsPerBar: s.metronome || alongMuted ? bpb : undefined,
    onEvent: (i, on) => {
      if (on) playingAt = i;
      onEvent(pb.orig[i] ?? i, on, pb.pass[i], pb.verse[i]);
    },
    onEnd: () => {
      if (useApp.getState().along) along?.passEnded('end');
      along?.stopChecking(false);
      useApp.setState({ play: 'stopped', activeEvents: [], playPass: 1, playVerse: 0 });
    },
  });
  useApp.setState({ play: 'playing', activeEvents: [], playPass: sel ? pb.pass[sel.index] : 1, playVerse: sel ? pb.verse[sel.index] : 0, playVerses: pb.verse.some((v) => v > 0) });
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

/** Stops playback. `record: false`: a play-along pass under way isn't scored (a restart). */
export function stop({ record = true }: { record?: boolean } = {}) {
  beforeStop?.();
  along?.stopChecking(record);
  generation++;
  engine.stopPlayback();
  useApp.setState({ play: 'stopped', activeEvents: [], playPass: 1, playVerse: 0 });
}

export function togglePlay() {
  const { play: state } = useApp.getState();
  if (state === 'playing') pause();
  else void play();
}

/** Plays a single score event immediately (clicking a card) and selects it. */
/** Plays from event `index` (clicking a card while playing jumps there). */
export function playFrom(index: number) {
  const s = useApp.getState();
  if (s.recording) return;
  // (Mid-song, in a repeat's second time or a later verse: that time, not back to the first.)
  const now = s.play !== 'stopped' && playing ? { pass: playing.pass[playingAt], round: playing.round[playingAt] } : {};
  stop();
  useApp.setState({ selectedEvent: index });
  void play({ count: false, from: index, ...now });
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
  // (Playing along without the tune, the clicks are the only timekeeping: they stay.)
  const muted = s.along && !s.alongMelody;
  if (s.metronome !== prev.metronome && s.play !== 'stopped' && !s.recording && !muted) {
    engine.setMetronome(s.metronome ? beatsPerBar(getParsed(s.text).doc.meta) : null);
  }
  // Looping switches on and off in place; playback keeps going.
  if (s.loop !== prev.loop && s.play !== 'stopped') engine.setLoop(s.loop);
  if (s.text !== prev.text) {
    if (s.play !== 'stopped' && !s.recording) stop();
    // An edit can leave the chosen passage (or the looped one) past the end of the song.
    const total = getParsed(s.text).score.totalBeats;
    const passage = s.passage && usablePassage(s.passage, total);
    const loopRange = s.loopRange && usablePassage(s.loopRange, total);
    if (passage !== s.passage || loopRange !== s.loopRange) {
      useApp.setState({ passage: passage ?? null, loopRange: loopRange ?? null, ...(s.loopRange && !loopRange ? { loop: false, training: null } : {}) });
    }
  }
  // Play along (or its tune) switched while playing, or the tune went silent or came back
  // (performance mode): playback starts again from where it was, so the checking and the sound match.
  // Repeats switched on or off: the same, from the same note — when it changes what's played.
  if (s.play === 'playing') {
    if (s.along !== prev.along || (s.along && s.alongMelody !== prev.alongMelody)) restartHere(true);
    else if ((tuneMuted(s) !== tuneMuted(prev) || s.playRepeats !== prev.playRepeats || s.playAllVerses !== prev.playAllVerses) && !sameStart(wanted(s), startedWith)) restartHere(false);
  }
});

/** Whether playback leaves the tune out: playing along without it, or performing silently. */
export function tuneMuted(s: Pick<AppState, 'along' | 'alongMelody' | 'performing' | 'performSilent'>): boolean {
  return (s.along && !s.alongMelody) || (s.performing && s.performSilent);
}

/** A passage cut to the song's length (the same object when it fits), or null if none of it is left. */
export function usablePassage(p: Passage, total: number): Passage | null {
  if (p.end <= total + 1e-6) return p.start < p.end - 1e-6 ? p : null;
  const end = total;
  return end > p.start + 1e-6 ? { start: p.start, end } : null;
}

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
    useApp.setState({ passage: joinPassages(eventPassage(anchor), bar) });
    return;
  }
  if (s.play === 'paused') stop();
  useApp.setState({ selectedEvent: first.index, passage: bar });
}

/** The passage the loop button would loop: the editor's selection there, else the Play page's. */
export function currentPassage(): Passage | null {
  const s = useApp.getState();
  // (The Split view's preview is a sheet like the Play page's: its passage counts there.)
  if (s.page === 'editor' && s.editorMode === 'visual') {
    const sel = s.ve.selection;
    if (!sel.length) return null;
    const song = fromDoc(getParsed(s.text).doc);
    // One note: its bar (a single note is where playback starts, not a passage).
    if (sel.length === 1) {
      const { score } = getParsed(s.text);
      return barPassage(score, barAt(score, realBeat(song, sel[0])));
    }
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
    endTraining();
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
  endTraining();
  useApp.setState({ loop: false, loopRange: null });
}

/** The loop ending takes the trainer with it: says so (the speed stays where it got to). */
function endTraining() {
  const s = useApp.getState();
  if (!s.training) return;
  useApp.setState({ training: null });
  if (s.speed !== 1) s.notify(`Tempo trainer stopped at ${Math.round(s.speed * 100)}% speed`);
}

// ---- Tempo trainer ---------------------------------------------------------------------

const roundSpeed = (x: number) => Math.round(x * 100) / 100;

/**
 * Starts the tempo trainer: the loop (the chosen passage, or the whole song) plays from the
 * trainer's start speed, a step faster after every `every` passes, up to its goal.
 */
export function startTrainer(opts: { count?: boolean } = {}) {
  const s = useApp.getState();
  if (s.recording) return;
  const range = s.loop ? s.loopRange : currentPassage();
  stop();
  // (Never above the goal: it would only ever slow down.)
  useApp.setState({ speed: Math.min(s.trainer.start, s.trainer.goal), loop: true, loopRange: range, training: { pass: 0, holding: false } });
  void play(opts);
}

export function stopTrainer() {
  useApp.setState({ training: null });
}

/** Keeps the speed where it is (or lets it climb again). */
export function holdTrainer(holding: boolean) {
  const t = useApp.getState().training;
  if (t) useApp.setState({ training: { ...t, holding } });
}

/** A pass of the loop ended: count it, and speed up when it's time. */
export function loopPassed() {
  const result = useApp.getState().along ? (along?.passEnded('loop') ?? null) : null;
  const s = useApp.getState();
  const t = s.training;
  if (!t) return;
  const pass = t.pass + 1;
  const { step, every, goal } = s.trainer;
  // Playing along, the trainer can wait for a pass played cleanly.
  const clean = !s.along || !s.trainerCleanOnly || !!result?.clean;
  const due = clean && !t.holding && pass % every === 0 && s.speed < goal - 1e-9;
  useApp.setState({ training: { ...t, pass }, ...(due ? { speed: roundSpeed(Math.min(goal, s.speed + step)) } : {}) });
}

/** "Pass 3 · 70%", or "At 100% ✓" once at the goal. */
export function trainerLabel(training: { pass: number }, speed: number, goal: number): string {
  const pct = `${Math.round(speed * 100)}%`;
  return speed >= goal - 1e-9 ? `Trainer at ${pct} ✓` : `Trainer · pass ${training.pass + 1} · ${pct}`;
}
