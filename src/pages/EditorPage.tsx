import { useRef, useState } from 'react';
import { CodeEditor, type CodeEditorHandle } from '../components/CodeEditor';
import { HarmonicaPicker, Transport } from '../components/Controls';
import { TabView } from '../components/TabView';
import { exportCurrent, importFile, newTab, saveCurrent } from '../state/actions';
import { previewEvent } from '../state/playback';
import { isDirty, useApp, useParsed } from '../state/store';

export function EditorPage() {
  const text = useApp((s) => s.text);
  const setText = useApp((s) => s.setText);
  const activeEvents = useApp((s) => s.activeEvents);
  const selectedEvent = useApp((s) => s.selectedEvent);
  const showNoteNames = useApp((s) => s.showNoteNames);
  const dirty = useApp(isDirty);
  const parsed = useParsed();
  const editor = useRef<CodeEditorHandle>(null);
  const [showHelp, setShowHelp] = useState(false);

  const lineOf = (offset: number) => text.slice(0, offset).split('\n').length;

  return (
    <section className="page editor-page">
      <div className="toolbar">
        <div className="tb-group">
          <button className="btn" onClick={newTab}>New</button>
          <button className="btn" onClick={importFile}>Import…</button>
          <button className="btn primary" onClick={() => void saveCurrent()}>{dirty ? 'Save' : 'Saved ✓'}</button>
          <button className="btn" onClick={() => void saveCurrent(true)}>Save copy</button>
          <button className="btn" onClick={() => exportCurrent()}>Export .htab</button>
          <button className={`btn ghost ${showHelp ? 'on' : ''}`} onClick={() => setShowHelp(!showHelp)}>Syntax help</button>
        </div>
        <HarmonicaPicker />
      </div>

      <Transport />

      {showHelp && <SyntaxHelp />}

      <div className="editor-split">
        <div className="editor-pane">
          <CodeEditor ref={editor} value={text} onChange={setText} issues={parsed.issues} />
          <div className={`issues ${parsed.issues.length ? '' : 'ok'}`}>
            {parsed.issues.length === 0 ? (
              <span>✓ No problems</span>
            ) : (
              parsed.issues.slice(0, 50).map((is, i) => (
                <button key={i} className={`issue ${is.severity}`} onClick={() => editor.current?.select(is.span.start, is.span.end)}>
                  <b>Line {lineOf(is.span.start)}</b> {is.message}
                </button>
              ))
            )}
          </div>
        </div>
        <div className="preview-pane sheet">
          <TabView
            parsed={parsed}
            activeEvents={activeEvents}
            selectedEvent={selectedEvent}
            showNoteNames={showNoteNames}
            onCardClick={(i, ev) => {
              void previewEvent(i);
              if (ev.src) editor.current?.select(ev.src.start, ev.src.end);
            }}
          />
        </div>
      </div>
    </section>
  );
}

function SyntaxHelp() {
  const rows: [string, string][] = [
    ['4  -4', 'blow / draw hole 4 (also +4, 4D)'],
    ["-3'  -3''  -3'''", 'bend ½, 1, 1½ steps (also -3b)'],
    ['6o  -7o', 'overblow / overdraw'],
    ['<5', 'chromatic: slide button in'],
    ['C4  F#5  Bb3', 'a pitch instead of a hole (notes notation)'],
    ['(4 5 6)  -(1 2 3)', 'chord: holes played together'],
    ['4~  4~~', 'hold for 2 / 3 beats'],
    ['{4 5}  {4~ 5}', 'split one beat: 2 eighths / dotted rhythm'],
    ['.', 'rest (one beat)'],
    ['|  ||  |]  |:  :|', 'bar lines'],
    ['[G7]', 'chord symbol above the next note'],
    ['w: Twin-kle twin-kle', 'lyrics for the line above (one syllable per note)'],
    ['@ Chorus', 'section heading'],
    ['# note', 'comment'],
  ];
  return (
    <div className="syntax-help">
      <p>
        <b>HarpTab (.htab)</b> — a header between <code>---</code> lines (title, harmonica, tuning, harp-key, key, tempo, time), then
        one line of tab per row. Rhythm is optional: every note is one beat unless you say otherwise.
      </p>
      <div className="syntax-grid">
        {rows.map(([code, desc]) => (
          <div key={code}>
            <code>{code}</code>
            <span>{desc}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
