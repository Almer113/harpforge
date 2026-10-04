import { useCallback, useEffect, useState } from 'react';
import { confirmDiscard, downloadData } from '../state/actions';
import { ExportMenu } from '../components/ExportMenu';
import { stop } from '../state/playback';
import { useApp } from '../state/store';
import { copyText, deleteTab, exportLibrary, importLibrary, listTabs, persistStorage, readBackup, saveTab, type SavedTab } from '../storage/library';

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
    // The tab that's already open: just go to it (reloading would throw away unsaved edits).
    if (s.docId === t.id) {
      s.setPage(page);
      return;
    }
    if (!confirmDiscard()) return;
    stop();
    s.loadText(t.text, t.id, true);
    s.setPage(page);
  };

  const remove = async (t: SavedTab) => {
    if (!window.confirm(`Delete "${t.title}" from your library? This can't be undone.`)) return;
    try {
      await deleteTab(t.id);
    } catch (e) {
      useApp.getState().notify(`Couldn’t delete: ${(e as Error).message}`);
      return;
    }
    if (useApp.getState().docId === t.id) useApp.setState({ docId: null, savedText: null });
    refresh();
  };

  const duplicate = async (t: SavedTab) => {
    try {
      await saveTab(copyText(t));
    } catch (e) {
      useApp.getState().notify(`Couldn’t duplicate: ${(e as Error).message}`);
    }
    refresh();
  };

  const backup = async () => {
    try {
      const zip = await exportLibrary();
      downloadData(`HarpForge library ${new Date().toISOString().slice(0, 10)}.zip`, zip, 'application/zip');
    } catch (e) {
      useApp.getState().notify(`Backup failed: ${(e as Error).message}`);
    }
  };

  const restore = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip,application/zip';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      let files: Record<string, Uint8Array>;
      try {
        files = readBackup(new Uint8Array(await file.arrayBuffer()));
      } catch (e) {
        useApp.getState().notify(`That isn’t a library backup (${(e as Error).message}).`);
        return;
      }
      try {
        const { added, skipped } = await importLibrary(files);
        useApp.getState().notify(`Restored ${added} tab${added === 1 ? '' : 's'}${skipped ? ` (${skipped} already in your library)` : ''} ✓`);
        void persistStorage();
      } catch (e) {
        useApp.getState().notify(`Couldn’t save the restored tabs: ${(e as Error).message}. Nothing was added.`);
      }
      refresh();
    };
    input.click();
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
        </div>
      </header>
      <div className="lib-backup muted small">
        <span>Tabs are stored only in this browser — clearing its site data removes them.</span>
        <button className="btn small ghost" onClick={() => void backup()} disabled={!tabs?.length} title="Download every tab as .htab files in one .zip">
          Back up library
        </button>
        <button className="btn small ghost" onClick={restore} title="Add the tabs from a backup .zip">
          Restore backup…
        </button>
      </div>

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
