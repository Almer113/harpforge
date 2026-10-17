// Phase 17b: find and replace holes (Ctrl+H) — a bar under the editor's toolbar, so the music
// stays in view: what's found is outlined, ‹ › go through it, Replace / Replace all change it.

import { useEffect, useMemo, useRef } from 'react';
import { soundPitch } from '../../core/instruments';
import { holeSoundText } from '../../core/htab/serializer';
import { flatsFor } from '../../core/edit/splice';
import { fromDoc, realBeat, samePos, type Pos, type Song } from '../../core/edit/model';
import { offHarp } from '../../core/edit/notes';
import { findHoles, parseHole, replaceHoles, type FindScope, type Found } from '../../core/edit/replace';
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
  const r = sectionRanges(song)[sectionAt(song, Math.min(at, song.measures.length - 1))];
  // A note selected: its hole to start with.
  const one = sel.length ? song.measures[sel[0].m]?.items.find((it) => samePos({ m: sel[0].m, start: it.start }, sel[0])) : undefined;
  const query = one?.sounds.length === 1 && one.sounds[0].type === 'hole' ? holeSoundText(one.sounds[0]) : (st.ve.find === undefined ? lastQuery : '');
  st.setVe({
    find: { query, by: lastBy, chords: lastChords, scope: sel.length > 1 ? 'selection' : 'song', section: [r.from, r.to], notes: sel.length > 1 ? sel : [] },
  });
}
// (What was asked last, for the next time the bar opens.)
let lastQuery = '';
let lastBy = '';
let lastChords = false;

export function closeFind() {
  const f = useApp.getState().ve.find;
  if (f) [lastQuery, lastBy, lastChords] = [f.query, f.by, f.chords];
  useApp.getState().setVe({ find: undefined });
}

const scopeOf = (f: FindState): FindScope => (f.scope === 'section' ? { kind: 'bars', from: f.section[0], to: f.section[1] } : f.scope === 'selection' ? { kind: 'notes', at: f.notes } : { kind: 'song' });

/** What the bar finds in `song` now (none while it's closed or the box isn't a hole). */
export function findNow(song: Song, f: FindState | undefined): Found[] {
  if (!f) return [];
  const hole = parseHole(f.query);
  return hole ? findHoles(song, hole, { chords: f.chords, scope: scopeOf(f) }) : [];
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

/** The found note selected now, if one is. */
function currentOf(found: Found[], sel: Pos[]): number {
  return found.findIndex((x) => x.chain.length === sel.length && x.chain.every((p, i) => samePos(p, sel[i])));
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
  if (!f) return null;

  const parsed = getParsed(text);
  const song = fromDoc(parsed.doc);
  const harp = parsed.harp;
  const set = (patch: Partial<FindState>) => useApp.getState().setVe({ find: { ...f, ...patch } });
  const hole = parseHole(f.query);
  const by = parseHole(f.by);
  const found = findNow(song, f);
  const current = currentOf(found, sel);
  const sectionName = label(sectionRanges(song).find((r) => r.from === f.section[0]) ?? { from: 0, to: 0 });
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
    commitSong(r.song);
    const after = useApp.getState().text;
    const skipped = r.skipped ? `; ${r.skipped} chord${r.skipped === 1 ? '' : 's'} left as ${r.skipped === 1 ? 'it was' : 'they were'} (blow and draw would mix)` : '';
    useApp.getState().notify(`Replaced ${r.replaced} × ${f.query.trim()} with ${f.by.trim()}${where}${skipped}`, {
      label: 'Undo',
      run: () => {
        if (useApp.getState().text === after) useApp.getState().undo();
        else useApp.getState().notify('There were changes after that: Ctrl+Z steps back through them');
      },
    });
  };
  const keys = (e: React.KeyboardEvent, enter: () => void) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) step(-1);
      else enter();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeFind();
    }
    e.stopPropagation();
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
