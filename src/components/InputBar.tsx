// The tools under the harmonica: microphone (with tuner), MIDI keyboard, practice mode
// and recording.

import { useEffect, useState } from 'react';
import { holeSoundText } from '../core/htab/serializer';
import { midiToName, keySpelling } from '../core/pitch';
import { startMic, startMidi, stopMic, stopMidi } from '../live/inputs';
import { startRecording, stopRecording } from '../live/recorder';
import { hint, practiceTotal, startPractice, stopPractice } from '../state/practice';
import { calibrateMic, DEFAULT_MIC_LATENCY, describePass, setAlong } from '../state/playAlong';
import { alongReport } from '../core/report';
import { showReport } from '../state/report';
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
const AlongIcon = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 17l4-4 3 3 7-8" />
    <path d="M14 8h4v4" />
  </svg>
);
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
      <AlongControl />
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

/**
 * Play along, checked: play with the song while it plays; each note lights up green (in
 * time), amber (early or late) or red (missed). Shows how the last pass went.
 */
/** Moves the keyboard to an element that appears once the state change has drawn. */
function focusSoon(selector: string) {
  requestAnimationFrame(() => document.querySelector<HTMLElement>(selector)?.focus());
}

function AlongControl() {
  const along = useApp((s) => s.along);
  const melody = useApp((s) => s.alongMelody);
  const passes = useApp((s) => s.alongPasses);
  const micOn = useApp((s) => s.mic.status === 'on');
  const latency = useApp((s) => s.micLatency);
  const playing = useApp((s) => s.play === 'playing');
  const { score } = useParsed();
  const [cal, setCal] = useState<'idle' | 'running' | 'failed'>('idle');
  if (!along) {
    return (
      <div className="input-card">
        <button className="t-btn toggle along-start" onClick={() => setAlong(true)} title="Play along with the song as it plays: each note you play (keys, MIDI or microphone) is checked for time">
          {AlongIcon} <span>Play along</span>
        </button>
      </div>
    );
  }
  const last = passes[passes.length - 1];
  const clean = passes.filter((p) => p.clean).length;
  const calibrate = async () => {
    setCal('running');
    const ms = await calibrateMic();
    setCal(ms === null ? 'failed' : 'idle');
  };
  return (
    <div className="input-card on along">
      <span className="practice-label">Play along</span>
      <span className="input-status along-status" role="status">
        {cal === 'running' ? 'Play any note with each click after the first bar…' : cal === 'failed' ? 'Didn’t hear enough notes on the clicks. Try again.' : last ? `Last pass: ${describePass(last)}` : playing ? 'Checking starts at the next Play' : 'Press Play, then play with it'}
      </span>
      {passes.length > 1 && <span className="input-status">{clean} of {passes.length} clean</span>}
      <label className="check" title="Off: only the clicks play, so the microphone hears just you">
        <input type="checkbox" checked={melody} onChange={(e) => useApp.setState({ alongMelody: e.target.checked })} />
        Hear the tune
      </label>
      {micOn && melody && <span className="mi-hint along-warn">With the tune on, the microphone hears it too: turn it off to be checked.</span>}
      {micOn && (
        <button
          className="btn small ghost"
          disabled={cal === 'running'}
          onClick={() => void calibrate()}
          title={`The microphone hears notes a moment late; this measures by how much${latency === null ? ` (until then, ${DEFAULT_MIC_LATENCY} ms is assumed)` : ' (click to measure again)'}`}
        >
          {latency === null ? 'Calibrate mic' : `Mic timing ${latency} ms`}
        </button>
      )}
      {passes.length > 0 && (
        <button className="btn small ghost" onClick={() => showReport(alongReport(score, passes), false)} title="How the session is going: the holes and bars missed most">
          Report
        </button>
      )}
      <button className="btn small ghost" onClick={() => { setAlong(false); focusSoon('.inputbar .along-start'); }} aria-label="Finish playing along" title="Finish: shows how it went">
        Finish
      </button>
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
  const flats = keySpelling(doc.meta.key ?? harp.spec.key);
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
      <button className="btn small ghost" onClick={stopPractice} aria-label="Stop practising">Stop</button>
    </div>
  );
}
