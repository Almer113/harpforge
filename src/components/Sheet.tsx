import { lazy, Suspense, useMemo, type ReactNode } from 'react';
import { shownVerses, songVerses } from '../core/verses';
import { Popover } from './Popover';
import { HolesIcon, NotesIcon } from './icons';
import type { NoteEvent, RestEvent } from '../core/htab/types';
import { useApp, useParsed, type Parsed, type ReadAs, type SheetShow, type SheetView } from '../state/store';
import { doPitchClass } from '../core/formats/jianpu';
import { pitchClassName, keyUsesFlats } from '../core/pitch';
import { LyricsView } from './LyricsView';
import { SimpleTabView } from './SimpleTabView';
import { TabView } from './TabView';
import { selectBar } from '../state/playback';

// Sheet music pulls in abcjs; load it only when the staff view is opened.
const StaffView = lazy(() => import('./StaffView').then((m) => ({ default: m.StaffView })));

/**
 * The song sheet with a Tab / Staff switch. `actions`: more buttons in its header. `bare`
 * (performance mode, whose bar has the switches): no header, no panel. `scale`: how big.
 */
export function Sheet({
  parsed,
  onSelect,
  title = 'Tab',
  actions,
  bare = false,
  scale = 1,
}: {
  parsed: Parsed;
  onSelect: (scoreIndex: number, ev?: NoteEvent | RestEvent, extend?: boolean) => void;
  title?: string;
  actions?: ReactNode;
  bare?: boolean;
  scale?: number;
}) {
  const passage = useApp((s) => s.passage);
  const marks = useApp((s) => s.alongMarks);
  const marksPrev = useApp((s) => s.alongPrev);
  const loopRange = useApp((s) => (s.loop ? s.loopRange : null));
  const activeEvents = useApp((s) => s.activeEvents);
  const selectedEvent = useApp((s) => s.selectedEvent);
  const showNoteNames = useApp((s) => s.showNoteNames);
  const view = useApp((s) => s.sheetView);
  const show = useApp((s) => s.sheetShow);
  const readAs = useApp((s) => s.readAs);
  const notes = readAs === 'notes';
  const verses = useShownVerses(parsed);
  // "Do" of the key: the song key's relative major, else the harmonica's key.
  const doName = pitchClassName(doPitchClass(parsed.doc.meta.key ?? parsed.harp.spec.key.replace(/^(Low|High)\s+/i, '')), keyUsesFlats(parsed.doc.meta.key ?? parsed.harp.spec.key));

  const eventAt = (i: number) => {
    const sev = parsed.score.events[i];
    const ev = sev ? parsed.doc.lines[sev.line]?.events[sev.eventIndex] : undefined;
    return ev && ev.kind !== 'bar' ? ev : undefined;
  };

  return (
    <div className={`sheet ${bare ? 'bare' : ''}`}>
      {!bare && <div className="sheet-head">
        <h2>
          {view === 'numbers' ? 'Numbered notation' : view === 'staff' ? 'Staff notation' : view === 'lyrics' ? 'Lyrics' : notes ? (view === 'simple' ? 'Simple notes' : 'Notes') : view === 'simple' ? 'Simple tab' : title}
          {view === 'numbers' && <span className="chip plain jp-key">1={doName}</span>}
        </h2>
        <div className="tb-group">
          {view !== 'simple' && <ShowMenu view={view} />}
          {(view === 'tab' || view === 'simple' || view === 'lyrics') && <ReadAsSwitch />}
          <ViewSwitch />
          {actions}
        </div>
      </div>}
      {/* (The staff is drawn to the width it's given: it's made bigger by giving it less.) */}
      <div className="sheet-body" style={scale !== 1 && view !== 'staff' ? { zoom: scale } : undefined}>
      {view === 'lyrics' ? (
        <LyricsView parsed={parsed} activeEvents={activeEvents} selectedEvent={selectedEvent} onSelect={onSelect} passage={passage} loopRange={loopRange} marks={marks} marksPrev={marksPrev} readAs={readAs} show={show.lyrics} verses={verses} />
      ) : view === 'simple' ? (
        <SimpleTabView parsed={parsed} activeEvents={activeEvents} selectedEvent={selectedEvent} onSelect={onSelect} passage={passage} loopRange={loopRange} marks={marks} marksPrev={marksPrev} readAs={readAs} />
      ) : view !== 'staff' ? (
        <TabView
          parsed={parsed}
          activeEvents={activeEvents}
          selectedEvent={selectedEvent}
          showNoteNames={view === 'numbers' ? show.numbers.holes : notes ? show.tab.holes : showNoteNames}
          showLyrics={view === 'numbers' ? show.numbers.lyrics : show.tab.lyrics}
          verses={verses}
          showChords={view === 'numbers' ? show.numbers.chords : show.tab.chords}
          onCardClick={onSelect}
          passage={passage}
          loopRange={loopRange}
          marks={marks}
          marksPrev={marksPrev}
          onBarClick={selectBar}
          notation={view === 'numbers' ? 'numbers' : 'holes'}
          readAs={readAs}
        />
      ) : (
        <Suspense fallback={<p className="muted">Loading sheet music…</p>}>
          <StaffView parsed={parsed} activeEvents={activeEvents} selectedEvent={selectedEvent} onNoteClick={(i) => onSelect(i, eventAt(i))} show={show.staff} verses={verses} staffWidth={Math.round(760 / scale)} />
        </Suspense>
      )}
      </div>
    </div>
  );
}

const VIEWS: { id: SheetView; label: string; short: string; title?: string }[] = [
  { id: 'simple', label: 'Simple tab', short: 'Simple', title: 'Just the holes, all the same size' },
  { id: 'tab', label: 'Tab', short: 'Tab' },
  { id: 'staff', label: 'Staff', short: 'Staff', title: 'Standard notation, with the holes underneath' },
  { id: 'numbers', label: 'Numbers', short: 'Numbers', title: 'Numbered notation (jianpu): 1 = do of the key' },
  { id: 'lyrics', label: 'Lyrics', short: 'Lyrics', title: 'The words, with the holes above them, like a chord sheet' },
];

/** Simple tab | Tab | Staff | Numbers | Lyrics. `short`: shorter names (performance mode's menu). */
export function ViewSwitch({ short = false }: { short?: boolean }) {
  const view = useApp((s) => s.sheetView);
  return (
    <div className="seg" role="radiogroup" aria-label="Sheet view">
      {VIEWS.map((v) => (
        <button key={v.id} role="radio" aria-checked={view === v.id} className={view === v.id ? 'on' : ''} onClick={() => useApp.setState({ sheetView: v.id })} title={v.title}>
          {short ? v.short : v.label}
        </button>
      ))}
    </div>
  );
}

/** Holes | Notes: whether the tab reads as holes (4 -4) or as notes (C5 D5). Remembered. */
export function ReadAsSwitch({ className = '', icons = false }: { className?: string; icons?: boolean }) {
  const readAs = useApp((s) => s.readAs);
  // `icons` (the editor bar): an icon each, named in the hover text ("Holes: …").
  const opt = (id: ReadAs, label: string, icon: React.ReactNode, title: string) => (
    <button role="radio" aria-checked={readAs === id} aria-label={icons ? label : undefined} className={readAs === id ? 'on' : ''} onClick={() => useApp.setState({ readAs: id })} title={icons ? `${label}: ${title}` : title}>
      {icons ? icon : label}
    </button>
  );
  return (
    <div className={`seg read-as ${icons ? 'icons' : ''} ${className}`} role="radiogroup" aria-label="Read as">
      {opt('holes', 'Holes', HolesIcon, 'Read the tab as holes: 4 -4 5')}
      {opt('notes', 'Notes', NotesIcon, 'Read the tab as notes: C5 D5 E5, with the holes small underneath')}
    </div>
  );
}

/** "Show ▾": what the Tab, Numbers, Staff or Lyrics view shows besides the notes. */
export function ShowMenu({ view }: { view: ShowView }) {
  const items = useShowItems(view);
  // The staff's title is off by default, so it doesn't count as "hidden".
  const hidden = items.filter((i) => !i.on && i.label !== 'Title and tempo').length;
  return (
    <Popover label={`Show${hidden ? ` (${hidden} hidden)` : ''} ▾`} title="Choose what this view shows" kind="panel" panelClass="menu show-menu" wrapClass="show-wrap" panelLabel="Show">
      <ShowItems view={view} />
    </Popover>
  );
}

type ShowView = 'tab' | 'numbers' | 'staff' | 'lyrics';

/** The verses the sheet shows (0-based), from the Show menu's choice. */
export function useShownVerses(parsed: Parsed): number[] {
  const pick = useApp((s) => s.showVerse);
  const count = useMemo(() => songVerses(parsed.doc), [parsed.doc]);
  return useMemo(() => shownVerses(count, pick), [count, pick]);
}

/** "Verses: All / 1 / 2…", for a song with more than one. */
function VersePicker() {
  const { doc } = useParsed();
  const pick = useApp((s) => s.showVerse);
  const count = songVerses(doc);
  if (count < 2) return null;
  return (
    <label className="show-item verse-pick">
      <span>
        <b>Verses</b>
        <span className="mi-hint">All of them under the notes, or just one</span>
      </span>
      <select value={pick >= 1 && pick <= count ? pick : 0} onChange={(e) => useApp.setState({ showVerse: Number(e.target.value) })} aria-label="Verses shown">
        <option value={0}>All</option>
        {Array.from({ length: count }, (_, k) => (
          <option key={k} value={k + 1}>Verse {k + 1}</option>
        ))}
      </select>
    </label>
  );
}

/** The Show menu's choices, as checkboxes (in the menu, or in performance mode's view menu). */
export function ShowItems({ view }: { view: ShowView }) {
  return (
    <>
      <VersePicker />
      {useShowItems(view).map((it) => (
        <label key={it.label} className="show-item">
          <input type="checkbox" checked={it.on} onChange={(e) => it.toggle(e.target.checked)} />
          <span>
            <b>{it.label}</b>
            <span className="mi-hint">{it.hint}</span>
          </span>
        </label>
      ))}
    </>
  );
}

function useShowItems(view: ShowView): { label: string; on: boolean; toggle: (v: boolean) => void; hint: string }[] {
  const show = useApp((s) => s.sheetShow);
  const names = useApp((s) => s.showNoteNames);
  const notes = useApp((s) => s.readAs === 'notes');
  const set = (patch: Partial<SheetShow['tab']> & Partial<SheetShow['numbers']> & Partial<SheetShow['staff']> & Partial<SheetShow['lyrics']>) =>
    useApp.setState((s) => ({ sheetShow: { ...s.sheetShow, [view]: { ...s.sheetShow[view], ...patch } } }));
  return view === 'tab'
      ? [
          notes
            ? { label: 'Holes', on: show.tab.holes, toggle: (v) => set({ holes: v }), hint: '4, -4… under each note' }
            : { label: 'Note names', on: names, toggle: (v) => useApp.setState({ showNoteNames: v }), hint: 'C5, E5… under each hole' },
          { label: 'Words', on: show.tab.lyrics, toggle: (v) => set({ lyrics: v }), hint: 'The lyrics under the notes' },
          { label: 'Chords', on: show.tab.chords, toggle: (v) => set({ chords: v }), hint: 'Chord symbols above the notes' },
        ]
      : view === 'lyrics'
        ? [
            { label: notes ? 'Notes' : 'Holes', on: show.lyrics.holes, toggle: (v) => set({ holes: v }), hint: notes ? 'C5, E5… above the words' : '4, -4… above the words' },
            { label: 'Chords', on: show.lyrics.chords, toggle: (v) => set({ chords: v }), hint: 'Chord symbols above the words' },
          ]
      : view === 'numbers'
        ? [
            { label: 'Holes', on: show.numbers.holes, toggle: (v) => set({ holes: v }), hint: 'The tab under each number' },
            { label: 'Words', on: show.numbers.lyrics, toggle: (v) => set({ lyrics: v }), hint: 'The lyrics under the notes' },
            { label: 'Chords', on: show.numbers.chords, toggle: (v) => set({ chords: v }), hint: 'Chord symbols above the notes' },
          ]
        : [
            { label: 'Holes', on: show.staff.holes, toggle: (v) => set({ holes: v }), hint: 'The tab under the staff' },
            { label: 'Words', on: show.staff.lyrics, toggle: (v) => set({ lyrics: v }), hint: 'The lyrics under the staff' },
            { label: 'Chords', on: show.staff.chords, toggle: (v) => set({ chords: v }), hint: 'Chord symbols above the staff' },
            { label: 'Title and tempo', on: show.staff.header, toggle: (v) => set({ header: v }), hint: 'The song’s heading on the staff' },
          ];
}
