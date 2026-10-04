import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExportMenu } from '../components/ExportMenu';
import { Menu } from '../components/Menu';
import { SimpleTabPreview } from '../components/SimpleTabView';
import { parseHtab } from '../core/htab/parser';
import type { TabDoc } from '../core/htab/types';
import { FAMILIES } from '../core/instruments';
import { specFromMeta } from '../core/score';
import { confirmDiscard, downloadData, importFile, newTab, openPasteImport } from '../state/actions';
import { stop } from '../state/playback';
import { useApp } from '../state/store';
import { copyText, deleteTab, exportLibrary, importLibrary, listTabs, persistStorage, readBackup, saveTab, seedDemos, type SavedTab } from '../storage/library';

export function LibraryPage() {
  const [tabs, setTabs] = useState<SavedTab[] | null>(null);
  const [query, setQuery] = useState('');
  const [family, setFamily] = useState('all');
  const [sort, setSort] = useState<'recent' | 'title'>(() => {
    try {
      return localStorage.getItem('harpforge:lib-sort') === 'title' ? 'title' : 'recent';
    } catch {
      return 'recent';
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('harpforge:lib-sort', sort);
    } catch {
      /* storage unavailable */
    }
  }, [sort]);
  const docId = useApp((s) => s.docId);
  const savedText = useApp((s) => s.savedText);

  // After the first-run demos are in (seedDemos runs once), and again whenever something is saved.
  const refresh = useCallback(() => {
    seedDemos()
      .catch(() => undefined)
      .then(listTabs)
      .then(setTabs)
      .catch(() => setTabs([]));
  }, []);
  useEffect(refresh, [refresh, docId, savedText]);

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

  // What each tab holds, read once per list (for search, filters and previews).
  const info = useMemo(() => {
    const out = new Map<string, TabInfo>();
    for (const t of tabs ?? []) out.set(t.id, describeCached(t));
    return out;
  }, [tabs]);

  const q = query.trim().toLowerCase();
  const filtered = (tabs ?? [])
    .filter((t) => family === 'all' || info.get(t.id)?.family === family)
    .filter((t) => !q || `${t.title} ${t.harmonica} ${info.get(t.id)?.searchText ?? ''}`.toLowerCase().includes(q))
    .sort((a, b) => (sort === 'title' ? a.title.localeCompare(b.title) : b.updatedAt - a.updatedAt));

  return (
    <section className="page library-page">
      <header className="page-head row">
        <div>
          <h1>Library</h1>
          <p className="muted">Your saved tabs. Click one to play it.</p>
        </div>
        <div className="tb-group">
          <input className="search" placeholder="Search titles, artists, lyrics…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <select value={family} onChange={(e) => setFamily(e.target.value)} title="Show one kind of harmonica">
            <option value="all">All harmonicas</option>
            {FAMILIES.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as 'recent' | 'title')} title="Order">
            <option value="recent">Recently changed</option>
            <option value="title">Title A–Z</option>
          </select>
        </div>
      </header>

      {tabs === null ? (
        <p className="muted">Loading…</p>
      ) : tabs.length === 0 ? (
        <div className="lib-empty">
          <h2>Start your library</h2>
          <p className="muted">Import a file (PDF, chord sheet, ABC, MusicXML, MIDI…), paste or type a song, or write one from scratch. Saved tabs show up here.</p>
          <div className="tb-group">
            <button className="btn primary" onClick={importFile}>Open a file…</button>
            <button className="btn" onClick={openPasteImport}>Paste or type…</button>
            <button className="btn ghost" onClick={() => { newTab(); useApp.getState().setPage('editor'); }}>New tab</button>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="tab-empty">
          <p>No tabs match.</p>
        </div>
      ) : (
        <div className="lib-grid">
          {filtered.map((t) => {
            const ti = info.get(t.id);
            return (
              <article key={t.id} className={`lib-card ${t.id === docId ? 'current' : ''}`}>
                <button className="lib-open" onClick={() => open(t)} title="Play this tab">
                  <div className="lib-title">
                    <h3>{t.title}</h3>
                    {ti?.artist && <span className="muted small">{ti.artist}</span>}
                  </div>
                  <div className="chips">
                    <span className="chip">{t.harmonica}</span>
                    {t.id === docId && <span className="chip plain">Open now</span>}
                  </div>
                  <div className="lib-preview">{ti && <SimpleTabPreview doc={ti.doc} />}</div>
                </button>
                <div className="lib-actions">
                  <span className="muted small lib-date">{relativeDate(t.updatedAt)}</span>
                  <button className="btn small" onClick={() => open(t, 'editor')}>Edit</button>
                  <ExportMenu text={t.text} small />
                  <Menu
                    label="⋯"
                    title="More"
                    items={[
                      { label: 'Duplicate', onClick: () => void duplicate(t) },
                      { label: <span className="danger-text">Delete…</span>, onClick: () => void remove(t) },
                    ]}
                  />
                </div>
              </article>
            );
          })}
        </div>
      )}

      <div className="lib-backup muted small">
        <span>Tabs are stored only in this browser — clearing its site data removes them. Back up now and then.</span>
        <button className="btn small ghost" onClick={() => void backup()} disabled={!tabs?.length} title="Download every tab as .htab files in one .zip">
          Back up library
        </button>
        <button className="btn small ghost" onClick={restore} title="Add the tabs from a backup .zip">
          Restore backup…
        </button>
      </div>
    </section>
  );
}

interface TabInfo {
  doc: TabDoc;
  artist?: string;
  family: string;
  searchText: string;
}

// Parsed once per saved version of a tab.
const described = new Map<string, { at: number; info: TabInfo }>();
function describeCached(t: SavedTab): TabInfo {
  const hit = described.get(t.id);
  if (hit && hit.at === t.updatedAt) return hit.info;
  const info = describeTab(t.text);
  described.set(t.id, { at: t.updatedAt, info });
  return info;
}

function describeTab(text: string): TabInfo {
  const { doc } = parseHtab(text);
  // Syllables joined back into words ("dia-" + "mond" → "diamond"), so lyrics can be searched.
  const lyrics = doc.lines
    .flatMap((l) => l.events.map((e) => (e.kind !== 'bar' ? e.lyric ?? '' : '')))
    .filter(Boolean)
    .reduce((acc, syl) => (acc.endsWith('-') ? acc.slice(0, -1) + syl : `${acc} ${syl}`), '');
  return { doc, artist: doc.meta.artist, family: specFromMeta(doc.meta).family, searchText: `${doc.meta.artist ?? ''} ${doc.meta.key ?? ''} ${lyrics}` };
}

function relativeDate(t: number): string {
  const days = Math.floor((Date.now() - t) / 86400000);
  if (days < 1) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(t).toLocaleDateString();
}
