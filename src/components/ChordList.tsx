// Phase 19a/b: "Chords on this harmonica" in the import dialog — each chord of a chord sheet as
// the chosen harmonica plays it: its holes, their notes, and what's left out (the worst first).
// Clicking one plays it, and shows where it comes in the preview. A chord not played in full
// can be played as another that is ("Play as"): the symbol stays, only its holes change.

import { useMemo } from 'react';
import { chordReport, chordSpelling, missingText, substitutes, type ChordLevel, type ChordLine, type Substitute } from '../core/chordReport';
import { holeSoundText } from '../core/htab/serializer';
import type { TabDoc } from '../core/htab/types';
import type { Harmonica } from '../core/instruments';

const MARK: Record<ChordLevel, { icon: string; title: string }> = {
  none: { icon: '✕', title: 'No way to play it on this harmonica: it stays a chord symbol, with no holes' },
  unknown: { icon: '?', title: 'Not a chord symbol the app knows: it stays as written, with no holes' },
  thin: { icon: '⚠', title: 'Played without its root or 3rd: it may not sound like itself' },
  mild: { icon: '·', title: 'Played without a 5th, 6th or 7th: still recognisably itself' },
  full: { icon: '✓', title: 'All of it' },
};

/** The chords picked to stand in, by the symbol they stand in for. */
export type Picks = Record<string, Substitute>;

interface Props {
  doc: TabDoc;
  harp: Harmonica;
  picks: Picks;
  onPicks: (picks: Picks) => void;
  /** A chord clicked: hear it (as it's played now). */
  onHear: (line: ChordLine) => void;
}

export function ChordList({ doc, harp, picks, onPicks, onHear }: Props) {
  const flats = chordSpelling(doc);
  const voicings = useMemo(() => Object.fromEntries(Object.entries(picks).map(([sym, p]) => [sym, p.sounds])), [picks]);
  const lines = useMemo(() => chordReport(doc, harp, voicings), [doc, harp, voicings]);
  // (What could stand in, for each chord not played in full — worked out as it was written;
  // not one on the very holes it's played on already, under another name.)
  const subs = useMemo(() => {
    const holes = (list: { sounds: Parameters<typeof holeSoundText>[0][] }) => list.sounds.map((x) => holeSoundText(x)).join(' ');
    return new Map(chordReport(doc, harp).map((l) => [l.symbol, l.level === 'full' || !l.info ? [] : substitutes(harp, l.info, flats).filter((o) => holes(o) !== holes(l))]));
  }, [doc, harp, flats]);
  if (!lines.length) return null;
  const worth = lines.filter((l) => !picks[l.symbol] && (l.level === 'thin' || l.level === 'none') && subs.get(l.symbol)?.length);
  const toLook = lines.filter((l) => !picks[l.symbol] && (l.level === 'thin' || l.level === 'none')).length;
  const pick = (symbol: string, sub: Substitute | undefined) => {
    const next = { ...picks };
    if (sub) next[symbol] = sub;
    else delete next[symbol];
    onPicks(next);
  };
  return (
    <section className="chord-list" aria-label="Chords on this harmonica">
      <div className="cl-head">
        <span className="field-label">
          Chords on this harmonica
          {toLook > 0 && <span className="muted"> · {toLook} to look at</span>}
        </span>
        {worth.length > 0 && (
          <button type="button" className="btn small ghost" onClick={() => onPicks({ ...picks, ...Object.fromEntries(worth.map((l) => [l.symbol, subs.get(l.symbol)![0]])) })} title="Each chord missing its root or 3rd (or not playable) played as the first chord suggested for it">
            Use the suggestions
          </button>
        )}
        {Object.keys(picks).length > 0 && (
          <button type="button" className="btn small ghost" onClick={() => onPicks({})} title="Every chord played as written again (as much of it as this harmonica has)">
            Back to as written
          </button>
        )}
      </div>
      <ul>
        {lines.map((l) => {
          const options = subs.get(l.symbol) ?? [];
          const picked = picks[l.symbol];
          const mark = picked ? { icon: '↪', title: `Played as ${picked.symbol}, which this harmonica has all of` } : MARK[l.level];
          return (
            <li key={l.symbol} className={picked ? 'cl-sub' : `cl-${l.level}`}>
              <button type="button" onClick={() => onHear(l)} disabled={!l.sounds.length} title={l.sounds.length ? 'Hear it, and see where it comes' : mark.title}>
                <span className="cl-mark" title={mark.title} aria-label={mark.title}>
                  {mark.icon}
                </span>
                <b className="cl-symbol">{l.symbol}</b>
                <span className="cl-count">×{l.count}</span>
                <span className="cl-holes">{l.sounds.length ? l.sounds.map((s) => holeSoundText(s)).join(' ') : '—'}</span>
                <span className="cl-notes">{l.notes.join(' ')}</span>
                <span className="cl-missing">
                  {picked ? `as ${picked.symbol}: ${picked.reason}` : l.level === 'none' ? 'no way to play it' : l.level === 'unknown' ? 'not a chord the app knows' : missingText(l.missing)}
                </span>
              </button>
              {options.length > 0 && (
                <label className="cl-play-as">
                  <span>Play as</span>
                  <select value={picked?.symbol ?? ''} onChange={(e) => pick(l.symbol, options.find((o) => o.symbol === e.target.value))} aria-label={`Play ${l.symbol} as`}>
                    <option value="">{l.sounds.length || picked ? `${l.symbol}, as written` : `${l.symbol} (nothing to play)`}</option>
                    {options.map((o) => (
                      <option key={o.symbol} value={o.symbol} title={o.reason}>
                        {o.symbol} — all of it: {o.sounds.map((s) => holeSoundText(s)).join(' ')}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
