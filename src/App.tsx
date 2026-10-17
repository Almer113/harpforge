import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Toast } from './components/Controls';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ExportMenu } from './components/ExportMenu';
import { Menu } from './components/Menu';
import { AccountGate, AccountMenu, BringSongsOffer } from './components/Account';
import { HistoryDialog } from './components/HistoryDialog';
import { PlainTextDialog } from './components/PlainTextDialog';
import { openShortcuts, Shortcuts } from './components/Shortcuts';
import { LibraryPage } from './pages/LibraryPage';
import { PlayPage } from './pages/PlayPage';
import { EXPORTS } from './core/formats/catalog';
import { exportAs, importFile, importFromFile, newTab, openPasteImport, saveCurrent } from './state/actions';
import { startRouter } from './state/router';
import { openHistory } from './state/history';
import { checkOpenTab } from './state/trash';
// (Asks before closing the page when work would be lost.)
import './state/leaveGuard';
import { copyShareLink } from './state/share';
import { isDirty, libraryInUse, useApp, useParsed, type Page } from './state/store';
import { seedDemos } from './storage/library';
import { isTyping } from './live/focus';
import { openSharedFromUrl } from './state/share';

const NAV: { id: Page; label: string }[] = [
  { id: 'library', label: 'Library' },
  { id: 'play', label: 'Play' },
  { id: 'editor', label: 'Edit' },
];

startRouter();

// The import dialog (with every format reader) loads when it's first opened. If its code
// can't be downloaded, it closes with a message, and opening it again tries again.
function lazyImportDialog() {
  return lazy(() =>
    import('./components/ImportDialog').then(
      (m) => ({ default: m.ImportDialog }),
      () => {
        LazyImportDialog = lazyImportDialog();
        useApp.setState({ importDraft: null });
        useApp.getState().notify('The import window couldn’t be loaded. Check your connection, then try again.');
        return { default: () => null };
      },
    ),
  );
}
let LazyImportDialog = lazyImportDialog();
function ImportDialog() {
  const Loaded = LazyImportDialog;
  return <Loaded />;
}
const PrintPage = lazy(() => import('./pages/PrintPage').then((m) => ({ default: m.PrintPage })));

// The editor is the biggest page: it loads the first time it's opened.
const EditorPage = lazy(() => import('./pages/EditorPage').then((m) => ({ default: m.EditorPage })));

/** What you can do with the open tab, the same on every page. */
function TabActions() {
  const dirty = useApp(isDirty);
  const docId = useApp((s) => s.docId);
  const inTrash = useApp((s) => s.inTrash);
  // (The open song is another library's than the one in use — the server unreachable, say: not "saved" here.)
  const elsewhere = useApp((s) => !!s.docId && s.libraryOwner !== libraryInUse(s));
  return (
    <div className="tab-actions">
      <div className="wide-actions">
        <button className="btn small ghost kbd-btn" onClick={openShortcuts} title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts">?</button>
        <Menu
          label="Import ▾"
          title="Open a file, paste text, or start a new tab"
          items={[
            { label: 'Open a file…', hint: 'PDF, ABC, MusicXML, MIDI, ChordPro, chord sheet, tab', onClick: importFile },
            { label: 'Paste or type…', hint: 'A chord sheet, ABC, ChordPro, MusicXML, a tab — or notes to turn into a tab', onClick: openPasteImport },
            { label: 'New empty tab', onClick: newTab },
          ]}
        />
        <ExportMenu small />
        <button className="btn small ghost" onClick={() => void copyShareLink()} title="Copy a link that opens this tab">Share</button>
      </div>
      {/* Narrow windows: the same actions folded into one menu. */}
      <div className="narrow-actions">
        <Menu
          label="⋯"
          title="Import, export, share"
          items={[
            { label: 'Open a file…', onClick: importFile },
            { label: 'Paste or type…', onClick: openPasteImport },
            { label: 'New empty tab', onClick: newTab },
            { label: 'Print or save as PDF…', onClick: () => useApp.getState().setPage('print') },
            { label: 'Plain text…', onClick: () => useApp.setState({ plainTextOpen: true }) },
            ...EXPORTS.map((f) => ({ label: `Export ${f.name} (.${f.ext})`, onClick: () => exportAs(f.id) })),
            { label: 'Copy a share link', onClick: () => void copyShareLink() },
            { label: 'Keyboard shortcuts', onClick: openShortcuts },
          ]}
        />
      </div>
      {inTrash && (
        <span className="chip trash-chip" title="You deleted this tab: it’s in the library’s trash. Saving it puts it back.">
          In trash
        </span>
      )}
      <div className="save-split">
        <button className="btn small primary" onClick={() => void saveCurrent()} title={inTrash ? 'Save it back into your library (Ctrl+S)' : 'Save to your library (Ctrl+S)'}>
          {dirty || !docId || inTrash || elsewhere ? 'Save' : 'Saved ✓'}
        </button>
        <Menu
          label="▾"
          className="btn small primary"
          title="More ways to save"
          items={[
            { label: 'Save as a copy', hint: 'A new tab in your library', onClick: () => void saveCurrent(true) },
            ...(docId && !elsewhere ? [{ label: 'History…', hint: 'Earlier saved versions: compare, bring one back', onClick: () => openHistory(docId) }] : []),
          ]}
        />
      </div>
    </div>
  );
}

export function App() {
  const importOpen = useApp((s) => !!s.importDraft);
  const page = useApp((s) => s.page);
  const setPage = useApp((s) => s.setPage);
  const dirty = useApp(isDirty);
  const docId = useApp((s) => s.docId);
  const inTrash = useApp((s) => s.inTrash);
  // In the library and unchanged (as the Save button says "Saved ✓").
  const elsewhere = useApp((s) => !!s.docId && s.libraryOwner !== libraryInUse(s));
  const saved = !!docId && !dirty && !inTrash && !elsewhere;
  // The tab open (from before a reload, say) may be one you've since deleted — here, in
  // another window, or by the trash's month running out: checked when it opens, when the
  // library changes, and when you come back to this window.
  // (The first two: trash.ts.)
  useEffect(() => {
    const onFocus = () => void checkOpenTab();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);
  const { doc } = useParsed();
  // The sticky headers sit just below the top bar, whatever its height.
  const topbar = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = topbar.current;
    if (!el) return;
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty('--topbar-h', `${el.offsetHeight}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Drag & drop a file anywhere to import it.
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const file = e.dataTransfer?.files[0];
      if (file) void importFromFile(file);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, []);

  useEffect(() => {
    seedDemos()
      .then((updated) => {
        // The song open is a demo just brought up to date, with nothing changed since it was
        // saved: it opens as it is now.
        const s = useApp.getState();
        const text = s.docId ? updated.get(s.docId) : undefined;
        if (text && s.text === s.savedText && s.text !== text) s.loadText(text, s.docId, true);
      })
      .catch(() => undefined);
    openSharedFromUrl();
    const onHash = () => openSharedFromUrl();
    window.addEventListener('hashchange', onHash);
    const onKey = (e: KeyboardEvent) => {
      // (Not behind a dialog — the start screen, say: Ctrl+S and Ctrl+P are for the song.)
      if ((e.ctrlKey || e.metaKey) && /^[ps]$/i.test(e.key) && document.querySelector('.modal-backdrop')) {
        e.preventDefault();
        return;
      }
      // Ctrl+P: the print view (printing the app itself would be dark pages); on it, print.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        if (useApp.getState().page === 'print') window.print();
        else useApp.getState().setPage('print');
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        // Holding the keys down saves once.
        if (!e.repeat) void saveCurrent();
        return;
      }
      // Undo / redo for every edit (visual and text). Plain inputs keep their own undo.
      const el = e.target as HTMLElement;
      const plainInput = isTyping(el) && el.tagName !== 'SELECT' && !el.closest('.code-editor');
      // (Not behind a dialog: the song isn't what's in front of you.)
      if ((e.ctrlKey || e.metaKey) && !plainInput && !document.querySelector('.modal-backdrop')) {
        const k = e.key.toLowerCase();
        if (k === 'z' && !e.shiftKey) {
          e.preventDefault();
          // On the Library page, a library change's Undo (a delete, a copy) comes first.
          const { page, toast } = useApp.getState();
          if (page === 'library' && toast?.action?.label === 'Undo') {
            useApp.setState({ toast: null });
            toast.action.run();
            return;
          }
          useApp.getState().undo();
        } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
          e.preventDefault();
          useApp.getState().redo();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('hashchange', onHash);
    };
  }, []);

  return (
    <div className="app">
      <nav className="topbar" ref={topbar}>
        <div className="brand">
          <svg viewBox="0 0 64 64" width="28" height="28" aria-hidden>
            <rect x="4" y="18" width="56" height="28" rx="6" fill="var(--brass)" />
            <rect x="8" y="27" width="48" height="10" rx="2" fill="var(--bg)" />
            <g fill="var(--brass)">
              {[15, 23, 31, 39, 47].map((x) => <rect key={x} x={x} y="27" width="2" height="10" />)}
            </g>
          </svg>
          <span>HarpForge</span>
        </div>
        <div className="nav">
          {NAV.map((n) => (
            <button key={n.id} className={page === n.id ? 'active' : ''} onClick={() => setPage(n.id)}>
              {n.label}
            </button>
          ))}
        </div>
        {/* On Play and Edit the page shows the title itself, big. */}
        <div className={`doc-status ${page === 'play' || page === 'editor' ? 'hidden-here' : ''}`} title={saved ? 'Saved in your library' : inTrash ? 'In the trash (Ctrl+S saves it back)' : docId ? 'Unsaved changes (Ctrl+S to save)' : 'Not in your library yet (Ctrl+S to save)'}>
          <span className={`dot ${saved ? 'clean' : 'dirty'}`} aria-hidden />
          <span className="doc-title">{doc.meta.title || 'Untitled'}</span>
        </div>
        <TabActions />
        <AccountMenu />
      </nav>
      <main>
        <ErrorBoundary resetKey={page}>
          {page === 'play' && <PlayPage />}
          {page === 'editor' && (
            <Suspense fallback={<section className="page"><p className="muted">Loading the editor…</p></section>}>
              <EditorPage />
            </Suspense>
          )}
          {page === 'library' && <LibraryPage />}
          {page === 'print' && (
            <Suspense fallback={<section className="page"><p className="muted">Loading…</p></section>}>
              <PrintPage />
            </Suspense>
          )}
        </ErrorBoundary>
      </main>
      {dragging && (
        <div className="drop-overlay">
          <div>
            <b>Drop to import</b>
            <span>PDF, chord sheet, ABC, MusicXML, MIDI, ChordPro or tab</span>
          </div>
        </div>
      )}
      {importOpen && (
        <Suspense fallback={<div className="modal-backdrop"><p className="modal muted" role="status">Loading the import window…</p></div>}>
          <ImportDialog />
        </Suspense>
      )}
      <PlainTextDialog />
      <HistoryDialog />
      <AccountGate />
      <BringSongsOffer />
      <Shortcuts />
      <Toast />
    </div>
  );
}
