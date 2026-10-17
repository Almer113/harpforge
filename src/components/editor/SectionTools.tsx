// Phase 17a: section tools in the visual editor — a section's heading opens its menu
// ("CHORUS ▾"), and ⋯ More tools has the same for the section at the caret. Each is one undo.

import { useEffect, useRef, useState } from 'react';
import { fromDoc, type Pos, type Song } from '../../core/edit/model';
import {
  canMove,
  canRepeat,
  deleteSection,
  duplicateSection,
  label,
  makeSection,
  moveSection,
  newSectionAfter,
  removeHeading,
  renameSection,
  repeatSection,
  sectionAt,
  sectionPositions,
  sectionRanges,
  sectionRepeat,
  sectionText,
  type SectionEdit,
} from '../../core/edit/sections';
import { songText } from '../../state/editor';
import { useDraft } from '../../state/leaveGuard';
import { endPassageLoop, toggleLoop } from '../../state/playback';
import { getParsed, useApp } from '../../state/store';
import { Popover } from '../Popover';

const songNow = (): Song => fromDoc(getParsed(useApp.getState().text).doc);

/** Writes a section change: the text's own blocks of lines when they fit, else as any edit. */
function commit(edit: SectionEdit | Song, caretAt?: number) {
  const e = 'song' in edit ? edit : { song: edit };
  const st = useApp.getState();
  const text = sectionText(st.text, e) ?? songText(e.song);
  st.setText(text, { kind: 'edit' });
  if (caretAt !== undefined) {
    const m = Math.max(0, Math.min(caretAt, e.song.measures.length - 1));
    st.setVe({ selection: [], anchor: undefined, caret: { m, start: 0 }, measure: m });
  }
  if ('note' in e && e.note) st.notify(e.note);
  return text;
}

/** Part k of the song now, moved up (-1) or down (1); the caret and the selection go with it. */
export function moveSectionAt(k: number, dir: -1 | 1): boolean {
  const song = songNow();
  const edit = moveSection(song, k, dir);
  if (!edit) return false;
  const r = sectionRanges(song);
  const self = r[k];
  const other = r[k + dir];
  // The two parts swap places: each one's bars shift by the other's length.
  const shift = (m: number) => (m >= self.from && m < self.to ? m + dir * (other.to - other.from) : m >= other.from && m < other.to ? m - dir * (self.to - self.from) : m);
  const ve = useApp.getState().ve;
  commit(edit);
  useApp.getState().setVe({
    selection: ve.selection.map((p) => ({ ...p, m: shift(p.m) })),
    anchor: ve.anchor && { ...ve.anchor, m: shift(ve.anchor.m) },
    caret: { ...ve.caret, m: shift(ve.caret.m) },
    measure: shift(ve.measure),
  });
  return true;
}

/** The part with the caret (or the selection's first note) in it. */
export function sectionAtCaret(song: Song): number {
  const ve = useApp.getState().ve;
  return sectionAt(song, ve.selection[0]?.m ?? ve.caret.m);
}

interface Action {
  name: string;
  hint?: string;
  key?: string;
  disabled?: boolean;
  danger?: boolean;
  run: () => void;
}

/** What can be done to part k (and, from ⋯, to the selection). */
function actions(song: Song, k: number, sel: Pos[]): { items: Action[]; repeat: { times: number | null; can: boolean } } {
  const r = sectionRanges(song)[k];
  const named = r.name !== undefined;
  const bars = r.to - r.from;
  const blocked = (dir: -1 | 1) => (!canMove(song, k, dir) && dir < 0 && k === 1 && sectionRanges(song)[0].name === undefined ? 'The bars before the first heading stay at the top: name them to move things above them' : undefined);
  const items: Action[] = [];
  if (named) items.push({ name: 'Rename…', run: () => useApp.getState().setVe({ naming: r.from }) });
  else items.push({ name: 'Name this part…', hint: 'The bars before the first heading: a heading makes them a section like the others', run: () => {
    commit(renameSection(songNow(), k, 'Intro'));
    useApp.getState().setVe({ naming: r.from });
  } });
  if (named) {
    items.push(
      { name: 'Duplicate', hint: 'A copy right after it', run: () => {
        const edit = duplicateSection(songNow(), k);
        if (edit) commit(edit, r.to);
      } },
      { name: 'Move up', key: 'Alt+↑', disabled: !canMove(song, k, -1), hint: blocked(-1), run: () => void moveSectionAt(k, -1) },
      { name: 'Move down', key: 'Alt+↓', disabled: !canMove(song, k, 1), run: () => void moveSectionAt(k, 1) },
    );
  }
  items.push(
    { name: 'Loop it', key: 'L ends it', run: () => {
      if (useApp.getState().loop) endPassageLoop();
      useApp.getState().setVe({ selection: sectionPositions(songNow(), k), anchor: undefined });
      toggleLoop();
    } },
    { name: 'Select its notes', run: () => useApp.getState().setVe({ selection: sectionPositions(songNow(), k), anchor: undefined }) },
  );
  if (named) {
    items.push(
      { name: 'Remove the heading', hint: 'Its bars join the part before it', run: () => commit(removeHeading(songNow(), k)) },
      { name: `Delete ${label(r)}`, hint: `Its ${bars} bar${bars === 1 ? '' : 's'}, with everything in them`, danger: true, run: () => deleteAt(k) },
    );
  }
  items.push({ name: '+ New section after it', run: () => {
    commit(newSectionAfter(songNow(), k, 'New section'), r.to);
    useApp.getState().setVe({ naming: r.to });
  } });
  if (sel.length) {
    const from = Math.min(...sel.map((p) => p.m));
    const to = Math.max(...sel.map((p) => p.m));
    items.push({ name: 'Make a section from the selection…', hint: `Bars ${from + 1}${to > from ? `–${to + 1}` : ''} under a heading of their own`, run: () => {
      commit(makeSection(songNow(), from, to, 'New section'), from);
      useApp.getState().setVe({ naming: from });
    } });
  }
  return { items, repeat: { times: sectionRepeat(song, k), can: canRepeat(song, k) } };
}

function deleteAt(k: number) {
  const song = songNow();
  const r = sectionRanges(song)[k];
  const edit = deleteSection(song, k);
  if (!edit) return;
  const after = commit(edit, r.from);
  const bars = r.to - r.from;
  useApp.getState().notify(`Deleted ${label(r)} (${bars} bar${bars === 1 ? '' : 's'})${edit.note ? `. ${edit.note}` : ''}`, {
    label: 'Undo',
    run: () => {
      // (Only while nothing else changed since: otherwise Ctrl+Z steps back through it.)
      if (useApp.getState().text === after) useApp.getState().undo();
      else useApp.getState().notify('There were changes after that: Ctrl+Z steps back through them');
    },
  });
}

/** The repeat choices: once, twice, 3 or 4 times through. */
function RepeatRow({ k, times, can, close }: { k: number; times: number | null; can: boolean; close: () => void }) {
  const pick = (n: number | null) => () => {
    close();
    commit(repeatSection(songNow(), k, n));
  };
  return (
    <div className="mi-row sec-repeat" role="group" aria-label="Repeat it" title={can ? 'Play it more than once: |: … :| around it' : 'It has repeats or endings of its own (or a repeat runs across it)'}>
      <span className="mi-name">Repeat it</span>
      {([null, 2, 3, 4] as const).map((n) => (
        <button key={String(n)} role="menuitemradio" aria-checked={times === n} className={`menu-item ${times === n ? 'checked' : ''}`} disabled={!can} onClick={pick(n)}>
          {n === null ? 'once' : `×${n}`}
        </button>
      ))}
    </div>
  );
}

function ActionItems({ items, close }: { items: Action[]; close: () => void }) {
  return items.map((a) => (
    <button
      key={a.name}
      role="menuitem"
      className={`menu-item ${a.danger ? 'danger' : ''}`}
      disabled={a.disabled}
      title={a.disabled ? a.hint : undefined}
      onClick={() => {
        close();
        a.run();
      }}
    >
      <span className="mi-name">
        {a.name} {a.key && <span className="mi-ext">{a.key}</span>}
      </span>
      {a.hint && !a.disabled && <span className="mi-hint">{a.hint}</span>}
    </button>
  ));
}

/** The menu's contents (the song read when it's open). */
function SectionMenu({ k, close, withSelection }: { k: number; close: () => void; withSelection?: boolean }) {
  const text = useApp((s) => s.text);
  const sel = useApp((s) => s.ve.selection);
  const song = fromDoc(getParsed(text).doc);
  if (!sectionRanges(song)[k]) return null;
  const { items, repeat } = actions(song, k, withSelection ? sel : []);
  // (Repeat sits after the moves, with the other changes to the music.)
  const at = items.findIndex((a) => a.name === 'Loop it');
  return (
    <>
      <ActionItems items={items.slice(0, at)} close={close} />
      <RepeatRow k={k} times={repeat.times} can={repeat.can} close={close} />
      <ActionItems items={items.slice(at)} close={close} />
    </>
  );
}

/** A section's heading over its first bar: its menu, or the box renaming it. */
export function SectionHeading({ m, name }: { m: number; name: string }) {
  const naming = useApp((s) => s.ve.naming === m);
  if (naming) return <NameBox m={m} name={name} />;
  return (
    <Popover label={<>{name || '(no name)'} <span aria-hidden>▾</span></>} buttonClass="ve-section" title="This section: rename, duplicate, move, repeat, loop, delete…" panelClass="menu sec-menu" panelLabel={`Section ${name}`}>
      {(close) => <SectionMenu k={sectionAt(songNow(), m)} close={close} />}
    </Popover>
  );
}

function NameBox({ m, name }: { m: number; name: string }) {
  const [value, setValue] = useState(name);
  const box = useRef<HTMLInputElement>(null);
  useDraft(value.trim() !== name);
  useEffect(() => box.current?.select(), []);
  const done = (keep: boolean) => {
    useApp.getState().setVe({ naming: undefined });
    const v = value.trim();
    if (keep && v && v !== name) {
      const song = songNow();
      commit(renameSection(song, sectionAt(song, m), v));
    }
  };
  return (
    <input
      ref={box}
      className="ve-section-name"
      value={value}
      aria-label="Section name"
      autoFocus
      size={Math.max(8, value.length + 1)}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') done(true);
        else if (e.key === 'Escape') done(false);
        e.stopPropagation();
      }}
      onBlur={() => done(true)}
    />
  );
}

/** ⋯ More tools → Section: the section at the caret (or the selection). */
export function SectionGroup({ close }: { close: () => void }) {
  const text = useApp((s) => s.text);
  const song = fromDoc(getParsed(text).doc);
  const k = sectionAtCaret(song);
  const r = sectionRanges(song)[k];
  return (
    <>
      <div className="mi-label">Section: {r.name !== undefined ? r.name || '(no name)' : 'the start (no heading)'}</div>
      <SectionMenu k={k} close={close} withSelection />
    </>
  );
}
