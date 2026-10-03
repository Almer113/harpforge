// Import dialog: shows what was found in a file (or pasted text), ranks harmonicas,
// previews the resulting tab, and loads it.

import { useEffect, useMemo, useState } from 'react';
import {
  chordSheetToTab,
  isChordSheet,
  notesToTab,
  STRUM_PATTERNS,
  suggestForChordSheet,
  suggestHarmonicas,
  type StrumPattern,
  type Suggestion,
} from '../core/convert';
import { FORMAT_NAMES, importText, sniffText, type Imported } from '../core/formats';
import { serializeHtab } from '../core/htab/serializer';
import { getHarmonica, harmonicaName, specId, type HarmonicaSpec } from '../core/instruments';
import { harmonicaFromMeta } from '../core/score';
import { loadTabText } from '../state/actions';
import { makeParsed, useApp, useParsed } from '../state/store';
import { TabView } from './TabView';

const CURRENT = 'current';

function countContent(imp: Imported) {
  let notes = 0;
  let chords = 0;
  for (const l of imp.doc.lines) {
    for (const e of l.events) {
      if (e.kind === 'note') notes++;
      if (e.kind !== 'bar' && e.chord) chords++;
    }
  }
  return { notes, chords };
}

export function ImportDialog() {
  const draft = useApp((s) => s.importDraft);
  const close = () => useApp.setState({ importDraft: null });

  useEffect(() => {
    if (!draft) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [draft]);

  if (!draft) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Import">
        <ImportBody key={draft.name} />
      </div>
    </div>
  );
}

function ImportBody() {
  const draft = useApp((s) => s.importDraft)!;
  const current = useParsed();
  const [paste, setPaste] = useState(draft.pasteText ?? '');
  const [picked, setPicked] = useState<string | null>(null);
  const [pattern, setPattern] = useState<StrumPattern>('halves');
  const pasteMode = draft.pasteText !== undefined;
  const close = () => useApp.setState({ importDraft: null });

  const imported = useMemo<(Imported & { kind?: string }) | null>(() => {
    if (draft.imported) return draft.imported;
    if (!pasteMode || !paste.trim()) return null;
    try {
      const kind = sniffText(paste);
      return { ...importText(paste, kind), kind };
    } catch {
      return null;
    }
  }, [draft.imported, paste, pasteMode]);

  const analysis = useMemo(() => {
    if (!imported) return null;
    const doc = imported.doc;
    const chordSheet = isChordSheet(doc);
    const hasHoles = doc.lines.some((l) => l.events.some((e) => e.kind === 'note' && e.sounds.some((s) => s.type === 'hole')));
    const sourceHarp = hasHoles ? harmonicaFromMeta(doc.meta) : undefined;
    const suggestions: Suggestion[] = chordSheet
      ? suggestForChordSheet(doc, { limit: 5 })
      : suggestHarmonicas(doc, { limit: 5, sourceHarp });
    return { doc, chordSheet, sourceHarp, suggestions, counts: countContent(imported) };
  }, [imported]);

  const choice = useMemo(() => {
    if (!analysis) return null;
    const id = picked ?? (analysis.suggestions[0] ? specId(analysis.suggestions[0].spec) : CURRENT);
    if (id === CURRENT) return { id, spec: current.harp.spec as HarmonicaSpec, shift: null as number | null };
    const s = analysis.suggestions.find((x) => specId(x.spec) === id) ?? analysis.suggestions[0];
    return { id, spec: s.spec, shift: s.shift as number | null, position: s.position };
  }, [analysis, picked, current.harp]);

  const result = useMemo(() => {
    if (!analysis || !choice) return null;
    const harp = getHarmonica(choice.spec);
    let r;
    if (analysis.chordSheet) r = chordSheetToTab(analysis.doc, harp, pattern);
    else {
      let shift = choice.shift;
      if (shift === null) {
        // Current harmonica: pick the octave that fits best.
        let best = Infinity;
        for (const s of [0, -12, 12]) {
          const c = notesToTab(analysis.doc, harp, { shift: s, sourceHarp: analysis.sourceHarp }).stats.cost + Math.abs(s) / 24;
          if (c < best) {
            best = c;
            shift = s;
          }
        }
      }
      r = notesToTab(analysis.doc, harp, { shift: shift ?? 0, sourceHarp: analysis.sourceHarp });
    }
    if ('position' in choice && choice.position) r.doc.meta.position = String(choice.position);
    const text = serializeHtab(r.doc);
    return { ...r, text, parsed: makeParsed(text) };
  }, [analysis, choice, pattern]);

  const doImport = () => {
    if (!result) return;
    close();
    loadTabText(result.text, draft.name);
    useApp.getState().setPage('play');
  };

  if (draft.error) {
    return (
      <>
        <div className="modal-head">
          <h2>Couldn’t import “{draft.name}”</h2>
        </div>
        <p className="issue error">{draft.error}</p>
        <div className="modal-actions">
          <button className="btn" onClick={close}>Close</button>
        </div>
      </>
    );
  }

  const meta = imported?.doc.meta;
  const formatName = imported ? (imported.kind && imported.kind in FORMAT_NAMES ? FORMAT_NAMES[imported.kind as keyof typeof FORMAT_NAMES] : imported.format) : null;

  return (
    <>
      <div className="modal-head">
        <h2>{pasteMode ? 'Paste & import' : `Import “${draft.name}”`}</h2>
        {formatName && <span className="chip">{formatName}</span>}
        <button className="modal-x" onClick={close} aria-label="Close">×</button>
      </div>

      {pasteMode && (
        <textarea
          className="plain-editor paste-box"
          autoFocus
          placeholder={'Paste a chord sheet (chords over lyrics), ChordPro, ABC notation, MusicXML or a harmonica tab…'}
          value={paste}
          onChange={(e) => {
            setPaste(e.target.value);
            setPicked(null);
          }}
          spellCheck={false}
        />
      )}

      {imported && analysis && (
        <div className="import-grid">
          <div className="import-info">
            <h3>{meta?.title || 'Untitled'}</h3>
            <div className="chips">
              {meta?.artist && <span className="chip plain">{meta.artist}</span>}
              {meta?.key && <span className="chip plain">Key {meta.key}</span>}
              <span className="chip plain">{meta?.time} · {meta?.tempo} bpm</span>
              {analysis.chordSheet ? (
                <span className="chip plain">{analysis.counts.chords} chords · no melody</span>
              ) : (
                <span className="chip plain">{analysis.counts.notes} notes{analysis.counts.chords ? ` · ${analysis.counts.chords} chord symbols` : ''}</span>
              )}
            </div>
            {analysis.chordSheet && (
              <p className="hint">
                This is a chord sheet, so HarpForge will play the chords as harmonica chords. Record or type the melody afterwards if you like.
              </p>
            )}
            {imported.warnings.length > 0 && (
              <div className="issues">
                {imported.warnings.slice(0, 5).map((w, i) => (
                  <span key={i} className="issue warning">{w}</span>
                ))}
              </div>
            )}

            <h4>Harmonica</h4>
            <div className="suggestions compact">
              {analysis.suggestions.map((s, i) => {
                const id = specId(s.spec);
                return (
                  <button key={id} className={`suggestion ${choice?.id === id ? 'active' : ''}`} onClick={() => setPicked(id)}>
                    <span className="rank">{i + 1}</span>
                    <span className="s-main">
                      <b>{s.name}</b>
                      <span className="s-tags">
                        {s.position && <span>{s.position}{['th', 'st', 'nd', 'rd'][s.position] ?? 'th'} pos.</span>}
                        {s.stats.unplayable > 0 && <span className="bad">{s.stats.unplayable} missing</span>}
                        {s.stats.reducedChords > 0 && <span>{s.stats.reducedChords} partial</span>}
                        {s.stats.bends > 0 && <span>{s.stats.bends} bends</span>}
                        {s.stats.overblows > 0 && <span>{s.stats.overblows} overblows</span>}
                        {s.stats.unplayable + s.stats.bends + s.stats.overblows + s.stats.reducedChords === 0 && <span className="good">easy fit</span>}
                      </span>
                    </span>
                  </button>
                );
              })}
              <button className={`suggestion ${choice?.id === CURRENT ? 'active' : ''}`} onClick={() => setPicked(CURRENT)}>
                <span className="rank">✓</span>
                <span className="s-main">
                  <b>Keep my current harmonica</b>
                  <span className="s-tags"><span>{harmonicaName(current.harp.spec)}</span></span>
                </span>
              </button>
            </div>

            {analysis.chordSheet && (
              <label className="field">
                <span>Chord rhythm</span>
                <select value={pattern} onChange={(e) => setPattern(e.target.value as StrumPattern)}>
                  {STRUM_PATTERNS.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <div className="import-preview sheet">
            {result && result.warnings.length > 0 && (
              <div className="issues">
                {result.warnings.slice(0, 3).map((w, i) => (
                  <span key={i} className="issue warning">{w}</span>
                ))}
              </div>
            )}
            {result && <TabView parsed={result.parsed} activeEvents={[]} selectedEvent={null} showNoteNames={false} follow={false} />}
          </div>
        </div>
      )}

      {pasteMode && paste.trim() && !analysis && <p className="muted">Couldn’t recognise this text yet.</p>}

      <div className="modal-actions">
        <button className="btn" onClick={close}>Cancel</button>
        <button className="btn primary" disabled={!result} onClick={doImport}>Import</button>
      </div>
    </>
  );
}
