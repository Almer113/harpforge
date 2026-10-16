// Plain-text tab for posting on forums or in messages: choose how holes are spelled and
// what to include, see it live, copy it or save it as .txt.

import { useEffect, useMemo } from 'react';
import { slugify } from '../core/formats/common';
import { writePlainText, type PlainTextOptions } from '../core/formats/plaintext';
import { copyToClipboard } from '../live/copy';
import { downloadData } from '../state/actions';
import { Dialog } from './Dialog';
import { useApp, useParsed } from '../state/store';

export function PlainTextDialog() {
  const open = useApp((s) => s.plainTextOpen);
  const close = () => useApp.setState({ plainTextOpen: false });
  if (!open) return null;
  return (
    <Dialog label="Plain-text tab" className="text-modal" onClose={close}>
      <PlainTextBody close={close} />
    </Dialog>
  );
}

function PlainTextBody({ close }: { close: () => void }) {
  const { doc, harp } = useParsed();
  const o = useApp((s) => s.textPrefs);
  const set = (patch: Partial<PlainTextOptions>) => useApp.setState((s) => ({ textPrefs: { ...s.textPrefs, ...patch } }));
  const text = useMemo(() => writePlainText(doc, harp, o), [doc, harp, o]);
  const asNotes = o.spelling === 'notes';
  // Opens in the spelling you're reading in (Holes or Notes).
  useEffect(() => useApp.setState((s) => ({ textPrefs: { ...s.textPrefs, spelling: s.readAs } })), []);

  const copy = () =>
    void copyToClipboard(text).then((ok) =>
      useApp.getState().notify(ok ? 'Copied — paste it into your post ✓' : 'Couldn’t copy; select the text and copy it instead.'),
    );

  const check = (key: keyof PlainTextOptions, label: string) => (
    <label className="check">
      <input type="checkbox" checked={!!o[key]} onChange={(e) => set({ [key]: e.target.checked })} /> {label}
    </label>
  );

  return (
    <>
      <div className="modal-head">
        <h2>Plain-text tab</h2>
        <span className="muted small">For forums, Reddit and messages</span>
        <button className="modal-x" onClick={close} aria-label="Close">×</button>
      </div>
      <div className="text-grid">
        <div className="text-options">
          <label className="field">
            <span>Write</span>
            <select value={o.spelling} onChange={(e) => set({ spelling: e.target.value as PlainTextOptions['spelling'] })}>
              <option value="holes">Holes (4 -4 5)</option>
              <option value="notes">Notes (C5 D5 E5)</option>
            </select>
          </label>
          <label className="field">
            <span>Blow and draw</span>
            <select disabled={asNotes} value={o.style} onChange={(e) => set({ style: e.target.value as PlainTextOptions['style'] })}>
              <option value="htab">4 and -4</option>
              <option value="plusminus">+4 and -4</option>
              <option value="letters">4B and 4D</option>
            </select>
          </label>
          <label className="field">
            <span>Bends</span>
            <select disabled={asNotes} value={o.bend} onChange={(e) => set({ bend: e.target.value as PlainTextOptions['bend'] })}>
              <option value="apostrophe">-3' and -3''</option>
              <option value="b">-3b and -3bb</option>
            </select>
          </label>
          <label className="field">
            <span>Overblows</span>
            <select disabled={asNotes} value={o.over} onChange={(e) => set({ over: e.target.value as PlainTextOptions['over'] })}>
              <option value="o">6o</option>
              <option value="ob">6ob (overdraw: 7od)</option>
            </select>
          </label>
          <div className="text-checks">
            {check('title', 'Title and how to read it')}
            {check('sections', 'Section names')}
            {check('bars', 'Bar lines')}
            {check('chords', 'Chords above')}
            {check('lyrics', 'Lyrics below')}
          </div>
          <label className="field">
            <span>Line length: {o.width} characters</span>
            <input type="range" min={40} max={120} step={4} value={o.width} onChange={(e) => set({ width: parseInt(e.target.value, 10) })} />
          </label>
          <p className="muted small">Post it in a code block (or a monospaced font) so the columns stay lined up.</p>
        </div>
        <pre className="text-preview" aria-label="Preview">{text}</pre>
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={() => downloadData(`${slugify(doc.meta.title ?? 'tab')}.txt`, text, 'text/plain')}>Download .txt</button>
        <button className="btn primary" onClick={() => void copy()}>Copy</button>
      </div>
    </>
  );
}
