import { useEffect } from 'react';
import { Toast } from './components/Controls';
import { ImportDialog } from './components/ImportDialog';
import { ConvertPage } from './pages/ConvertPage';
import { EditorPage } from './pages/EditorPage';
import { LibraryPage } from './pages/LibraryPage';
import { PlayPage } from './pages/PlayPage';
import { saveCurrent } from './state/actions';
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
      <ImportDialog />
      <Toast />
    </div>
  );
}
