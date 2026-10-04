import { useEffect, useRef, useState } from 'react';
import { useKeepInView } from './keepInView';
import { EXPORTS } from '../core/formats';
import { exportAs } from '../state/actions';

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
