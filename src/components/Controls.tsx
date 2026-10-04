import { useEffect, useMemo, useRef, useState } from 'react';
import { FAMILIES, getHarmonica, harmonicaName, keysFor, rangeLabel, specId, tuningsFor, type Family, type HarmonicaSpec } from '../core/instruments';
import { keysTaken } from '../live/focus';
import { stopRecording } from '../live/recorder';
import { isKeyChange, keyDistance, setHarmonica, shiftOctave } from '../state/actions';
import { guessTonic, harpForPosition, octaveOptions, positionFor, positionName } from '../core/convert';
import { mod12, transposeKey } from '../core/pitch';
import { stop, togglePlay } from '../state/playback';
import { useApp, useParsed } from '../state/store';
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
  loop: <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 2l3 3-3 3" /><path d="M4 11V9a4 4 0 0 1 4-4h12" /><path d="M7 22l-3-3 3-3" /><path d="M20 13v2a4 4 0 0 1-4 4H4" /></svg>,
  metro: <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M9 3h6l4 18H5z" /><path d="M12 15l5-9" strokeLinecap="round" /></svg>,
  rec: <svg viewBox="0 0 24 24" width="14" height="14"><circle cx="12" cy="12" r="7" fill="currentColor" /></svg>,
};

/** Playback settings: loop, metronome, speed and sound (the editor's ♫ menu). */
function PlaybackSettings() {
  const loop = useApp((s) => s.loop);
  const metronome = useApp((s) => s.metronome);
  const speed = useApp((s) => s.speed);
  const soundMode = useApp((s) => s.soundMode);
  const samplesStatus = useApp((s) => s.samplesStatus);
  const { doc } = useParsed();
  return (
    <div className="pb-settings">
      <label className="check">
        <input type="checkbox" checked={loop} onChange={(e) => useApp.setState({ loop: e.target.checked })} /> Loop
      </label>
      <label className="check">
        <input type="checkbox" checked={metronome} onChange={(e) => useApp.setState({ metronome: e.target.checked })} /> Metronome
      </label>
      <label className="pb-row">
        <span>Speed</span>
        <input type="range" min={0.4} max={1.6} step={0.05} value={speed} aria-label="Speed" onChange={(e) => useApp.setState({ speed: parseFloat(e.target.value) })} onDoubleClick={() => useApp.setState({ speed: 1 })} title="Double-click to reset" />
        <span className="t-value">{Math.round(speed * 100)}% · {Math.round(doc.meta.tempo * speed)} bpm</span>
      </label>
      <label className="pb-row">
        <span>Sound</span>
        <select value={soundMode} aria-label="Sound" onChange={(e) => useApp.setState({ soundMode: e.target.value as 'samples' | 'synth' })}>
          <option value="samples">Real harmonica{soundMode === 'samples' && samplesStatus === 'loading' ? ' (loading…)' : ''}{samplesStatus === 'error' ? ' (unavailable)' : ''}</option>
          <option value="synth">Synth</option>
        </select>
      </label>
    </div>
  );
}

/**
 * Play and stop, and the harmonica. `compact` (the editor): loop, metronome, speed and sound
 * are in a ♫ menu, which shows a dot while loop or the metronome is on.
 */
export function Transport({ compact = false }: { compact?: boolean }) {
  const play = useApp((s) => s.play);
  const loop = useApp((s) => s.loop);
  const metronome = useApp((s) => s.metronome);
  const speed = useApp((s) => s.speed);
  const soundMode = useApp((s) => s.soundMode);
  const samplesStatus = useApp((s) => s.samplesStatus);
  const recording = useApp((s) => s.recording);
  const { doc } = useParsed();
  const bpm = Math.round(doc.meta.tempo * speed);

  // Global space-free shortcut: Enter toggles playback (Space belongs to the harmonica slide).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      // Typing, or a dialog/menu is open (Escape closes that instead of stopping the music).
      if (keysTaken(e)) return;
      if (e.code === 'Enter' && !e.repeat && !el.closest('button')) {
        e.preventDefault();
        togglePlay();
      } else if (e.code === 'Escape') {
        if (useApp.getState().recording) stopRecording();
        else stop();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (compact) {
    const on = loop || metronome || speed !== 1;
    return (
      <div className="transport compact">
        <button className="t-btn primary" onClick={togglePlay} disabled={!!recording} title="Play / pause (Enter)" aria-label={play === 'playing' ? 'Pause' : 'Play'}>
          {play === 'playing' ? Icon.pause : Icon.play}
        </button>
        <button className="t-btn" onClick={stop} disabled={play === 'stopped' || !!recording} title="Stop (Esc)" aria-label="Stop">
          {Icon.stop}
        </button>
        <Popover
          label={
            <>
              ♫ ▾{on && <span className="pb-dot" aria-hidden />}
            </>
          }
          buttonClass="btn small ghost pb-btn"
          title={`Playback: loop ${loop ? 'on' : 'off'}, metronome ${metronome ? 'on' : 'off'}, ${Math.round(speed * 100)}% speed`}
          ariaLabel="Playback settings"
          kind="panel"
          panelClass="menu pb-menu"
        >
          <PlaybackSettings />
        </Popover>
        <HarmonicaChip />
      </div>
    );
  }

  return (
    <div className="transport">
      <div className="t-group">
        <button className="t-btn primary" onClick={togglePlay} disabled={!!recording} title="Play / pause (Enter)" aria-label={play === 'playing' ? 'Pause' : 'Play'}>
          {play === 'playing' ? Icon.pause : Icon.play}
        </button>
        <button className="t-btn" onClick={stop} disabled={play === 'stopped' || !!recording} title="Stop (Esc)" aria-label="Stop">
          {Icon.stop}
        </button>
        <button className={`t-btn toggle ${loop ? 'on' : ''}`} onClick={() => useApp.setState({ loop: !loop })} title="Loop" aria-label="Loop" aria-pressed={loop}>
          {Icon.loop}
        </button>
        <button className={`t-btn toggle ${metronome ? 'on' : ''}`} onClick={() => useApp.setState({ metronome: !metronome })} title="Metronome during playback" aria-label="Metronome" aria-pressed={metronome}>
          {Icon.metro}
        </button>
      </div>

      <div className="t-group speed">
        <span className="t-label">Speed</span>
        <input
          type="range"
          min={0.4}
          max={1.6}
          step={0.05}
          value={speed}
          onChange={(e) => useApp.setState({ speed: parseFloat(e.target.value) })}
          onDoubleClick={() => useApp.setState({ speed: 1 })}
          title="Double-click to reset"
        />
        <span className="t-value">{Math.round(speed * 100)}% · {bpm} bpm</span>
      </div>

      <div className="t-group">
        <span className="t-label">Sound</span>
        <select
          value={soundMode}
          onChange={(e) => useApp.setState({ soundMode: e.target.value as 'samples' | 'synth' })}
          title="Real harmonica: recordings of a Hohner Special 20 (public domain, VCSL). Synth: a generated reed sound."
        >
          <option value="samples">Real harmonica{soundMode === 'samples' && samplesStatus === 'loading' ? ' (loading…)' : ''}{samplesStatus === 'error' ? ' (unavailable)' : ''}</option>
          <option value="synth">Synth</option>
        </select>
      </div>

      <div className="t-group t-harp">
        <HarmonicaChip />
      </div>

    </div>
  );
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
          {position !== undefined && <span className="muted">· {positionName(position)} pos.</span>}
          <span aria-hidden>▾</span>
        </>
      }
      buttonClass="harp-chip"
      title="Harmonica, key, position and octave"
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
