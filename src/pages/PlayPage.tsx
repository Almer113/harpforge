import { HarmonicaPicker, Transport } from '../components/Controls';
import { Harmonica } from '../components/Harmonica';
import { TabView } from '../components/TabView';
import { useHarmonicaKeyboard } from '../live/useHarmonicaKeyboard';
import { previewEvent } from '../state/playback';
import { useApp, useParsed } from '../state/store';
import { rangeLabel, type Harmonica as HarmonicaT } from '../core/instruments';

export function PlayPage() {
  useHarmonicaKeyboard(true);
  const parsed = useParsed();
  const activeEvents = useApp((s) => s.activeEvents);
  const selectedEvent = useApp((s) => s.selectedEvent);
  const showNoteNames = useApp((s) => s.showNoteNames);
  const recording = useApp((s) => s.recording);
  const { meta } = parsed.doc;

  return (
    <section className="page play-page">
      <header className="song-head">
        <div>
          <h1>{meta.title || 'Untitled'}</h1>
          <div className="chips">
            {meta.artist && <span className="chip plain">{meta.artist}</span>}
            <span className="chip">{parsed.harp.name}</span>
            <span className="chip plain">{rangeLabel(parsed.harp)}</span>
            {meta.position && <span className="chip plain">Position {meta.position}</span>}
            <span className="chip plain">{meta.time} · {meta.tempo} bpm</span>
          </div>
        </div>
        <HarmonicaPicker />
      </header>

      <Transport showRecord />

      <div className={`stage ${recording ? 'is-recording' : ''}`}>
        <Harmonica />
        <KeyHelp harp={parsed.harp} />
      </div>

      <div className="sheet">
        <div className="sheet-head">
          <h2>Tab</h2>
          <label className="check">
            <input type="checkbox" checked={showNoteNames} onChange={(e) => useApp.setState({ showNoteNames: e.target.checked })} />
            Show note names
          </label>
        </div>
        <TabView
          parsed={parsed}
          activeEvents={activeEvents}
          selectedEvent={selectedEvent}
          showNoteNames={showNoteNames}
          onCardClick={(i) => void previewEvent(i)}
        />
      </div>
    </section>
  );
}

function KeyHelp({ harp }: { harp: HarmonicaT }) {
  const { hasSlide, bendable, overblows } = harp;
  const holes = harp.holes.length;
  return (
    <div className="keyhelp">
      <span><kbd>1</kbd>…<kbd>0</kbd> blow</span>
      <span><kbd>Q</kbd>…<kbd>P</kbd> draw</span>
      {bendable && <span><kbd>Shift</kbd> bend (hold to go deeper)</span>}
      {overblows && <span><kbd>Alt</kbd> overblow / overdraw</span>}
      {hasSlide && <span><kbd>Space</kbd> slide</span>}
      {holes > 12 && <span><kbd>←</kbd><kbd>→</kbd> move keys</span>}
      <span>Mouse: drag sideways to glide{bendable ? ', drag out to bend' : ''}</span>
      <span><kbd>Enter</kbd> play/pause</span>
    </div>
  );
}
