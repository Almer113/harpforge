// Inspector for the visual editor: edits the selected note(s) and the current measure.

import { useEffect, useState } from 'react';
import {
  advance,
  clearMeasure,
  deleteMeasure,
  duplicateMeasure,
  EPS,
  findItem,
  insertMeasure,
  placeItem,
  removeItems,
  updateItem,
  updateMeasure,
  type Item,
  type Pos,
  type Song,
} from '../../core/edit/model';
import { holeSoundText, soundText } from '../../core/htab/serializer';
import type { BarStyle } from '../../core/htab/types';
import { canOver, maxBend, soundPitch } from '../../core/instruments';
import { midiToName, prefersFlats } from '../../core/pitch';
import type { HoleSound, Sound } from '../../core/types';
import { commitSong, DURATIONS, describeDuration, durationLabel, mapHoles, parseSoundsInput, stepPitch } from '../../state/editor';
import { useApp, useParsed } from '../../state/store';
import { Glyph } from '../TabView';
import { apply, playSounds } from './VisualEditor';

const soundsText = (sounds: Sound[]) =>
  sounds.length === 0 ? '' : sounds.length === 1 ? soundText(sounds[0]) : '(' + sounds.map((s) => soundText(s)).join(' ') + ')';

/** A text input that commits as you type (grouped into one undo step). */
function LiveInput({ value, placeholder, onCommit, className }: { value: string; placeholder?: string; onCommit: (v: string) => void; className?: string }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      className={`meta-input ${className ?? ''}`}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => {
        setDraft(e.target.value);
        onCommit(e.target.value);
      }}
    />
  );
}

export function Inspector({ song }: { song: Song }) {
  const ve = useApp((s) => s.ve);
  const sel = ve.selection;
  const items = sel.map((p) => ({ p, it: findItem(song, p) })).filter((x): x is { p: Pos; it: Item } => !!x.it);
  return (
    <aside className="ve-inspector">
      {items.length === 1 ? <NotePanel song={song} pos={items[0].p} item={items[0].it} /> : items.length > 1 ? <MultiPanel song={song} sel={items.map((x) => x.p)} /> : <CaretPanel song={song} />}
      <MeasurePanel song={song} m={Math.min(ve.measure, song.measures.length - 1)} />
    </aside>
  );
}

function CaretPanel({ song }: { song: Song }) {
  const ve = useApp((s) => s.ve);
  return (
    <section className="insp-card">
      <h3>Caret</h3>
      <p className="muted small">
        Bar {ve.caret.m + 1}, beat {+(ve.caret.start + 1).toFixed(2)}. Double-click a slot, press <b>+ Note</b>, or turn on <b>Step entry</b> and play
        the harmonica to add notes here.
      </p>
      {song.measures.every((m) => !m.items.length) && <p className="muted small">This tab is empty — start by playing or adding a note.</p>}
    </section>
  );
}

function NotePanel({ song, pos, item }: { song: Song; pos: Pos; item: Item }) {
  const { harp, doc } = useParsed();
  const flats = prefersFlats(doc.meta.key ?? harp.spec.key);
  const [input, setInput] = useState(soundsText(item.sounds));
  const [bad, setBad] = useState(false);
  useEffect(() => {
    setInput(soundsText(item.sounds));
    setBad(false);
  }, [item.sounds]);

  const set = (patch: Partial<Item>) => apply(updateItem(song, pos, patch));
  const holes = item.sounds.filter((s): s is HoleSound => s.type === 'hole');
  const first = holes[0];
  const midis = item.sounds.map((s) => (s.type === 'pitch' ? s.midi : soundPitch(harp, s)));
  const d = describeDuration(item.dur);

  const applyInput = () => {
    const parsed = parseSoundsInput(input);
    if (!parsed) {
      setBad(true);
      return;
    }
    setBad(false);
    set({ sounds: parsed });
    playSounds(parsed);
  };

  const setDur = (base: number, dotted: boolean, triplet: boolean) => set({ dur: base * (dotted ? 1.5 : 1) * (triplet ? 2 / 3 : 1) });

  return (
    <section className="insp-card">
      <div className="insp-head">
        <h3>{item.sounds.length ? (item.sounds.length > 1 ? 'Chord' : 'Note') : 'Rest'}</h3>
        <span className="muted small">
          Bar {pos.m + 1}, beat {+(pos.start + 1).toFixed(2)}
        </span>
      </div>

      <div className="insp-preview">
        <span className={`ve-glyphs big ${item.sounds.length > 1 ? 'stack' : ''}`}>
          {item.sounds.length ? item.sounds.map((s, k) => <Glyph key={k} sound={s} flats={flats} />) : <span className="rest-glyph">𝄽</span>}
        </span>
        <div className="insp-names">
          <b>{midis.map((m) => (m === null ? 'not playable' : midiToName(m, flats))).join(' + ') || 'rest'}</b>
          <span className="muted small">{durationLabel(item.dur)}</span>
        </div>
        {item.sounds.length > 0 && (
          <button className="icon-btn" onClick={() => playSounds(item.sounds, item.dur)} title="Hear it">
            ▶
          </button>
        )}
      </div>

      <label className="field">
        <span>Holes</span>
        <div className="row">
          <input
            className={`meta-input mono ${bad ? 'bad' : ''}`}
            value={input}
            placeholder="-4'  or  (4 5 6)"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && applyInput()}
            onBlur={() => input !== soundsText(item.sounds) && applyInput()}
          />
          <button className="icon-btn" title="Next note up (↑) — Shift-click: one semitone" onClick={(e) => { const s = stepPitch(harp, item.sounds, 1, e.shiftKey); if (s) { set({ sounds: s }); playSounds(s); } }}>▲</button>
          <button className="icon-btn" title="Next note down (↓) — Shift-click: one semitone" onClick={(e) => { const s = stepPitch(harp, item.sounds, -1, e.shiftKey); if (s) { set({ sounds: s }); playSounds(s); } }}>▼</button>
        </div>
        {bad && <span className="input-error">Use tab like -4' or (4 5 6), or a note like C5.</span>}
      </label>

      {first && (
        <>
          <div className="field">
            <span>Breath</span>
            <div className="seg">
              <button className={first.breath === 'blow' ? 'on' : ''} onClick={() => set({ sounds: mapHoles(harp, item.sounds, (s) => ({ ...s, breath: 'blow' })) })}>Blow</button>
              <button className={first.breath === 'draw' ? 'on' : ''} onClick={() => set({ sounds: mapHoles(harp, item.sounds, (s) => ({ ...s, breath: 'draw' })) })}>Draw</button>
            </div>
          </div>
          {harp.bendable && (
            <div className="field">
              <span>Bend</span>
              <div className="seg">
                {[0, 1, 2, 3].map((b) => (
                  <button
                    key={b}
                    className={first.bend === b && !first.over ? 'on' : ''}
                    disabled={b > maxBend(harp, first.hole, first.breath)}
                    onClick={() => set({ sounds: mapHoles(harp, item.sounds, (s) => ({ ...s, bend: b, over: false })) })}
                    title={b ? `${b === 1 ? 'Half step' : b === 2 ? 'Whole step' : '1½ steps'} down` : 'No bend'}
                  >
                    {b ? "'".repeat(b) : 'none'}
                  </button>
                ))}
                {canOver(harp, first.hole, first.breath) && (
                  <button className={first.over ? 'on' : ''} onClick={() => set({ sounds: mapHoles(harp, item.sounds, (s) => ({ ...s, over: !s.over, bend: 0 })) })} title="Overblow / overdraw">
                    OB
                  </button>
                )}
              </div>
            </div>
          )}
          {harp.hasSlide && (
            <label className="check">
              <input type="checkbox" checked={first.slide} onChange={(e) => set({ sounds: mapHoles(harp, item.sounds, (s) => ({ ...s, slide: e.target.checked })) })} />
              Slide button in
            </label>
          )}
        </>
      )}

      <div className="field">
        <span>Length</span>
        <div className="seg durations">
          {DURATIONS.map((x) => (
            <button key={x.beats} className={d.base === x.beats ? 'on' : ''} onClick={() => setDur(x.beats, d.dotted, d.triplet)} title={x.name}>
              {x.symbol}
            </button>
          ))}
          <button className={d.dotted ? 'on' : ''} onClick={() => setDur(d.base ?? 1, !d.dotted, false)} title="Dotted">·</button>
          <button className={d.triplet ? 'on' : ''} onClick={() => setDur(d.base ?? 1, false, !d.triplet)} title="Triplet">3</button>
        </div>
      </div>

      <div className="field-row">
        <label className="field">
          <span>Chord</span>
          <LiveInput value={item.chord ?? ''} placeholder="G7" onCommit={(v) => commitSong(updateItem(song, pos, { chord: v.trim() || undefined }), 'typing')} />
        </label>
        <label className="field">
          <span>Lyric</span>
          <LiveInput value={item.lyric ?? ''} placeholder="syl-" onCommit={(v) => commitSong(updateItem(song, pos, { lyric: v || undefined }), 'typing')} />
        </label>
      </div>

      <div className="row">
        <button
          className="btn small"
          onClick={() => {
            const to = advance(song, pos, item.dur);
            apply(placeItem(song, to.m, { ...item, start: to.start }), { selection: [to], caret: advance(song, to, item.dur), measure: to.m });
          }}
          title="Copy this note into the next slot"
        >
          Repeat
        </button>
        <button className="btn small danger" onClick={() => apply(removeItems(song, [pos]), { selection: [], caret: pos })}>
          Delete
        </button>
      </div>
      {holes.length > 0 && (
        <p className="muted small">
          {holes.map((h) => holeSoundText(h)).join(' ')} · play a hole on the harmonica below to replace it.
        </p>
      )}
    </section>
  );
}

function MultiPanel({ song, sel }: { song: Song; sel: Pos[] }) {
  const { harp } = useParsed();
  const step = (dir: 1 | -1) => {
    let next = song;
    for (const p of sel) {
      const it = findItem(next, p);
      if (!it || !it.sounds.length) continue;
      const s = stepPitch(harp, it.sounds, dir);
      if (s) next = updateItem(next, p, { sounds: s });
    }
    apply(next);
  };
  return (
    <section className="insp-card">
      <h3>{sel.length} notes selected</h3>
      <p className="muted small">Use the length buttons in the toolbar to change them all. Ctrl+C copies them; Ctrl+V pastes at the caret.</p>
      <div className="row">
        <button className="btn small" onClick={() => step(1)}>Pitch ▲</button>
        <button className="btn small" onClick={() => step(-1)}>Pitch ▼</button>
        <button className="btn small danger" onClick={() => apply(removeItems(song, sel), { selection: [] })}>Delete</button>
      </div>
    </section>
  );
}

const END_BARS: { id: BarStyle; label: string }[] = [
  { id: 'single', label: '| bar' },
  { id: 'double', label: '|| double' },
  { id: 'repeat-end', label: ':| repeat back' },
  { id: 'final', label: '|] end' },
];

function MeasurePanel({ song, m }: { song: Song; m: number }) {
  const meas = song.measures[m];
  if (!meas) return null;
  const length = meas.items.reduce((a, it) => Math.max(a, it.start + it.dur), 0);
  return (
    <section className="insp-card">
      <div className="insp-head">
        <h3>Measure {m + 1}</h3>
        <span className={`muted small ${length > song.cap + EPS ? 'warn' : ''}`}>
          {+Math.min(length, 99).toFixed(2)} / {song.cap} beats
        </span>
      </div>
      <label className="field">
        <span>Section</span>
        <LiveInput
          value={meas.section ?? ''}
          placeholder="e.g. Chorus"
          onCommit={(v) => commitSong(updateMeasure(song, m, { section: v.trim() || undefined, lineBreak: v.trim() ? true : meas.lineBreak }), 'typing')}
        />
      </label>
      <div className="field-row">
        <label className="check">
          <input type="checkbox" checked={meas.lineBreak} disabled={m === 0} onChange={(e) => apply(updateMeasure(song, m, { lineBreak: e.target.checked }))} />
          Starts a new line
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={meas.startBar === 'repeat-start'}
            onChange={(e) => apply(updateMeasure(song, m, { startBar: e.target.checked ? 'repeat-start' : undefined }))}
          />
          Repeat from here
        </label>
      </div>
      <label className="field">
        <span>Bar line at the end</span>
        <select value={meas.endBar} onChange={(e) => apply(updateMeasure(song, m, { endBar: e.target.value as BarStyle }))}>
          {END_BARS.map((b) => (
            <option key={b.id} value={b.id}>{b.label}</option>
          ))}
        </select>
      </label>
      <div className="row wrap">
        <button className="btn small ghost" onClick={() => apply(insertMeasure(song, m), { measure: m, caret: { m, start: 0 } })}>Insert before</button>
        <button className="btn small ghost" onClick={() => apply(insertMeasure(song, m + 1), { measure: m + 1, caret: { m: m + 1, start: 0 } })}>Insert after</button>
        <button className="btn small ghost" onClick={() => apply(duplicateMeasure(song, m), { measure: m + 1 })}>Duplicate</button>
        <button className="btn small ghost" onClick={() => apply(clearMeasure(song, m), { selection: [] })}>Clear</button>
        <button className="btn small danger" onClick={() => apply(deleteMeasure(song, m), { selection: [], measure: Math.max(0, m - 1), caret: { m: Math.max(0, m - 1), start: 0 } })}>
          Delete
        </button>
      </div>
    </section>
  );
}

