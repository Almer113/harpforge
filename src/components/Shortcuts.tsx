// "?" opens a list of every keyboard shortcut.

import { useEffect, useState } from 'react';
import { isTyping, overlayOpen } from '../live/focus';
import { Dialog } from './Dialog';

// Keys are written "Ctrl+Z / Ctrl+Y": each word is a key, and "/", "…" and "or" between them are plain text.
type Group = { title: string; rows: [string, string][] };

/** Two columns of about the same length: the app and the harmonica, then the editor. */
const COLUMNS: Group[][] = [
  [
    {
      title: 'Anywhere',
      rows: [
        ['Enter', 'Play / pause'],
        ['Esc', 'Stop, or stop recording; when stopped, end the loop or trainer, then let go of the passage'],
        ['L', 'Loop the chosen passage, or the whole song (Shift+L in the editor)'],
        ['F', 'Performance mode: the music fills the screen (Play); F or Esc leaves'],
        ['Ctrl+= / Ctrl+−', 'Performance mode: bigger / smaller music (Ctrl+0: the usual size)'],
        ['Page Down / Up, arrows', 'Performance mode: next / previous page (page-turner pedals send these; there the arrows don’t move the harmonica’s keys)'],
        ['Shift+click', 'Choose a passage, from the selected note (Play: Tab, Simple, Numbers and Lyrics views)'],
        ['Bar number', 'Click: choose that bar; Shift+click: up to it (Play: Tab and Numbers views)'],
        ['Ctrl+S', 'Save to your library'],
        ['Ctrl+P', 'Print or save as PDF'],
        ['Ctrl+Z / Ctrl+Y', 'Undo / redo'],
        ['?', 'This list'],
      ],
    },
    {
      title: 'Harmonica',
      rows: [
        ['1 … 0 - =', 'Blow holes'],
        ['Q … P [ ]', 'Draw holes'],
        ['Shift', 'Bend: hold longer to bend deeper'],
        ['Alt', 'Overblow / overdraw'],
        ['Space', 'Slide button (chromatic)'],
        ['← →', 'Move the keys along a long harmonica (Play)'],
      ],
    },
  ],
  [
    {
      title: 'Editor: writing notes',
      rows: [
        ['B V C X Z', 'Whole, half, quarter, eighth, sixteenth'],
        ['N or .', 'Dotted'],
        ['M', 'Triplet'],
        ['L', 'Tie to the previous note'],
        ['/', 'Rest at the caret'],
        ['Ctrl+L', 'Lyrics mode on and off: type the words onto the notes (or click under a note)'],
        ['Space · - · _', 'In lyrics: next note · join the next syllable · hold over the next note'],
        ['Shift+Space · Enter · Esc', 'In lyrics: back a note (or Backspace in an empty box) · done · leave without this syllable'],
        ['Ctrl+Space · Ctrl+-', 'In lyrics: a space inside the syllable · a real hyphen'],
        ['↑ ↓', 'Note up / down (Shift: a semitone)'],
        ['Del', 'Delete the selection'],
        ['Backspace', 'Step entry: take back the last note'],
        ['Ins', 'Insert or overwrite'],
      ],
    },
    {
      title: 'Editor: selecting and copying',
      rows: [
        ['← →', 'Previous / next note'],
        ['Shift+click', 'Select a range'],
        ['Ctrl+click', 'Add or remove a note'],
        ['Ctrl+A', 'Select everything'],
        ['Ctrl+C / X / V', 'Copy, cut, paste (as tab text)'],
      ],
    },
  ],
];

const JOINERS = new Set(['/', '…', 'or']);

function Keys({ spec }: { spec: string }) {
  const parts = spec.split(' ');
  return (
    <span className="sc-keys">
      {/* A lone "/" is the key itself (Rest), not a separator. */}
      {parts.map((k, i) => (JOINERS.has(k) && parts.length > 1 ? <span key={i} className="sc-join">{k}</span> : <kbd key={i}>{k}</kbd>))}
    </span>
  );
}

export function Shortcuts() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '?' && !isTyping(e.target)) {
        // Not on top of another dialog or menu (but '?' again closes this one).
        if (overlayOpen() && !document.querySelector('.shortcuts')) return;
        e.preventDefault();
        setOpen((o) => !o);
      }
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
    <Dialog label="Keyboard shortcuts" className="shortcuts" onClose={() => setOpen(false)}>
      <div className="modal-head">
        <h2>Keyboard shortcuts</h2>
        <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Close">✕</button>
      </div>
      <div className="sc-columns">
        {COLUMNS.map((groups, c) => (
          <div key={c} className="sc-column">
            {groups.map((g) => (
              <section key={g.title}>
                <h3>{g.title}</h3>
                {g.rows.map(([k, d]) => (
                  <div key={k} className="sc-row">
                    <Keys spec={k} />
                    <span className="sc-what">{d}</span>
                  </div>
                ))}
              </section>
            ))}
          </div>
        ))}
      </div>
    </Dialog>
  );
}

/** Opens the shortcut list (for a "?" button). */
export const openShortcuts = () => window.dispatchEvent(new Event('harpforge:shortcuts'));
