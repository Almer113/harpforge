// The tools under the harmonica: microphone (with tuner), MIDI keyboard, practice mode
// and recording.

import { useEffect, useState } from 'react';
import { holeSoundText } from '../core/htab/serializer';
import { midiToName, keyUsesFlats } from '../core/pitch';
import { startMic, startMidi, stopMic, stopMidi } from '../live/inputs';
import { startRecording, stopRecording } from '../live/recorder';
import { hint, practiceTotal, startPractice, stopPractice } from '../state/practice';
import { useApp, useParsed } from '../state/store';

const MicIcon = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </svg>
);
const KeysIcon = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M8 5v9M12 5v9M16 5v9M6 14h4M14 14h4" />
  </svg>
);
const RecIcon = <svg viewBox="0 0 24 24" width="14" height="14"><circle cx="12" cy="12" r="7" fill="currentColor" /></svg>;
const StopIcon = <svg viewBox="0 0 24 24" width="14" height="14"><rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" /></svg>;
const TargetIcon = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export function InputBar() {
  return (
    <div className="inputbar">
      <PracticeControl />
      <MicControl />
      <MidiControl />
      <RecordControl />
    </div>
  );
}

/** Record what you play into the tab. Its options only show when you open it. */
function RecordControl() {
  const recording = useApp((s) => s.recording);
  const recordAppend = useApp((s) => s.recordAppend);
  const recordGrid = useApp((s) => s.recordGrid);
  const [open, setOpen] = useState(false);
  if (recording) {
    return (
      <div className="input-card on rec">
        <button className="t-btn rec-btn live" onClick={stopRecording} title="Stop recording (Esc)">
          {StopIcon} <span>{recording.phase === 'count-in' ? 'Count-in…' : 'Stop recording'}</span>
        </button>
      </div>
    );
  }
  return (
    <div className={`input-card ${open ? 'on' : ''}`}>
      <button className={`t-btn toggle ${open ? 'on' : ''}`} onClick={() => setOpen(!open)} title="Record what you play into the tab">
        <span className="rec-dot-icon">{RecIcon}</span> <span>Record</span>
      </button>
      {open && (
        <>
          <button className="btn small" onClick={() => void startRecording('timed')} title="With a metronome and a one-bar count-in; notes keep their timing">
            In time
          </button>
          <button className="btn small ghost" onClick={() => void startRecording('free')} title="Notes in order, without timing">
            Free
          </button>
          <select
            value={recordGrid}
            onChange={(e) => useApp.setState({ recordGrid: parseFloat(e.target.value) })}
            title="When you stop, each note is rounded to the nearest step so small timing wobbles disappear (in-time recording only)"
          >
            <option value={1}>Round to beats</option>
            <option value={0.5}>Round to ½ beats</option>
            <option value={0.25}>Round to ¼ beats</option>
          </select>
          <label className="check" title="Add the recording to the end of the tab, or replace what's there">
            <input type="checkbox" checked={recordAppend} onChange={(e) => useApp.setState({ recordAppend: e.target.checked })} />
            Append
          </label>
        </>
      )}
    </div>
  );
}

export function MicControl() {
  const mic = useApp((s) => s.mic);
  const sensitivity = useApp((s) => s.micSensitivity);
  const on = mic.status === 'on';
  return (
    <div className={`input-card ${on ? 'on' : ''}`}>
      <button
        className={`t-btn toggle ${on ? 'on' : ''}`}
        onClick={() => (on || mic.status === 'starting' ? stopMic() : void startMic())}
        title="Listen to your real harmonica: shows the hole and note you play, with a tuner for bends. Recording and practice work with it too."
      >
        {MicIcon} <span>{mic.status === 'starting' ? 'Starting…' : on ? 'Listening' : 'Microphone'}</span>
      </button>
      {on && (
        <>
          <div className="level" title="Input level">
            <div style={{ width: `${Math.min(100, Math.sqrt(mic.level) * 260)}%` }} />
          </div>
          <Tuner />
          <label className="sens" title="Sensitivity: raise it if quiet notes aren't picked up; lower it in noisy rooms">
            <span>Sens.</span>
            <input type="range" min={0} max={1} step={0.05} value={sensitivity} onChange={(e) => useApp.setState({ micSensitivity: parseFloat(e.target.value) })} />
          </label>
        </>
      )}
      {mic.status === 'error' && <span className="input-error">{mic.error}</span>}
    </div>
  );
}

function Tuner() {
  const reading = useApp((s) => s.mic.reading);
  if (!reading) return <div className="tuner idle">Play a note…</div>;
  const c = Math.max(-50, Math.min(50, reading.cents));
  const inTune = Math.abs(reading.cents) <= 12;
  return (
    <div className={`tuner ${reading.hole ? '' : 'off-harp'}`} title={reading.hole ? `${reading.cents > 0 ? '+' : ''}${reading.cents} cents` : 'This note isn’t on the current harmonica'}>
      <b className="tuner-hole">{reading.hole ?? '—'}</b>
      <span className="tuner-note">{reading.note}</span>
      <div className="tuner-scale">
        <div className="tuner-center" />
        <div className={`tuner-needle ${inTune ? 'good' : ''}`} style={{ left: `${50 + c}%` }} />
      </div>
    </div>
  );
}

export function MidiControl() {
  const midi = useApp((s) => s.midi);
  const on = midi.status === 'on';
  const [miss, setMiss] = useState<string | undefined>();
  useEffect(() => {
    if (!midi.miss) return;
    // A brief notice in answer to an outside event (a MIDI note), cleared by the timer below.
    // oxlint-disable-next-line react/set-state-in-effect
    setMiss(midi.miss);
    const t = setTimeout(() => setMiss(undefined), 1500);
    return () => clearTimeout(t);
  }, [midi.miss]);
  return (
    <div className={`input-card ${on ? 'on' : ''}`}>
      <button className={`t-btn toggle ${on ? 'on' : ''}`} onClick={() => (on ? stopMidi() : void startMidi())} title="Play the harmonica from a MIDI keyboard">
        {KeysIcon} <span>MIDI</span>
      </button>
      {on && <span className="input-status">{midi.devices.length ? midi.devices.join(', ') : 'No device — plug one in'}</span>}
      {miss && <span className="input-error">{miss}</span>}
      {midi.status === 'unsupported' && <span className="input-error">This browser has no MIDI support (try Chrome or Edge).</span>}
      {midi.status === 'error' && <span className="input-error">MIDI access was blocked.</span>}
    </div>
  );
}

function PracticeControl() {
  const practice = useApp((s) => s.practice);
  const asNotes = useApp((s) => s.readAs === 'notes');
  const { score, harp, doc } = useParsed();
  const [shake, setShake] = useState(false);
  useEffect(() => {
    if (!practice?.wrongAt) return;
    // A brief shake in answer to a wrong note, cleared by the timer below.
    // oxlint-disable-next-line react/set-state-in-effect
    setShake(true);
    const t = setTimeout(() => setShake(false), 350);
    return () => clearTimeout(t);
  }, [practice?.wrongAt]);

  if (!practice) {
    return (
      <div className="input-card">
        <button className="t-btn toggle practice-start" onClick={startPractice} title="Step through the tab: it waits until you play each note (keyboard, mouse, MIDI or microphone)">
          {TargetIcon} <span>Practice</span>
        </button>
      </div>
    );
  }
  const ev = score.events[practice.index];
  const total = practiceTotal();
  const flats = keyUsesFlats(doc.meta.key ?? harp.spec.key);
  const target = ev
    ? ev.sounds.map((s, k) => (s.type === 'hole' ? holeSoundText(s) : midiToName(ev.midis[k] ?? 0, flats))).join(' ')
    : '';
  const notes = ev ? ev.midis.filter((m): m is number => m !== null).map((m) => midiToName(m, flats)).join(' ') : '';
  return (
    <div className={`input-card on practice ${shake ? 'shake' : ''}`}>
      <span className="practice-label">Play</span>
      <b className="practice-target">{asNotes ? notes || target : target}</b>
      <span className="practice-note">{asNotes ? target : notes}</span>
      <span className="input-status">
        {practice.played + 1} / {total} · {practice.mistakes} mistake{practice.mistakes === 1 ? '' : 's'}
      </span>
      <button className="btn small" onClick={() => void hint()} title="Hear the note">Hint</button>
      <button className="btn small ghost" onClick={stopPractice}>Stop</button>
    </div>
  );
}
