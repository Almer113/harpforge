import { useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { lineVerses, songVerses } from '../core/verses';
import { FAMILIES, getHarmonica, harmonicaName, keysFor, rangeLabel, specId, tuningsFor, type Family, type HarmonicaSpec } from '../core/instruments';
import { keysTaken } from '../live/focus';
import { stopRecording } from '../live/recorder';
import { isKeyChange, keyDistance, setHarmonica, shiftOctave } from '../state/actions';
import { guessTonic, harpForPosition, octaveOptions, positionFor, positionName } from '../core/convert';
import { mod12, transposeKey } from '../core/pitch';
import { describePassage } from '../core/passage';
import { ordinal, passageHasEndings } from '../core/endings';
import { BACKING_STYLES, hasChords } from '../core/backing';
import { atStart, backToStart, currentPassage, endPassageLoop, extendPassage, holdTrainer, playFrom, startLabel, startTrainer, stop, stopTrainer, toggleLoop, togglePlay, trainerLabel } from '../state/playback';
import { exitPerform, performResize, togglePerform } from '../state/perform';
import { DEFAULT_MIX, setPartOff, TRAINER_CHOICES, useApp, useParsed, type AppState, type Mix, type MixPart, type TrainerSettings } from '../state/store';
import { Popover } from './Popover';

export function HarmonicaPicker() {
  const { harp, doc } = useParsed();
  const octaves = useMemo(() => octaveOptions(doc, harp), [doc, harp]);
  const up = octaves.find((o) => o.shift === 12)!;
  const down = octaves.find((o) => o.shift === -12)!;
  const { family, tuning, key } = harp.spec;
  // A key change on the same kind of harp asks: keep the holes or keep the notes?
  const [pending, setPending] = useState<HarmonicaSpec | null>(null);
  const tonic = useMemo(() => guessTonic(doc, harp), [doc, harp]);
  const position = tonic !== undefined && family !== 'chromatic' ? positionFor(key, tonic) : undefined;

  const change = (spec: HarmonicaSpec) => {
    // Reading in notes, the notes are what you keep: no need to ask.
    if (isKeyChange(spec) && useApp.getState().readAs !== 'notes') setPending(spec);
    else setHarmonica(spec);
  };
  const setFamily = (f: Family) => {
    // Keep the key if the new family has it, else the key with the same pitch (Low F → F).
    const keys = keysFor(f);
    const same = keys.find((k) => k === key) ?? keys.find((k) => mod12(getHarmonica({ family: f, key: k }).holes[0].blow) === mod12(harp.holes[0].blow));
    setHarmonica({ family: f, tuning: tuningsFor(f)[0].id, key: same ?? 'C' });
  };
  const setPosition = (n: number) => {
    if (tonic === undefined) return;
    const pc = harpForPosition(tonic, n);
    const keys = keysFor(family);
    // Prefer a standard key; Low/High only when it's the current one or the only match.
    const match = keys.filter((k) => mod12(getHarmonica({ family, tuning, key: k }).holes[0].blow) === pc);
    const next = match.find((k) => k === key) ?? match.find((k) => !/Low|High/.test(k)) ?? match[0];
    if (next) setHarmonica({ family, tuning, key: next }, 'notes');
  };

  return (
    <div className="picker" title="Pick the harmonica this tab is for">
      <label>
        <span>Harmonica</span>
        <select value={family} onChange={(e) => setFamily(e.target.value as Family)}>
          {FAMILIES.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
      </label>
      <label>
        <span>Tuning</span>
        <select value={tuning} onChange={(e) => setHarmonica({ family, tuning: e.target.value, key })}>
          {tuningsFor(family).map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </label>
      <div className="picker-key">
        <label>
          <span>Key</span>
          <select value={pending?.key ?? key} onChange={(e) => change({ family, tuning, key: e.target.value })}>
            {keysFor(family).map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        </label>
        {pending && <KeyChoice from={harp.spec} to={pending} songKey={doc.meta.key} onClose={() => setPending(null)} />}
      </div>
      {position !== undefined && (
        <label title="Position: which note of the harp the song is centred on. 1st = the harp's own key, 2nd = cross harp (blues), 3rd = minor/dorian. Changing it picks the harp that plays the song in that position.">
          <span>Position</span>
          <select value={position} onChange={(e) => setPosition(parseInt(e.target.value, 10))}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {positionName(n)}
                {n === 2 ? ' (cross)' : ''}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="octave-ctl">
        <span>Octave</span>
        <div className="seg">
          <button disabled={!down.possible} onClick={() => shiftOctave(-12)} title={down.note} aria-label="Octave down">▼</button>
          <button disabled={!up.possible} onClick={() => shiftOctave(12)} title={up.note} aria-label="Octave up">▲</button>
        </div>
      </div>
    </div>
  );
}

/** Asks how to switch to a harp in another key: same tab (transpose) or same music (re-tab). */
function KeyChoice({ from, to, songKey, onClose }: { from: HarmonicaSpec; to: HarmonicaSpec; songKey?: string; onClose: () => void }) {
  const semis = keyDistance(from, to);
  const movedKey = songKey ? transposeKey(songKey, semis) : undefined;
  const root = useRef<HTMLDivElement>(null);
  // Escape or a click elsewhere cancels. Escape is caught first (capture) and marked handled,
  // so the harmonica popover around it stays open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      onClose();
    };
    const onDown = (e: MouseEvent) => !root.current?.contains(e.target as Node) && onClose();
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);
  // When it closes, the keyboard goes back to where it was (the harmonica you picked).
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    return () => {
      const lost = !document.activeElement || document.activeElement === document.body;
      if (lost && before && before !== document.body && document.contains(before)) before.focus({ preventScroll: true });
    };
  }, []);
  // "an A harp", "an F harp", "a G harp"
  const harpName = `${/^[AEF]/.test(to.key) ? 'an' : 'a'} ${to.key} harp`;
  const pick = (keep: 'holes' | 'notes') => {
    onClose();
    setHarmonica(to, keep);
  };
  return (
    <div className="key-choice" role="dialog" aria-label={`Switch to ${harpName}`} ref={root}>
      <b>Switch to {harpName}</b>
      <button className="kc-option" onClick={() => pick('holes')} autoFocus>
        <span className="kc-title">Keep the holes</span>
        <span className="kc-desc">
          The tab stays the same; it sounds {Math.abs(semis)} semitone{Math.abs(semis) === 1 ? '' : 's'} {semis > 0 ? 'higher' : 'lower'}
          {movedKey ? `, in ${movedKey}` : ''}. Chord symbols move too.
        </span>
      </button>
      <button className="kc-option" onClick={() => pick('notes')}>
        <span className="kc-title">Keep the notes</span>
        <span className="kc-desc">Re-tab for the {to.key} harp so the song still sounds {songKey ? `in ${songKey}` : 'the same'}.</span>
      </button>
      <button className="btn small ghost" onClick={onClose}>Cancel</button>
    </div>
  );
}

const Icon = {
  play: <svg viewBox="0 0 24 24" width="18" height="18"><path d="M7 4.5v15l13-7.5z" fill="currentColor" /></svg>,
  pause: <svg viewBox="0 0 24 24" width="18" height="18"><path d="M6 4h4v16H6zM14 4h4v16h-4z" fill="currentColor" /></svg>,
  stop: <svg viewBox="0 0 24 24" width="16" height="16"><rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" /></svg>,
  toStart: <svg viewBox="0 0 24 24" width="16" height="16"><rect x="5" y="5" width="3" height="14" rx="1" fill="currentColor" /><path d="M19 5v14L9 12z" fill="currentColor" /></svg>,
  loop: <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 2l3 3-3 3" /><path d="M4 11V9a4 4 0 0 1 4-4h12" /><path d="M7 22l-3-3 3-3" /><path d="M20 13v2a4 4 0 0 1-4 4H4" /></svg>,
  metro: <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M9 3h6l4 18H5z" /><path d="M12 15l5-9" strokeLinecap="round" /></svg>,
  gauge: <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4.5 18a9 9 0 1 1 15 0" /><path d="M12 14l4-5" /><circle cx="12" cy="14" r="1.2" fill="currentColor" /></svg>,
  hold: <svg viewBox="0 0 24 24" width="12" height="12"><path d="M6 4h4v16H6zM14 4h4v16h-4z" fill="currentColor" /></svg>,
  resume: <svg viewBox="0 0 24 24" width="12" height="12"><path d="M7 4.5v15l13-7.5z" fill="currentColor" /></svg>,
  rec: <svg viewBox="0 0 24 24" width="14" height="14"><circle cx="12" cy="12" r="7" fill="currentColor" /></svg>,
};

/**
 * The sound menu (♫ Real / ♫ Synth), the same on both pages. `withSpeed` (the editor, which has
 * no speed slider in its bar): the speed is in the menu too, and shows on the button when it isn't 100%.
 */
function SoundMenu({ withSpeed = false }: { withSpeed?: boolean }) {
  const speed = useApp((s) => s.speed);
  const soundMode = useApp((s) => s.soundMode);
  const samplesStatus = useApp((s) => s.samplesStatus);
  const countIn = useApp((s) => s.countIn);
  const countEachLoop = useApp((s) => s.countEachLoop);
  const playRepeats = useApp((s) => s.playRepeats);
  const allVerses = useApp((s) => s.playAllVerses);

  const { doc } = useParsed();
  const showSpeed = withSpeed && speed !== 1;
  const oneVerse = useMemo(() => songVerses(doc) < 2, [doc]);
  // (The tune off is said on the button: it's easy to forget it's off.)
  const tuneOff = useApp((s) => s.mix.off.tune);
  return (
    <Popover
      label={`♫ ${soundMode === 'samples' ? 'Real' : 'Synth'}${showSpeed ? ` · ${Math.round(speed * 100)}%` : ''}${tuneOff ? ' · tune off' : ''} ▾`}
      buttonClass="btn small ghost"
      title={withSpeed ? 'Sound (real harmonica or synth), speed, counting in, repeats and verses' : 'Sound (real harmonica or synth), counting in, repeats and verses'}
      ariaLabel={withSpeed ? 'Sound, speed, counting in, repeats and verses' : 'Sound, counting in, repeats and verses'}
      kind="panel"
      panelClass="menu pb-menu"
    >
      <div className="pb-settings">
        <label className="check">
          <input type="radio" name="sound-mode" checked={soundMode === 'samples'} onChange={() => useApp.setState({ soundMode: 'samples' })} />
          Real harmonica{soundMode === 'samples' && samplesStatus === 'loading' ? ' (loading…)' : ''}{samplesStatus === 'error' ? ' (unavailable)' : ''}
        </label>
        <span className="mi-hint pb-hint">Recordings of a Hohner Special 20 (public domain, VCSL)</span>
        <label className="check">
          <input type="radio" name="sound-mode" checked={soundMode === 'synth'} onChange={() => useApp.setState({ soundMode: 'synth' })} />
          Synth
        </label>
        <span className="mi-hint pb-hint">A generated reed sound</span>
        <BackingChoice />
        <MixControls />
        {withSpeed && (
          <label className="pb-row pb-speed">
            <span>Speed</span>
            <input type="range" min={0.4} max={1.6} step={0.05} value={speed} aria-label="Speed" onChange={(e) => useApp.setState({ speed: parseFloat(e.target.value) })} onDoubleClick={() => useApp.setState({ speed: 1 })} title="Double-click to reset" />
            <span className="t-value">{Math.round(speed * 100)}% · {Math.round(doc.meta.tempo * speed)} bpm</span>
          </label>
        )}
        <span className="pb-head">Counting in</span>
        <label className="check">
          <input type="checkbox" checked={countIn} onChange={(e) => useApp.setState({ countIn: e.target.checked })} />
          Count in before playing
        </label>
        <span className="mi-hint pb-hint">A bar of clicks first (two at fast tempos)</span>
        <label className="check">
          <input type="checkbox" checked={countEachLoop} onChange={(e) => useApp.setState({ countEachLoop: e.target.checked })} />
          Count in before each pass
        </label>
        <span className="mi-hint pb-hint">A breath between passes when looping</span>
        <span className="pb-head">Repeats and verses</span>
        <label className="check">
          <input type="checkbox" checked={playRepeats} onChange={(e) => useApp.setState({ playRepeats: e.target.checked })} />
          Play repeats
        </label>
        <span className="mi-hint pb-hint">Sections between repeat signs (|: and :|) play twice (or as marked: :|x3), with their 1st and 2nd endings, verse 2 the second time; not when looping a passage or playing notes selected in the editor</span>
        <label className="check">
          <input type="checkbox" checked={allVerses} onChange={(e) => useApp.setState({ playAllVerses: e.target.checked })} />
          Play all verses
        </label>
        <span className="mi-hint pb-hint">{oneVerse ? 'This song has one verse' : 'The song plays through until every verse has been sung'}</span>
      </div>
    </Popover>
  );
}

/** Backing chords: off, or how the song's chord symbols are played. */
function BackingChoice() {
  const backing = useApp((s) => s.backing);
  const { score } = useParsed();
  const chords = useMemo(() => hasChords(score), [score]);
  const hint = backing === 'off' ? 'The song’s chord symbols, played under it' : (BACKING_STYLES.find((b) => b.id === backing)?.hint ?? '');
  return (
    <>
      <span className="pb-head">Backing</span>
      <div className="seg backing-seg" role="radiogroup" aria-label="Backing chords">
        {[{ id: 'off' as const, label: 'Off', hint: 'No backing' }, ...BACKING_STYLES].map((b) => (
          <button key={b.id} role="radio" aria-checked={backing === b.id} className={backing === b.id ? 'on' : ''} onClick={() => useApp.setState({ backing: b.id })} title={b.hint}>
            {b.label}
          </button>
        ))}
      </div>
      <span className="mi-hint pb-hint">{chords ? hint : 'This song has no chord symbols ([G], [Am7]…) to play'}</span>
    </>
  );
}

const MIX_ROWS: { part: MixPart; label: string; hint: string }[] = [
  { part: 'tune', label: 'Tune', hint: 'The song’s melody (off: the music moves on silently — Silent in performance mode, or playing along to be heard by the microphone)' },
  { part: 'backing', label: 'Backing', hint: 'The chords under the song (choose how they’re played above)' },
  { part: 'clicks', label: 'Clicks', hint: 'The metronome and the count-in' },
  { part: 'you', label: 'You', hint: 'What you play: the keys, the mouse, a MIDI keyboard, and notes you click to hear' },
];

/** The mix: the master volume, and each part's level and on/off. */
function MixControls() {
  const mix = useApp((s) => s.mix);
  const set = (patch: Partial<Mix>) => useApp.setState((s) => ({ mix: { ...s.mix, ...patch } }));
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  return (
    <>
      <span className="pb-head">Mix</span>
      <label className="pb-row mix-row">
        <span>Volume</span>
        <input type="range" min={0} max={1} step={0.05} value={mix.master} aria-label="Volume" onChange={(e) => set({ master: parseFloat(e.target.value) })} onDoubleClick={() => set({ master: DEFAULT_MIX.master })} title="Everything the app plays (double-click to reset)" />
        <span className="t-value">{pct(mix.master)}</span>
      </label>
      {MIX_ROWS.map(({ part, label, hint }) => (
        <div className={`pb-row mix-row ${mix.off[part] ? 'off' : ''}`} key={part} title={hint}>
          <button
            className={`mix-on ${mix.off[part] ? '' : 'on'}`}
            onClick={() => setPartOff(part, !mix.off[part])}
            aria-pressed={!mix.off[part]}
            aria-label={`${label} ${mix.off[part] ? 'off' : 'on'}`}
            title={`${label}: ${mix.off[part] ? 'off (click to turn on)' : 'on (click to turn off)'}`}
          >
            {label}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={mix.levels[part]}
            aria-label={`${label} level`}
            onChange={(e) => set({ levels: { ...mix.levels, [part]: parseFloat(e.target.value) }, off: { ...mix.off, [part]: false } })}
            onDoubleClick={() => set({ levels: { ...mix.levels, [part]: DEFAULT_MIX.levels[part] } })}
          />
          <span className="t-value">{mix.off[part] ? 'off' : pct(mix.levels[part])}</span>
        </div>
      ))}
    </>
  );
}

/**
 * Play / pause, stop, loop and metronome: the start of the bar on both pages. `perform`
 * (performance mode, where Esc leaves): no "Esc" in the hints.
 */
export function PlayStop({ perform = false }: { perform?: boolean }) {
  const play = useApp((s) => s.play);
  const loop = useApp((s) => s.loop);
  const metronome = useApp((s) => s.metronome);
  const recording = useApp((s) => s.recording);
  const page = useApp((s) => s.page);
  const countIn = useApp((s) => s.countIn);
  const calibrating = useApp((s) => s.calibrating);
  // "Looping bars 5–8" while a passage loops; "Bars 5–8" for a chosen passage not looped yet.
  const loopRange = useApp((s) => (s.loop ? s.loopRange : null));
  const { doc, score } = useParsed();
  // (A passage holding an ending plays it as written: both endings, one after the other.)
  const asWritten = useMemo(() => !!loopRange && passageHasEndings(doc, score, loopRange), [loopRange, doc, score]);
  const passage = useApp((s) => (s.page === 'play' && !s.loop ? s.passage : null));
  const loopKey = page === 'editor' ? 'Shift+L' : 'L';
  const startHere = useApp(atStart);
  // (What Play starts from, said in its tooltip: worked out only when what it depends on changes.)
  const startDeps = useApp(useShallow((s) => [s.text, s.page, s.editorMode, s.ve.selection, s.ve.caret, s.selectedEvent, s.loop, s.loopRange] as const));
  // oxlint-disable-next-line react-hooks/exhaustive-deps, react/exhaustive-deps
  const from = useMemo(() => startLabel(useApp.getState()), startDeps);
  const focusLoop = () => document.querySelector<HTMLElement>('.play-stop [aria-label="Loop"]')?.focus();
  return (
    <div className="t-group play-stop">
      <button className="t-btn primary" onClick={togglePlay} disabled={!!recording} title={play === 'playing' ? 'Pause (Enter)' : `Play ${from} (Enter)`} aria-label={play === 'playing' ? 'Pause' : 'Play'}>
        {play === 'playing' ? Icon.pause : Icon.play}
      </button>
      {/* Stopped, Stop goes back to the start (when a place is chosen). */}
      <button
        className="t-btn"
        // (A microphone calibration's clicks stop too.)
        onClick={() => (play === 'stopped' && !calibrating ? backToStart() : stop())}
        disabled={(play === 'stopped' && startHere && !calibrating) || !!recording}
        title={play === 'stopped' ? 'Back to the start' : perform ? 'Stop' : 'Stop (Esc)'}
        aria-label={play === 'stopped' ? 'Back to the start' : 'Stop'}
      >
        {play === 'stopped' ? Icon.toStart : Icon.stop}
      </button>
      <button
        className={`t-btn toggle ${loop ? 'on' : ''}`}
        onClick={toggleLoop}
        title={loopRange ? `Looping ${describePassage(score, loopRange)} (${loopKey} or click to stop)` : `Loop (${loopKey}): the chosen passage, or the whole song`}
        aria-label="Loop"
        aria-pressed={loop}
      >
        {Icon.loop}
      </button>
      <button
        className={`t-btn toggle ${metronome ? 'on' : ''}`}
        onClick={() => useApp.setState({ metronome: !metronome })}
        title={`Metronome during playback${countIn ? ' (counting in is on)' : ' (counting in: in the ♫ menu)'}`}
        aria-label="Metronome"
        aria-pressed={metronome}
      >
        {Icon.metro}
      </button>
      <TrainerButton />
      {loopRange && (
        <span className="loop-chip">
          <span role="status">
            Looping {describePassage(score, loopRange)}
            {asWritten && (
              <span className="loop-note" title="A looped passage plays as it's written: its 1st and 2nd endings one after the other, not one each time through">
                {' '}· as written
              </span>
            )}
          </span>
          <button className="loop-chip-x" onClick={() => { endPassageLoop(); focusLoop(); }} title={perform ? 'Stop looping this passage' : 'Stop looping this passage (Esc when stopped)'} aria-label="Stop looping this passage">
            ✕
          </button>
        </span>
      )}
      {passage && (
        <span className="loop-chip passage-chip">
          <span role="status">
            {capital(describePassage(score, passage))} · {loopKey} to loop
          </span>
          <button className="loop-chip-x" onClick={() => { useApp.setState({ passage: null }); focusLoop(); }} title={perform ? 'Let go of this passage' : 'Let go of this passage (Esc)'} aria-label="Let go of the chosen passage">
            ✕
          </button>
        </span>
      )}
    </div>
  );
}

const capital = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
const pct = (x: number) => `${Math.round(x * 100)}%`;

/**
 * The tempo trainer: a button with its settings, and while it runs a chip with the pass and
 * the speed, a hold button and ✕.
 */
function TrainerButton() {
  const trainer = useApp((s) => s.trainer);
  const training = useApp((s) => s.training);
  const speed = useApp((s) => s.speed);
  const recording = useApp((s) => s.recording);
  const cleanOnly = useApp((s) => s.trainerCleanOnly);
  const playing = useApp((s) => s.play !== 'stopped');
  const { score } = useParsed();
  const set = (patch: Partial<TrainerSettings>) => useApp.setState((s) => ({ trainer: { ...s.trainer, ...patch } }));
  const choice = (key: keyof TrainerSettings, label: string, show: (x: number) => string, disabled = false) => (
    <label className="pb-row">
      <span>{label}</span>
      <select value={trainer[key]} disabled={disabled} onChange={(e) => set({ [key]: parseFloat(e.target.value) })} aria-label={label}>
        {TRAINER_CHOICES[key].map((x) => (
          <option key={x} value={x}>{show(x)}</option>
        ))}
      </select>
    </label>
  );
  const focusButton = () => document.querySelector<HTMLElement>('.play-stop [aria-label^="Tempo trainer"]')?.focus();
  return (
    <>
      <Popover
        label={Icon.gauge}
        buttonClass={`t-btn toggle ${training ? 'on' : ''}`}
        title={training ? trainerLabel(training, speed, trainer.goal) : 'Tempo trainer: loop slowly, speeding up pass by pass'}
        ariaLabel={training ? 'Tempo trainer (on)' : 'Tempo trainer'}
        kind="panel"
        panelClass="menu pb-menu trainer-menu"
      >
        {(close) => {
          // What it will loop (worked out when the menu opens).
          const target = useApp.getState().loop ? useApp.getState().loopRange : currentPassage();
          return (
          <div className="pb-settings">
            <p className="trainer-intro">
              {target ? `Loops ${describePassage(score, target)}` : 'Loops the whole song (Shift+click notes, or click bar numbers, to choose a passage)'}, a little faster each pass.
            </p>
            {choice('start', 'Start at', pct, !!training)}
            {choice('step', 'Speed up by', (x) => `+${Math.round(x * 100)}%`)}
            {choice('every', 'Every', (x) => (x === 1 ? 'pass' : `${x} passes`))}
            {choice('goal', 'Up to', pct)}
            <label className="check" title="Playing along (below the harmonica), a pass with a missed note doesn't count">
              <input type="checkbox" checked={cleanOnly} onChange={(e) => useApp.setState({ trainerCleanOnly: e.target.checked })} />
              Only after a clean pass (playing along)
            </label>
            <div className="pb-row trainer-actions">
              {training ? (
                <button className="btn small" onClick={() => { stopTrainer(); close(); }}>Stop the trainer</button>
              ) : (
                <button className="btn small primary" disabled={!!recording} onClick={() => { startTrainer(); close(); }}>Start</button>
              )}
            </div>
          </div>
          );
        }}
      </Popover>
      {training && (
        <span className={`loop-chip trainer-chip ${playing ? '' : 'idle'}`}>
          <span role="status">
            {trainerLabel(training, speed, trainer.goal)}{playing ? '' : ' (stopped)'}
          </span>
          {speed < trainer.goal - 1e-9 && (
            <button
              className={`loop-chip-x ${training.holding ? 'on' : ''}`}
              onClick={() => holdTrainer(!training.holding)}
              title={training.holding ? 'Holding this speed: click to speed up again' : 'Hold this speed'}
              aria-label="Hold this speed"
              aria-pressed={training.holding}
            >
              {training.holding ? Icon.resume : Icon.hold}
            </button>
          )}
          <button className="loop-chip-x" onClick={() => { stopTrainer(); focusButton(); }} title="Stop the trainer (the loop goes on at this speed)" aria-label="Stop the trainer">
            ✕
          </button>
        </span>
      )}
    </>
  );
}

/**
 * Which time through the music is playing, when that matters: "Verse 2" (a song with several
 * verses, going through them), else "2nd time", "3rd time" (in a repeat); null otherwise.
 */
export function usePlayingPass(): string | null {
  const { doc } = useParsed();
  // (Only on lines with verses of their own: an intro or a chorus between isn't "Verse 2".)
  const linesVerses = useMemo(() => doc.lines.map(lineVerses), [doc]);
  return useApp((s) => passLabel(s, linesVerses));
}

/** usePlayingPass's words, from the playback state and each line's verse count. */
export function passLabel(s: Pick<AppState, 'play' | 'playVerses' | 'playLine' | 'playVerse' | 'playPass'>, linesVerses: number[]): string | null {
  if (s.play === 'stopped') return null;
  if (s.playVerses && s.playLine !== null && (linesVerses[s.playLine] ?? 1) > 1) return `Verse ${s.playVerse + 1}`;
  return s.playPass < 2 ? null : `${ordinal(s.playPass)} time`;
}

/** "2nd time" / "Verse 2" in the transport, while it's so. */
function PassChip() {
  const pass = usePlayingPass();
  return pass ? (
    <span className="pass-chip" aria-live="polite" title="Where playback is in the repeats and verses">
      {pass}
    </span>
  ) : null;
}

/**
 * The transport. Full (Play): play, stop, loop, metronome, speed, sound and the harmonica.
 * `compact` (the editor, whose bar starts with PlayStop): the sound menu (with the speed) and the harmonica.
 */
export function Transport({ compact = false }: { compact?: boolean }) {
  useTransportKeys();

  if (compact) {
    return (
      <div className="transport compact">
        <PassChip />
        <SoundMenu withSpeed />
        <HarmonicaChip />
      </div>
    );
  }

  return (
    <div className="transport">
      <PlayStop />
      <SpeedControl />
      <PassChip />
      <div className="t-group t-harp">
        <SoundMenu />
        <HarmonicaChip />
      </div>
    </div>
  );
}

/** The speed slider, with the speed and the tempo it gives. */
export function SpeedControl() {
  const speed = useApp((s) => s.speed);
  const { doc } = useParsed();
  const bpm = Math.round(doc.meta.tempo * speed);
  return (
    <div className="t-group speed">
      <span className="t-label">Speed</span>
      <input
        type="range"
        min={0.4}
        max={1.6}
        step={0.05}
        value={speed}
        aria-label="Speed"
        onChange={(e) => useApp.setState({ speed: parseFloat(e.target.value) })}
        onDoubleClick={() => useApp.setState({ speed: 1 })}
        title="Double-click to reset"
      />
      <span className="t-value">{Math.round(speed * 100)}% · {bpm} bpm</span>
    </div>
  );
}

/**
 * The playback keys, wherever there's a transport (Play, the editor, performance mode):
 * Enter plays (Space belongs to the harmonica slide), Esc stops, L loops, F performs.
 */
export function useTransportKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // (A key event aimed at the window or document, not an element, counts as the page's.)
      const el = e.target instanceof Element ? e.target : document.body;
      // Typing, or a dialog/menu is open (Escape closes that instead of stopping the music).
      if (keysTaken(e)) return;
      // Enter on a card in the sheet plays from that note (instead of just sounding it).
      const card = el.closest<HTMLElement>('[data-index]');
      if (e.code === 'Enter' && !e.repeat && card && card.closest('.sheet')) {
        e.preventDefault();
        // Shift+Enter, like Shift+click: the passage runs to this note.
        if (e.shiftKey) extendPassage(Number(card.dataset.index));
        else playFrom(Number(card.dataset.index));
        return;
      }
      const st = useApp.getState();
      const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
      // F: performance mode (on Play).
      if (e.code === 'KeyF' && !e.repeat && plain && !e.shiftKey && st.page === 'play') {
        e.preventDefault();
        togglePerform();
        return;
      }
      // Performing: Ctrl+= / Ctrl+− size the music (not the whole page), Ctrl+0 resets it.
      if (st.performing && (e.ctrlKey || e.metaKey) && !e.altKey && ['Equal', 'NumpadAdd', 'Minus', 'NumpadSubtract', 'Digit0', 'Numpad0'].includes(e.code)) {
        e.preventDefault();
        performResize(e.code === 'Digit0' || e.code === 'Numpad0' ? 0 : e.code === 'Minus' || e.code === 'NumpadSubtract' ? -1 : 1);
        return;
      }
      // L loops (Shift+L in the editor, where L ties notes).
      if (e.code === 'KeyL' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && e.shiftKey === (st.page === 'editor')) {
        e.preventDefault();
        toggleLoop();
        return;
      }
      if (e.code === 'Enter' && !e.repeat && !el.closest('button')) {
        e.preventDefault();
        togglePlay();
      } else if (e.code === 'Escape') {
        // (In full screen the browser takes Esc itself, and leaving it ends performance mode.)
        if (st.performing) exitPerform();
        else if (st.recording) stopRecording();
        else if (st.play !== 'stopped' || st.calibrating) stop();
        // Stopped, a step a press: the editor's selection, the passage loop, the trainer, the
        // chosen passage, then back to the start.
        else if (st.page === 'editor' && st.ve.selection.length) st.setVe({ selection: [] });
        else if (st.loop && st.loopRange) endPassageLoop();
        else if (st.training) stopTrainer();
        else if (st.passage) useApp.setState({ passage: null });
        else if (!atStart(st)) backToStart();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** "C Diatonic · 1st position ▾": opens the harmonica picker. Lives in the transport. */
export function HarmonicaChip() {
  const { harp, doc } = useParsed();
  const readAs = useApp((s) => s.readAs);
  const tonic = useMemo(() => guessTonic(doc, harp), [doc, harp]);
  const position = tonic !== undefined && harp.spec.family !== 'chromatic' ? positionFor(harp.spec.key, tonic) : undefined;
  return (
    <Popover
      label={
        <>
          <span>{harp.name}</span>
          {position !== undefined && <span className="muted chip-pos">· {positionName(position)} pos.</span>}
          <span aria-hidden>▾</span>
        </>
      }
      buttonClass="harp-chip"
      title={`${harp.name}${position !== undefined ? `, ${positionName(position)} position` : ''}: harmonica, key, position and octave`}
      panelLabel="Harmonica"
      kind="panel"
      panelClass="harp-pop"
      wrapClass="harp-chip-wrap"
    >
      <HarmonicaPicker />
      <OwnedHarps />
      <p className="muted small">
        {rangeLabel(harp)} ·{' '}
        {readAs === 'notes'
          ? 'Reading in notes: changing the key, type or tuning keeps the notes and finds the holes.'
          : 'Changing the key asks whether to keep the holes or the notes; type and tuning keep the notes.'}
      </p>
    </Popover>
  );
}

/** "I have this harp" and quick switches to the other harps you own. */
function OwnedHarps() {
  const { harp } = useParsed();
  const owned = useApp((s) => s.ownedHarps);
  const id = specId(harp.spec);
  const have = owned.some((o) => specId(o) === id);
  const toggle = () => useApp.setState({ ownedHarps: have ? owned.filter((o) => specId(o) !== id) : [...owned, harp.spec] });
  const others = owned.filter((o) => specId(o) !== id);
  return (
    <div className="owned">
      <button className={`btn small ghost ${have ? 'on' : ''}`} onClick={toggle} title="Your harmonicas are suggested first when importing">
        {have ? '★ You have this harp' : '☆ I have this harp'}
      </button>
      {others.length > 0 && (
        <div className="owned-list">
          <span className="muted small">Switch to (keeps the notes):</span>
          {others.map((o) => (
            <button key={specId(o)} className="chip owned-chip" onClick={() => setHarmonica(o, 'notes')} title={`Re-tab for your ${harmonicaName(o)}`}>
              {harmonicaName(o)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Toast() {
  const toast = useApp((s) => s.toast);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => useApp.setState({ toast: null }), 3200);
    return () => clearTimeout(t);
  }, [toast]);
  if (!toast) return null;
  return (
    <div className="toast" key={toast.id} role="status">
      {toast.message}
    </div>
  );
}
