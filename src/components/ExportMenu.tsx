import { useEffect, useRef, useState } from 'react';
import { useKeepInView } from './keepInView';
import { EXPORTS } from '../core/formats';
import { exportAs } from '../state/actions';
import { useApp } from '../state/store';

/** "Export ▾" button with every export format. Exports `text`, or the current tab. */
export function ExportMenu({ text, small = false, label = 'Export' }: { text?: string; small?: boolean; label?: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useKeepInView(open, root);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <div className="menu-wrap" ref={root}>
      <button className={`btn ${small ? 'small ghost' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open}>
        {label} ▾
      </button>
      {open && (
        <div className="menu" role="menu">
          {text === undefined && (
            <button
              role="menuitem"
              className="menu-item"
              onClick={() => {
                setOpen(false);
                useApp.getState().setPage('print');
              }}
            >
              <span className="mi-name">Print or save as PDF… <span className="mi-ext">Ctrl+P</span></span>
              <span className="mi-hint">Ink on white, with a choice of view and size</span>
            </button>
          )}
          {text === undefined && (
            <button
              role="menuitem"
              className="menu-item"
              onClick={() => {
                setOpen(false);
                useApp.setState({ plainTextOpen: true });
              }}
            >
              <span className="mi-name">Plain text… <span className="mi-ext">.txt</span></span>
              <span className="mi-hint">To post on a forum or in a message: copy, or save as .txt</span>
            </button>
          )}
          {EXPORTS.map((f) => (
            <button
              key={f.id}
              role="menuitem"
              className="menu-item"
              onClick={() => {
                setOpen(false);
                exportAs(f.id, text);
              }}
            >
              <span className="mi-name">{f.name} <span className="mi-ext">.{f.ext}</span></span>
              <span className="mi-hint">{f.hint}</span>
              {f.loses && <span className="mi-loses">{f.loses}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
