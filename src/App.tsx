import { useEffect, useState } from 'react';
import { Toast } from './components/Controls';
import { ImportDialog } from './components/ImportDialog';
import { ConvertPage } from './pages/ConvertPage';
import { EditorPage } from './pages/EditorPage';
import { LibraryPage } from './pages/LibraryPage';
import { PlayPage } from './pages/PlayPage';
import { importFromFile, saveCurrent } from './state/actions';
import { isDirty, useApp, useParsed, type Page } from './state/store';
import { seedDemos } from './storage/library';

const NAV: { id: Page; label: string }[] = [
  { id: 'play', label: 'Play' },
  { id: 'editor', label: 'Editor' },
  { id: 'convert', label: 'Convert' },
  { id: 'library', label: 'Library' },
];

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
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveCurrent();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
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
        <div className="doc-status" title={dirty ? 'Unsaved changes (Ctrl+S to save)' : 'Saved'}>
          <span className="doc-title">{doc.meta.title || 'Untitled'}</span>
          <span className={`dot ${dirty ? 'dirty' : 'clean'}`} />
        </div>
      </nav>
      <main>
        {page === 'play' && <PlayPage />}
        {page === 'editor' && <EditorPage />}
        {page === 'convert' && <ConvertPage />}
        {page === 'library' && <LibraryPage />}
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
