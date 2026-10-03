import { useEffect, useMemo, useState } from 'react';
import { notesToTab, suggestHarmonicas, tabToNotes, type Suggestion } from '../core/convert';
import { parseHtab } from '../core/htab/parser';
import { serializeHtab } from '../core/htab/serializer';
import { getHarmonica, specId } from '../core/instruments';
import { buildScore, eventKey, harmonicaFromMeta } from '../core/score';
import { TabView } from '../components/TabView';
import { confirmDiscard } from '../state/actions';
import { stop } from '../state/playback';
import { useApp, useParsed, type Parsed } from '../state/store';

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

const DRAFT_KEY = 'harpforge:convert-draft';

function loadDraft(): string {
  try {
    return localStorage.getItem(DRAFT_KEY) ?? EXAMPLE;
  } catch {
    return EXAMPLE;
  }
}

function asParsed(text: string): Parsed {
  const { doc, issues } = parseHtab(text);
  const harp = harmonicaFromMeta(doc.meta);
  const { score } = buildScore(doc, harp);
  const indexByKey = new Map<string, number>();
  for (const ev of score.events) indexByKey.set(eventKey(ev.line, ev.eventIndex), ev.index);
  return { text, doc, harp, score, issues, indexByKey };
}

export function ConvertPage() {
  const current = useParsed();
  const [input, setInput] = useState(loadDraft);
  const [family, setFamily] = useState<'all' | 'diatonic' | 'chromatic'>('all');
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, input);
    } catch {
      /* ignore */
    }
  }, [input]);

  const parsedInput = useMemo(() => parseHtab(input), [input]);
  const hasHoles = parsedInput.doc.lines.some((l) => l.events.some((e) => e.kind === 'note' && e.sounds.some((s) => s.type === 'hole')));
  const sourceHarp = hasHoles ? harmonicaFromMeta(parsedInput.doc.meta) : undefined;

  const suggestions = useMemo<Suggestion[]>(
    () => suggestHarmonicas(parsedInput.doc, { sourceHarp, limit: 8, families: family === 'all' ? undefined : [family] }),
    [parsedInput, family, sourceHarp],
  );

  const chosen = suggestions.find((s) => specId(s.spec) === picked) ?? suggestions[0];

  const result = useMemo(() => {
    if (!chosen) return null;
    const harp = getHarmonica(chosen.spec);
    const r = notesToTab(parsedInput.doc, harp, { shift: chosen.shift, sourceHarp });
    if (chosen.position) r.doc.meta.position = String(chosen.position);
    const text = serializeHtab(r.doc);
    return { ...r, text, parsed: asParsed(text) };
  }, [chosen, parsedInput, sourceHarp]);

  const useCurrentTab = () => {
    const { doc } = tabToNotes(current.doc, current.harp);
    setInput(serializeHtab(doc));
    setPicked(null);
  };

  const openInEditor = () => {
    if (!result || !confirmDiscard()) return;
    stop();
    const s = useApp.getState();
    s.loadText(result.text);
    s.setPage('editor');
    s.notify('Converted tab opened in the editor ✓');
  };

  const errors = parsedInput.issues.filter((i) => i.severity === 'error');

  return (
    <section className="page convert-page">
      <header className="page-head">
        <h1>Convert</h1>
        <p className="muted">
          Type or paste a melody as notes (or a tab for any harmonica). HarpForge ranks every harmonica by how easy the song is to play,
          then writes the tab.
        </p>
      </header>

      <div className="convert-grid">
        <div className="panel">
          <div className="panel-head">
            <h2>Input</h2>
            <div className="tb-group">
              <button className="btn small" onClick={useCurrentTab} title="Turn the current tab into notes">Current tab → notes</button>
              <button className="btn small ghost" onClick={() => setInput(EXAMPLE)}>Example</button>
            </div>
          </div>
          <textarea className="plain-editor" value={input} onChange={(e) => { setInput(e.target.value); setPicked(null); }} spellCheck={false} />
          {errors.length > 0 && (
            <div className="issues">
              {errors.slice(0, 6).map((e, i) => (
                <span key={i} className="issue error">{e.message}</span>
              ))}
            </div>
          )}
          <p className="hint">
            Notes like <code>C4 D#4 Bb3</code>, chords <code>(C4 E4 G4)</code>, rhythm <code>~</code> and <code>{'{ }'}</code>, bars{' '}
            <code>|</code>, chord symbols <code>[G]</code>, lyrics <code>w:</code> — the same syntax as tabs.
          </p>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h2>Best harmonicas</h2>
            <select value={family} onChange={(e) => { setFamily(e.target.value as typeof family); setPicked(null); }}>
              <option value="all">All types</option>
              <option value="diatonic">Diatonic only</option>
              <option value="chromatic">Chromatic only</option>
            </select>
          </div>
          <div className="suggestions">
            {suggestions.map((s, i) => {
              const id = specId(s.spec);
              const active = chosen && specId(chosen.spec) === id;
              return (
                <button key={id} className={`suggestion ${active ? 'active' : ''}`} onClick={() => setPicked(id)}>
                  <span className="rank">{i + 1}</span>
                  <span className="s-main">
                    <b>{s.name}</b>
                    <span className="s-tags">
                      {s.position && <span>{ordinal(s.position)} position</span>}
                      {s.shift !== 0 && <span>{s.shift > 0 ? '+' : '−'}{Math.abs(s.shift / 12)} oct</span>}
                      {s.stats.unplayable > 0 && <span className="bad">{s.stats.unplayable} missing</span>}
                      {s.stats.bends > 0 && <span>{s.stats.bends} bends</span>}
                      {s.stats.overblows > 0 && <span>{s.stats.overblows} overblows</span>}
                      {s.stats.slides > 0 && <span>{s.stats.slides} slides</span>}
                      {s.stats.unplayable + s.stats.bends + s.stats.overblows + s.stats.slides === 0 && <span className="good">no techniques needed</span>}
                    </span>
                  </span>
                </button>
              );
            })}
            {!suggestions.length && <p className="muted">Enter some notes to get suggestions.</p>}
          </div>
        </div>

        <div className="panel wide">
          <div className="panel-head">
            <h2>Result {result && <span className="muted">· {chosen?.name}</span>}</h2>
            <div className="tb-group">
              <button className="btn small" disabled={!result} onClick={() => result && navigator.clipboard?.writeText(result.text).then(() => useApp.getState().notify('Copied ✓'))}>Copy text</button>
              <button className="btn small primary" disabled={!result} onClick={openInEditor}>Open in editor</button>
            </div>
          </div>
          {result && result.warnings.length > 0 && (
            <div className="issues">
              {result.warnings.slice(0, 6).map((w, i) => (
                <span key={i} className="issue warning">{w}</span>
              ))}
            </div>
          )}
          {result && <TabView parsed={result.parsed} activeEvents={[]} selectedEvent={null} showNoteNames follow={false} />}
        </div>
      </div>
    </section>
  );
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
