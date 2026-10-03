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
  EPS,
  fromDoc,
  insertMeasure,
  measureLength,
  moveItem,
  placeItem,
  removeItems,
  samePos,
  snapTo,
  updateItem,
  type Item,
  type Pos,
  type Song,
} from '../../core/edit/model';
import { soundPitch } from '../../core/instruments';
import { midiToName, prefersFlats } from '../../core/pitch';
import type { Sound } from '../../core/types';
import { onPlayed } from '../../live/livePlayer';
import { useHarmonicaKeyboard } from '../../live/useHarmonicaKeyboard';
import { commitSong, DURATIONS, describeDuration, stepPitch } from '../../state/editor';
import { getParsed, useApp, useParsed, type VisualState } from '../../state/store';
import { Harmonica } from '../Harmonica';
import { Glyph } from '../TabView';
import { Inspector } from './Inspector';

// ---- Helpers shared with the inspector ------------------------------------------------

export function toolDuration(ve: VisualState): number {
  return ve.dur * (ve.dotted ? 1.5 : 1) * (ve.triplet ? 2 / 3 : 1);
}

/** Absolute start beat of each measure (a measure spans its capacity, or longer if overfull). */
export function measureStarts(song: Song): number[] {
  const out: number[] = [];
  let t = 0;
  for (const m of song.measures) {
    out.push(t);
    t += Math.max(song.cap, measureLength(m));
  }
  return out;
}

/** Applies an edit and moves the selection/caret. */
export function apply(song: Song, patch: Partial<VisualState> = {}) {
  commitSong(song);
  useApp.getState().setVe(patch);
}

let clipboard: { rel: number; item: Item }[] = [];

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
  const showNames = useApp((s) => s.showNoteNames);
  const song = useMemo(() => fromDoc(parsed.doc), [parsed]);
  const starts = useMemo(() => measureStarts(song), [song]);
  const flats = prefersFlats(parsed.doc.meta.key ?? parsed.harp.spec.key);
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
  useEffect(
    () =>
      onPlayed((_midi, _id, sound) => {
        const st = useApp.getState();
        if (st.page !== 'editor' || st.editorMode !== 'visual') return;
        const v = st.ve;
        const s = fromDoc(getParsed(st.text).doc);
        const now = performance.now();
        if (v.step) {
          // Keys pressed together become a chord.
          const li = lastInsert.current;
          if (li && now - li.at < 90) {
            const it = s.measures[li.pos.m]?.items.find((x) => Math.abs(x.start - li.pos.start) < EPS);
            if (it && !it.sounds.some((x) => JSON.stringify(x) === JSON.stringify(sound))) {
              apply(updateItem(s, li.pos, { sounds: [...it.sounds, sound].sort((a, b) => (a.type === 'hole' && b.type === 'hole' ? a.hole - b.hole : 0)) }), { lastSounds: [sound] });
            }
            return;
          }
          const dur = toolDuration(v);
          const pos = v.caret;
          const next = placeItem(s, pos.m, { start: pos.start, dur, sounds: [sound] });
          lastInsert.current = { at: now, pos };
          apply(next, { caret: advance(next, pos, dur), selection: [pos], measure: pos.m, lastSounds: [sound] });
          return;
        }
        if (v.selection.length === 1) {
          apply(updateItem(s, v.selection[0], { sounds: [sound] }), { lastSounds: [sound] });
        } else setVe({ lastSounds: [sound] });
      }),
    [setVe],
  );

  // ---- Keyboard shortcuts ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable) return;
      const st = useApp.getState();
      const v = st.ve;
      const s = fromDoc(getParsed(st.text).doc);
      const sel = v.selection;
      const ctrl = e.ctrlKey || e.metaKey;

      if (ctrl && e.key.toLowerCase() === 'c' && sel.length) {
        const abs = (p: Pos) => measureStarts(s)[p.m] + p.start;
        const items = sel.map((p) => ({ p, it: s.measures[p.m]?.items.find((x) => Math.abs(x.start - p.start) < EPS) })).filter((x) => x.it);
        const base = Math.min(...items.map((x) => abs(x.p)));
        clipboard = items.map((x) => ({ rel: abs(x.p) - base, item: { ...x.it! } }));
        st.notify(`Copied ${clipboard.length} note${clipboard.length === 1 ? '' : 's'}`);
        e.preventDefault();
        return;
      }
      if (ctrl && e.key.toLowerCase() === 'v' && clipboard.length) {
        let next = s;
        const caretAbs = v.caret.m * s.cap + v.caret.start;
        const placed: Pos[] = [];
        let end = caretAbs;
        for (const c of clipboard) {
          const abs = caretAbs + c.rel;
          const m = Math.floor(abs / s.cap + EPS);
          const start = abs - m * s.cap;
          next = placeItem(next, m, { ...c.item, start });
          placed.push({ m, start });
          end = Math.max(end, abs + c.item.dur);
        }
        const em = Math.floor(end / s.cap + EPS);
        apply(next, { selection: placed, caret: { m: em, start: end - em * s.cap } });
        e.preventDefault();
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
        case '/': {
          e.preventDefault();
          insertRest();
          return;
        }
        case 'Delete':
        case 'Backspace':
          if (!sel.length) return;
          e.preventDefault();
          apply(removeItems(s, sel), { selection: [], caret: sel[0] });
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
          if (i < 0) i = all.findIndex((p) => p.m > v.caret.m || (p.m === v.caret.m && p.start >= v.caret.start - EPS)) - (e.key === 'ArrowRight' ? 1 : 0);
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
          let next = s;
          for (const p of sel) {
            const it = next.measures[p.m]?.items.find((x) => Math.abs(x.start - p.start) < EPS);
            if (!it || !it.sounds.length) continue;
            const stepped = stepPitch(harp, it.sounds, e.key === 'ArrowUp' ? 1 : -1, e.shiftKey);
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
      <Toolbar song={song} />
      {!hasBars && song.measures.some((m) => m.items.length) && (
        <div className="ve-notice">
          This tab has no bar lines, so it's shown in bars of {parsed.doc.meta.time}. Your first edit here adds the bar lines to the text.
        </div>
      )}
      <div className="ve-main">
        <Score song={song} starts={starts} playingAt={playingAt} flats={flats} showNames={showNames} />
        <Inspector song={song} />
      </div>
      <div className="ve-harp">
        <div className="ve-harp-head">
          <b>Harmonica</b>
          <span className="muted">
            {ve.step
              ? 'Step entry is on: each hole you play is added at the caret.'
              : ve.selection.length === 1
                ? 'Play a hole to change the selected note.'
                : 'Select a note and play a hole to change it, or turn on step entry to write notes by playing.'}
          </span>
        </div>
        <Harmonica />
      </div>
    </div>
  );
}

// ---- Toolbar ---------------------------------------------------------------------------------

function setDuration(base: number, dotted: boolean, triplet: boolean) {
  const st = useApp.getState();
  const v = st.ve;
  st.setVe({ dur: base, dotted, triplet });
  if (!v.selection.length) return;
  const beats = base * (dotted ? 1.5 : 1) * (triplet ? 2 / 3 : 1);
  let s = fromDoc(getParsed(st.text).doc);
  // Later notes first, so earlier ones can grow over them predictably.
  for (const p of [...v.selection].sort((a, b) => b.m - a.m || b.start - a.start)) s = updateItem(s, p, { dur: beats });
  commitSong(s);
}

function insertRest() {
  const st = useApp.getState();
  const v = st.ve;
  const s = fromDoc(getParsed(st.text).doc);
  const dur = toolDuration(v);
  const cleared = removeItems(placeItem(s, v.caret.m, { start: v.caret.start, dur, sounds: [] }), [v.caret]);
  apply(cleared, { caret: advance(cleared, v.caret, dur), selection: [] });
}

function addNoteAtCaret() {
  const st = useApp.getState();
  const v = st.ve;
  const s = fromDoc(getParsed(st.text).doc);
  const dur = toolDuration(v);
  const next = placeItem(s, v.caret.m, { start: v.caret.start, dur, sounds: v.lastSounds });
  apply(next, { selection: [v.caret], caret: advance(next, v.caret, dur), measure: v.caret.m });
  playSounds(v.lastSounds, dur);
}

const UNDO = <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></svg>;
const REDO = <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 14l5-5-5-5" /><path d="M20 9H10a6 6 0 0 0 0 12h3" /></svg>;

function Toolbar({ song }: { song: Song }) {
  const ve = useApp((s) => s.ve);
  const setVe = useApp((s) => s.setVe);
  const canUndo = useApp((s) => s.history.past.length > 0);
  const canRedo = useApp((s) => s.history.future.length > 0);
  const sel = ve.selection;
  // When notes are selected, the palette shows (and sets) their duration.
  const shown = useMemo(() => {
    if (sel.length) {
      const it = song.measures[sel[0].m]?.items.find((x) => Math.abs(x.start - sel[0].start) < EPS);
      if (it) return describeDuration(it.dur);
    }
    return { base: ve.dur, dotted: ve.dotted, triplet: ve.triplet };
  }, [sel, song, ve.dur, ve.dotted, ve.triplet]);

  return (
    <div className="ve-toolbar">
      <div className="tb-group">
        <button className="icon-btn" disabled={!canUndo} onClick={() => useApp.getState().undo()} title="Undo (Ctrl+Z)">{UNDO}</button>
        <button className="icon-btn" disabled={!canRedo} onClick={() => useApp.getState().redo()} title="Redo (Ctrl+Y)">{REDO}</button>
      </div>
      <div className="tb-group durations" role="group" aria-label="Note length">
        {DURATIONS.map((d) => (
          <button
            key={d.beats}
            className={`dur-btn ${shown.base === d.beats ? 'on' : ''}`}
            onClick={() => setDuration(d.beats, shown.dotted, shown.triplet)}
            title={`${d.name} note (${d.key})${sel.length ? ' — applies to the selection' : ''}`}
          >
            <span className="dur-sym">{d.symbol}</span>
          </button>
        ))}
        <button className={`dur-btn mod ${shown.dotted ? 'on' : ''}`} onClick={() => setDuration(shown.base ?? ve.dur, !shown.dotted, false)} title="Dotted: 1½ × as long (N or .)">
          ·
        </button>
        <button className={`dur-btn mod ${shown.triplet ? 'on' : ''}`} onClick={() => setDuration(shown.base ?? ve.dur, false, !shown.triplet)} title="Triplet: three in the time of two (M)">
          3
        </button>
      </div>
      <div className="tb-group">
        <button className="btn small" onClick={addNoteAtCaret} title="Add a note at the caret (double-click an empty slot also works)">+ Note</button>
        <button className="btn small ghost" onClick={insertRest} title="Insert a rest at the caret (/)">Rest</button>
        <button className="btn small ghost" disabled={!sel.length} onClick={() => apply(removeItems(fromDoc(getParsed(useApp.getState().text).doc), sel), { selection: [] })} title="Delete selected notes (Del)">
          Delete
        </button>
      </div>
      <div className="tb-group">
        <button className={`btn small step-btn ${ve.step ? 'on' : ''}`} onClick={() => setVe({ step: !ve.step })} title="Step entry: every hole you play (keyboard, mouse, MIDI, mic) is written at the caret">
          <span className="rec-dot" /> Step entry
        </button>
      </div>
      <div className="tb-group">
        <span className="t-label">Snap</span>
        <select value={ve.snap} onChange={(e) => setVe({ snap: parseFloat(e.target.value) })} title="Grid for placing and dragging notes">
          <option value={1}>Beat</option>
          <option value={0.5}>½ beat</option>
          <option value={0.25}>¼ beat</option>
          <option value={1 / 3}>Triplet</option>
        </select>
        <span className="t-label">Zoom</span>
        <input type="range" min={36} max={120} step={4} value={ve.zoom} onChange={(e) => setVe({ zoom: parseInt(e.target.value, 10) })} />
      </div>
      <div className="tb-group">
        <button className="btn small ghost" onClick={() => apply(insertMeasure(song, song.measures.length), { caret: { m: song.measures.length, start: 0 }, measure: song.measures.length })} title="Add a measure at the end">
          + Measure
        </button>
      </div>
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
}

function Score({ song, starts, playingAt, flats, showNames }: { song: Song; starts: number[]; playingAt: Set<number>; flats: boolean; showNames: boolean }) {
  const ve = useApp((s) => s.ve);
  const setVe = useApp((s) => s.setVe);
  const harp = useParsed().harp;
  const zoom = ve.zoom;
  const drag = useRef<Drag | null>(null);
  const [ghost, setGhost] = useState<{ m: number; start: number; dur: number; copy: boolean } | null>(null);
  const [resizeDur, setResizeDur] = useState<{ pos: Pos; dur: number } | null>(null);
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
      const snap = useApp.getState().ve.snap;
      if (d.mode === 'resize') {
        const dur = Math.max(snap, snapTo(d.item.dur + (e.clientX - d.x0) / zoom, snap));
        setResizeDur({ pos: d.pos, dur: Math.min(dur, song.cap - d.pos.start) });
        return;
      }
      const lane = laneAt(e.clientX, e.clientY);
      if (!lane) {
        setGhost(null);
        return;
      }
      const r = lane.el.getBoundingClientRect();
      const start = Math.max(0, Math.min(song.cap - Math.min(d.item.dur, song.cap), snapTo((e.clientX - r.left) / zoom - d.grab, snap)));
      setGhost({ m: lane.m, start, dur: d.item.dur, copy: e.altKey });
    };
    const up = (e: PointerEvent) => {
      const d = drag.current;
      drag.current = null;
      if (!d) return;
      const s = fromDoc(getParsed(useApp.getState().text).doc);
      if (d.mode === 'resize') {
        setResizeDur((rd) => {
          if (rd && d.moved && Math.abs(rd.dur - d.item.dur) > EPS) apply(updateItem(s, d.pos, { dur: rd.dur }));
          return null;
        });
        return;
      }
      setGhost((g) => {
        if (g && d.moved) {
          const to = { m: g.m, start: g.start };
          if (!samePos(to, d.pos) || g.copy) apply(moveItem(s, d.pos, to, e.altKey), { selection: [to], measure: to.m, caret: advance(s, to, d.item.dur) });
        }
        return null;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [zoom, song.cap]);

  const onItemDown = (e: React.PointerEvent, pos: Pos, item: Item) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const resize = (e.target as HTMLElement).classList.contains('ve-resize');
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    drag.current = { pos, item, x0: e.clientX, y0: e.clientY, grab: (e.clientX - rect.left) / zoom, moved: false, mode: resize ? 'resize' : 'move' };
    const sel = useApp.getState().ve.selection;
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      const has = sel.some((p) => samePos(p, pos));
      setVe({ selection: has ? sel.filter((p) => !samePos(p, pos)) : [...sel, pos], measure: pos.m });
    } else if (!sel.some((p) => samePos(p, pos)) || sel.length > 1) {
      setVe({ selection: [pos], measure: pos.m, caret: advance(song, pos, item.dur) });
    }
    if (item.sounds.length && !resize) playSounds(item.sounds, item.dur);
  };

  const onLaneDown = (e: React.PointerEvent, m: number) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.ve-item')) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const start = Math.max(0, Math.min(song.cap - ve.snap, Math.floor((e.clientX - r.left) / zoom / ve.snap + EPS) * ve.snap));
    setVe({ caret: { m, start }, selection: [], measure: m });
  };

  const onLaneDouble = (e: React.MouseEvent, m: number) => {
    if ((e.target as HTMLElement).closest('.ve-item')) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const start = Math.max(0, Math.min(song.cap - ve.snap, Math.floor((e.clientX - r.left) / zoom / ve.snap + EPS) * ve.snap));
    const dur = toolDuration(ve);
    const next = placeItem(song, m, { start, dur, sounds: ve.lastSounds });
    apply(next, { selection: [{ m, start }], caret: advance(next, { m, start }, dur), measure: m });
    playSounds(ve.lastSounds, dur);
  };

  // Grid background: faint lines at the snap, stronger on beats.
  const gridStyle = (cap: number) => ({
    width: cap * zoom,
    backgroundSize: `${zoom}px 100%, ${zoom * ve.snap}px 100%`,
  });

  return (
    <div className="ve-score" ref={root}>
      <div className="ve-measures">
        {song.measures.map((meas, mi) => {
          const len = measureLength(meas);
          const over = len > song.cap + EPS;
          return [
            meas.lineBreak && mi > 0 ? <div key={`br${mi}`} className="ve-break" /> : null,
            <div key={mi} className={`ve-measure ${ve.measure === mi ? 'current' : ''} ${over ? 'overfull' : ''}`}>
              <div className="ve-mhead">
                <span className="ve-mnum">{mi + 1}</span>
                {meas.section !== undefined && <span className="ve-section">{meas.section}</span>}
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
                {meas.items.map((it) => {
                  const pos = { m: mi, start: it.start };
                  const selected = ve.selection.some((p) => samePos(p, pos));
                  const playing = playingAt.has(+(starts[mi] + it.start).toFixed(4));
                  const dur = resizeDur && samePos(resizeDur.pos, pos) ? resizeDur.dur : it.dur;
                  const dragging = ghost && drag.current && samePos(drag.current.pos, pos) && !ghost.copy;
                  const midis = it.sounds.map((s) => (s.type === 'pitch' ? s.midi : soundPitch(harp, s)));
                  const breath = it.sounds.length ? (it.sounds.every((s) => s.type === 'hole' && s.breath === 'draw') ? 'draw' : it.sounds.every((s) => s.type === 'hole' && s.breath === 'blow') ? 'blow' : 'mixed') : 'rest';
                  return (
                    <div
                      key={it.start}
                      className={`ve-item ${breath} ${selected ? 'selected' : ''} ${playing ? 'playing' : ''} ${dragging ? 'dragging' : ''} ${it.dur <= EPS ? 'marker' : ''} ${midis.some((x) => x === null) ? 'bad' : ''}`}
                      style={{ left: it.start * zoom, width: Math.max(it.dur * zoom, 22) - 3 }}
                      onPointerDown={(e) => onItemDown(e, pos, it)}
                      title={midis.map((x) => (x === null ? 'not playable' : midiToName(x, flats))).join(' + ')}
                    >
                      <span className="ve-chord">{it.chord ?? ''}</span>
                      <span className={`ve-glyphs ${it.sounds.length > 1 ? 'stack' : ''}`}>
                        {it.sounds.length ? it.sounds.map((s, k) => <Glyph key={k} sound={s} flats={flats} />) : <span className="rest-glyph">𝄽</span>}
                      </span>
                      {showNames && it.sounds.length > 0 && <span className="ve-name">{midis.map((x) => (x === null ? '?' : midiToName(x, flats))).join(' ')}</span>}
                      <span className="ve-lyric">{it.lyric ?? ''}</span>
                      {it.dur > EPS && <span className="ve-resize" title="Drag to change the length" />}
                      {resizeDur && samePos(resizeDur.pos, pos) && <span className="ve-resize-ghost" style={{ width: dur * zoom - 3 }} />}
                    </div>
                  );
                })}
                {ve.caret.m === mi && <span className="ve-caret" style={{ left: ve.caret.start * zoom }} />}
                {ghost && ghost.m === mi && <span className={`ve-ghost ${ghost.copy ? 'copy' : ''}`} style={{ left: ghost.start * zoom, width: Math.max(ghost.dur * zoom, 22) - 3 }} />}
              </div>
            </div>,
          ];
        })}
        <button
          className="ve-add-measure"
          onClick={() => apply(insertMeasure(song, song.measures.length), { caret: { m: song.measures.length, start: 0 }, measure: song.measures.length })}
          title="Add a measure"
        >
          +
        </button>
      </div>
      {ve.caret.m >= song.measures.length && <p className="muted small">The caret is after the last measure — adding a note there creates a new measure.</p>}
      <div className="ve-legend muted small">
        Click a slot to place the caret · double-click to add a note · drag notes to move them (Alt = copy) · drag a note's right edge to change its length ·
        ←/→ select · ↑/↓ next note (Shift: by semitone, incl. bends) · Z X C V B lengths · N dotted · M triplet · / rest · Del delete · Ctrl+C/V copy/paste
      </div>
    </div>
  );
}

