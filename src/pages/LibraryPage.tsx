import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExportMenu } from '../components/ExportMenu';
import { Menu } from '../components/Menu';
import { SimpleTabPreview } from '../components/SimpleTabView';
import { parseHtab } from '../core/htab/parser';
import type { TabDoc } from '../core/htab/types';
import { FAMILIES } from '../core/instruments';
import { specFromMeta } from '../core/score';
import { confirmDiscard, downloadData, importFile, newTab, openPasteImport } from '../state/actions';
import { openHistory } from '../state/history';
import { stop } from '../state/playback';
import { useApp } from '../state/store';
import { deleteForever, duplicateTab, emptyTheTrash, moveToTrash, restoreBackup, restoreFromTrash } from '../state/trash';
import { exportLibrary, libraryStats, listTabs, listTrash, persistStorage, readBackup, recoverableTabs, recoverTabs, seedDemos, TRASH_DAYS, type SavedTab } from '../storage/library';

export function LibraryPage() {
  const [tabs, setTabs] = useState<SavedTab[] | null>(null);
  /** Why the library couldn't be read (storage blocked or broken), if it couldn't. */
  const [loadError, setLoadError] = useState<string | null>(null);
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
  const libraryRev = useApp((s) => s.libraryRev);
  const [showTrash, setShowTrash] = useState(false);
  const [trash, setTrash] = useState<SavedTab[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);

  // After the first-run demos are in (seedDemos runs once), and again whenever something is saved.
  const refresh = useCallback(() => {
    seedDemos()
      .catch(() => undefined)
      .then(listTabs)
      .then(async (list) => {
        setTabs(list);
        setTrash(await listTrash());
        setStats(await libraryStats());
        setLoadError(null);
      })
      .catch((e: Error) => setLoadError(e?.message || 'storage unavailable'));
  }, []);
  useEffect(refresh, [refresh, docId, savedText, libraryRev]);
  // (The trash emptied: back to the library.)
  if (showTrash && !trash.length) setShowTrash(false);


  // An empty library whose tabs are still in the working copies: the browser cleared it.
  const [recoverable, setRecoverable] = useState(0);
  const empty = tabs?.length === 0;
  useEffect(() => {
    if (!empty) return;
    let live = true;
    recoverableTabs()
      .then((found) => live && setRecoverable(found.length))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [empty]);
  const recover = async () => {
    try {
      const n = await recoverTabs();
      setRecoverable(0);
      useApp.getState().notify(`Recovered ${n} tab${n === 1 ? '' : 's'} ✓`);
    } catch (e) {
      useApp.getState().notify(`Couldn’t recover: ${(e as Error).message}`);
    }
    refresh();
  };

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

  const startNew = () => {
    if (newTab()) useApp.getState().setPage('editor');
  };


  const backup = async (full = false) => {
    try {
      const zip = await exportLibrary({ full });
      downloadData(`HarpForge library${full ? ' (full)' : ''} ${new Date().toISOString().slice(0, 10)}.zip`, zip, 'application/zip');
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
      if (await restoreBackup(files)) void persistStorage();
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
        <div className="tb-group" style={showTrash ? { visibility: 'hidden' } : undefined}>
          <input className="search" type="search" aria-label="Search your tabs" placeholder="Search titles, artists, lyrics…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <select value={family} onChange={(e) => setFamily(e.target.value)} title="Show one kind of harmonica" aria-label="Kind of harmonica">
            <option value="all">All harmonicas</option>
            {FAMILIES.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as 'recent' | 'title')} title="Order" aria-label="Order">
            <option value="recent">Recently changed</option>
            <option value="title">Title A–Z</option>
          </select>
        </div>
      </header>

      {loadError && (
        <div className="lib-error" role="alert">
          <p>
            <b>Couldn’t read your library</b> ({loadError}). Your tabs aren’t deleted: this usually means the browser is blocking storage for this site
            (private window, or site data settings).
          </p>
          <button className="btn small" onClick={refresh}>Retry</button>
        </div>
      )}
      {showTrash ? (
        <TrashView tabs={trash} docId={docId} onBack={() => setShowTrash(false)} />
      ) : tabs === null ? (
        !loadError && <p className="muted">Loading…</p>
      ) : tabs.length === 0 ? (
        <div className="lib-empty">
          {recoverable > 0 && (
            <div className="lib-recover" role="status">
              <p>
                <b>Your library was cleared</b>, but {recoverable} saved tab{recoverable === 1 ? ' is' : 's are'} still in this browser. Browsers sometimes clear a
                site’s storage when the disk is nearly full.
              </p>
              <button className="btn primary" onClick={() => void recover()}>Recover {recoverable} tab{recoverable === 1 ? '' : 's'}</button>
            </div>
          )}
          <div className="lib-empty-text">
            <h2>Start your library</h2>
            <p className="muted">Write a song from scratch, import a file (PDF, chord sheet, ABC, MusicXML, MIDI…), or paste tab from anywhere. Saved tabs show up here.</p>
          </div>
          <NewTabCard onNew={startNew} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="tab-empty">
          <p>No tabs match.</p>
        </div>
      ) : (
        <div className="lib-grid">
          {/* Always first (whatever the order); not while searching or filtering, where the grid shows only results. */}
          {!q && family === 'all' && (
            <NewTabCard onNew={startNew} />
          )}
          {filtered.map((t) => {
            const ti = info.get(t.id);
            return (
              <article key={t.id} className={`lib-card ${t.id === docId ? 'current' : ''}`}>
                <div className="lib-main">
                  <div className="lib-title">
                    <h3>
                      {/* Covers the whole card (see .lib-open::after), so a click anywhere plays it. */}
                      <button className="lib-open" onClick={() => open(t)} title="Play this tab">
                        {t.title}
                      </button>
                    </h3>
                    {ti?.artist && <span className="muted small">{ti.artist}</span>}
                  </div>
                  <div className="chips">
                    <span className="chip">{t.harmonica}</span>
                    {t.id === docId && <span className="chip plain">Open now</span>}
                  </div>
                  <div className="lib-preview">{ti && <SimpleTabPreview doc={ti.doc} />}</div>
                </div>
                <div className="lib-actions">
                  <span className="muted small lib-date">{relativeDate(t.updatedAt)}</span>
                  <button className="btn small" onClick={() => open(t, 'editor')}>Edit</button>
                  <ExportMenu text={t.text} small />
                  <Menu
                    label="⋯"
                    title="More"
                    items={[
                      { label: 'History…', onClick: () => openHistory(t.id) },
                      { label: 'Duplicate', onClick: () => void duplicateTab(t) },
                      { label: <span className="danger-text">Delete</span>, hint: 'To the trash (Undo, or restore it there)', onClick: () => void moveToTrash(t) },
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
        <div className="save-split">
          <button className="btn small ghost" onClick={() => void backup()} disabled={!tabs?.length} title="Download every tab as .htab files in one .zip">
            Back up library
          </button>
          <Menu
            label="▾"
            title="More ways to back up"
            items={[{ label: 'Back up with history and trash', hint: 'Every saved version, and the trash too (a bigger file)', onClick: () => void backup(true) }]}
          />
        </div>
        <button className="btn small ghost" onClick={restore} title="Add the tabs from a backup .zip">
          Restore backup…
        </button>
        {trash.length > 0 && !showTrash && (
          <button className="btn small ghost" onClick={() => setShowTrash(true)} title={`Deleted tabs wait here for ${TRASH_DAYS} days`}>
            Trash ({trash.length})
          </button>
        )}
        {stats && <span className="lib-stats">{statsLine(stats)}</span>}
      </div>
    </section>
  );
}

/** The trash: deleted tabs, each to put back or delete for good; they go by themselves after a month. */
function TrashView({ tabs, docId, onBack }: { tabs: SavedTab[]; docId: string | null; onBack: () => void }) {
  return (
    <div className="trash">
      <div className="trash-head">
        <button className="btn small ghost" onClick={onBack}>← Library</button>
        <h2>Trash</h2>
        <span className="muted small">Deleted tabs wait here for {TRASH_DAYS} days, then go for good.</span>
        <button className="btn small ghost danger-text" onClick={() => void emptyTheTrash(tabs)}>Empty trash…</button>
      </div>
      <ul className="trash-list">
        {tabs.map((t) => (
          <li key={t.id} className="trash-item">
            <div className="trash-info">
              <b>{t.title}</b>
              <span className="muted small">
                {t.harmonica} · deleted {relativeDate(t.deletedAt!).toLowerCase()} · goes in {left(t)} day{left(t) === 1 ? '' : 's'}
                {t.id === docId ? ' · open now' : ''}
              </span>
            </div>
            <button className="btn small" onClick={() => void restoreFromTrash(t)}>Put back</button>
            <button className="btn small ghost danger-text" onClick={() => void deleteForever(t)}>Delete for good…</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The "+ New tab" card: first in the library (and the empty library's way in). New tab on
 * top, Open a file and Paste or type below, the part under the mouse tinted brass.
 */
function NewTabCard({ onNew }: { onNew: () => void }) {
  return (
    <article className="lib-card lib-new" role="group" aria-label="Add a tab">
      <button className="lib-new-part main" onClick={onNew} aria-label="New tab: start from scratch in the editor">
        {NEW_ICONS.plus}
        <span>New tab</span>
      </button>
      <div className="lib-new-row">
        <button className="lib-new-part" onClick={importFile} title="Import a PDF, chord sheet, ABC, MusicXML, MIDI or tab file">
          {NEW_ICONS.file}
          <span>Open a file</span>
        </button>
        <button className="lib-new-part" onClick={openPasteImport} title="Paste tab, notes or a chord sheet from anywhere, or type a song">
          {NEW_ICONS.paste}
          <span>Paste or type</span>
        </button>
      </div>
    </article>
  );
}

// The "+ New tab" card's icons (one stroke style, like the rest of the app's icons).
const svg = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);
const NEW_ICONS = {
  plus: svg('M12 5v14M5 12h14'),
  file: svg('M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M12 18v-6M9 15l3-3 3 3'),
  paste: svg('M9 4h6v3H9zM9 5.5H7a2 2 0 0 0-2 2V19a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7.5a2 2 0 0 0-2-2h-2M9 12h6M9 16h4'),
};

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

type Stats = Awaited<ReturnType<typeof libraryStats>>;

/** "6 tabs, 24 saved versions, 1 in the trash: about 48 KB". */
function statsLine(s: Stats): string {
  const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
  const size = s.bytes < 1024 * 1024 ? `${Math.max(1, Math.round(s.bytes / 1024))} KB` : `${(s.bytes / 1024 / 1024).toFixed(1)} MB`;
  const parts = [n(s.tabs, 'tab'), n(s.versions, 'saved version'), s.trashed ? `${s.trashed} in the trash` : ''].filter(Boolean);
  return `${parts.join(', ')}: about ${size}`;
}

/** Days until a tab in the trash goes for good. */
function left(t: SavedTab): number {
  return Math.max(1, TRASH_DAYS - Math.floor((Date.now() - t.deletedAt!) / 86400000));
}

function relativeDate(t: number): string {
  const days = Math.floor((Date.now() - t) / 86400000);
  if (days < 1) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(t).toLocaleDateString();
}
