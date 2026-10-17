// Import & convert: one place for everything that becomes a tab — a file, pasted text
// (chord sheets, ABC, ChordPro, MusicXML, a tab) or notes typed in. It shows what was
// found, suggests harmonicas (or keeps yours), previews the tab with sound, and opens it.

import { useEffect, useMemo, useRef, useState } from 'react';
import * as engine from '../audio/engine';
import {
  chordSheetToTab,
  isChordSheet,
  notesToTab,
  positionName,
  STRUM_PATTERNS,
  type StrumPattern,
  type Suggestion,
} from '../core/convert';
import { FORMAT_NAMES, importText, sniffText, type Imported } from '../core/formats';
import { serializeHtab } from '../core/htab/serializer';
import { FAMILIES, getHarmonica, harmonicaName, specId, type HarmonicaSpec } from '../core/instruments';
import { harmonicaFromMeta } from '../core/score';
import { copyToClipboard } from '../live/copy';
import { loadTabText } from '../state/actions';
import { stop } from '../state/playback';
import { getParsed, makeParsed, useApp, useParsed } from '../state/store';
import { useSuggestions } from '../state/useSuggestions';
import { useDraft } from '../state/leaveGuard';
import { Dialog } from './Dialog';
import { TabView } from './TabView';
import { ChordList, type Picks } from './ChordList';
import type { ChordLine } from '../core/chordReport';
import { soundPitch } from '../core/instruments';

const MINE = 'mine';

const EXAMPLE = `---
title: Amazing Grace
artist: Traditional
key: G
tempo: 80
time: 3/4
---
D4 | G4~ {B4 G4} | B4~ A4 | G4~ E4 | D4~ D4 |
w: A-maz-ing _ grace how sweet the sound that
G4~ {B4 G4} | B4~ A4 | D5~~ | D5~ |]
w: saved a _ wretch like me
`;

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

/** Text typed or pasted into the paste box that hasn't been opened yet. */
let unsavedPaste = false;

/** Closes the dialog, asking first if that would throw away typed or pasted text. */
function requestClose() {
  if (unsavedPaste && !window.confirm('Close and discard the text you pasted?')) return;
  unsavedPaste = false;
  useApp.setState({ importDraft: null });
}

export function ImportDialog() {
  const draft = useApp((s) => s.importDraft);
  if (!draft) return null;
  return (
    <Dialog label="Import" className="import-modal" onClose={requestClose}>
      <ImportBody key={`${draft.name}:${draft.pasteText !== undefined ? 'paste' : 'file'}`} />
    </Dialog>
  );
}

function techniqueTags(s: Pick<Suggestion, 'stats'>) {
  const t = s.stats;
  const tags: { text: string; cls?: string }[] = [];
  const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  if (t.thinChords !== undefined) {
    // A chord sheet: its chords, counted once each (not every time they're played).
    if (t.unplayableChords) tags.push({ text: `${n(t.unplayableChords, 'chord', 'chords')} can’t be played`, cls: 'bad' });
    if (t.thinChords > 0) tags.push({ text: `${t.thinChords} missing root or 3rd` });
  } else if (t.unplayable > 0) tags.push({ text: `${t.unplayable} missing`, cls: 'bad' });
  if (t.thinChords === undefined && t.reducedChords > 0) tags.push({ text: n(t.reducedChords, 'partial chord', 'partial chords') });
  if (t.bends > 0) tags.push({ text: n(t.bends, 'bend', 'bends') });
  if (t.overblows > 0) tags.push({ text: n(t.overblows, 'overblow', 'overblows') });
  if (t.slides > 0) tags.push({ text: n(t.slides, 'slide note', 'slide notes') });
  if (!tags.length) tags.push({ text: 'no techniques needed', cls: 'good' });
  return tags;
}

function ImportBody() {
  const draft = useApp((s) => s.importDraft)!;
  const readAs = useApp((s) => s.readAs);
  const current = useParsed();
  const [paste, setPaste] = useState(draft.pasteText ?? '');
  // Parsing and ranking wait for a pause in typing.
  const [pasteSettled, setPasteSettled] = useState(paste);
  useEffect(() => {
    const t = setTimeout(() => setPasteSettled(paste), paste === pasteSettled ? 0 : 250);
    return () => clearTimeout(t);
  }, [paste, pasteSettled]);
  const [picked, setPicked] = useState<string | null>(null);
  const [pattern, setPattern] = useState<StrumPattern>('halves');
  const [family, setFamily] = useState<string>('all');
  const pasteMode = draft.pasteText !== undefined;
  const close = requestClose;
  useEffect(() => {
    unsavedPaste = pasteMode && paste.trim() !== '' && paste !== (draft.pasteText ?? '');
  }, [paste, pasteMode, draft.pasteText]);
  useEffect(() => () => void (unsavedPaste = false), []);
  // (Leaving the page with pasted text not opened yet asks first, as closing the dialog does.)
  useDraft(pasteMode && paste.trim() !== '' && paste !== (draft.pasteText ?? ''));

  const imported = useMemo<(Imported & { kind?: string }) | null>(() => {
    if (draft.imported) return draft.imported;
    if (!pasteMode || !pasteSettled.trim()) return null;
    try {
      const kind = sniffText(pasteSettled);
      return { ...importText(pasteSettled, kind), kind };
    } catch {
      return null;
    }
  }, [draft.imported, pasteSettled, pasteMode]);

  const analysis = useMemo(() => {
    if (!imported) return null;
    const doc = imported.doc;
    const counts = countContent(imported);
    if (!counts.notes && !counts.chords) return null;
    const chordSheet = isChordSheet(doc);
    const hasHoles = doc.lines.some((l) => l.events.some((e) => e.kind === 'note' && e.sounds.some((s) => s.type === 'hole')));
    const sourceHarp = hasHoles ? harmonicaFromMeta(doc.meta) : undefined;
    return { doc, chordSheet, sourceHarp, counts };
  }, [imported]);

  const { suggestions, pending } = useSuggestions(analysis?.doc ?? null, {
    chordSheet: !!analysis?.chordSheet,
    sourceSpec: analysis?.sourceHarp?.spec,
    families: family === 'all' ? undefined : [family],
  });

  // Your harmonicas (the current one and the ones you own), each at the octave that fits
  // best unless you move it, best first.
  const owned = useApp((st) => st.ownedHarps);
  const [shifts, setShifts] = useState<Record<string, number>>({});
  const mine = useMemo(() => {
    if (!analysis) return [];
    const specs = [current.harp.spec as HarmonicaSpec, ...owned].filter((sp, i, all) => all.findIndex((x) => specId(x) === specId(sp)) === i);
    return specs
      .map((spec) => {
        const harp = getHarmonica(spec);
        const id = `${MINE}:${specId(spec)}`;
        if (analysis.chordSheet) {
          const stats = chordSheetToTab(analysis.doc, harp, 'hold').stats;
          return { id, spec, shift: 0, stats, score: stats.cost, current: specId(spec) === specId(current.harp.spec) };
        }
        let best = 0;
        let bestCost = Infinity;
        for (const sh of [0, -12, 12, -24, 24]) {
          const c = notesToTab(analysis.doc, harp, { shift: sh, sourceHarp: analysis.sourceHarp }).stats.cost + Math.abs(sh) / 48;
          if (c < bestCost) {
            bestCost = c;
            best = sh;
          }
        }
        const shift = shifts[id] ?? best;
        const stats = notesToTab(analysis.doc, harp, { shift, sourceHarp: analysis.sourceHarp }).stats;
        return { id, spec, shift, stats, score: bestCost, current: specId(spec) === specId(current.harp.spec) };
      })
      .sort((x, y) => x.score - y.score);
  }, [analysis, current.harp, owned, shifts]);
  const ownedIds = new Set(owned.map(specId));

  const choice = useMemo(() => {
    // With harps of your own, one of them unless none can play every note.
    const yours = owned.length ? mine.find((m) => !m.stats.unplayable) : undefined;
    const id = picked ?? yours?.id ?? (suggestions[0] ? specId(suggestions[0].spec) : mine[0]?.id);
    const own = mine.find((m) => m.id === id);
    if (own || !suggestions.length) {
      const m = own ?? mine[0];
      return m ? { id: m.id, spec: m.spec, shift: m.shift, position: undefined as number | undefined } : null;
    }
    const s = suggestions.find((x) => specId(x.spec) === id) ?? suggestions[0];
    return { id: specId(s.spec), spec: s.spec, shift: s.shift, position: s.position };
  }, [suggestions, picked, mine, owned.length]);

  // Chords picked to stand in for ones this harmonica can't play in full (for this harmonica).
  const [picks, setPicks] = useState<{ harp: string; picks: Picks }>({ harp: '', picks: {} });
  const standIns = useMemo(() => (choice && picks.harp === choice.id ? picks.picks : {}), [choice, picks]);
  const voicings = useMemo(() => Object.fromEntries(Object.entries(standIns).map(([sym, p]) => [sym, p.sounds])), [standIns]);

  const result = useMemo(() => {
    if (!analysis || !choice) return null;
    const harp = getHarmonica(choice.spec);
    const r = analysis.chordSheet ? chordSheetToTab(analysis.doc, harp, pattern, voicings) : notesToTab(analysis.doc, harp, { shift: choice.shift, sourceHarp: analysis.sourceHarp });
    if (choice.position) r.doc.meta.position = positionName(choice.position);
    const text = serializeHtab(r.doc);
    return { ...r, text, parsed: makeParsed(text) };
  }, [analysis, choice, pattern, voicings]);

  // Hear the result before importing it.
  const [playing, setPlaying] = useState(false);
  const [active, setActive] = useState<number[]>([]);
  // The engine's sound follows the open tab's harmonica again afterwards.
  const restoreVoicing = () => engine.setVoicing(getParsed(useApp.getState().text).harp.voicing);
  const stopPreview = () => {
    engine.stopPlayback();
    restoreVoicing();
    setPlaying(false);
    setActive([]);
  };
  // Only the preview's own playback is stopped here (the app's playback is the app's).
  const playingRef = useRef(false);
  playingRef.current = playing;
  useEffect(
    () => () => {
      if (playingRef.current) {
        engine.stopPlayback();
        restoreVoicing();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useEffect(() => {
    if (playingRef.current) stopPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);
  const togglePreview = async () => {
    if (playing || !result) return stopPreview();
    stop();
    await engine.ensureAudio();
    engine.setVoicing(result.parsed.harp.voicing);
    engine.playScore(result.parsed.score, {
      tempo: result.parsed.doc.meta.tempo,
      onEvent: (i, on) => setActive((a) => (on ? [...a.filter((x) => x !== i), i] : a.filter((x) => x !== i))),
      onEnd: () => {
        setPlaying(false);
        setActive([]);
        restoreVoicing();
      },
    });
    setPlaying(true);
  };

  // A chord in the list: heard on the chosen harmonica, and marked where it comes in the preview.
  const chosenHarp = useMemo(() => (choice ? getHarmonica(choice.spec) : null), [choice]);
  const hearChord = (line: ChordLine) => {
    if (!chosenHarp || !result) return;
    if (playing) stopPreview();
    const midis = line.sounds.map((x) => soundPitch(chosenHarp, x)).filter((m): m is number => m !== null);
    void engine.ensureAudio().then(() => {
      engine.setVoicing(chosenHarp.voicing);
      engine.previewMidis(midis, 1);
      setTimeout(restoreVoicing, 1300);
    });
    const uses = result.parsed.score.events.filter((x) => x.chord === line.symbol).map((x) => x.index);
    setActive(uses);
    setTimeout(() => setActive((a) => (a === uses ? [] : a)), 1600);
    document.querySelector(`.import-preview [data-index="${uses[0]}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  const open = (page: 'play' | 'editor') => {
    if (!result) return;
    stopPreview();
    if (!loadTabText(result.text, draft.name)) return;
    // Opened: nothing is discarded, so no question.
    unsavedPaste = false;
    close();
    useApp.getState().setPage(page);
  };

  if (draft.progress && !draft.imported) {
    return (
      <>
        <div className="modal-head">
          <h2>Importing “{draft.name}”</h2>
          <button className="modal-x" onClick={close} aria-label="Cancel">×</button>
        </div>
        <div className="progress-box">
          <div className="spinner" aria-hidden />
          <div className="progress-text">
            <b>{draft.progress.message}</b>
            <span className="muted">Image-based PDFs are read with text recognition, which can take a few seconds per page.</span>
            <div className="progress-bar"><div style={{ width: `${Math.round(draft.progress.fraction * 100)}%` }} /></div>
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={close}>Cancel</button>
        </div>
      </>
    );
  }

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
  const formatName = imported
    ? analysis?.chordSheet && imported.kind === 'htab'
      ? 'Chord sheet'
      : imported.kind === 'htab' && !analysis?.sourceHarp
        ? 'Notes'
      : imported.format.includes('→') || !(imported.kind && imported.kind in FORMAT_NAMES)
        ? imported.format
        : FORMAT_NAMES[imported.kind as keyof typeof FORMAT_NAMES]
    : null;

  return (
    <>
      <div className="modal-head">
        <h2>{pasteMode ? 'Import or convert' : `Import “${draft.name}”`}</h2>
        {formatName && analysis && <span className="chip">{formatName}</span>}
        {draft.sourceText && (
          <button className="btn small ghost" onClick={() => useApp.setState({ importDraft: { name: draft.name, pasteText: draft.sourceText } })} title="Fix any recognition mistakes, then import">
            Edit recognised text
          </button>
        )}
        <button className="modal-x" onClick={close} aria-label="Close">×</button>
      </div>

      {pasteMode && (
        <div className="paste-area">
          <textarea
            className="plain-editor paste-box"
            autoFocus
            placeholder={'Paste a chord sheet, ChordPro, ABC, MusicXML or a tab — or type notes like  C4 D4 E4~ | G4 …'}
            value={paste}
            onKeyDown={(e) => {
              // Escape only leaves the box (the text stays); a second Escape closes the dialog.
              if (e.key === 'Escape') {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
            onChange={(e) => {
              setPaste(e.target.value);
              setPicked(null);
              setShifts({});
            }}
            spellCheck={false}
          />
          <p className="hint">
            Notes: <code>C4 D#4 Bb3</code>, chords <code>(C4 E4 G4)</code>, held <code>~</code>, beats <code>{'{ }'}</code>, bars <code>|</code>, chord
            symbols <code>[G]</code>, lyrics <code>w:</code> — the same as tabs. Other formats are recognised automatically.{' '}
            <button className="link-btn" onClick={() => setPaste(EXAMPLE)}>Try an example</button>
          </p>
        </div>
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
            {analysis.chordSheet && <p className="hint">A chord sheet: the chords are played as harmonica chords. Record or type the melody afterwards if you like.</p>}
            {imported.parts && imported.choosePart && draft.imported && (
              <label className="import-part">
                <span>Part</span>
                <select
                  value={imported.part}
                  onChange={(e) => {
                    const next = imported.choosePart!(e.target.value);
                    setPicked(null);
                    setShifts({});
                    useApp.setState({ importDraft: { ...draft, imported: { ...next, kind: draft.imported!.kind } } });
                  }}
                  title="The file holds several parts: pick the one with the melody"
                >
                  {imported.parts.map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
              </label>
            )}
            {imported.warnings.length > 0 && (
              <div className="issues">
                {imported.warnings.slice(0, 5).map((w, i) => (
                  <span key={i} className="issue warning">{w}</span>
                ))}
              </div>
            )}

            <h4>{mine.length > 1 ? 'Your harmonicas' : 'Your harmonica'}</h4>
            <div className="suggestions compact">
              {mine.map((m) => (
                // The choice is a button; the octave buttons sit beside it (buttons can't hold buttons).
                <div key={m.id} className={`suggestion ${choice?.id === m.id ? 'active' : ''}`} onClick={() => setPicked(m.id)}>
                  <button className="s-pick" aria-pressed={choice?.id === m.id} onClick={() => setPicked(m.id)}>
                    <span className="rank">{m.current ? '✓' : '★'}</span>
                    <span className="s-main">
                      <b>{harmonicaName(m.spec)}</b>
                      <span className="s-tags">
                        {m.current && <span>open now</span>}
                        {m.shift !== 0 && <span>{m.shift > 0 ? '+' : '−'}{Math.abs(m.shift / 12)} oct</span>}
                        {techniqueTags(m).map((t) => <span key={t.text} className={t.cls}>{t.text}</span>)}
                      </span>
                    </span>
                  </button>
                  {!analysis.chordSheet && (
                    <span className="oct-btns" onClick={(e) => e.stopPropagation()}>
                      <button className="icon-btn" title="An octave lower" disabled={m.shift <= -24} onClick={() => { setPicked(m.id); setShifts((x) => ({ ...x, [m.id]: m.shift - 12 })); }}>▼</button>
                      <button className="icon-btn" title="An octave higher" disabled={m.shift >= 24} onClick={() => { setPicked(m.id); setShifts((x) => ({ ...x, [m.id]: m.shift + 12 })); }}>▲</button>
                    </span>
                  )}
                </div>
              ))}
            </div>
            {!owned.length && <p className="muted small">Tip: mark the harps you own (harmonica menu → ☆) and they'll be listed here first.</p>}

            <div className="sugg-head">
              <h4>Best fits {pending && <span className="muted small">· working…</span>}</h4>
              <select value={family} onChange={(e) => { setFamily(e.target.value); setPicked(null); }} title="Which kinds of harmonica to suggest">
                <option value="all">All types</option>
                {FAMILIES.map((f) => (
                  <option key={f.id} value={f.id}>{f.name} only</option>
                ))}
              </select>
            </div>
            <div className={`suggestions compact ${pending ? 'stale' : ''}`}>
              {suggestions.map((s, i) => {
                const id = specId(s.spec);
                return (
                  <button key={id} className={`suggestion ${choice?.id === id ? 'active' : ''}`} onClick={() => setPicked(id)}>
                    <span className="rank">{i + 1}</span>
                    <span className="s-main">
                      <b>{s.name}{ownedIds.has(id) && <span className="owned-star" title="You have this harp"> ★</span>}</b>
                      <span className="s-tags">
                        {s.position && <span>{positionName(s.position)} pos.</span>}
                        {s.shift !== 0 && <span>{s.shift > 0 ? '+' : '−'}{Math.abs(s.shift / 12)} oct</span>}
                        {techniqueTags(s).map((t) => <span key={t.text} className={t.cls}>{t.text}</span>)}
                      </span>
                    </span>
                  </button>
                );
              })}
              {!suggestions.length && !pending && <p className="muted small">No harmonica of this kind fits.</p>}
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
            {analysis.chordSheet && chosenHarp && choice && <ChordList doc={analysis.doc} harp={chosenHarp} picks={standIns} onPicks={(p) => setPicks({ harp: choice.id, picks: p })} onHear={hearChord} />}
          </div>

          <div className="import-preview sheet">
            <div className="preview-head">
              <button className={`t-btn primary ${playing ? 'on' : ''}`} onClick={() => void togglePreview()} disabled={!result} title={playing ? 'Stop' : 'Hear it'}>
                {playing ? '■' : '▶'}
              </button>
              <span className="muted small">{choice ? harmonicaName(choice.spec) : ''}</span>
              <button className="btn small ghost" disabled={!result} onClick={() => result && void copyToClipboard(result.text).then((ok) => useApp.getState().notify(ok ? 'Copied ✓' : 'Couldn’t copy; open it and copy from the editor instead.'))}>
                Copy text
              </button>
            </div>
            {result && result.warnings.length > 0 && (
              <div className="issues">
                {result.warnings.slice(0, 3).map((w, i) => (
                  <span key={i} className="issue warning">{w}</span>
                ))}
              </div>
            )}
            {result && <TabView parsed={result.parsed} activeEvents={active} selectedEvent={null} showNoteNames={readAs === 'notes'} follow={playing} readAs={readAs} />}
          </div>
        </div>
      )}

      {pasteMode && paste.trim() && !analysis && <p className="muted">No notes or chords recognised yet.</p>}

      <div className="modal-actions">
        <button className="btn" onClick={close}>Cancel</button>
        <button className="btn" disabled={!result} onClick={() => open('editor')}>Open in Edit</button>
        <button className="btn primary" disabled={!result} onClick={() => open('play')}>Open in Play</button>
      </div>
    </>
  );
}
