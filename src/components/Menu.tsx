import type { ReactNode } from 'react';
import { MenuItem as Item, Popover } from './Popover';

export interface MenuItem {
  label: ReactNode;
  hint?: ReactNode;
  onClick: () => void;
}

/** A button that opens a small menu of commands (closes on pick, Escape or a click elsewhere). */
export function Menu({ label, items, className = 'btn small ghost', title }: { label: ReactNode; items: MenuItem[]; className?: string; title?: string }) {
  return (
    <Popover label={label} buttonClass={className} title={title}>
      {(close) => items.map((it, k) => <Item key={k} label={it.label} hint={it.hint} onClick={it.onClick} close={close} />)}
    </Popover>
  );
}
