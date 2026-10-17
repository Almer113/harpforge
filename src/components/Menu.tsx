import { useId, type ReactNode } from 'react';
import { MenuItem as Item, Popover } from './Popover';

export interface MenuItem {
  label: ReactNode;
  hint?: ReactNode;
  onClick: () => void;
  /** One of a set to pick from: whether it's the one picked. */
  checked?: boolean;
  /** A heading above this item: it starts a group (named by it) that runs to the next heading. */
  heading?: string;
}

/** A button that opens a small menu of commands (closes on pick, Escape or a click elsewhere). */
export function Menu({ label, items, className = 'btn small ghost', title }: { label: ReactNode; items: MenuItem[]; className?: string; title?: string }) {
  const id = useId();
  // The items in groups: those before the first heading, then one group per heading.
  const groups: { heading?: string; items: MenuItem[] }[] = [{ items: [] }];
  for (const it of items) {
    if (it.heading) groups.push({ heading: it.heading, items: [] });
    groups[groups.length - 1].items.push(it);
  }
  return (
    <Popover label={label} buttonClass={className} title={title}>
      {(close) =>
        groups.map((g, k) => {
          const shown = g.items.map((it, j) => <Item key={j} label={it.label} hint={it.hint} onClick={it.onClick} close={close} checked={it.checked} />);
          if (!g.heading) return shown;
          return (
            <div key={k} role="group" aria-labelledby={`${id}-${k}`} className="menu-group">
              <span className="pb-head" id={`${id}-${k}`}>
                {g.heading}
              </span>
              {shown}
            </div>
          );
        })
      }
    </Popover>
  );
}
