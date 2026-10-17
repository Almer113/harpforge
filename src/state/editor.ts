// Glue between the visual editor's measure model and the .htab text.

import { fromDoc, type Song } from '../core/edit/model';
import { retabNotes } from '../core/edit/retab';
import { keptMessage, spliceBody, type SpliceReport } from '../core/edit/splice';
import { transposeChord } from '../core/chords';
import { keyUsesFlats, transposeKey } from '../core/pitch';
import { setMetaFields } from '../core/htab/meta';
import { parseHtab, splitHeader } from '../core/htab/parser';
import { allOptions, canOver, maxBend, soundPitch, type Harmonica } from '../core/instruments';
import type { HoleSound, Sound } from '../core/types';
import { getParsed, useApp, type VisualState } from './store';

export function currentSong(): Song {
  return fromDoc(getParsed(useApp.getState().text).doc);
}

/** The current text with its body replaced by `song` (the header is kept as written). */
export function songText(song: Song, report?: SpliceReport): string {
  const current = useApp.getState().text;
  // Lines the edit didn't touch keep their own text, comments and blank lines.
  let text = current.slice(0, splitHeader(current).bodyStart) + spliceBody(current, song, report) + '\n';
  if (song.meta.time !== getParsed(current).doc.meta.time) text = setMetaFields(text, { time: song.meta.time });
  // (Line endings as the text had them.)
  if (current.includes('\r\n')) text = text.replace(/\r?\n/g, '\r\n');
  return text;
}

/**
 * Transposes (shift ≠ 0) or makes easier (shift 0) the selected notes, or the whole song
 * when nothing is selected. A whole song moved by a semitone takes its key and chord
 * symbols along. Says what happened.
 */
export function retabSelection(shift: number) {
  const st = useApp.getState();
  const parsed = getParsed(st.text);
  const song = fromDoc(parsed.doc);
  const sel = st.ve.selection;
  const r = retabNotes(song, parsed.harp, sel, shift);
  let out = r.song;
  const whole = !sel.length;
  if (whole && shift % 12 !== 0) {
    const key = song.meta.key ? transposeKey(song.meta.key, shift) : undefined;
    const flats = keyUsesFlats(key ?? parsed.harp.spec.key);
    out = { ...out, meta: { ...out.meta, key: key ?? out.meta.key }, measures: out.measures.map((m) => ({ ...m, items: m.items.map((it) => (it.chord ? { ...it, chord: transposeChord(it.chord, shift, flats) } : it)) })) };
  }
  if (!r.changed && out === r.song) {
    st.notify(shift ? 'Nothing to move.' : 'Already the easiest way to play these notes.');
    return;
  }
  const report: SpliceReport = { kept: [] };
  let text = songText(out, report);
  if (whole && shift % 12 !== 0 && out.meta.key && out.meta.key !== song.meta.key) text = setMetaFields(text, { key: out.meta.key });
  st.setText(text);
  const what = whole ? 'the song' : `${sel.length} note${sel.length === 1 ? '' : 's'}`;
  const tech = (t: { bends: number; overblows: number }) => `${t.bends} bend${t.bends === 1 ? '' : 's'}${t.overblows ? `, ${t.overblows} overblow${t.overblows === 1 ? '' : 's'}` : ''}`;
  const lost = r.unplayable ? ` — ${r.unplayable} note${r.unplayable === 1 ? '' : 's'} don't fit this harp (kept as note names or as written)` : '';
  const kept = keptMessage(report);
  const also = kept ? ` ${kept}` : '';
  if (shift === 0) st.notify(`Made ${what} easier: ${r.changed} note${r.changed === 1 ? '' : 's'} changed (${tech(r.before)} → ${tech(r.after)}).${also}`);
  else st.notify(`Moved ${what} ${Math.abs(shift) === 12 ? 'an octave' : `${Math.abs(shift)} semitone${Math.abs(shift) === 1 ? '' : 's'}`} ${shift > 0 ? 'up' : 'down'}${lost}.${also}`);
}

/** The length a new note (or rest block) gets: the length tool, dotted or triplet. */
export function toolDuration(ve: VisualState): number {
  return ve.dur * (ve.dotted ? 1.5 : 1) * (ve.triplet ? 2 / 3 : 1);
}

/** Writes a song back into the text as one undo step ('typing' groups keystrokes). */
export function commitSong(song: Song, kind: 'edit' | 'typing' | `typing:${string}` = 'edit') {
  const report: SpliceReport = { kept: [] };
  useApp.getState().setText(songText(song, report), { kind });
  const kept = keptMessage(report);
  if (kept) useApp.getState().notify(kept);
}

/** Parses what's typed in the inspector: "-4'", "(4 5 6)", "-(1 2 3)" or a pitch like "C5". */
export function parseSoundsInput(input: string): Sound[] | null {
  const { doc, issues } = parseHtab(input.trim());
  if (issues.some((i) => i.severity === 'error')) return null;
  for (const l of doc.lines) for (const e of l.events) if (e.kind === 'note') return e.sounds;
  return null;
}

/**
 * The next note up or down, played the easiest way. By default only notes that need
 * no bend or overblow; `chromatic` steps by semitone (bends included).
 */
export function stepPitch(harp: Harmonica, sounds: Sound[], dir: 1 | -1, chromatic = false): Sound[] | null {
  const options = allOptions(harp).filter((o) => chromatic || (o.sound.bend === 0 && !o.sound.over));
  const out: Sound[] = [];
  for (const s of sounds) {
    const midi = s.type === 'pitch' ? s.midi : soundPitch(harp, s);
    if (midi === null) return null;
    let best: { sound: HoleSound; midi: number; cost: number } | null = null;
    for (const o of options) {
      if (dir > 0 ? o.midi <= midi : o.midi >= midi) continue;
      if (!best || (dir > 0 ? o.midi < best.midi : o.midi > best.midi) || (o.midi === best.midi && o.cost < best.cost)) best = o;
    }
    if (!best) return null;
    out.push(best.sound);
  }
  return out;
}

/** Applies a change to every hole sound, keeping only playable results. */
export function mapHoles(harp: Harmonica, sounds: Sound[], fn: (s: HoleSound) => HoleSound): Sound[] {
  return sounds.map((s) => {
    if (s.type !== 'hole') return s;
    let next = fn(s);
    if (next.bend > maxBend(harp, next.hole, next.breath)) next = { ...next, bend: 0 };
    if (next.over && !canOver(harp, next.hole, next.breath)) next = { ...next, over: false };
    if (next.slide && !harp.hasSlide) next = { ...next, slide: false };
    return soundPitch(harp, next) === null ? s : next;
  });
}

export const DURATIONS: { beats: number; name: string; symbol: string; key: string }[] = [
  { beats: 4, name: 'Whole', symbol: '𝅝', key: 'B' },
  { beats: 2, name: 'Half', symbol: '𝅗𝅥', key: 'V' },
  { beats: 1, name: 'Quarter', symbol: '♩', key: 'C' },
  { beats: 0.5, name: 'Eighth', symbol: '♪', key: 'X' },
  { beats: 0.25, name: 'Sixteenth', symbol: '𝅘𝅥𝅯', key: 'Z' },
];

/** Splits a duration into base value, dotted and triplet (for highlighting the palette). */
export function describeDuration(beats: number): { base: number | null; dotted: boolean; triplet: boolean } {
  for (const d of DURATIONS) {
    if (Math.abs(beats - d.beats) < 1e-6) return { base: d.beats, dotted: false, triplet: false };
    if (Math.abs(beats - d.beats * 1.5) < 1e-6) return { base: d.beats, dotted: true, triplet: false };
    if (Math.abs(beats - (d.beats * 2) / 3) < 1e-6) return { base: d.beats, dotted: false, triplet: true };
  }
  return { base: null, dotted: false, triplet: false };
}

export function durationLabel(beats: number): string {
  const d = describeDuration(beats);
  const base = DURATIONS.find((x) => x.beats === d.base);
  if (!base) return `${+beats.toFixed(3)} beats`;
  return `${d.dotted ? 'Dotted ' : ''}${base.name.toLowerCase()}${d.triplet ? ' (triplet)' : ''}`;
}
