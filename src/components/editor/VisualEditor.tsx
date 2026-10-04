// Visual (drag-and-drop) tab editor.
//
// Measures are lanes sized by the time signature, with gridlines at the snap
// resolution. Notes are cards placed by start time and sized by duration: drag to
// move (Alt = copy), drag the right edge to change length, click an empty slot to
// put the caret there. Edits go through the measure model and back into the .htab
// text, so the text view, playback and undo all stay in sync.

import { useEffect, useMemo, useRef, useState } from 'react';
import * as engine from '../../audio/engine';
import {
  advance,
  allPositions,
  absBeat,
  chainAt,
  chainLength,
  EPS,
  fromDoc,
  insertMeasure,
  measureLength,
  measureSpan,
  moveItem,
  moveItems,
  positionsBetween,
  placeItem,
  previousItem,
  removeChains,
  samePos,
  changeLengths,
  deleteNotes,
  makeRoom,
  realBeat,
  ripple,
  setTie,
  snapTo,
  fineGrid,
  gridFor,
  gridForNote,
  updateItem,
  type Item,
  type Pos,
  type Song,
} from '../../core/edit/model';
import { soundPitch } from '../../core/instruments';
import { midiToName } from '../../core/pitch';
import { flatsFor } from '../../core/edit/splice';
import type { Sound } from '../../core/types';
import { onPitchPlayed, onPlayed } from '../../live/livePlayer';
import { chooseSound, neighbours, offHarp, stepNotes, stepScale } from '../../core/edit/notes';
import { MIC_ID } from '../../live/inputs';
import { useHarmonicaKeyboard } from '../../live/useHarmonicaKeyboard';
import { commitSong, DURATIONS, describeDuration, durationLabel, retabSelection, stepPitch } from '../../state/editor';
import { Popover } from '../Popover';
import { InsertIcon, OverwriteIcon } from '../icons';
import { MicControl, MidiControl } from '../InputBar';
import { getParsed, useApp, useParsed, type VisualState } from '../../state/store';
import { Harmonica } from '../Harmonica';
import { Glyph, NoteGlyph } from '../TabView';
import { ReadAsSwitch } from '../Sheet';
import { holeSoundText } from '../../core/htab/serializer';
import { Inspector } from './Inspector';
import { isTyping, keysTaken, overlayOpen } from '../../live/focus';
import { copyText, pasteText } from '../../core/edit/clipboard';
import { openShortcuts } from '../Shortcuts';

// ---- Helpers shared with the inspector ------------------------------------------------

export function toolDuration(ve: VisualState): number {
  return ve.dur * (ve.dotted ? 1.5 : 1) * (ve.triplet ? 2 / 3 : 1);
}

/** The grid for a click in an empty slot: the snap setting, or (auto) the length about to be written. */
function clickGrid(ve: VisualState): number {
  return ve.snap || gridFor(toolDuration(ve));
}

// Zoom: pixels per beat.
export const ZOOM_DEFAULT = 64;
const ZOOM_MIN = 32;
const ZOOM_MAX = 160;
const ZOOM_STEPS = [32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const clampZoom = (z: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
function stepZoom(dir: 1 | -1) {
  const z = useApp.getState().ve.zoom;
  const next = dir > 0 ? (ZOOM_STEPS.find((s) => s > z) ?? ZOOM_MAX) : ([...ZOOM_STEPS].reverse().find((s) => s < z) ?? ZOOM_MIN);
  useApp.getState().setVe({ zoom: next });
}

/**
 * How much of a note card fits its width (cards are exactly as long as their notes): full,
 * if its glyph fits at full size; the glyph a size smaller; just a small hole number; or only
 * the blow/draw colour. `ems` is the glyph's width in em (from glyphEms).
 */
function detailLevel(width: number, ems: number, stack: boolean): '' | 'lod-mid' | 'lod-small' | 'lod-bar' {
  const inner = width - 6; // padding and border
  if (inner >= ems * (stack ? 13 : 18)) return '';
  if (inner >= ems * (stack ? 11 : 14)) return 'lod-mid';
  return width >= 12 ? 'lod-small' : 'lod-bar';
}

/** The widest glyph on a card, in em of its monospace font ("−10ʼ" ≈ 2.6, "C♯5" ≈ 1.9). */
function glyphEms(sounds: Sound[], midis: (number | null)[], asNotes: boolean, flats: boolean): number {
  const CH = 0.6; // a monospace character is 0.6 em wide
  let most = CH;
  sounds.forEach((s, k) => {
    let w: number;
    if (s.type !== 'hole') w = midiToName((s as { midi: number }).midi, flats).length * CH * (16 / 18);
    else if (asNotes) {
      const name = midis[k] === null ? '?' : midiToName(midis[k]!, flats);
      w = (name.length - 1) * CH + 0.7 * CH; // the octave is smaller
    } else w = (String(s.hole).length + (s.breath === 'draw' ? 0.8 : 0) + (s.slide ? 1 : 0) + (s.over ? 1 : 0) + s.bend * 0.5) * CH;
    most = Math.max(most, w);
  });
  return most;
}

/** A lyric's width in the card's lyric font (measured once per text). */
const lyricWidths = new Map<string, number>();
let lyricCtx: CanvasRenderingContext2D | null | undefined;
function lyricWidth(text: string): number {
  const hit = lyricWidths.get(text);
  if (hit !== undefined) return hit;
  if (lyricCtx === undefined) {
    lyricCtx = document.createElement('canvas').getContext('2d');
    if (lyricCtx) lyricCtx.font = 'italic 11px Inter, system-ui, -apple-system, "Segoe UI", sans-serif';
  }
  const w = lyricCtx ? lyricCtx.measureText(text).width : text.length * 5.5;
  lyricWidths.set(text, w);
  return w;
}

/**
 * A lyric that doesn't fit its room: cut with "…" (by the CSS), or just "…" when not even two
 * letters would show. Either way the whole lyric is in the hover text.
 */
function fitLyric(text: string, room: number): { shown: string; cut: boolean } {
  if (lyricWidth(text) <= room) return { shown: text, cut: false };
  return { shown: lyricWidth(text.slice(0, 2) + '…') > room ? '…' : text, cut: true };
}

/** Absolute start beat of each measure as played (short bars and overfull bars take their real length). */
export function measureStarts(song: Song): number[] {
  const out: number[] = [];
  let t = 0;
  for (const m of song.measures) {
    out.push(t);
    t += measureSpan(song, m);
  }
  return out;
}

/** Applies an edit and moves the selection/caret. */
export function apply(song: Song, patch: Partial<VisualState> = {}) {
  commitSong(song);
  useApp.getState().setVe(patch);
}


const getHarp = () => getParsed(useApp.getState().text).harp;

export function playSounds(sounds: Sound[], beats = 0.6) {
  const harp = getHarp();
  const midis = sounds.map((s) => (s.type === 'pitch' ? s.midi : soundPitch(harp, s))).filter((m): m is number => m !== null);
  void engine.ensureAudio().then(() => engine.previewMidis(midis, Math.min(1, beats)));
}

// ---- Component -------------------------------------------------------------------------------

export function VisualEditor() {
  const parsed = useParsed();
  const ve = useApp((s) => s.ve);
  const setVe = useApp((s) => s.setVe);
  const activeEvents = useApp((s) => s.activeEvents);
  const asNotes = useApp((s) => s.readAs === 'notes');
  // The small line under each note: note names in Holes mode, holes in Notes mode.
  const showSecond = useApp((s) => (asNotes ? s.sheetShow.tab.holes : s.showNoteNames));
  const song = useMemo(() => fromDoc(parsed.doc), [parsed]);
  const starts = useMemo(() => measureStarts(song), [song]);
  const text = useApp((s) => s.text);
  const flats = flatsFor(text, parsed.doc.meta.key ?? parsed.harp.spec.key);
  const hasBars = parsed.doc.lines.some((l) => l.events.some((e) => e.kind === 'bar'));

  useHarmonicaKeyboard(true, { arrows: false });

  // Playback highlight: score events → absolute start times.
  const playingAt = useMemo(() => new Set(activeEvents.map((i) => +(parsed.score.events[i]?.start ?? -1).toFixed(4))), [activeEvents, parsed]);

  // Keep "play from here" in sync with the selected note.
  useEffect(() => {
    const first = ve.selection[0];
    if (!first) return;
    const abs = starts[first.m] + first.start;
    const idx = parsed.score.events.findIndex((e) => Math.abs(e.start - abs) < 1e-4 && !e.rest);
    if (idx >= 0 && useApp.getState().selectedEvent !== idx) useApp.setState({ selectedEvent: idx });
  }, [ve.selection, starts, parsed]);

  // ---- Step entry & replacing notes from the harmonica ----
  const lastInsert = useRef<{ at: number; pos: Pos } | null>(null);
  useEffect(() => {
    const enter = (midi: number, id: string, played: Sound) => {
      const st = useApp.getState();
      if (st.page !== 'editor' || st.editorMode !== 'visual') return;
      const v = st.ve;
      const s = fromDoc(getParsed(st.text).doc);
      const now = performance.now();
      // Notes mode: a note from MIDI or the microphone gets the hole that fits the notes around it
      // (keys and the mouse play the hole you chose).
      let sound = played;
      if (st.readAs === 'notes' && played.type === 'hole' && (id.startsWith('midi:') || id === MIC_ID)) {
        const at = v.step ? v.caret : v.selection[0];
        if (at) sound = chooseSound(getHarp(), midi, neighbours(s, at));
      }
      if (v.step) {
        // A chord: on the computer keyboard, keys held down together; from MIDI or the
        // microphone, notes that start together (within 90 ms). Quick single notes stay single.
        const li = lastInsert.current;
        const together = id.startsWith('key:')
          ? Object.keys(st.held).some((k) => k !== id && k.startsWith('key:'))
          : !!li && now - li.at < 90 && id !== 'mouse';
        if (li && together) {
          const it = s.measures[li.pos.m]?.items.find((x) => Math.abs(x.start - li.pos.start) < EPS);
          if (it && !it.sounds.some((x) => JSON.stringify(x) === JSON.stringify(sound))) {
            // One hole can't blow and draw at once.
            if (sound.type === 'hole' && it.sounds.some((x) => x.type === 'hole' && x.hole === sound.hole)) {
              st.notify(`Hole ${sound.hole} can’t blow and draw at the same time, so it wasn’t added to the chord.`);
              return;
            }
            apply(updateItem(s, li.pos, { sounds: [...it.sounds, sound].sort((a, b) => (a.type === 'hole' && b.type === 'hole' ? a.hole - b.hole : 0)) }), { lastSounds: [sound] });
          }
          return;
        }
        const dur = toolDuration(v);
        const pos = v.caret;
        const next = placeItem(makeRoom(s, pos, dur, v.insert), pos.m, { start: pos.start, dur, sounds: [sound] });
        lastInsert.current = { at: now, pos };
        // Not selected: the length keys go on setting the next note's length.
        apply(next, { caret: advance(next, pos, dur), selection: [], justEntered: pos, measure: pos.m, lastSounds: [sound] });
        return;
      }
      if (v.selection.length === 1) {
        apply(updateItem(s, v.selection[0], { sounds: [sound] }), { lastSounds: [sound] });
      } else if (sound.type === 'hole') setVe({ lastSounds: [sound] });
    };
    const offPlayed = onPlayed((midi, id, sound) => enter(midi, id, sound));
    // A MIDI note the harp can't play is written as a note name.
    const offPitch = onPitchPlayed((midi, id) => enter(midi, id, { type: 'pitch', midi }));
    return () => {
      offPlayed();
      offPitch();
    };
  }, [setVe]);

  // ---- Copy, cut and paste: the system clipboard, as tab text ----
  useEffect(() => {
    // Only for the visual editor, and not while typing or when page text is selected.
    const ours = (e: ClipboardEvent) => {
      const st = useApp.getState();
      if (st.page !== 'editor' || st.editorMode !== 'visual') return false;
      if (isTyping(e.target) || overlayOpen()) return false;
      return !window.getSelection()?.toString();
    };
    const copyOut = (e: ClipboardEvent, cut: boolean) => {
      if (!ours(e)) return;
      const st = useApp.getState();
      const sel = st.ve.selection;
      if (!sel.length) return;
      const s = fromDoc(getParsed(st.text).doc);
      const text = copyText(s, sel);
      if (!text) return;
      e.clipboardData?.setData('text/plain', text);
      e.preventDefault();
      if (cut) apply(deleteNotes(s, sel, st.ve.insert), { selection: [], caret: sel[0] });
      st.notify(`${cut ? 'Cut' : 'Copied'} ${sel.length} note${sel.length === 1 ? '' : 's'} — paste them here or anywhere as text`);
    };
    const onCopy = (e: ClipboardEvent) => copyOut(e, false);
    const onCut = (e: ClipboardEvent) => copyOut(e, true);
    const onPaste = (e: ClipboardEvent) => {
      if (!ours(e)) return;
      const text = e.clipboardData?.getData('text/plain') ?? '';
      const st = useApp.getState();
      const s = fromDoc(getParsed(st.text).doc);
      // Insert mode: room for what's pasted first.
      const probe = st.ve.insert ? pasteText(s, text, st.ve.caret) : null;
      const room = probe ? realBeat(probe.song, probe.end) - realBeat(probe.song, st.ve.caret) : 0;
      const r = pasteText(room > 0 ? ripple(s, st.ve.caret, room) : s, text, st.ve.caret);
      e.preventDefault();
      if (!r) {
        st.notify('The clipboard doesn’t hold tab or notes to paste.');
        return;
      }
      apply(r.song, { selection: r.placed, anchor: r.placed[0], caret: r.end, measure: r.placed[0]?.m ?? st.ve.caret.m });
    };
    window.addEventListener('copy', onCopy);
    window.addEventListener('cut', onCut);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('copy', onCopy);
      window.removeEventListener('cut', onCut);
      window.removeEventListener('paste', onPaste);
    };
  }, []);

  // ---- Keyboard shortcuts ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (keysTaken(e)) return;
      // Alt+arrows belong to the browser (Back / Forward).
      if (e.altKey && e.key.startsWith('Arrow')) return;
      const st = useApp.getState();
      const v = st.ve;
      const s = fromDoc(getParsed(st.text).doc);
      const sel = v.selection;
      const ctrl = e.ctrlKey || e.metaKey;

      if (ctrl && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        const all = allPositions(s);
        setVe({ selection: all, anchor: all[0] });
        return;
      }
      if (ctrl) return;

      const durKey = DURATIONS.find((d) => d.key === e.key.toUpperCase());
      if (durKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        setDuration(durKey.beats, v.dotted, v.triplet);
        return;
      }
      switch (e.key) {
        case 'n':
        case 'N':
        case '.':
          e.preventDefault();
          setDuration(v.dur, !v.dotted, false);
          return;
        case 'm':
        case 'M':
          e.preventDefault();
          setDuration(v.dur, false, !v.triplet);
          return;
        case 'l':
        case 'L':
          e.preventDefault();
          toggleTie();
          return;
        case '/': {
          e.preventDefault();
          insertRest();
          return;
        }
        case 'Delete':
        case 'Backspace':
          if (!sel.length) {
            // Step entry: Backspace takes back the note before the caret.
            // (A caret after the last measure is at the end of that measure.)
            const last = s.measures.length - 1;
            const at = v.caret.m > last && last >= 0 ? { m: last, start: measureSpan(s, s.measures[last]) } : v.caret;
            const prev = e.key === 'Backspace' && v.step ? previousItem(s, at) : null;
            if (!prev) return;
            e.preventDefault();
            const head = chainAt(s, prev.pos)[0] ?? prev.pos;
            let next = deleteNotes(s, [prev.pos], v.insert);
            // Taking back the last notes leaves no empty bars behind at the end.
            while (next.measures.length > 1 && next.measures.length - 1 >= head.m && !next.measures[next.measures.length - 1].items.length) {
              next = { ...next, measures: next.measures.slice(0, -1) };
            }
            apply(next, { caret: head, justEntered: undefined });
            return;
          }
          e.preventDefault();
          apply(deleteNotes(s, sel, v.insert), { selection: [], caret: sel[0] });
          return;
        case 'Insert':
          e.preventDefault();
          setVe({ insert: !v.insert });
          st.notify(v.insert ? 'Overwrite: new notes replace what’s there' : 'Insert: new notes push the rest along');
          return;
        case 'Escape':
          setVe({ selection: [] });
          return;
        case 'ArrowLeft':
        case 'ArrowRight': {
          e.preventDefault();
          const all = allPositions(s);
          if (!all.length) return;
          const cur = sel[sel.length - 1];
          let i = cur ? all.findIndex((p) => samePos(p, cur)) : -1;
          if (i < 0) {
            // No selection: step from the caret (after the last note when nothing follows it).
            const after = all.findIndex((p) => p.m > v.caret.m || (p.m === v.caret.m && p.start >= v.caret.start - EPS));
            i = (after < 0 ? all.length : after) - (e.key === 'ArrowRight' ? 1 : 0);
          }
          const j = Math.max(0, Math.min(all.length - 1, i + (e.key === 'ArrowRight' ? 1 : -1)));
          const p = all[j];
          const it = s.measures[p.m].items.find((x) => Math.abs(x.start - p.start) < EPS)!;
          setVe({ selection: [p], caret: advance(s, p, it.dur), measure: p.m });
          if (it.sounds.length) playSounds(it.sounds, it.dur);
          return;
        }
        case 'ArrowUp':
        case 'ArrowDown': {
          if (!sel.length) return;
          e.preventDefault();
          const harp = getHarp();
          const st = useApp.getState();
          const scale = stepScale(getParsed(st.text).doc.meta.key, harp);
          let next = s;
          for (const p of sel) {
            const it = next.measures[p.m]?.items.find((x) => Math.abs(x.start - p.start) < EPS);
            if (!it || !it.sounds.length) continue;
            // Notes mode steps through the notes (the hole follows); Holes mode through the holes.
            const dir = e.key === 'ArrowUp' ? 1 : -1;
            const stepped = st.readAs === 'notes' ? stepNotes(harp, it.sounds, dir, e.shiftKey, scale, neighbours(next, p)) : stepPitch(harp, it.sounds, dir, e.shiftKey);
            if (stepped) next = updateItem(next, p, { sounds: stepped });
          }
          apply(next);
          const it = next.measures[sel[0].m]?.items.find((x) => Math.abs(x.start - sel[0].start) < EPS);
          if (it) playSounds(it.sounds);
          return;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setVe]);

  return (
    <div className="ve">
      {!hasBars && song.measures.some((m) => m.items.length) && (
        <div className="ve-notice">
          This tab has no bar lines, so it's shown in bars of {parsed.doc.meta.time}. Your first edit here adds the bar lines to the text.
        </div>
      )}
      <div className="ve-main">
        <Score song={song} starts={starts} playingAt={playingAt} flats={flats} showSecond={showSecond} asNotes={asNotes} />
        <Inspector song={song} />
      </div>
      <Dock />
    </div>
  );
}

// ---- Toolbar ---------------------------------------------------------------------------------

function setDuration(base: number, dotted: boolean, triplet: boolean) {
  const st = useApp.getState();
  const v = st.ve;
  st.setVe({ dur: base, dotted, triplet });
  // Step entry: the length is for the next note (the one just written isn't changed).
  if (v.step || !v.selection.length) return;
  const beats = base * (dotted ? 1.5 : 1) * (triplet ? 2 / 3 : 1);
  const s = fromDoc(getParsed(st.text).doc);
  const { song, selection } = changeLengths(s, v.selection, beats, v.insert);
  apply(song, { selection });
}

/** Ties the selected note to the one before it (or unties it). */
function toggleTie() {
  const st = useApp.getState();
  const sel = st.ve.selection;
  if (sel.length !== 1) {
    st.notify('Select the note that should continue the previous one, then press Tie (L).');
    return;
  }
  const s = fromDoc(getParsed(st.text).doc);
  const it = s.measures[sel[0].m]?.items.find((x) => Math.abs(x.start - sel[0].start) < EPS);
  if (!it) return;
  const next = setTie(s, sel[0], !it.tied);
  if (next === s) {
    st.notify('There’s no note right before this one to tie to.');
    return;
  }
  apply(next);
}

function insertRest() {
  const st = useApp.getState();
  const v = st.ve;
  const s = fromDoc(getParsed(st.text).doc);
  const dur = toolDuration(v);
  const cleared = removeChains(placeItem(makeRoom(s, v.caret, dur, v.insert), v.caret.m, { start: v.caret.start, dur, sounds: [] }), [v.caret]);
  apply(cleared, { caret: advance(cleared, v.caret, dur), selection: [] });
}

function addNoteAtCaret() {
  const st = useApp.getState();
  const v = st.ve;
  const s = fromDoc(getParsed(st.text).doc);
  const dur = toolDuration(v);
  const next = placeItem(makeRoom(s, v.caret, dur, v.insert), v.caret.m, { start: v.caret.start, dur, sounds: v.lastSounds });
  apply(next, { selection: [v.caret], caret: advance(next, v.caret, dur), measure: v.caret.m });
  playSounds(v.lastSounds, dur);
}

const UNDO = <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></svg>;
const REDO = <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 14l5-5-5-5" /><path d="M20 9H10a6 6 0 0 0 0 12h3" /></svg>;

/** Undo and redo (in the editor bar, in every mode). */
export function UndoRedo() {
  const canUndo = useApp((s) => s.history.past.length > 0);
  const canRedo = useApp((s) => s.history.future.length > 0);
  return (
    <div className="tb-group">
      <button className="icon-btn" disabled={!canUndo} onClick={() => useApp.getState().undo()} title="Undo (Ctrl+Z)" aria-label="Undo">{UNDO}</button>
      <button className="icon-btn" disabled={!canRedo} onClick={() => useApp.getState().redo()} title="Redo (Ctrl+Y)" aria-label="Redo">{REDO}</button>
    </div>
  );
}

/** The visual editor's tools, in the editor bar. */
export function VisualToolbar() {
  const parsed = useParsed();
  const song = useMemo(() => fromDoc(parsed.doc), [parsed]);
  return <Toolbar song={song} />;
}

/** Deletes the selected notes; the caret goes where they were (as with Del). */
function deleteSelection() {
  const st = useApp.getState();
  const sel = st.ve.selection;
  if (!sel.length) return;
  apply(deleteNotes(fromDoc(getParsed(st.text).doc), sel, st.ve.insert), { selection: [], caret: sel[0] });
}

function Toolbar({ song }: { song: Song }) {
  const fit = useApp((s) => s.fitWidth);
  const rebar = useApp((s) => s.rebar);
  const ve = useApp((s) => s.ve);
  const setVe = useApp((s) => s.setVe);
  const sel = ve.selection;
  const selTied = sel.length === 1 && !!song.measures[sel[0].m]?.items.find((x) => Math.abs(x.start - sel[0].start) < EPS)?.tied;
  // The palette shows what a length key sets: the selected notes' length, or (in step entry,
  // or with nothing selected) the next note's.
  const forNext = ve.step || !sel.length;
  const shown = useMemo(() => {
    if (!forNext) {
      const it = song.measures[sel[0].m]?.items.find((x) => Math.abs(x.start - sel[0].start) < EPS);
      if (it) return describeDuration(chainLength(song, chainAt(song, sel[0])));
    }
    return { base: ve.dur, dotted: ve.dotted, triplet: ve.triplet };
  }, [forNext, sel, song, ve.dur, ve.dotted, ve.triplet]);
  const what = ve.step ? ' — the next note' : sel.length ? ` — the selected note${sel.length > 1 ? 's' : ''}` : '';
  const on = (yes: boolean) => (yes ? (ve.step ? 'next' : 'on') : '');

  return (
    <div className="ve-toolbar">
      <span className="tb-sep" />
      <div className="pal" role="group" aria-label={ve.step ? 'Length of the next note' : sel.length ? 'Length of the selected notes' : 'Note length'}>
        {DURATIONS.map((d) => (
          <button key={d.beats} className={`pal-btn ${on(shown.base === d.beats)}`} aria-pressed={shown.base === d.beats} onClick={() => setDuration(d.beats, shown.dotted, shown.triplet)} title={`${d.name} (${d.key})${what}`}>
            <span className="dur-sym">{d.symbol}</span>
          </button>
        ))}
        <button className={`pal-btn mod ${on(shown.dotted)}`} aria-pressed={shown.dotted} onClick={() => setDuration(shown.base ?? ve.dur, !shown.dotted, false)} title={`Dotted: 1½ × as long (N or .)${what}`}>·</button>
        <button className={`pal-btn mod ${on(shown.triplet)}`} aria-pressed={shown.triplet} onClick={() => setDuration(shown.base ?? ve.dur, false, !shown.triplet)} title={`Triplet: three in the time of two (M)${what}`}>3</button>
      </div>
      <div className="pal" role="group" aria-label="Rest and tie">
        <button className="pal-btn" onClick={insertRest} title="Rest at the caret (/)" aria-label="Rest">𝄽</button>
        <button className={`pal-btn ${selTied ? 'on' : ''}`} disabled={sel.length !== 1} onClick={toggleTie} aria-pressed={selTied} aria-label="Tie" title="Tie: the selected note continues the note before it, across bar lines too (L)">
          ⁀
        </button>
      </div>
      <span className="tb-sep" />
      <button className={`btn small step-btn ${ve.step ? 'on' : ''}`} aria-pressed={ve.step} aria-label="Step entry" onClick={() => setVe({ step: !ve.step, justEntered: undefined })} title="Step entry: every hole you play (keyboard, mouse, MIDI, mic) is written at the caret">
        <span className="rec-dot" /> Step
      </button>
      <div className="seg icons" role="radiogroup" aria-label="Writing over or in between">
        <button role="radio" aria-checked={!ve.insert} aria-label="Overwrite" className={ve.insert ? '' : 'on'} onClick={() => setVe({ insert: false })} title="Overwrite: new notes replace what’s there (Ins switches)">
          {OverwriteIcon}
        </button>
        <button role="radio" aria-checked={ve.insert} aria-label="Insert" className={ve.insert ? 'on' : ''} onClick={() => setVe({ insert: true })} title="Insert: new or longer notes push the music after them along; deleting closes the gap (Ins switches)">
          {InsertIcon}
        </button>
      </div>
      <ReadAsSwitch icons />
      <Popover label="⋯" buttonClass="icon-btn more-btn" title="More tools" ariaLabel="More tools" kind="panel" panelClass="menu more-menu" panelLabel="More tools">
        {(close) => {
          const run = (f: () => void) => () => {
            close();
            f();
          };
          const target = sel.length ? `${sel.length} selected` : 'the whole song';
          return (
            <>
              <div className="mi-label">Notes</div>
              <button className="menu-item" onClick={run(addNoteAtCaret)}>
                <span className="mi-name">+ Note at the caret</span>
                <span className="mi-hint">The last sound you used (double-clicking a slot does the same)</span>
              </button>
              <button className="menu-item" disabled={!sel.length} onClick={run(deleteSelection)}>
                <span className="mi-name">Delete the selection <span className="mi-ext">Del</span></span>
              </button>
              <div className="mi-label">Transpose: {target}</div>
              <button className="menu-item" onClick={run(() => retabSelection(1))}><span className="mi-name">Up a semitone</span>{!sel.length && <span className="mi-hint">With the song’s key and chords</span>}</button>
              <button className="menu-item" onClick={run(() => retabSelection(-1))}><span className="mi-name">Down a semitone</span></button>
              <button className="menu-item" onClick={run(() => retabSelection(12))}><span className="mi-name">Up an octave</span></button>
              <button className="menu-item" onClick={run(() => retabSelection(-12))}><span className="mi-name">Down an octave</span></button>
              <button className="menu-item" onClick={run(() => retabSelection(0))}>
                <span className="mi-name">Make easier</span>
                <span className="mi-hint">Same notes, easier holes: fewer bends and overblows, less jumping</span>
              </button>
              <div className="mi-label">Measures</div>
              <button className="menu-item" onClick={run(() => apply(insertMeasure(song, song.measures.length), { caret: { m: song.measures.length, start: 0 }, measure: song.measures.length }))}>
                <span className="mi-name">+ Measure at the end</span>
              </button>
              <label className="pb-check">
                <input type="checkbox" checked={rebar} onChange={(e) => useApp.setState({ rebar: e.target.checked })} />
                <span>
                  Re-bar notes when the time changes
                  <span className="mi-hint">Notes crossing a new bar line are split; off: the bars stay as they are</span>
                </span>
              </label>
              <label className="pb-check">
                <input type="checkbox" checked={fit} onChange={(e) => useApp.setState({ fitWidth: e.target.checked })} />
                <span>
                  Fit measures to the width
                  <span className="mi-hint">Off: rows follow the tab’s lines of text</span>
                </span>
              </label>
              <div className="mi-label">Grid</div>
              <label className="pb-row">
                <span>Snap</span>
                <select value={ve.snap} onChange={(e) => setVe({ snap: parseFloat(e.target.value) })} title="Grid for placing and dragging notes. Auto: eighths on a ½-beat grid, sixteenths on ¼, triplets on ⅓ (hold Shift while dragging for a finer grid)">
                  <option value={0}>Auto (follows the note)</option>
                  <option value={1}>1/4</option>
                  <option value={0.5}>1/8</option>
                  <option value={0.25}>1/16</option>
                  <option value={1 / 3}>Triplet</option>
                </select>
              </label>
              <label className="pb-row">
                <span>Zoom</span>
                <input type="range" min={ZOOM_MIN} max={ZOOM_MAX} step={4} value={ve.zoom} aria-label="Zoom" onChange={(e) => setVe({ zoom: parseInt(e.target.value, 10) })} title="Also Ctrl + mouse wheel over the music" />
              </label>
            </>
          );
        }}
      </Popover>
    </div>
  );
}

// ---- Dock: the harmonica under the music, and the status line ----------------------------

/** The slim harmonica docked at the bottom of the window (Visual mode), with Mic and MIDI. */
function Dock() {
  const open = useApp((s) => s.dockOpen);
  // Step entry on: a red outline says playing here writes notes.
  const step = useApp((s) => s.ve.step);
  const name = useParsed().harp.name;
  // Its height, so the inspector ends above it.
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty('--dock-h', `${el.offsetHeight}px`));
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.documentElement.style.removeProperty('--dock-h');
    };
  }, []);
  return (
    <div className={`ve-dock ${step ? 'stepping' : ''}`} ref={root}>
      <div className="dock-head">
        <b>Harmonica</b>
        <span className="muted small">{name} · the top half of a hole blows, the bottom half draws</span>
        <span className="bar-spacer" />
        <MicControl />
        <MidiControl />
        <button className="btn small ghost" onClick={() => useApp.setState({ dockOpen: !open })} aria-expanded={open} title={open ? 'Fold the harmonica away (the keyboard still plays)' : 'Show the harmonica'}>
          {open ? 'Hide ▾' : 'Show ▴'}
        </button>
      </div>
      {open && <Harmonica size="slim" />}
      <StatusLine />
    </div>
  );
}

/** Where the caret is, what mode the editor is in, and a hint for what to do next. */
function StatusLine() {
  const ve = useApp((s) => s.ve);
  const setVe = useApp((s) => s.setVe);
  const sel = ve.selection;
  const at = sel[0] ?? ve.caret;
  const hint = ve.step
    ? 'Play the harmonica (keys 1–0, Q–P) to write at the caret · hold keys together for a chord · Backspace takes back the last note'
    : sel.length === 1
      ? '↑ ↓ change the note · play a hole to replace it · drag its right edge to change the length'
      : sel.length > 1
        ? 'Drag one to move them all · Ctrl+C / X / V copy, cut and paste'
        : 'Click a slot for the caret · double-click to add a note · drag a note to move it (Alt copies)';
  return (
    <div className="ve-status" role="status">
      <span>
        Bar <b>{at.m + 1}</b> · beat <b>{+(at.start + 1).toFixed(2)}</b>
      </span>
      {sel.length > 0 && <span><b>{sel.length}</b> selected</span>}
      <span className={ve.step ? 'live' : ''}>{ve.step ? '● Step entry' : 'Step entry off'}</span>
      <span>{ve.insert ? 'Insert' : 'Overwrite'}</span>
      <span>
        Next: <b>{durationLabel(toolDuration(ve)).toLowerCase()}</b>
      </span>
      <span className="ve-status-hint">
        {hint} ·{' '}
        <button className="link-btn" onClick={openShortcuts}>
          all shortcuts (?)
        </button>
      </span>
      <span className="ve-zoom" role="group" aria-label="Zoom">
        <button onClick={() => stepZoom(-1)} disabled={ve.zoom <= ZOOM_MIN} aria-label="Zoom out" title="Zoom out (Ctrl + mouse wheel over the music)">−</button>
        <button className="ve-zoom-val" onClick={() => setVe({ zoom: ZOOM_DEFAULT })} title="Zoom (Ctrl + mouse wheel over the music). Click to reset to 100%">
          {Math.round((ve.zoom / ZOOM_DEFAULT) * 100)}%
        </button>
        <button onClick={() => stepZoom(1)} disabled={ve.zoom >= ZOOM_MAX} aria-label="Zoom in" title="Zoom in (Ctrl + mouse wheel over the music)">+</button>
      </span>
    </div>
  );
}

// ---- Score: measures, notes, dragging ----------------------------------------------------------

interface Drag {
  pos: Pos;
  item: Item;
  x0: number;
  y0: number;
  grab: number; // beats between the note start and the pointer
  moved: boolean;
  mode: 'move' | 'resize';
  /** Beats from the start of the (tied) note to the grabbed piece, and the note's whole length. */
  offset: number;
  total: number;
  /** Dragging one of several selected notes moves them all: their starts and lengths. */
  group: { pos: Pos; abs: number; len: number }[];
  /** A click (no drag) on a note inside a selection selects just that note. */
  collapse: boolean;
  /** The grid it moves on (Shift: finer). */
  grid: number;
}

/** A narrow card's label: holes, notes, chord and lyric ("−4  D5 · G7 · “tle”"). */
function peekText(it: Item, midis: (number | null)[], flats: boolean): string {
  if (!it.sounds.length) return ['Rest', it.chord, it.lyric && `“${it.lyric}”`].filter(Boolean).join(' · ');
  const holes = it.sounds.map((s) => (s.type === 'hole' ? holeSoundText(s) : '')).filter(Boolean).join(' ');
  const notes = midis.map((x) => (x === null ? '?' : midiToName(x, flats))).join(' ');
  return [holes ? `${holes}  ${notes}` : notes, it.chord, it.lyric && `“${it.lyric}”`].filter(Boolean).join(' · ');
}

/**
 * Splits a span (absolute start + length) into one segment per measure, so previews
 * line up with the lanes — measures are separated by gaps and can wrap onto new lines.
 */
function segments(cap: number, abs: number, dur: number): { m: number; start: number; len: number }[] {
  const out: { m: number; start: number; len: number }[] = [];
  let at = abs;
  let left = dur;
  for (let guard = 0; left > EPS && guard < 64; guard++) {
    const m = Math.floor(at / cap + EPS);
    const start = at - m * cap;
    const len = Math.min(left, cap - start);
    out.push({ m, start, len });
    at += len;
    left -= len;
  }
  return out;
}

function Score({ song, starts, playingAt, flats, showSecond, asNotes }: { song: Song; starts: number[]; playingAt: Set<number>; flats: boolean; showSecond: boolean; asNotes: boolean }) {
  const ve = useApp((s) => s.ve);
  // Fit to width: measures fill each row and only sections start a new one; the
  // text's own line breaks show as a small mark.
  const fit = useApp((s) => s.fitWidth);
  const setVe = useApp((s) => s.setVe);
  const harp = useParsed().harp;
  const zoom = ve.zoom;
  const drag = useRef<Drag | null>(null);
  // Move preview: where the grabbed piece lands (m/start) and the whole note's span (abs/dur).
  const [ghost, setGhost] = useState<{ m: number; start: number; abs: number; dur: number; copy: boolean; others: { abs: number; dur: number }[] } | null>(null);
  const [resizeDur, setResizeDur] = useState<{ pos: Pos; dur: number } | null>(null);
  // The grid shown while dragging (auto snap follows the dragged note).
  const [dragGrid, setDragGrid] = useState<number | null>(null);
  // Latest previews, read when the drag ends.
  const ghostRef = useRef(ghost);
  const resizeRef = useRef(resizeDur);
  ghostRef.current = ghost;
  resizeRef.current = resizeDur;
  const root = useRef<HTMLDivElement>(null);

  const laneAt = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y)?.closest('.ve-lane') as HTMLElement | null;
    return el ? { el, m: parseInt(el.dataset.m!, 10) } : null;
  };

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 4) return;
      d.moved = true;
      const snap = e.shiftKey ? fineGrid(d.grid) : d.grid;
      setDragGrid(snap);
      if (d.mode === 'resize') {
        // Past the bar line the note carries on into the next measure as a tie.
        const dur = Math.max(snap, snapTo(d.item.dur + (e.clientX - d.x0) / zoom, snap));
        resizeRef.current = { pos: d.pos, dur: Math.min(dur, song.cap * 4) };
        setResizeDur(resizeRef.current);
        return;
      }
      const lane = laneAt(e.clientX, e.clientY);
      if (!lane) {
        ghostRef.current = null;
        setGhost(null);
        return;
      }
      const r = lane.el.getBoundingClientRect();
      const start = Math.max(0, Math.min(song.cap - snap, snapTo((e.clientX - r.left) / zoom - d.grab, snap)));
      const head = Math.max(0, lane.m * song.cap + start - d.offset);
      // The other selected notes follow at the same distance.
      const grabbedHead = absBeat(song, d.pos) - d.offset;
      const others = d.group.filter((g) => !samePos(g.pos, chainAt(song, d.pos)[0])).map((g) => ({ abs: Math.max(0, g.abs + head - grabbedHead), dur: g.len }));
      ghostRef.current = { m: lane.m, start, abs: head, dur: d.total, copy: e.altKey, others };
      setGhost(ghostRef.current);
    };
    const up = () => {
      const d = drag.current;
      drag.current = null;
      if (!d) return;
      setDragGrid(null);
      const s = fromDoc(getParsed(useApp.getState().text).doc);
      // Edits happen here, not inside state updaters (React may run those twice).
      if (d.mode === 'resize') {
        const rd = resizeRef.current;
        setResizeDur(null);
        if (rd && d.moved && Math.abs(rd.dur - d.item.dur) > EPS) {
          // The dragged piece changes length; the whole (tied) note follows.
          const chain = chainAt(s, d.pos);
          const total = chainLength(s, chain) - d.item.dur + rd.dur;
          const ins = useApp.getState().ve.insert;
          apply(ins ? changeLengths(s, [d.pos], total, true).song : updateItem(s, d.pos, { dur: total }));
        }
        return;
      }
      const g = ghostRef.current;
      setGhost(null);
      if (!d.moved) {
        if (d.collapse) setVe({ selection: [d.pos], anchor: d.pos, measure: d.pos.m, caret: advance(s, d.pos, d.item.dur) });
        return;
      }
      if (g) {
        const to = { m: g.m, start: g.start };
        if (d.group.length > 1) {
          // Several notes: all move by the same amount (Alt copies).
          const delta = g.abs - (absBeat(s, d.pos) - d.offset);
          if (Math.abs(delta) > EPS || g.copy) {
            const { song: next, moved } = moveItems(s, d.group.map((x) => x.pos), delta, g.copy);
            apply(next, { selection: moved, anchor: moved[0], measure: moved[0]?.m ?? to.m });
          }
          return;
        }
        // Copy or move as the preview showed it (Alt when the pointer last moved).
        if (!samePos(to, d.pos) || g.copy) apply(moveItem(s, d.pos, to, g.copy), { selection: [to], anchor: to, measure: to.m, caret: advance(s, to, d.item.dur) });
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [zoom, song, setVe]);

  const onItemDown = (e: React.PointerEvent, pos: Pos, item: Item) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const resize = (e.target as HTMLElement).classList.contains('ve-resize');
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const chain = chainAt(song, pos);
    const v = useApp.getState().ve;
    const sel = v.selection;
    const inSelection = sel.some((p) => samePos(p, pos));
    // Selecting: Ctrl/⌘ adds or removes one note; Shift selects everything from the anchor.
    let selection = sel;
    if (e.ctrlKey || e.metaKey) {
      selection = inSelection ? sel.filter((p) => !samePos(p, pos)) : [...sel, pos];
      setVe({ selection, anchor: pos, measure: pos.m });
    } else if (e.shiftKey) {
      selection = positionsBetween(song, v.anchor ?? sel[0] ?? pos, pos);
      setVe({ selection, measure: pos.m });
    } else if (!inSelection) {
      selection = [pos];
      setVe({ selection, anchor: pos, measure: pos.m, caret: advance(song, pos, item.dur) });
    }
    const group =
      !resize && selection.length > 1 && selection.some((p) => samePos(p, pos))
        ? selection.map((p) => chainAt(song, p)[0] ?? p).filter((p, i, all) => all.findIndex((q) => samePos(q, p)) === i).map((p) => ({ pos: p, abs: absBeat(song, p), len: chainLength(song, chainAt(song, p)) }))
        : [];
    drag.current = {
      pos,
      item,
      x0: e.clientX,
      y0: e.clientY,
      grab: (e.clientX - rect.left) / zoom,
      moved: false,
      mode: resize ? 'resize' : 'move',
      offset: absBeat(song, pos) - absBeat(song, chain[0] ?? pos),
      total: chainLength(song, chain),
      group,
      collapse: !e.ctrlKey && !e.metaKey && !e.shiftKey && inSelection && sel.length > 1,
      // Auto: the note's own grid (several notes: the finest of theirs).
      grid: v.snap || (group.length ? Math.min(...group.map((g) => gridForNote(g.len, g.abs))) : gridForNote(item.dur, pos.start)),
    };
    if (item.sounds.length && !resize) playSounds(item.sounds, chainLength(song, chainAt(song, pos)));
  };

  const onLaneDown = (e: React.PointerEvent, m: number) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.ve-item')) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const g = clickGrid(ve);
    const start = Math.max(0, Math.min(song.cap - g, Math.floor((e.clientX - r.left) / zoom / g + EPS) * g));
    setVe({ caret: { m, start }, selection: [], measure: m });
  };

  const onLaneDouble = (e: React.MouseEvent, m: number) => {
    if ((e.target as HTMLElement).closest('.ve-item')) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const g = clickGrid(ve);
    const start = Math.max(0, Math.min(song.cap - g, Math.floor((e.clientX - r.left) / zoom / g + EPS) * g));
    const dur = toolDuration(ve);
    const next = placeItem(makeRoom(song, { m, start }, dur, ve.insert), m, { start, dur, sounds: ve.lastSounds });
    apply(next, { selection: [{ m, start }], caret: advance(next, { m, start }, dur), measure: m });
    playSounds(ve.lastSounds, dur);
  };

  // Grid background: faint lines at the snap (auto: the grid a click or the dragged note uses), stronger on beats.
  const grid = dragGrid ?? clickGrid(ve);
  const gridStyle = (cap: number) => ({
    width: cap * zoom,
    backgroundSize: `${zoom}px 100%, ${zoom * grid}px 100%`,
  });
  // Cards are exactly as long as their notes (no minimum, so they never overlap).
  const cardW = (len: number) => {
    const px = len * zoom;
    return Math.max(px - (px < 27 ? 2 : 3), 3);
  };

  // Ctrl + wheel zooms, keeping the measure under the pointer where it is on screen.
  const zoomAcc = useRef(zoom);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const cur = useApp.getState().ve.zoom;
      if (Math.abs(zoomAcc.current - cur) >= 1) zoomAcc.current = cur;
      zoomAcc.current = clampZoom(zoomAcc.current * Math.exp(-e.deltaY * 0.0015));
      const next = Math.round(zoomAcc.current);
      if (next === cur) return;
      const lane = (e.target as HTMLElement).closest<HTMLElement>('.ve-measure')?.querySelector<HTMLElement>('.ve-lane');
      const top = lane?.getBoundingClientRect().top;
      useApp.getState().setVe({ zoom: next });
      if (lane && top !== undefined) {
        requestAnimationFrame(() => {
          const now = root.current?.querySelector<HTMLElement>(`.ve-lane[data-m="${lane.dataset.m}"]`);
          if (now) window.scrollBy(0, now.getBoundingClientRect().top - top);
        });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <div className="ve-score" ref={root}>
      <div className="ve-measures">
        {song.measures.map((meas, mi) => {
          const len = measureLength(meas);
          const over = len > song.cap + EPS;
          return [
            meas.lineBreak && mi > 0 && (!fit || meas.section !== undefined) ? <div key={`br${mi}`} className="ve-break" /> : null,
            <div key={mi} className={`ve-measure ${ve.measure === mi ? 'current' : ''} ${over ? 'overfull' : ''}`}>
              <div className="ve-mhead">
                <button
                  className="ve-mnum"
                  title="Select this measure (Shift: up to here)"
                  onClick={(e) => {
                    const v = useApp.getState().ve;
                    const from = e.shiftKey ? Math.min(v.anchor?.m ?? mi, mi) : mi;
                    const to = e.shiftKey ? Math.max(v.anchor?.m ?? mi, mi) : mi;
                    const selection = allPositions(song).filter((p) => p.m >= from && p.m <= to);
                    setVe({ selection, anchor: e.shiftKey ? v.anchor : { m: mi, start: 0 }, measure: mi, panel: 'measure' });
                  }}
                >
                  {mi + 1}
                </button>
                {meas.section !== undefined && <span className="ve-section">{meas.section}</span>}
                {fit && meas.lineBreak && mi > 0 && meas.section === undefined && (
                  <span className="ve-linemark" title="Starts a new line in the tab">↵</span>
                )}
                {meas.startBar === 'repeat-start' && <span className="ve-barflag">𝄆</span>}
                {meas.endBar === 'repeat-end' && <span className="ve-barflag end">𝄇</span>}
                {over && <span className="ve-warn" title="This measure holds more beats than the time signature allows">too long</span>}
              </div>
              <div
                className="ve-lane"
                data-m={mi}
                style={gridStyle(Math.max(song.cap, len))}
                onPointerDown={(e) => onLaneDown(e, mi)}
                onDoubleClick={(e) => onLaneDouble(e, mi)}
              >
                {meas.len !== undefined && meas.len < song.cap - EPS && len < song.cap - EPS && (
                  <span
                    className="ve-short"
                    style={{ left: Math.max(meas.len, len) * zoom }}
                    title={`A short bar (pickup): ${+meas.len.toFixed(2)} of ${song.cap} beats. Notes placed here make it longer.`}
                  />
                )}
                {meas.items.map((it) => {
                  const pos = { m: mi, start: it.start };
                  // Chords and lyrics run on past a narrow card, up to the next chord or lyric.
                  const laneEnd = Math.max(song.cap, len);
                  const nextWith = (key: 'chord' | 'lyric') => meas.items.reduce((best, o) => (o.start > it.start + EPS && o[key] !== undefined && o.start < best ? o.start : best), laneEnd);
                  const w = cardW(it.dur);
                  const lod = it.dur <= EPS ? '' : detailLevel(w, glyphEms(it.sounds, it.sounds.map((s) => (s.type === 'pitch' ? s.midi : soundPitch(harp, s))), asNotes, flats), it.sounds.length > 1);
                  const lyricRoom = (nextWith('lyric') - it.start) * zoom - 6;
                  const lyric = it.lyric ? fitLyric(it.lyric, lyricRoom) : undefined;
                  const selected = ve.selection.some((p) => samePos(p, pos));
                  const just = !selected && samePos(ve.justEntered, pos);
                  const playing = playingAt.has(+(starts[mi] + it.start).toFixed(4));
                  const dragging = ghost && drag.current && samePos(drag.current.pos, pos) && !ghost.copy;
                  const midis = it.sounds.map((s) => (s.type === 'pitch' ? s.midi : soundPitch(harp, s)));
                  const offNote = it.sounds.some((s) => offHarp(harp, s));
                  const breath = it.sounds.length ? (it.sounds.every((s) => s.type === 'hole' && s.breath === 'draw') ? 'draw' : it.sounds.every((s) => s.type === 'hole' && s.breath === 'blow') ? 'blow' : 'mixed') : 'rest';
                  return (
                    <div
                      key={it.start}
                      className={`ve-item ${breath} ${lod} ${it.tied ? 'tied' : ''} ${selected ? 'selected' : ''} ${selected && ve.selection.length === 1 ? 'solo' : ''} ${just ? 'just' : ''} ${playing ? 'playing' : ''} ${dragging ? 'dragging' : ''} ${it.dur <= EPS ? 'marker' : ''} ${offNote ? 'bad' : ''}`}
                      style={{ left: it.start * zoom, width: it.dur <= EPS ? undefined : w }}
                      onPointerDown={(e) => onItemDown(e, pos, it)}
                      // Narrow cards: everything in an instant label on hover (and on the selected note).
                      data-peek={lod ? peekText(it, midis, flats) : undefined}
                      title={lod ? undefined : midis.map((x) => (x === null ? 'not playable' : midiToName(x, flats))).join(' + ') + (offNote ? ' — not on this harmonica' : '')}
                    >
                      {it.tied && <span className="ve-tie" aria-label="tied from the previous note" />}
                      <span className="ve-chord" style={{ maxWidth: (nextWith('chord') - it.start) * zoom - 6 }}>{it.chord ?? ''}</span>
                      <span className={`ve-glyphs ${it.sounds.length > 1 ? 'stack' : ''}`}>
                        {it.sounds.length ? (
                          it.sounds.map((s, k) => (asNotes ? <NoteGlyph key={k} sound={s} midi={midis[k]} flats={flats} /> : <Glyph key={k} sound={s} flats={flats} />))
                        ) : (
                          <span className="rest-glyph">𝄽</span>
                        )}
                      </span>
                      {showSecond && it.sounds.length > 0 && (
                        <span className="ve-name">
                          {asNotes
                            ? it.sounds.map((s) => (s.type === 'hole' ? holeSoundText(s) : '–')).join(' ')
                            : midis.map((x) => (x === null ? '?' : midiToName(x, flats))).join(' ')}
                        </span>
                      )}
                      <span className="ve-lyric" style={{ maxWidth: lyricRoom }} title={lyric?.cut && !lod ? it.lyric : undefined}>
                        {lyric?.shown ?? ''}
                      </span>
                      {it.dur > EPS && <span className="ve-resize" title="Drag to change the length" />}

                    </div>
                  );
                })}
                {ve.caret.m === mi && <span className="ve-caret" style={{ left: ve.caret.start * zoom }} />}
                {ghost &&
                  ghost.others.flatMap((o) => segments(song.cap, o.abs, o.dur))
                    .filter((g) => g.m === mi)
                    .map((g) => (
                      <span key={`o${g.start}`} className={`ve-ghost ${ghost.copy ? 'copy' : ''}`} style={{ left: g.start * zoom, width: cardW(g.len) }} />
                    ))}
                {ghost &&
                  segments(song.cap, ghost.abs, ghost.dur)
                    .filter((g) => g.m === mi)
                    .map((g) => (
                      <span key={`g${g.start}`} className={`ve-ghost ${ghost.copy ? 'copy' : ''}`} style={{ left: g.start * zoom, width: cardW(g.len) }} />
                    ))}
                {resizeDur &&
                  segments(song.cap, absBeat(song, resizeDur.pos), resizeDur.dur)
                    .filter((g) => g.m === mi)
                    .map((g) => <span key={`r${g.start}`} className="ve-resize-ghost" style={{ left: g.start * zoom, width: cardW(g.len) }} />)}
              </div>
            </div>,
          ];
        })}
        <button
          className={`ve-add-measure ${ve.caret.m >= song.measures.length ? 'caret-here' : ''}`}
          onClick={() => apply(insertMeasure(song, song.measures.length), { caret: { m: song.measures.length, start: 0 }, measure: song.measures.length })}
          title={ve.caret.m >= song.measures.length ? 'The caret is after the last measure: a note written now starts a new one. Click to add an empty measure.' : 'Add a measure'}
        >
          {ve.caret.m >= song.measures.length && <span className="ve-caret" style={{ left: 8 }} />}+
        </button>
      </div>
    </div>
  );
}

