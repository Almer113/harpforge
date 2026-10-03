// Song details: title, artist, key, time signature, tempo and harmonica.

import { useEffect, useState } from 'react';
import { setTimeSignature } from '../../core/edit/model';
import { setMetaFields } from '../../core/htab/meta';
import { commitSong, currentSong } from '../../state/editor';
import { useApp, useParsed } from '../../state/store';
import { HarmonicaPicker } from '../Controls';

const TIMES = ['2/4', '3/4', '4/4', '5/4', '6/4', '2/2', '3/8', '6/8', '7/8', '9/8', '12/8'];
const KEYS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'Am', 'Em', 'Bm', 'F#m', 'C#m', 'G#m', 'Ebm', 'Bbm', 'Fm', 'Cm', 'Gm', 'Dm'];

/** A text field that edits a header field, recording one undo step per burst of typing. */
function MetaInput({ field, value, placeholder, width }: { field: string; value: string; placeholder: string; width?: number }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      className="meta-input"
      style={width ? { width } : undefined}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => {
        setDraft(e.target.value);
        const s = useApp.getState();
        s.setText(setMetaFields(s.text, { [field]: e.target.value.trim() || undefined }), { kind: 'typing' });
      }}
    />
  );
}

export function SongDetails() {
  const { doc } = useParsed();
  const { meta } = doc;
  const [reflow, setReflow] = useState(true);
  const hasNotes = doc.lines.some((l) => l.events.some((e) => e.kind === 'note'));

  const changeTime = (time: string) => {
    if (time === meta.time) return;
    if (reflow && hasNotes) commitSong(setTimeSignature(currentSong(), time, true));
    else {
      const s = useApp.getState();
      s.setText(setMetaFields(s.text, { time }));
    }
  };

  const setTempo = (v: number) => {
    if (!(v >= 20 && v <= 400)) return;
    const s = useApp.getState();
    s.setText(setMetaFields(s.text, { tempo: Math.round(v) }), { kind: 'typing' });
  };

  return (
    <div className="song-details">
      <div className="sd-title">
        <MetaInput field="title" value={meta.title ?? ''} placeholder="Untitled" />
        <MetaInput field="artist" value={meta.artist ?? ''} placeholder="Artist" />
      </div>
      <div className="sd-fields">
        <label className="field">
          <span>Song key</span>
          <select
            value={meta.key ?? ''}
            onChange={(e) => {
              const s = useApp.getState();
              s.setText(setMetaFields(s.text, { key: e.target.value || undefined }));
            }}
          >
            <option value="">—</option>
            {KEYS.includes(meta.key ?? '') || !meta.key ? null : <option value={meta.key}>{meta.key}</option>}
            {KEYS.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Time</span>
          <select value={meta.time} onChange={(e) => changeTime(e.target.value)}>
            {!TIMES.includes(meta.time) && <option value={meta.time}>{meta.time}</option>}
            {TIMES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="check reflow" title="When the time signature changes, re-bar the notes (notes crossing a new bar line are split). Off: keep the bars as they are.">
          <input type="checkbox" checked={reflow} onChange={(e) => setReflow(e.target.checked)} />
          Re-bar notes
        </label>
        <label className="field">
          <span>Tempo</span>
          <input
            className="meta-input tempo"
            type="number"
            min={20}
            max={400}
            defaultValue={meta.tempo}
            key={meta.tempo}
            onBlur={(e) => setTempo(parseFloat(e.target.value))}
            onKeyDown={(e) => e.key === 'Enter' && setTempo(parseFloat((e.target as HTMLInputElement).value))}
          />
        </label>
        <HarmonicaPicker />
      </div>
    </div>
  );
}
