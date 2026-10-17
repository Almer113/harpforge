// Phase 17b: find and replace holes (Ctrl+H) — a bar under the editor's toolbar, so the music
// stays in view: what's found is outlined, ‹ › go through it, Replace / Replace all change it.

import { useEffect, useMemo, useRef } from 'react';
import { soundPitch } from '../../core/instruments';
import { holeSoundText } from '../../core/htab/serializer';
import { flatsFor } from '../../core/edit/splice';
import { chainAt, findItem, fromDoc, realBeat, samePos, type Pos, type Song } from '../../core/edit/model';
import { offHarp } from '../../core/edit/notes';
import { findHoles, parseHole, replaceHoles, sameHole, type FindScope, type Found } from '../../core/edit/replace';
import { label, sectionAt, sectionRanges } from '../../core/edit/sections';
import { midiToName } from '../../core/pitch';
import { commitSong } from '../../state/editor';
import { getParsed, useApp, type FindState } from '../../state/store';

/** Opens the bar (or, open already, puts the cursor in its Find box). */
export function openFind() {
  const st = useApp.getState();
  if (st.ve.find) {
    document.querySelector<HTMLInputElement>('.find-bar input[name="find"]')?.select();
    return;
  }
  const song = fromDoc(getParsed(st.text).doc);
  const sel = st.ve.selection;
  const at = sel[0]?.m ?? st.ve.caret.m;
  const k = sectionAt(song, Math.min(at, song.measures.length - 1));
  const r = sectionRanges(song)[k];
  // One note selected (all of it, if it's tied over): its hole to start with.
  const chain = sel.length ? chainAt(song, sel[0]) : [];
  const single = sel.length > 0 && (sel.length === 1 || (chain.length === sel.length && sel.every((p) => chain.some((c) => samePos(c, p)))));
  const one = single ? findItem(song, chain[0] ?? sel[0]) : undefined;
  const query = one?.sounds.length === 1 && one.sounds[0].type === 'hole' ? holeSoundText(one.sounds[0]) : lastQuery;
  const several = sel.length > 1 && !single;
  st.setVe({
    find: { query, by: lastBy, chords: lastChords, scope: several ? 'selection' : 'song', section: [r.from, r.to], sectionNo: k, sectionName: r.name, notes: several ? sel : [] },
  });
}
// (What was asked last, for the next time the bar opens.)
let lastQuery = '';
let lastBy = '';
let lastChords = false;

export function closeFind() {
  useApp.getState().setVe({ find: undefined });
}

/**
 * The section the bar looks in: the one it started in, found by its name (and, of parts with
 * the same name, its place) — bars added before it, or the parts moved, don't change which.
 */
function sectionOf(song: Song, f: FindState) {
  const ranges = sectionRanges(song);
  if (f.sectionNo !== undefined) {
    const same = ranges.map((r, k) => ({ r, k })).filter((x) => x.r.name === f.sectionName);
    const hit = same.find((x) => x.k === f.sectionNo) ?? (same.length === 1 ? same[0] : undefined);
    if (hit) return hit.r;
  }
  return ranges[sectionAt(song, Math.min(f.section[0], song.measures.length - 1))];
}
const scopeOf = (song: Song, f: FindState): FindScope => {
  if (f.scope === 'section') {
    const r = sectionOf(song, f);
    return { kind: 'bars', from: r.from, to: r.to };
  }
  return f.scope === 'selection' ? { kind: 'notes', at: f.notes } : { kind: 'song' };
};

/** What the bar finds in `song` now (none while it's closed or the box isn't a hole). */
export function findNow(song: Song, f: FindState | undefined): Found[] {
  if (!f) return [];
  const hole = parseHole(f.query);
  return hole ? findHoles(song, hole, { chords: f.chords, scope: scopeOf(song, f) }) : [];
}

/** Every note the bar has found (all parts of tied ones), for outlining them. */
export function useFound(song: Song): Pos[] {
  const f = useApp((s) => s.ve.find);
  return useMemo(() => findNow(song, f).flatMap((x) => x.chain), [song, f]);
}

/** Selects a found note (all of it) and brings it into view. */
function show(x: Found) {
  useApp.getState().setVe({ selection: x.chain, anchor: x.at, caret: x.at, measure: x.at.m });
  requestAnimationFrame(() => document.querySelector('.ve-item.selected')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
}

/** The found note selected now, if one is (all of it, in whatever order it was selected). */
function currentOf(found: Found[], sel: Pos[]): number {
  return found.findIndex((x) => x.chain.length === sel.length && x.chain.every((p) => sel.some((q) => samePos(p, q))));
}

export function FindBar() {
  const f = useApp((s) => s.ve.find);
  const text = useApp((s) => s.text);
  const sel = useApp((s) => s.ve.selection);
  const caret = useApp((s) => s.ve.caret);
  const box = useRef<HTMLInputElement>(null);
  const open = !!f;
  useEffect(() => {
    if (open) box.current?.select();
  }, [open]);
  // (Worked out again when the song or the boxes change, not on every caret move.)
  const parsed = getParsed(text);
  const song = useMemo(() => fromDoc(parsed.doc), [parsed]);
  const found = useMemo(() => findNow(song, f), [song, f]);
  if (!f) return null;

  const harp = parsed.harp;
  const set = (patch: Partial<FindState>) => {
    const next = { ...f, ...patch };
    // (Kept for the next time the bar opens, whichever way it's closed.)
    [lastQuery, lastBy, lastChords] = [next.query, next.by, next.chords];
    useApp.getState().setVe({ find: next });
  };
  const hole = parseHole(f.query);
  const by = parseHole(f.by);
  const current = currentOf(found, sel);
  const sectionName = label(sectionOf(song, f));
  const where = f.scope === 'section' ? ` in ${sectionName}` : f.scope === 'selection' ? ' in the selection' : '';
  const asNotes = !song.measures.some((m) => m.items.some((it) => it.sounds.some((s) => s.type === 'hole'))) && song.measures.some((m) => m.items.some((it) => it.sounds.length));

  // What the boxes say, and whether the change keeps the tune.
  const flats = flatsFor(text, parsed.doc.meta.key ?? harp.spec.key);
  const name = (h: NonNullable<typeof hole>) => {
    const midi = soundPitch(harp, h);
    return midi === null ? null : midiToName(midi, flats);
  };
  let status: string;
  if (asNotes) status = 'This tab is written as notes: there are no holes to find';
  else if (!f.query.trim()) status = 'Type a hole: -4, 6’, -3’’, 6o';
  else if (!hole) status = 'Not a hole (one hole, as the tab writes it: -4, 6’, -3’’, 6o)';
  else if (!found.length) status = `No ${f.query.trim()}${where}`;
  else status = `${current >= 0 ? `${current + 1} of ` : ''}${found.length} found${where}`;
  let change = '';
  let canReplace = !!hole && found.length > 0;
  if (hole && f.by.trim()) {
    if (!by) {
      change = 'Replace with: one hole';
      canReplace = false;
    } else if (sameHole(by, hole)) {
      change = 'that’s the same hole';
      canReplace = false;
    } else if (offHarp(harp, by)) {
      change = `${f.by.trim()} isn’t on this harmonica`;
      canReplace = false;
    } else {
      const [a, b] = [name(hole), name(by)];
      change = a === b ? `same note (${a})` : `a different note: ${a ?? '?'} → ${b}`;
    }
  } else canReplace = false;

  const step = (dir: 1 | -1) => {
    if (!found.length) return;
    let k: number;
    if (current >= 0) k = (current + dir + found.length) % found.length;
    else {
      // From the caret: the next one after it (or the last one before it).
      const at = realBeat(song, caret);
      const after = found.findIndex((x) => realBeat(song, x.at) >= at - 1e-6);
      k = dir > 0 ? (after < 0 ? 0 : after) : (after <= 0 ? found.length : after) - 1;
    }
    show(found[k]);
  };
  const replaceOne = () => {
    if (!hole || !by || !canReplace) return;
    if (current < 0) return step(1);
    const r = replaceHoles(song, [found[current]], hole, by);
    if (!r.replaced) {
      useApp.getState().notify('That chord would mix blow and draw (or hold a hole twice): left as it is');
      return step(1);
    }
    commitSong(r.song);
    // On to the next one (the one replaced is found no more).
    const was = realBeat(song, found[current].at);
    const rest = findNow(r.song, f);
    const next = rest.find((x) => realBeat(r.song, x.at) > was + 1e-6) ?? rest[0];
    if (next) show(next);
  };
  const replaceAll = () => {
    if (!hole || !by || !canReplace) return;
    const r = replaceHoles(song, found, hole, by);
    if (!r.replaced) {
      useApp.getState().notify('Nothing replaced: those chords would mix blow and draw (or hold a hole twice)');
      return;
    }
    const before = useApp.getState().text;
    commitSong(r.song);
    const after = useApp.getState().text;
    // (Nothing changed: nothing to say, and no Undo that would take back something else.)
    if (after === before) return;
    const skipped = r.skipped ? `; ${r.skipped} chord${r.skipped === 1 ? '' : 's'} left as ${r.skipped === 1 ? 'it was' : 'they were'} (blow and draw would mix)` : '';
    useApp.getState().notify(`Replaced ${r.replaced} × ${f.query.trim()} with ${f.by.trim()}${where}${skipped}`, {
      label: 'Undo',
      run: () => {
        if (useApp.getState().text === after) useApp.getState().undo();
        else useApp.getState().notify('There were changes after that: Ctrl+Z steps back through them');
      },
    });
  };
  // (Only Enter and Esc are the bar's: Ctrl+S, Ctrl+H and the rest still reach the app.)
  const keys = (e: React.KeyboardEvent, enter: () => void) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) step(-1);
      else enter();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeFind();
    }
  };

  return (
    <div className="find-bar" role="search" aria-label="Find and replace holes">
      <label className="find-field">
        <span>Find</span>
        <input ref={box} name="find" value={f.query} size={6} spellCheck={false} autoComplete="off" onChange={(e) => set({ query: e.target.value })} onKeyDown={(e) => keys(e, () => step(1))} title="A hole as the tab writes it: -4, 6', -3'', 6o (Enter: next, Shift+Enter: previous)" />
      </label>
      <label className="find-field">
        <span>Replace with</span>
        <input name="by" value={f.by} size={6} spellCheck={false} autoComplete="off" onChange={(e) => set({ by: e.target.value })} onKeyDown={(e) => keys(e, replaceOne)} title="The hole to put in its place (Enter: replace this one and go to the next)" />
      </label>
      <label className="check find-chords" title="Also the hole inside harmonica chords like (4 5 6). A chord that would mix blow and draw is left as it is.">
        <input type="checkbox" checked={f.chords} onChange={(e) => set({ chords: e.target.checked })} /> in chords too
      </label>
      <div className="seg find-scope" role="radiogroup" aria-label="Where">
        {(['song', 'section', 'selection'] as const).map((s) => (
          <button key={s} role="radio" aria-checked={f.scope === s} className={f.scope === s ? 'on' : ''} disabled={s === 'selection' && !f.notes.length} onClick={() => set({ scope: s })} title={s === 'selection' ? (f.notes.length ? 'The notes selected when this bar opened' : 'Select notes first (then Ctrl+H)') : undefined}>
            {s === 'song' ? 'Song' : s === 'section' ? sectionName.replace(/[“”]/g, '') : 'Selection'}
          </button>
        ))}
      </div>
      <span className="find-status" role="status">
        {status}
        {change && <span className={`find-change ${change.startsWith('same') ? 'same' : ''}`}> · {change}</span>}
      </span>
      <span className="find-actions">
        <button className="icon-btn" onClick={() => step(-1)} disabled={!found.length} title="Previous (Shift+Enter)" aria-label="Previous">‹</button>
        <button className="icon-btn" onClick={() => step(1)} disabled={!found.length} title="Next (Enter)" aria-label="Next">›</button>
        <button className="btn small" onClick={replaceOne} disabled={!canReplace} title="Replace the selected one and go to the next">Replace</button>
        <button className="btn small" onClick={replaceAll} disabled={!canReplace} title="Replace every one found (one undo)">Replace all</button>
        <button className="icon-btn" onClick={closeFind} title="Close (Esc)" aria-label="Close find and replace">✕</button>
      </span>
    </div>
  );
}
