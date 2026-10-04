// "?" opens a list of every keyboard shortcut.

import { useEffect, useState } from 'react';
import { isTyping, overlayOpen } from '../live/focus';

const GROUPS: { title: string; rows: [string, string][] }[] = [
  {
    title: 'Anywhere',
    rows: [
      ['Enter', 'Play / pause'],
      ['Esc', 'Stop (or stop recording)'],
      ['Ctrl+S', 'Save to your library'],
      ['Ctrl+Z  Ctrl+Y', 'Undo / redo'],
      ['?', 'This list'],
    ],
  },
  {
    title: 'Harmonica (Play and Edit)',
    rows: [
      ['1 … 0  - =', 'Blow holes'],
      ['Q … P  [ ]', 'Draw holes'],
      ['Shift (hold)', 'Bend — hold longer to bend deeper'],
      ['Alt', 'Overblow / overdraw'],
      ['Space', 'Slide button (chromatic)'],
      ['← →', 'Move the keys along a long harmonica'],
    ],
  },
  {
    title: 'Visual editor',
    rows: [
      ['B V C X Z', 'Whole, half, quarter, eighth, sixteenth'],
      ['N or .', 'Dotted'],
      ['M', 'Triplet'],
      ['L', 'Tie to the previous note'],
      ['/', 'Rest at the caret'],
      ['← →', 'Previous / next note'],
      ['↑ ↓', 'Next note up / down (Shift: by semitone)'],
      ['Del', 'Delete the selection'],
      ['Ctrl+C  Ctrl+X  Ctrl+V', 'Copy, cut, paste notes (as tab text, also to and from other apps)'],
      ['Ctrl+A', 'Select everything'],
      ['Shift+click', 'Select from the last note clicked to this one'],
      ['Ctrl+click', 'Add or remove a note from the selection'],
    ],
  },
];

export function Shortcuts() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '?' && !isTyping(e.target)) {
        // Not on top of another dialog or menu (but '?' again closes this one).
        if (overlayOpen() && !document.querySelector('.shortcuts')) return;
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === 'Escape') setOpen(false);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('harpforge:shortcuts', onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('harpforge:shortcuts', onOpen);
    };
  }, []);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="modal shortcuts" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
        <div className="modal-head">
          <h2>Keyboard shortcuts</h2>
          <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Close">✕</button>
        </div>
        <div className="sc-groups">
          {GROUPS.map((g) => (
            <section key={g.title}>
              <h3>{g.title}</h3>
              {g.rows.map(([k, d]) => (
                <div key={k} className="sc-row">
                  <span className="sc-keys">
                    {k.split('  ').map((x) => (
                      <kbd key={x}>{x}</kbd>
                    ))}
                  </span>
                  <span>{d}</span>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Opens the shortcut list (for a "?" button). */
export const openShortcuts = () => window.dispatchEvent(new Event('harpforge:shortcuts'));
