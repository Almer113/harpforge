import { useCallback, useEffect, useState } from 'react';
import { confirmDiscard, importFile, openPasteImport, saveCurrent } from '../state/actions';
import { ExportMenu } from '../components/ExportMenu';
import { stop } from '../state/playback';
import { useApp } from '../state/store';
import { deleteTab, listTabs, saveTab, type SavedTab } from '../storage/library';

export function LibraryPage() {
  const [tabs, setTabs] = useState<SavedTab[] | null>(null);
  const [query, setQuery] = useState('');
  const docId = useApp((s) => s.docId);

  const refresh = useCallback(() => {
    listTabs().then(setTabs).catch(() => setTabs([]));
  }, []);
  useEffect(refresh, [refresh, docId]);

  const open = (t: SavedTab, page: 'play' | 'editor' = 'play') => {
    const s = useApp.getState();
    if (s.docId !== t.id && !confirmDiscard()) return;
    stop();
    s.loadText(t.text, t.id, true);
    s.setPage(page);
  };

  const remove = async (t: SavedTab) => {
    if (!window.confirm(`Delete "${t.title}" from your library? This can't be undone.`)) return;
    await deleteTab(t.id);
    if (useApp.getState().docId === t.id) useApp.setState({ docId: null, savedText: null });
    refresh();
  };

  const duplicate = async (t: SavedTab) => {
    await saveTab(t.text.replace(/^(title:\s*)(.*)$/m, '$1$2 (copy)'));
    refresh();
  };

  const filtered = (tabs ?? []).filter((t) => (t.title + ' ' + t.harmonica).toLowerCase().includes(query.toLowerCase()));

  return (
    <section className="page library-page">
      <header className="page-head row">
        <div>
          <h1>Library</h1>
          <p className="muted">Your saved tabs live in this browser. Import ABC, MusicXML, MIDI, ChordPro or chord sheets; export to any of them.</p>
        </div>
        <div className="tb-group">
          <input className="search" placeholder="Search…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <button className="btn" onClick={importFile}>Import file…</button>
          <button className="btn" onClick={openPasteImport}>Paste…</button>
          <button className="btn primary" onClick={() => saveCurrent().then(refresh)}>Save current tab</button>
        </div>
      </header>

      {tabs === null ? (
        <p className="muted">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="tab-empty">
          <p>{tabs.length ? 'No tabs match your search.' : 'No saved tabs yet.'}</p>
        </div>
      ) : (
        <div className="lib-grid">
          {filtered.map((t) => (
            <article key={t.id} className={`lib-card ${t.id === docId ? 'current' : ''}`}>
              <button className="lib-open" onClick={() => open(t)}>
                <h3>{t.title}</h3>
                <span className="chip">{t.harmonica}</span>
                <pre className="lib-preview">{previewOf(t.text)}</pre>
                <span className="muted small">Updated {new Date(t.updatedAt).toLocaleString()}</span>
              </button>
              <div className="lib-actions">
                <button className="btn small" onClick={() => open(t, 'play')}>Play</button>
                <button className="btn small" onClick={() => open(t, 'editor')}>Edit</button>
                <button className="btn small ghost" onClick={() => duplicate(t)}>Duplicate</button>
                <ExportMenu text={t.text} small />
                <button className="btn small danger" onClick={() => remove(t)}>Delete</button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function previewOf(text: string): string {
  const body = text.replace(/^\s*---[\s\S]*?\n---\s*\n/, '');
  return body
    .split('\n')
    .filter((l) => l.trim() && !/^\s*(w:|#|@)/i.test(l))
    .slice(0, 2)
    .join('\n');
}
