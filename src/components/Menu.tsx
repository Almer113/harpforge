import { Fragment, type ReactNode } from 'react';
import { MenuItem as Item, Popover } from './Popover';

export interface MenuItem {
  label: ReactNode;
  hint?: ReactNode;
  onClick: () => void;
  /** One of a set to pick from: whether it's the one picked. */
  checked?: boolean;
  /** A heading above this item (it starts a group). */
  heading?: string;
}

/** A button that opens a small menu of commands (closes on pick, Escape or a click elsewhere). */
export function Menu({ label, items, className = 'btn small ghost', title }: { label: ReactNode; items: MenuItem[]; className?: string; title?: string }) {
  return (
    <Popover label={label} buttonClass={className} title={title}>
      {(close) =>
        items.map((it, k) => (
          <Fragment key={k}>
            {it.heading && (
              <span className="pb-head" role="presentation">
                {it.heading}
              </span>
            )}
            <Item label={it.label} hint={it.hint} onClick={it.onClick} close={close} checked={it.checked} />
          </Fragment>
        ))
      }
    </Popover>
  );
}
