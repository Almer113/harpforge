import { useEffect, useRef, useState } from 'react';
import { Transport } from '../components/Controls';
import { Harmonica } from '../components/Harmonica';
import { InputBar } from '../components/InputBar';
import '../state/practice';
import { Sheet } from '../components/Sheet';
import { useHarmonicaKeyboard } from '../live/useHarmonicaKeyboard';
import { previewEvent } from '../state/playback';
import { useApp, useParsed } from '../state/store';
import { rangeLabel, type Harmonica as HarmonicaT } from '../core/instruments';

export function PlayPage() {
  useHarmonicaKeyboard(true);
  const parsed = useParsed();
  const recording = useApp((s) => s.recording);
  const harpHidden = useApp((s) => s.harpHidden);
  const { meta } = parsed.doc;

  return (
    <section className="page play-page">
      <header className="song-head slim">
        <h1>{meta.title || 'Untitled'}</h1>
        <div className="chips">
          {meta.artist && <span className="chip plain">{meta.artist}</span>}
          <span className="chip plain">{rangeLabel(parsed.harp)}</span>
          {meta.key && <span className="chip plain">Key {meta.key}</span>}
          <span className="chip plain">{meta.time} · {meta.tempo} bpm</span>
        </div>
      </header>

      <Transport />

      <div className={`stage ${recording ? 'is-recording' : ''} ${harpHidden ? 'folded' : ''}`}>
        <div className="stage-head">
          <span className="stage-title">Harmonica</span>
          <KeyHelp harp={parsed.harp} />
          <button className="btn small ghost" onClick={() => useApp.setState({ harpHidden: !harpHidden })} title={harpHidden ? 'Show the harmonica' : 'Fold the harmonica away (the keyboard still plays)'}>
            {harpHidden ? 'Show ▾' : 'Hide ▴'}
          </button>
        </div>
        {!harpHidden && <Harmonica />}
        <InputBar />
      </div>

      <Sheet parsed={parsed} onSelect={(i) => void previewEvent(i)} />
    </section>
  );
}

/** The computer-keyboard map, behind a small "Keys" button. */
function KeyHelp({ harp }: { harp: HarmonicaT }) {
  const { hasSlide, bendable, overblows } = harp;
  const holes = harp.holes.length;
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div className="keys-wrap" ref={root}>
      <button className={`btn small ghost ${open ? 'on' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open}>
        ⌨ Keys
      </button>
      {open && (
        <div className="keyhelp">
          <span><kbd>1</kbd>…<kbd>0</kbd> blow</span>
          <span><kbd>Q</kbd>…<kbd>P</kbd> draw</span>
          {bendable && <span><kbd>Shift</kbd> bend (hold to go deeper)</span>}
          {overblows && <span><kbd>Alt</kbd> overblow / overdraw</span>}
          {hasSlide && <span><kbd>Space</kbd> slide</span>}
          {holes > 12 && <span><kbd>←</kbd><kbd>→</kbd> move keys</span>}
          <span>Mouse: drag sideways to glide{bendable ? ', drag out to bend' : ''}</span>
          <span><kbd>Enter</kbd> play / pause · <kbd>Esc</kbd> stop</span>
        </div>
      )}
    </div>
  );
}
