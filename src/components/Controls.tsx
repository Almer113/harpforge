import { useEffect, useMemo } from 'react';
import { FAMILIES, keysFor, tuningsFor, type Family } from '../core/instruments';
import { startRecording, stopRecording } from '../live/recorder';
import { setHarmonica, shiftOctave } from '../state/actions';
import { octaveOptions } from '../core/convert';
import { stop, togglePlay } from '../state/playback';
import { useApp, useParsed } from '../state/store';

export function HarmonicaPicker() {
  const { harp, doc } = useParsed();
  const octaves = useMemo(() => octaveOptions(doc, harp), [doc, harp]);
  const up = octaves.find((o) => o.shift === 12)!;
  const down = octaves.find((o) => o.shift === -12)!;
  const { family, tuning, key } = harp.spec;
  const setFamily = (f: Family) => {
    const keys = keysFor(f);
    setHarmonica({ family: f, tuning: tuningsFor(f)[0].id, key: keys.includes(key) ? key : 'C' });
  };
  return (
    <div className="picker" title="Changing the key keeps the holes (transposes). Changing type or tuning re-tabs to keep the notes.">
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
      <label>
        <span>Key</span>
        <select value={key} onChange={(e) => setHarmonica({ family, tuning, key: e.target.value })}>
          {keysFor(family).map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
      </label>
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

const Icon = {
  play: <svg viewBox="0 0 24 24" width="18" height="18"><path d="M7 4.5v15l13-7.5z" fill="currentColor" /></svg>,
  pause: <svg viewBox="0 0 24 24" width="18" height="18"><path d="M6 4h4v16H6zM14 4h4v16h-4z" fill="currentColor" /></svg>,
  stop: <svg viewBox="0 0 24 24" width="16" height="16"><rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" /></svg>,
  loop: <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 2l3 3-3 3" /><path d="M4 11V9a4 4 0 0 1 4-4h12" /><path d="M7 22l-3-3 3-3" /><path d="M20 13v2a4 4 0 0 1-4 4H4" /></svg>,
  metro: <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M9 3h6l4 18H5z" /><path d="M12 15l5-9" strokeLinecap="round" /></svg>,
  rec: <svg viewBox="0 0 24 24" width="14" height="14"><circle cx="12" cy="12" r="7" fill="currentColor" /></svg>,
};

export function Transport({ showRecord = false }: { showRecord?: boolean }) {
  const play = useApp((s) => s.play);
  const loop = useApp((s) => s.loop);
  const metronome = useApp((s) => s.metronome);
  const speed = useApp((s) => s.speed);
  const soundMode = useApp((s) => s.soundMode);
  const samplesStatus = useApp((s) => s.samplesStatus);
  const recording = useApp((s) => s.recording);
  const recordAppend = useApp((s) => s.recordAppend);
  const recordGrid = useApp((s) => s.recordGrid);
  const { doc } = useParsed();
  const bpm = Math.round(doc.meta.tempo * speed);

  // Global space-free shortcut: Enter toggles playback (Space belongs to the harmonica slide).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;
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

  return (
    <div className="transport">
      <div className="t-group">
        <button className="t-btn primary" onClick={togglePlay} disabled={!!recording} title="Play / pause (Enter)">
          {play === 'playing' ? Icon.pause : Icon.play}
        </button>
        <button className="t-btn" onClick={stop} disabled={play === 'stopped' || !!recording} title="Stop (Esc)">
          {Icon.stop}
        </button>
        <button className={`t-btn toggle ${loop ? 'on' : ''}`} onClick={() => useApp.setState({ loop: !loop })} title="Loop">
          {Icon.loop}
        </button>
        <button className={`t-btn toggle ${metronome ? 'on' : ''}`} onClick={() => useApp.setState({ metronome: !metronome })} title="Metronome during playback">
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

      {showRecord && (
        <div className="t-group rec">
          {recording ? (
            <button className="t-btn rec-btn live" onClick={stopRecording} title="Stop recording (Esc)">
              {Icon.stop} <span>{recording.phase === 'count-in' ? 'Count-in…' : 'Stop recording'}</span>
            </button>
          ) : (
            <>
              <button className="t-btn rec-btn" onClick={() => startRecording('timed')} title="Record in time with a metronome (1 bar count-in)">
                {Icon.rec} <span>Record</span>
              </button>
              <button className="t-btn rec-btn ghost" onClick={() => startRecording('free')} title="Record notes in order, without timing">
                {Icon.rec} <span>Free</span>
              </button>
              <select
                value={recordGrid}
                onChange={(e) => useApp.setState({ recordGrid: parseFloat(e.target.value) })}
                title="Timing grid for Record: when you stop, each note is rounded to the nearest step so small timing wobbles disappear. (Free recording ignores this.)"
              >
                <option value={1}>Round to beats</option>
                <option value={0.5}>Round to ½ beats</option>
                <option value={0.25}>Round to ¼ beats</option>
              </select>
              <label className="check" title="Add the recording to the end of the current tab, or replace its contents">
                <input type="checkbox" checked={recordAppend} onChange={(e) => useApp.setState({ recordAppend: e.target.checked })} />
                Append
              </label>
            </>
          )}
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
