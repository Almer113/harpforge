// Print view: the tab as it will look on paper (ink on white), with choices for what to
// print. "Print" opens the browser's print dialog, where "Save as PDF" makes a PDF.

import { lazy, Suspense, useEffect } from 'react';
import { ShowMenu } from '../components/Sheet';
import { SimpleTabView } from '../components/SimpleTabView';
import { TabView } from '../components/TabView';
import { guessTonic, positionFor, positionName } from '../core/convert';
import { rangeLabel } from '../core/instruments';
import { midiToName, prefersFlats } from '../core/pitch';
import { useApp, useParsed, type SheetView } from '../state/store';

const StaffView = lazy(() => import('../components/StaffView').then((m) => ({ default: m.StaffView })));

export interface PrintPrefs {
  view: SheetView;
  size: 'compact' | 'normal' | 'large';
  title: boolean;
  details: boolean;
  chart: boolean;
}

const VIEWS: { id: SheetView; label: string }[] = [
  { id: 'simple', label: 'Simple Tab' },
  { id: 'tab', label: 'Tab' },
  { id: 'staff', label: 'Staff' },
  { id: 'numbers', label: 'Numbers' },
];

const ZOOM = { compact: 0.82, normal: 1, large: 1.3 };

export function PrintPage() {
  const parsed = useParsed();
  const prefs = useApp((s) => s.printPrefs);
  const show = useApp((s) => s.sheetShow);
  const names = useApp((s) => s.showNoteNames);
  const set = (patch: Partial<PrintPrefs>) => useApp.setState((s) => ({ printPrefs: { ...s.printPrefs, ...patch } }));
  const { meta } = parsed.doc;
  const harp = parsed.harp;
  const tonic = guessTonic(parsed.doc, harp);
  const position = tonic !== undefined && harp.spec.family !== 'chromatic' ? positionFor(harp.spec.key, tonic) : undefined;
  const flats = prefersFlats(meta.key ?? harp.spec.key);

  // Ctrl+P on this page prints straight away.
  useEffect(() => {
    document.documentElement.classList.add('printing');
    return () => document.documentElement.classList.remove('printing');
  }, []);

  const details = [
    `${harp.name}${position ? ` · ${positionName(position)} position` : ''}`,
    meta.key ? `Key ${meta.key}` : null,
    `${meta.time} · ${Math.round(meta.tempo)} bpm`,
  ].filter(Boolean);

  return (
    <section className="page print-page">
      <div className="print-controls no-print">
        <div className="tb-group">
          <button className="btn small ghost" onClick={() => history.back()}>← Back</button>
          <h1>Print</h1>
        </div>
        <div className="print-options">
          <div className="seg" role="tablist" aria-label="What to print">
            {VIEWS.map((v) => (
              <button key={v.id} role="tab" aria-selected={prefs.view === v.id} className={prefs.view === v.id ? 'on' : ''} onClick={() => set({ view: v.id })}>
                {v.label}
              </button>
            ))}
          </div>
          {prefs.view !== 'simple' && <ShowMenu view={prefs.view} />}
          <select value={prefs.size} onChange={(e) => set({ size: e.target.value as PrintPrefs['size'] })} title="Size on the page">
            <option value="compact">Compact</option>
            <option value="normal">Normal size</option>
            <option value="large">Large (music stand)</option>
          </select>
          <label className="check"><input type="checkbox" checked={prefs.title} onChange={(e) => set({ title: e.target.checked })} /> Title</label>
          <label className="check"><input type="checkbox" checked={prefs.details} onChange={(e) => set({ details: e.target.checked })} /> Harmonica and tempo</label>
          <label className="check"><input type="checkbox" checked={prefs.chart} onChange={(e) => set({ chart: e.target.checked })} /> Hole chart</label>
          <button className="btn primary" onClick={() => window.print()} title="Opens the print dialog — choose “Save as PDF” there for a PDF file">
            Print / Save as PDF
          </button>
        </div>
        <p className="muted small">For a PDF, choose “Save as PDF” as the printer. Pages only break between lines.</p>
      </div>

      <div className={`paper size-${prefs.size}`} style={{ ['--paper-zoom' as string]: ZOOM[prefs.size] }}>
        {(prefs.title || prefs.details) && (
          <header className="paper-head">
            {prefs.title && (
              <div>
                <h1>{meta.title || 'Untitled'}</h1>
                {meta.artist && <div className="paper-artist">{meta.artist}</div>}
              </div>
            )}
            {prefs.details && <div className="paper-details">{details.join('  ·  ')}</div>}
          </header>
        )}
        {prefs.chart && (
          <table className="hole-chart" aria-label="Hole chart">
            <tbody>
              <tr>
                <th>Hole</th>
                {harp.holes.map((h) => (
                  <td key={h.hole}>{h.hole}</td>
                ))}
              </tr>
              <tr className="blow">
                <th>Blow</th>
                {harp.holes.map((h) => (
                  <td key={h.hole}>{midiToName(h.blow, flats).replace(/\d+$/, '')}</td>
                ))}
              </tr>
              <tr className="draw">
                <th>Draw</th>
                {harp.holes.map((h) => (
                  <td key={h.hole}>{midiToName(h.draw, flats).replace(/\d+$/, '')}</td>
                ))}
              </tr>
            </tbody>
            <caption>{rangeLabel(harp)}</caption>
          </table>
        )}
        <div className="paper-body">
          {prefs.view === 'simple' ? (
            <SimpleTabView parsed={parsed} activeEvents={[]} selectedEvent={null} />
          ) : prefs.view === 'staff' ? (
            <Suspense fallback={<p>Loading the staff…</p>}>
              <StaffView parsed={parsed} activeEvents={[]} selectedEvent={null} show={show.staff} oneSvgPerLine />
            </Suspense>
          ) : (
            <TabView
              parsed={parsed}
              activeEvents={[]}
              selectedEvent={null}
              showNoteNames={prefs.view === 'numbers' ? show.numbers.holes : names}
              showLyrics={prefs.view === 'numbers' ? show.numbers.lyrics : show.tab.lyrics}
              showChords={prefs.view === 'numbers' ? show.numbers.chords : show.tab.chords}
              notation={prefs.view === 'numbers' ? 'numbers' : 'holes'}
              follow={false}
            />
          )}
        </div>
      </div>
    </section>
  );
}
