// Phase 19a: "Chords on this harmonica" in the import dialog — each chord of a chord sheet as the
// chosen harmonica plays it: its holes, their notes, and what's left out (the worst first).
// Clicking one plays it, and shows where it comes in the preview.

import { useMemo } from 'react';
import { chordReport, missingText, type ChordLine, type ChordLevel } from '../core/chordReport';
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

export function ChordList({ doc, harp, onPick }: { doc: TabDoc; harp: Harmonica; onPick: (line: ChordLine) => void }) {
  const lines = useMemo(() => chordReport(doc, harp), [doc, harp]);
  if (!lines.length) return null;
  const thin = lines.filter((l) => l.level === 'thin' || l.level === 'none').length;
  return (
    <section className="chord-list" aria-label="Chords on this harmonica">
      <span className="field-label">
        Chords on this harmonica
        {thin > 0 && <span className="muted"> · {thin} to look at</span>}
      </span>
      <ul>
        {lines.map((l) => (
          <li key={l.symbol} className={`cl-${l.level}`}>
            <button type="button" onClick={() => onPick(l)} disabled={!l.sounds.length} title={l.sounds.length ? 'Hear it, and see where it comes' : MARK[l.level].title}>
              <span className="cl-mark" title={MARK[l.level].title} aria-label={MARK[l.level].title}>
                {MARK[l.level].icon}
              </span>
              <b className="cl-symbol">{l.symbol}</b>
              <span className="cl-count">×{l.count}</span>
              <span className="cl-holes">{l.sounds.length ? l.sounds.map((s) => holeSoundText(s)).join(' ') : '—'}</span>
              <span className="cl-notes">{l.notes.join(' ')}</span>
              <span className="cl-missing">{l.level === 'none' ? 'no way to play it' : l.level === 'unknown' ? 'not a chord the app knows' : missingText(l.missing)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
