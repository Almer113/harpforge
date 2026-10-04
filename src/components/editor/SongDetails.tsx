// The song's line above the music: title, artist, key, time signature and tempo. The
// editor's line is editable; the Play page shows the same line, read-only, in the same place.

import { useEffect, useMemo, useState } from 'react';
import { guessTonic } from '../../core/convert';
import { keyUsesFlats, pitchClassName } from '../../core/pitch';
import { setTimeSignature } from '../../core/edit/model';
import { setMetaFields } from '../../core/htab/meta';
import { commitSong, currentSong } from '../../state/editor';
import { useApp, useParsed } from '../../state/store';

const TIMES = ['2/4', '3/4', '4/4', '5/4', '6/4', '2/2', '3/8', '6/8', '7/8', '9/8', '12/8'];
const KEYS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'Am', 'Em', 'Bm', 'F#m', 'C#m', 'G#m', 'Ebm', 'Bbm', 'Fm', 'Cm', 'Gm', 'Dm'];

/** A text field that edits a header field, recording one undo step per burst of typing. */
function MetaInput({ field, value, placeholder, label, className = '' }: { field: string; value: string; placeholder: string; label: string; className?: string }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      className={`meta-input ${className}`}
      value={draft}
      placeholder={placeholder}
      aria-label={label}
      onChange={(e) => {
        setDraft(e.target.value);
        const s = useApp.getState();
        s.setText(setMetaFields(s.text, { [field]: e.target.value.trim() || undefined }), { kind: 'typing' });
      }}
    />
  );
}

const Chevron = (
  <svg className="sl-chev" viewBox="0 0 10 6" width="10" height="6" aria-hidden>
    <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * The song's line: editable (the editor) or read-only (the Play page). Both use the same boxes
 * (title, artist, and a field box for key, time and tempo), so everything sits in the same place;
 * the editor's field boxes are outlined, with a ▾ on the pickers, and Play's are plain text.
 */
export function SongLine({ editable }: { editable: boolean }) {
  const { doc, harp } = useParsed();
  const { meta } = doc;
  // With no key set, show what the song's notes suggest (its last note's pitch).
  const tonic = useMemo(() => guessTonic(doc, harp), [doc, harp]);
  const detected = tonic !== undefined ? pitchClassName(tonic, keyUsesFlats(harp.spec.key)) : undefined;

  if (!editable) {
    return (
      <header className="song-line">
        <h1 className="sl-title">{meta.title || 'Untitled'}</h1>
        {meta.artist ? (
          <span className="sl-artist">{meta.artist}</span>
        ) : (
          // No artist: a dash, in a box as wide as the editor's empty "Artist" field.
          <span className="sl-artist empty" title="No artist set">
            <span className="sl-sizer" aria-hidden>Artist</span>
            <span>—</span>
          </span>
        )}
        <span className="sl-item">
          <span className="sl-label">Key</span>
          <span className={`sl-field pick ${meta.key ? '' : 'unset'}`}>{meta.key ?? (detected ? `sounds like ${detected}` : '—')}</span>
        </span>
        <span className="sl-item">
          <span className="sl-label">Time</span>
          <span className="sl-field pick">{meta.time}</span>
        </span>
        <span className="sl-item">
          <span className="sl-label">Tempo</span>
          <span className="sl-field">{meta.tempo}<span className="sl-unit">bpm</span></span>
        </span>
      </header>
    );
  }

  const hasNotes = doc.lines.some((l) => l.events.some((e) => e.kind === 'note'));
  const changeTime = (time: string) => {
    if (time === meta.time) return;
    // Re-barring (⋯ → Measures) splits notes that cross the new bar lines.
    if (useApp.getState().rebar && hasNotes) commitSong(setTimeSignature(currentSong(), time, true));
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
    <header className="song-line editable">
      <MetaInput field="title" value={meta.title ?? ''} placeholder="Untitled" label="Title" className="sl-title" />
      <MetaInput field="artist" value={meta.artist ?? ''} placeholder="Artist" label="Artist" className="sl-artist" />
      <label className="sl-item">
        <span className="sl-label">Key</span>
        <span className={`sl-field pick ${meta.key ? '' : 'unset'}`}>
          <select
            value={meta.key ?? ''}
            title="The song's key (none set: what the notes suggest)"
            onChange={(e) => {
              const s = useApp.getState();
              s.setText(setMetaFields(s.text, { key: e.target.value || undefined }));
            }}
          >
            <option value="">{detected ? `sounds like ${detected}` : '—'}</option>
            {KEYS.includes(meta.key ?? '') || !meta.key ? null : <option value={meta.key}>{meta.key}</option>}
            {KEYS.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
          {Chevron}
        </span>
      </label>
      <label className="sl-item">
        <span className="sl-label">Time</span>
        <span className="sl-field pick">
          <select value={meta.time} title="Time signature" onChange={(e) => changeTime(e.target.value)}>
            {!TIMES.includes(meta.time) && <option value={meta.time}>{meta.time}</option>}
            {TIMES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          {Chevron}
        </span>
      </label>
      <label className="sl-item">
        <span className="sl-label">Tempo</span>
        <span className="sl-field">
          <input
            className="sl-tempo"
            type="number"
            min={20}
            max={400}
            defaultValue={meta.tempo}
            key={meta.tempo}
            title="Tempo in beats per minute (20 to 400; arrow keys step it)"
            onBlur={(e) => setTempo(parseFloat(e.target.value))}
            onKeyDown={(e) => e.key === 'Enter' && setTempo(parseFloat((e.target as HTMLInputElement).value))}
          />
          <span className="sl-unit">bpm</span>
        </span>
      </label>
    </header>
  );
}
