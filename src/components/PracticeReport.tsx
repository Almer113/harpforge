// The practice report: after a session of play along or practice mode, how it went, the
// holes missed most, the bars to work on (each with "Drill"), and the song's earlier sessions.

import { accuracy } from '../core/report';
import { closeReport, drill } from '../state/report';
import { useApp } from '../state/store';
import { Dialog } from './Dialog';

const shortDate = (at: number) => new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export function PracticeReport() {
  const report = useApp((s) => s.report);
  const saved = useApp((s) => !!s.docId);
  if (!report) return null;
  const { session: r, title, at } = report;
  // Earlier sessions of the same kind (practice mode and play along count differently).
  const history = report.history.filter((e) => e.mode === r.mode);
  const pct = accuracy(r);
  const holes = r.holes.filter((h) => h.misses + h.off > 0).slice(0, 4);
  const bars = r.bars.filter((b) => b.misses + b.off > 0).slice(0, 3);
  const before = history.at(-1);
  const trouble = (t: { misses: number; off: number }) =>
    [t.misses ? `${t.misses} ${r.mode === 'along' ? 'missed' : 'wrong'}` : '', t.off ? `${t.off} early or late` : ''].filter(Boolean).join(', ');
  return (
    <Dialog label="Practice report" className="report" onClose={closeReport}>
      <div className="modal-head">
        <h2>How it went</h2>
        <span className="muted">{title}</span>
      </div>
      <div className="report-summary">
        <div className="report-big">
          <b>{pct}%</b>
          <span className="muted small">{r.mode === 'along' ? 'of the notes played' : 'of your tries were right'}</span>
        </div>
        <ul className="report-facts">
          {r.mode === 'along' ? (
            <>
              <li>{r.passes} pass{r.passes === 1 ? '' : 'es'}, {r.clean} clean</li>
              <li>{r.inTime} of {r.notes} notes in time</li>
              {r.mistakes > 0 && <li>{r.mistakes} wrong note{r.mistakes === 1 ? '' : 's'}</li>}
            </>
          ) : (
            <li>{r.played} notes · {r.mistakes} wrong note{r.mistakes === 1 ? '' : 's'}</li>
          )}
          {before && (
            <li>
              Last time ({shortDate(before.at)}): {before.accuracy}%{' '}
              {pct !== before.accuracy && (
                <span className={pct > before.accuracy ? 'report-up' : 'report-down'} aria-label={pct > before.accuracy ? `up ${pct - before.accuracy} points` : `down ${before.accuracy - pct} points`}>
                  {pct > before.accuracy ? `▲ ${pct - before.accuracy}` : `▼ ${before.accuracy - pct}`}
                </span>
              )}
            </li>
          )}
        </ul>
      </div>
      {holes.length > 0 || bars.length > 0 ? (
        <div className="report-cols">
          <section>
            <h3>Holes to work on</h3>
            <ul className="report-list">
              {holes.map((h) => (
                <li key={h.label}>
                  <b className="report-hole">{h.label}</b>
                  <span className="muted small">{trouble(h)}</span>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h3>Bars to work on</h3>
            <ul className="report-list">
              {bars.map((b) => (
                <li key={b.bar}>
                  <b>Bar {b.bar}</b>
                  <span className="muted small">{trouble(b)}</span>
                  <button className="btn small" onClick={() => drill(b.passage)} title="Loop this bar slowly with the tempo trainer, playing along">
                    Drill
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : (
        <p className="report-clean">{r.mode === 'along' ? 'Every note played.' : 'No wrong notes.'} Try it faster, or a harder passage.</p>
      )}
      {history.length > 1 && (
        <section className="report-history">
          <h3>Earlier sessions</h3>
          <div className="report-bars" role="img" aria-label={`Earlier sessions: ${[...history.slice(-9).map((e) => `${e.accuracy}%`), `today ${pct}%`].join(', ')}`}>
            {[...history.slice(-9), { at, accuracy: pct }].map((e, k, all) => (
              <span key={k} className={k === all.length - 1 ? 'now' : ''} style={{ height: `${Math.max(4, e.accuracy)}%` }} title={`${shortDate(e.at)}: ${e.accuracy}%`} />
            ))}
          </div>
        </section>
      )}
      {!saved && <p className="muted small report-note">Save the song to your library to keep a history of your practice.</p>}
      <div className="modal-actions">
        <button className="btn primary" onClick={closeReport} autoFocus>
          Done
        </button>
      </div>
    </Dialog>
  );
}
