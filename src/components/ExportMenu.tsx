import { EXPORTS } from '../core/formats';
import { exportAs } from '../state/actions';
import { useApp } from '../state/store';
import { Popover } from './Popover';

/** "Export ▾" button with every export format. Exports `text`, or the current tab. */
export function ExportMenu({ text, small = false, label = 'Export' }: { text?: string; small?: boolean; label?: string }) {
  return (
    <Popover label={`${label} ▾`} buttonClass={`btn ${small ? 'small ghost' : ''}`}>
      {(close) => (
        <>
          {text === undefined && (
            <button
              role="menuitem"
              className="menu-item"
              onClick={() => {
                close();
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
                close();
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
                close();
                exportAs(f.id, text);
              }}
            >
              <span className="mi-name">{f.name} <span className="mi-ext">.{f.ext}</span></span>
              <span className="mi-hint">{f.hint}</span>
              {f.loses && <span className="mi-loses">{f.loses}</span>}
            </button>
          ))}
        </>
      )}
    </Popover>
  );
}
