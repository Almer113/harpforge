import { lazy, Suspense } from 'react';
import { Popover } from './Popover';
import type { NoteEvent, RestEvent } from '../core/htab/types';
import { useApp, type Parsed, type ReadAs, type SheetShow } from '../state/store';
import { doPitchClass } from '../core/formats/jianpu';
import { pitchClassName, keyUsesFlats } from '../core/pitch';
import { SimpleTabView } from './SimpleTabView';
import { TabView } from './TabView';

// Sheet music pulls in abcjs; load it only when the staff view is opened.
const StaffView = lazy(() => import('./StaffView').then((m) => ({ default: m.StaffView })));

/** The song sheet with a Tab / Staff switch. */
export function Sheet({
  parsed,
  onSelect,
  title = 'Tab',
}: {
  parsed: Parsed;
  onSelect: (scoreIndex: number, ev?: NoteEvent | RestEvent) => void;
  title?: string;
}) {
  const activeEvents = useApp((s) => s.activeEvents);
  const selectedEvent = useApp((s) => s.selectedEvent);
  const showNoteNames = useApp((s) => s.showNoteNames);
  const view = useApp((s) => s.sheetView);
  const show = useApp((s) => s.sheetShow);
  const readAs = useApp((s) => s.readAs);
  const notes = readAs === 'notes';
  // "Do" of the key: the song key's relative major, else the harmonica's key.
  const doName = pitchClassName(doPitchClass(parsed.doc.meta.key ?? parsed.harp.spec.key.replace(/^(Low|High)\s+/i, '')), keyUsesFlats(parsed.doc.meta.key ?? parsed.harp.spec.key));

  const eventAt = (i: number) => {
    const sev = parsed.score.events[i];
    const ev = sev ? parsed.doc.lines[sev.line]?.events[sev.eventIndex] : undefined;
    return ev && ev.kind !== 'bar' ? ev : undefined;
  };

  return (
    <div className="sheet">
      <div className="sheet-head">
        <h2>
          {view === 'numbers' ? 'Numbered notation' : view === 'staff' ? 'Staff notation' : notes ? (view === 'simple' ? 'Simple notes' : 'Notes') : view === 'simple' ? 'Simple tab' : title}
          {view === 'numbers' && <span className="chip plain jp-key">1={doName}</span>}
        </h2>
        <div className="tb-group">
          {view !== 'simple' && <ShowMenu view={view} />}
          {(view === 'tab' || view === 'simple') && <ReadAsSwitch />}
          <div className="seg" role="tablist" aria-label="Sheet view">
            <button
              role="tab"
              aria-selected={view === 'simple'}
              className={view === 'simple' ? 'on' : ''}
              onClick={() => useApp.setState({ sheetView: 'simple' })}
              title="Just the holes, all the same size"
            >
              Simple Tab
            </button>
            <button role="tab" aria-selected={view === 'tab'} className={view === 'tab' ? 'on' : ''} onClick={() => useApp.setState({ sheetView: 'tab' })}>
              Tab
            </button>
            <button
              role="tab"
              aria-selected={view === 'staff'}
              className={view === 'staff' ? 'on' : ''}
              onClick={() => useApp.setState({ sheetView: 'staff' })}
              title="Standard notation, with the holes underneath"
            >
              Staff
            </button>
            <button
              role="tab"
              aria-selected={view === 'numbers'}
              className={view === 'numbers' ? 'on' : ''}
              onClick={() => useApp.setState({ sheetView: 'numbers' })}
              title="Numbered notation (jianpu): 1 = do of the key"
            >
              Numbers
            </button>
          </div>
        </div>
      </div>
      {view === 'simple' ? (
        <SimpleTabView parsed={parsed} activeEvents={activeEvents} selectedEvent={selectedEvent} onSelect={onSelect} readAs={readAs} />
      ) : view !== 'staff' ? (
        <TabView
          parsed={parsed}
          activeEvents={activeEvents}
          selectedEvent={selectedEvent}
          showNoteNames={view === 'numbers' ? show.numbers.holes : notes ? show.tab.holes : showNoteNames}
          showLyrics={view === 'numbers' ? show.numbers.lyrics : show.tab.lyrics}
          showChords={view === 'numbers' ? show.numbers.chords : show.tab.chords}
          onCardClick={onSelect}
          notation={view === 'numbers' ? 'numbers' : 'holes'}
          readAs={readAs}
        />
      ) : (
        <Suspense fallback={<p className="muted">Loading sheet music…</p>}>
          <StaffView parsed={parsed} activeEvents={activeEvents} selectedEvent={selectedEvent} onNoteClick={(i) => onSelect(i, eventAt(i))} show={show.staff} />
        </Suspense>
      )}
    </div>
  );
}

/** Holes | Notes: whether the tab reads as holes (4 -4) or as notes (C5 D5). Remembered. */
export function ReadAsSwitch({ className = '' }: { className?: string }) {
  const readAs = useApp((s) => s.readAs);
  const opt = (id: ReadAs, label: string, title: string) => (
    <button role="radio" aria-checked={readAs === id} className={readAs === id ? 'on' : ''} onClick={() => useApp.setState({ readAs: id })} title={title}>
      {label}
    </button>
  );
  return (
    <div className={`seg read-as ${className}`} role="radiogroup" aria-label="Read as">
      {opt('holes', 'Holes', 'Read the tab as holes: 4 -4 5')}
      {opt('notes', 'Notes', 'Read the tab as notes: C5 D5 E5, with the holes small underneath')}
    </div>
  );
}

/** "Show ▾": what the Tab or Numbers view shows besides the notes. */
export function ShowMenu({ view }: { view: 'tab' | 'numbers' | 'staff' }) {
  const show = useApp((s) => s.sheetShow);
  const names = useApp((s) => s.showNoteNames);
  const notes = useApp((s) => s.readAs === 'notes');
  const set = (patch: Partial<SheetShow['tab']> & Partial<SheetShow['numbers']> & Partial<SheetShow['staff']>) =>
    useApp.setState((s) => ({ sheetShow: { ...s.sheetShow, [view]: { ...s.sheetShow[view], ...patch } } }));
  const items: { label: string; on: boolean; toggle: (v: boolean) => void; hint: string }[] =
    view === 'tab'
      ? [
          notes
            ? { label: 'Holes', on: show.tab.holes, toggle: (v) => set({ holes: v }), hint: '4, -4… under each note' }
            : { label: 'Note names', on: names, toggle: (v) => useApp.setState({ showNoteNames: v }), hint: 'C5, E5… under each hole' },
          { label: 'Lyrics', on: show.tab.lyrics, toggle: (v) => set({ lyrics: v }), hint: 'The words under the notes' },
          { label: 'Chords', on: show.tab.chords, toggle: (v) => set({ chords: v }), hint: 'Chord symbols above the notes' },
        ]
      : view === 'numbers'
        ? [
            { label: 'Holes', on: show.numbers.holes, toggle: (v) => set({ holes: v }), hint: 'The tab under each number' },
            { label: 'Lyrics', on: show.numbers.lyrics, toggle: (v) => set({ lyrics: v }), hint: 'The words under the notes' },
            { label: 'Chords', on: show.numbers.chords, toggle: (v) => set({ chords: v }), hint: 'Chord symbols above the notes' },
          ]
        : [
            { label: 'Holes', on: show.staff.holes, toggle: (v) => set({ holes: v }), hint: 'The tab under the staff' },
            { label: 'Lyrics', on: show.staff.lyrics, toggle: (v) => set({ lyrics: v }), hint: 'The words under the staff' },
            { label: 'Chords', on: show.staff.chords, toggle: (v) => set({ chords: v }), hint: 'Chord symbols above the staff' },
            { label: 'Title and tempo', on: show.staff.header, toggle: (v) => set({ header: v }), hint: 'The song’s heading on the staff' },
          ];
  // The staff's title is off by default, so it doesn't count as "hidden".
  const hidden = items.filter((i) => !i.on && i.label !== 'Title and tempo').length;

  return (
    <Popover label={`Show${hidden ? ` (${hidden} hidden)` : ''} ▾`} title="Choose what this view shows" kind="panel" panelClass="menu show-menu" wrapClass="show-wrap" panelLabel="Show">
      {items.map((it) => (
        <label key={it.label} className="show-item">
          <input type="checkbox" checked={it.on} onChange={(e) => it.toggle(e.target.checked)} />
          <span>
            <b>{it.label}</b>
            <span className="mi-hint">{it.hint}</span>
          </span>
        </label>
      ))}
    </Popover>
  );
}
