import { lazy, Suspense } from 'react';
import type { NoteEvent, RestEvent } from '../core/htab/types';
import { useApp, type Parsed } from '../state/store';
import { doPitchClass } from '../core/formats/jianpu';
import { pitchClassName, prefersFlats } from '../core/pitch';
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
  // "Do" of the key: the song key's relative major, else the harmonica's key.
  const doName = pitchClassName(doPitchClass(parsed.doc.meta.key ?? parsed.harp.spec.key.replace(/^(Low|High)\s+/i, '')), prefersFlats(parsed.doc.meta.key ?? parsed.harp.spec.key));

  const eventAt = (i: number) => {
    const sev = parsed.score.events[i];
    const ev = sev ? parsed.doc.lines[sev.line]?.events[sev.eventIndex] : undefined;
    return ev && ev.kind !== 'bar' ? ev : undefined;
  };

  return (
    <div className="sheet">
      <div className="sheet-head">
        <h2>
          {view === 'numbers' ? 'Numbered notation' : view === 'staff' ? 'Sheet music' : view === 'simple' ? 'Simple tab' : title}
          {view === 'numbers' && <span className="chip plain jp-key">1={doName}</span>}
        </h2>
        <div className="tb-group">
          {view !== 'staff' && view !== 'simple' && (
            <label className="check">
              <input type="checkbox" checked={showNoteNames} onChange={(e) => useApp.setState({ showNoteNames: e.target.checked })} />
              {view === 'numbers' ? 'Holes' : 'Note names'}
            </label>
          )}
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
            <button role="tab" aria-selected={view === 'staff'} className={view === 'staff' ? 'on' : ''} onClick={() => useApp.setState({ sheetView: 'staff' })}>
              Staff + tab
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
        <SimpleTabView parsed={parsed} activeEvents={activeEvents} selectedEvent={selectedEvent} onSelect={onSelect} />
      ) : view !== 'staff' ? (
        <TabView
          parsed={parsed}
          activeEvents={activeEvents}
          selectedEvent={selectedEvent}
          showNoteNames={showNoteNames}
          onCardClick={onSelect}
          notation={view === 'numbers' ? 'numbers' : 'holes'}
        />
      ) : (
        <Suspense fallback={<p className="muted">Loading sheet music…</p>}>
          <StaffView parsed={parsed} activeEvents={activeEvents} selectedEvent={selectedEvent} onNoteClick={(i) => onSelect(i, eventAt(i))} />
        </Suspense>
      )}
    </div>
  );
}
