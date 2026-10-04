import { useEffect, useState } from 'react';
import { Toast } from './components/Controls';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ExportMenu } from './components/ExportMenu';
import { ImportDialog } from './components/ImportDialog';
import { Menu } from './components/Menu';
import { ConvertPage } from './pages/ConvertPage';
import { EditorPage } from './pages/EditorPage';
import { LibraryPage } from './pages/LibraryPage';
import { PlayPage } from './pages/PlayPage';
import { importFile, importFromFile, newTab, openPasteImport, saveCurrent } from './state/actions';
import { startRouter } from './state/router';
import { copyShareLink } from './state/share';
import { isDirty, useApp, useParsed, type Page } from './state/store';
import { seedDemos } from './storage/library';
import { openSharedFromUrl } from './state/share';

const NAV: { id: Page; label: string }[] = [
  { id: 'library', label: 'Library' },
  { id: 'play', label: 'Play' },
  { id: 'editor', label: 'Edit' },
  { id: 'convert', label: 'Convert' },
];

startRouter();

/** What you can do with the open tab, the same on every page. */
function TabActions() {
  const dirty = useApp(isDirty);
  const docId = useApp((s) => s.docId);
  return (
    <div className="tab-actions">
      <Menu
        label="Import ▾"
        title="Open a file, paste text, or start a new tab"
        items={[
          { label: 'Open a file…', hint: 'PDF, ABC, MusicXML, MIDI, ChordPro, chord sheet, tab', onClick: importFile },
          { label: 'Paste text…', hint: 'A chord sheet, ABC, ChordPro, MusicXML or a tab', onClick: openPasteImport },
          { label: 'New empty tab', onClick: newTab },
        ]}
      />
      <ExportMenu small />
      <button className="btn small ghost" onClick={() => void copyShareLink()} title="Copy a link that opens this tab">Share</button>
      <div className="save-split">
        <button className="btn small primary" onClick={() => void saveCurrent()} title="Save to your library (Ctrl+S)">
          {dirty || !docId ? 'Save' : 'Saved ✓'}
        </button>
        <Menu label="▾" className="btn small primary" title="More ways to save" items={[{ label: 'Save as a copy', hint: 'A new tab in your library', onClick: () => void saveCurrent(true) }]} />
      </div>
    </div>
  );
}

export function App() {
  const page = useApp((s) => s.page);
  const setPage = useApp((s) => s.setPage);
  const dirty = useApp(isDirty);
  const { doc } = useParsed();

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
    void seedDemos();
    openSharedFromUrl();
    const onHash = () => openSharedFromUrl();
    window.addEventListener('hashchange', onHash);
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveCurrent();
        return;
      }
      // Undo / redo for every edit (visual and text). Plain inputs keep their own undo.
      const el = e.target as HTMLElement;
      const plainInput = (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && !el.closest('.code-editor');
      if ((e.ctrlKey || e.metaKey) && !plainInput) {
        const k = e.key.toLowerCase();
        if (k === 'z' && !e.shiftKey) {
          e.preventDefault();
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
      <nav className="topbar">
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
        <div className="doc-status" title={dirty ? 'Unsaved changes (Ctrl+S to save)' : 'Saved in your library'}>
          <span className={`dot ${dirty ? 'dirty' : 'clean'}`} />
          <span className="doc-title">{doc.meta.title || 'Untitled'}</span>
        </div>
        <TabActions />
      </nav>
      <main>
        <ErrorBoundary resetKey={page}>
          {page === 'play' && <PlayPage />}
          {page === 'editor' && <EditorPage />}
          {page === 'convert' && <ConvertPage />}
          {page === 'library' && <LibraryPage />}
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
      <ImportDialog />
      <Toast />
    </div>
  );
}
