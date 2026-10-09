import { Transport } from '../components/Controls';
import { PerformBar } from '../components/PerformBar';
import { Harmonica, NowPlaying } from '../components/Harmonica';
import { InputBar } from '../components/InputBar';
import '../state/practice';
import { Sheet } from '../components/Sheet';
import { PracticeReport } from '../components/PracticeReport';
import { SongLine } from '../components/editor/SongDetails';
import { Popover } from '../components/Popover';
import { useHarmonicaKeyboard } from '../live/useHarmonicaKeyboard';
import { extendPassage, selectEvent } from '../state/playback';
import { enterPerform } from '../state/perform';
import { useApp, useParsed, type HarpSize } from '../state/store';
import type { Harmonica as HarmonicaT } from '../core/instruments';

const SIZES: { id: HarpSize; label: string; title: string }[] = [
  { id: 'full', label: 'Full', title: 'The whole harmonica, with its keys and notes' },
  { id: 'slim', label: 'Slim', title: 'One row of holes: more room for the music' },
  { id: 'hidden', label: 'Hidden', title: 'No harmonica (the keyboard still plays)' },
];

export function PlayPage() {
  useHarmonicaKeyboard(true);
  const parsed = useParsed();
  const recording = useApp((s) => s.recording);
  const harpSize = useApp((s) => s.harpSize);
  const practising = useApp((s) => !!s.practice);
  const performing = useApp((s) => s.performing);
  const performSize = useApp((s) => s.performSize);
  // Practising with the harmonica hidden: the slim one shows, so the next hole can be seen.
  const shown = harpSize === 'hidden' && practising ? 'slim' : harpSize;
  const onSelect = (i: number, _ev: unknown, extend?: boolean) => (extend ? extendPassage(i) : selectEvent(i));

  // Performance mode: the music alone, under one bar.
  if (performing) {
    return (
      <section className="page play-page perform-page">
        <PerformBar />
        <Sheet parsed={parsed} onSelect={onSelect} bare scale={performSize} />
        <PracticeReport />
      </section>
    );
  }

  return (
    <section className="page play-page">
      <SongLine editable={false} />

      <Transport />

      <div className={`stage ${recording ? 'is-recording' : ''} ${shown === 'hidden' ? 'folded' : ''}`}>
        <div className="stage-head">
          <span className="stage-title">Harmonica</span>
          <NowPlaying />
          <KeyHelp harp={parsed.harp} />
          <div className="seg" role="radiogroup" aria-label="Harmonica size">
            {SIZES.map((z) => (
              <button key={z.id} role="radio" aria-checked={harpSize === z.id} className={harpSize === z.id ? 'on' : ''} onClick={() => useApp.setState({ harpSize: z.id })} title={z.title}>
                {z.label}
              </button>
            ))}
          </div>
        </div>
        {shown !== 'hidden' && <Harmonica size={shown} />}
        {harpSize === 'hidden' && practising && <p className="muted small slim-note">Shown while you practise, so you can see the next hole.</p>}
        <InputBar />
      </div>

      <Sheet
        parsed={parsed}
        onSelect={onSelect}
        actions={
          <button className="btn small ghost perform-btn" onClick={enterPerform} disabled={!!recording} title={recording ? 'Stop recording first' : 'Performance mode (F): the music fills the screen, bigger; it can play silently, and pages turn with a pedal'}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
            </svg>
            Perform
          </button>
        }
      />
      <PracticeReport />
    </section>
  );
}

/** The computer-keyboard map, behind a small "Keys" button. */
function KeyHelp({ harp }: { harp: HarmonicaT }) {
  const { hasSlide, bendable, overblows } = harp;
  const holes = harp.holes.length;
  return (
    <Popover label="⌨ Keys" kind="panel" panelClass="keyhelp" wrapClass="keys-wrap" panelLabel="Keyboard keys">
      <span><kbd>1</kbd>…<kbd>0</kbd> blow</span>
      <span><kbd>Q</kbd>…<kbd>P</kbd> draw</span>
      {bendable && <span><kbd>Shift</kbd> bend (hold to go deeper)</span>}
      {overblows && <span><kbd>Alt</kbd> overblow / overdraw</span>}
      {hasSlide && <span><kbd>Space</kbd> slide</span>}
      {holes > 12 && <span><kbd>←</kbd><kbd>→</kbd> move keys</span>}
      <span>Mouse: drag sideways to glide{bendable ? ', drag out to bend' : ''}</span>
      <span><kbd>Enter</kbd> play / pause · <kbd>Esc</kbd> stop · <kbd>F</kbd> performance mode</span>
      <span><kbd>L</kbd> loop · <kbd>Shift</kbd>+click a note, or click a bar number (Tab and Numbers views), to choose a passage</span>
    </Popover>
  );
}
