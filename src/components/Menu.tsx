import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface MenuItem {
  label: ReactNode;
  hint?: ReactNode;
  onClick: () => void;
}

/** A button that opens a small menu (closes on pick, Escape or a click elsewhere). */
export function Menu({ label, items, className = 'btn small ghost', title, align = 'right' }: { label: ReactNode; items: MenuItem[]; className?: string; title?: string; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    // Keyboard: the first item gets focus, arrows move, Escape returns to the button.
    const items = () => [...(root.current?.querySelectorAll<HTMLButtonElement>('.menu-item') ?? [])];
    items()[0]?.focus({ preventScroll: true });
    const close = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        root.current?.querySelector<HTMLButtonElement>(':scope > button')?.focus();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const list = items();
        const i = list.indexOf(document.activeElement as HTMLButtonElement);
        list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus();
        e.preventDefault();
      }
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);
  return (
    <div className="menu-wrap" ref={root}>
      <button className={className} onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu" title={title}>
        {label}
      </button>
      {open && (
        <div className={`menu ${align === 'left' ? 'left' : ''}`} role="menu">
          {items.map((it, k) => (
            <button
              key={k}
              role="menuitem"
              className="menu-item"
              onClick={() => {
                setOpen(false);
                it.onClick();
              }}
            >
              <span className="mi-name">{it.label}</span>
              {it.hint && <span className="mi-hint">{it.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
