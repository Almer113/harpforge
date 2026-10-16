// One dialog for Import, Plain text and the shortcut list: the keyboard goes into it when
// it opens, Tab stays inside it, Escape or a click on the dimmed page closes it, and the
// keyboard goes back to where it was when it closes.

import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({ label, className = '', onClose, children }: { label: string; className?: string; onClose: () => void; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useLayoutEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const el = box.current!;
    // Into the dialog: a field marked autofocus, else the first control.
    if (!el.contains(document.activeElement)) (el.querySelector<HTMLElement>('[autofocus]') ?? el.querySelector<HTMLElement>(FOCUSABLE) ?? el).focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      // Something inside handled it (e.g. Escape in the paste box only leaves the box).
      if (e.defaultPrevented) return;
      // (Two open — the sign-in screen over another: only the one on top answers.)
      const open = document.querySelectorAll('.modal-backdrop');
      if (open.length > 1 && open[open.length - 1] !== el.parentElement) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const list = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && (document.activeElement === first || !el.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !el.contains(document.activeElement))) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      // Back to where the keyboard was (if that's still on the page).
      if (before && document.contains(before)) before.focus({ preventScroll: true });
    };
  }, []);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && closeRef.current()}>
      <div className={`modal ${className}`} role="dialog" aria-modal="true" aria-label={label} ref={box} tabIndex={-1}>
        {children}
      </div>
    </div>
  );
}
