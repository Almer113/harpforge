import { useEffect, useRef, useState } from 'react';
import { CodeEditor, type CodeEditorHandle } from '../components/CodeEditor';
import { PlayStop, Transport } from '../components/Controls';
import { SplitIcon, TextIcon, VisualIcon } from '../components/icons';
import { SongLine } from '../components/editor/SongDetails';
import { UndoRedo, VisualEditor, VisualToolbar } from '../components/editor/VisualEditor';
import { Sheet } from '../components/Sheet';
import { selectEvent } from '../state/playback';
import { useApp, useParsed, type EditorMode } from '../state/store';

const MODES: { id: EditorMode; label: string; icon: React.ReactNode; hint: string }[] = [
  { id: 'visual', label: 'Visual', icon: VisualIcon, hint: 'Drag-and-drop editor: measures, slots and note cards' },
  { id: 'text', label: 'Text', icon: TextIcon, hint: 'Edit the HarpTab text directly' },
  { id: 'split', label: 'Split', icon: SplitIcon, hint: 'Text and a live preview side by side' },
];

export function EditorPage() {
  const mode = useApp((s) => s.editorMode);
  const [showHelp, setShowHelp] = useState(false);
  // The header's height, so the inspector and panes stick just below it.
  const head = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = head.current;
    if (!el) return;
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty('--edit-head-h', `${el.offsetHeight}px`));
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.documentElement.style.removeProperty('--edit-head-h');
    };
  }, []);

  return (
    <section className={`page editor-page mode-${mode}`}>
      <SongLine editable />
      {/* One bar: the mode switch always first, the editor's tools, then play and the harmonica. */}
      <div className="edit-sticky" ref={head}>
        <div className="editor-bar">
          <PlayStop />
          <span className="tb-sep" />
          <div className="seg icons" role="radiogroup" aria-label="Editor mode">
            {MODES.map((m) => (
              <button key={m.id} role="radio" aria-checked={mode === m.id} aria-label={m.label} className={mode === m.id ? 'on' : ''} title={`${m.label}: ${m.hint}`} onClick={() => useApp.setState({ editorMode: m.id })}>
                {m.icon}
              </button>
            ))}
          </div>
          <UndoRedo />
          {mode === 'visual' ? (
            <VisualToolbar />
          ) : (
            <div className="tb-group">
              <span className="tb-sep" />
              <button className={`btn small ghost ${showHelp ? 'on' : ''}`} onClick={() => setShowHelp(!showHelp)} aria-pressed={showHelp}>Syntax help</button>
            </div>
          )}
          <span className="bar-spacer" />
          <Transport compact />
        </div>
      </div>

      {mode === 'visual' ? (
        <VisualEditor />
      ) : (
        <>
          {showHelp && <SyntaxHelp />}
          <TextEditor split={mode === 'split'} />
        </>
      )}
    </section>
  );
}

function TextEditor({ split }: { split: boolean }) {
  const text = useApp((s) => s.text);
  const setText = useApp((s) => s.setText);
  const parsed = useParsed();
  // The preview follows the text when typing pauses, so each key stays quick (the staff
  // in particular takes a while to draw).
  const preview = useSettled(parsed, split ? 200 : 0);
  const editor = useRef<CodeEditorHandle>(null);
  const lineOf = (offset: number) => text.slice(0, offset).split('\n').length;
  const problems = parsed.issues.filter((i) => i.severity !== 'info').length;
  const editorPane = (
    <div className="editor-pane">
      <CodeEditor ref={editor} value={text} onChange={(t) => setText(t, { kind: 'typing' })} issues={parsed.issues} />
      <div className={`issues ${problems ? '' : 'ok'}`}>
        {!problems && <span>✓ No problems</span>}
        {/* Problems first, then notes (an extra verse that's kept but not shown). */}
        {[...parsed.issues]
          .sort((a, b) => +(a.severity === 'info') - +(b.severity === 'info'))
          .slice(0, 50)
          .map((is, i) => (
            <button key={i} className={`issue ${is.severity}`} onClick={() => editor.current?.select(is.span.start, is.span.end)}>
              <b>Line {lineOf(is.span.start)}</b> {is.message}
            </button>
          ))}
      </div>
    </div>
  );
  if (!split) return <div className="editor-single">{editorPane}</div>;
  return (
    <div className="editor-split">
      {editorPane}
      <div className="preview-pane">
        <Sheet
          parsed={preview}
          title="Preview"
          onSelect={(i, ev) => {
            selectEvent(i);
            if (ev?.src) editor.current?.select(ev.src.start, ev.src.end);
          }}
        />
      </div>
    </div>
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
    ['{7}/2  {6~ 7}~~/2', 'a group lasting part of a beat (for 7/8, 5/8 …)'],
    ['.', 'rest (one beat)'],
    ['_', 'sung rest: the harp rests, the lyrics line gives it a syllable'],
    ['6~ | ~~ 5', 'tie: a lone ~ continues the previous note (across bars too)'],
    ['|  ||  |]  |:  :|  :|:', 'bar lines (:|: ends one repeat and starts the next)'],
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

/** `value`, once it has stayed the same for `ms` (0: right away). */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    if (ms <= 0) return;
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return ms <= 0 ? value : settled;
}
