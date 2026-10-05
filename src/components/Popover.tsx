// One popover for every button that opens something small: menus, the Show checklist,
// the harmonica picker, the keyboard help. It closes on a click elsewhere or Escape
// (giving focus back to its button), stays inside the window, and in a menu the arrow
// keys move between the items.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useKeepInView } from './keepInView';

export interface PopoverProps {
  /** What the button shows. */
  label: ReactNode;
  buttonClass?: string;
  title?: string;
  /** The button's name for screen readers, when its label isn't words. */
  ariaLabel?: string;
  /** The open panel's name for screen readers (default: the button's). */
  panelLabel?: string;
  /** 'menu': a list of commands (role=menu, arrow keys). 'panel': fields and checkboxes. */
  kind?: 'menu' | 'panel';
  /** Classes of the open panel (its look: "menu", "harp-pop", "keyhelp"…). */
  panelClass?: string;
  wrapClass?: string;
  /** The panel's contents; a function gets `close` (for items that close the popover). */
  children: ReactNode | ((close: () => void) => ReactNode);
  /** Called when it opens or closes. */
  onToggle?: (open: boolean) => void;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Popover({ label, buttonClass = 'btn small ghost', title, ariaLabel, panelLabel, kind = 'menu', panelClass = 'menu', wrapClass = '', children, onToggle }: PopoverProps) {
  const [open, setOpenState] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const setOpen = (v: boolean) => {
    setOpenState(v);
    onToggle?.(v);
  };
  /** Closes; `refocus` puts the keyboard back on the button (after Escape or picking an item). */
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) button.current?.focus({ preventScroll: true });
  };
  useKeepInView(open, root);

  useEffect(() => {
    if (!open) return;
    const panel = () => root.current?.querySelector<HTMLElement>(':scope > .pop-panel');
    const items = () => [...(panel()?.querySelectorAll<HTMLElement>(kind === 'menu' ? '[role=menuitem]' : FOCUSABLE) ?? [])];
    // The keyboard goes to the first item (a menu) or field (a panel).
    items()[0]?.focus({ preventScroll: true });
    // A dialog opened over the popover (e.g. the shortcut list from the keyboard help) has the
    // keyboard and the mouse; the popover waits underneath.
    const underDialog = () => !!document.querySelector('.modal-backdrop') && !root.current?.closest('.modal');
    const onDown = (e: MouseEvent) => !underDialog() && !root.current?.contains(e.target as Node) && close(false);
    const onKey = (e: KeyboardEvent) => {
      // Something inside the panel handled it (e.g. the harmonica's key question).
      if (e.defaultPrevented || underDialog()) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      } else if (kind === 'menu' && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        const list = items();
        const i = list.indexOf(document.activeElement as HTMLElement);
        list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus();
        e.preventDefault();
      } else if (kind === 'menu' && e.key === 'Tab') close(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, kind]);

  return (
    <div className={`menu-wrap ${wrapClass}`} ref={root}>
      <button
        ref={button}
        className={`${buttonClass} ${open ? 'on' : ''}`}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup={kind === 'menu' ? 'menu' : 'dialog'}
        title={title}
        aria-label={ariaLabel}
      >
        {label}
      </button>
      {open && (
        <div className={`pop-panel ${panelClass}`} role={kind === 'menu' ? 'menu' : 'dialog'} aria-label={panelLabel ?? ariaLabel ?? title}>
          {typeof children === 'function' ? children(() => close()) : children}
        </div>
      )}
    </div>
  );
}

/** One command in a menu popover. */
export function MenuItem({ label, hint, onClick, close }: { label: ReactNode; hint?: ReactNode; onClick: () => void; close: () => void }) {
  return (
    <button
      role="menuitem"
      className="menu-item"
      onClick={() => {
        close();
        onClick();
      }}
    >
      <span className="mi-name">{label}</span>
      {hint && <span className="mi-hint">{hint}</span>}
    </button>
  );
}
