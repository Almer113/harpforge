// Inspector for the visual editor: edits the selected note(s) and the current measure.

import { setLyric } from '../../core/edit/lyrics';
import { ordinal } from '../../core/endings';
import { lyricOf } from '../../core/verses';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  advance,
  chainAt,
  chainLength,
  clearMeasure,
  deleteMeasure,
  duplicateMeasure,
  EPS,
  findItem,
  fromDoc,
  insertMeasure,
  placeItem,
  deleteNotes,
  makeRoom,
  setTie,
  updateItem,
  updateMeasure,
  type Item,
  type Pos,
  type Song,
} from '../../core/edit/model';
import { holeSoundText, soundText } from '../../core/htab/serializer';
import type { BarStyle } from '../../core/htab/types';
import { canOver, maxBend, soundPitch } from '../../core/instruments';
import { midiToName, type Spelling } from '../../core/pitch';
import { flatsFor } from '../../core/edit/splice';
import type { HoleSound, Sound } from '../../core/types';
import { commitSong, durationLabel, mapHoles, parseSoundsInput, stepPitch } from '../../state/editor';
import { chooseSounds, neighbours, offHarp, parseNotes, pitchOf, stepNotes, stepScale, waysToPlay } from '../../core/edit/notes';
import { getParsed, useApp, useParsed } from '../../state/store';
import { Glyph, NoteGlyph } from '../TabView';
import { apply, playSounds } from './VisualEditor';

const soundsText = (sounds: Sound[]) =>
  sounds.length === 0 ? '' : sounds.length === 1 ? soundText(sounds[0]) : '(' + sounds.map((s) => soundText(s)).join(' ') + ')';

/** A text input that commits as you type (grouped into one undo step). */
function LiveInput({ value, placeholder, onCommit, className }: { value: string; placeholder?: string; onCommit: (v: string) => void; className?: string }) {
  const [draft, setDraft] = useState(value);
  // A new value (another note, an undo) replaces the draft, during render rather than in an effect.
  const [shown, setShown] = useState(value);
  if (value !== shown) {
    setShown(value);
    setDraft(value);
  }
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

type Tab = 'note' | 'measure';
const TABS: { id: Tab; label: string }[] = [
  { id: 'note', label: 'Note' },
  { id: 'measure', label: 'Measure' },
];

/**
 * Note and Measure tabs. The tab follows what you click (a note: Note; a bar number or an
 * empty slot: the measure there) until you pick one yourself.
 */
export function Inspector({ song }: { song: Song }) {
  const ve = useApp((s) => s.ve);
  const sel = ve.selection;
  const items = sel.map((p) => ({ p, it: findItem(song, p) })).filter((x): x is { p: Pos; it: Item } => !!x.it);
  const tab: Tab = ve.panel === 'note' || ve.panel === 'measure' ? ve.panel : items.length ? 'note' : 'measure';
  const m = Math.min(sel[0]?.m ?? ve.measure, song.measures.length - 1);
  return (
    <aside className="ve-inspector">
      <div className="insp-tabs" role="tablist" aria-label="Inspector">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => useApp.getState().setVe({ panel: t.id })}>
            {t.label}
            {t.id === 'note' && items.length > 1 ? ` (${items.length})` : ''}
          </button>
        ))}
      </div>
      <div className="insp-body" role="tabpanel">
        {tab === 'note' &&
          (items.length === 1 ? (
            // One panel per note (keyed), so what's typed in it can only ever go to that note.
            <NotePanel key={`${items[0].p.m}:${items[0].p.start}`} song={song} pos={items[0].p} item={items[0].it} />
          ) : items.length > 1 ? (
            <MultiPanel song={song} sel={items.map((x) => x.p)} />
          ) : (
            <p className="muted small insp-empty">Select a note to see it here, or turn on Step entry and play the harmonica to write notes at the caret.</p>
          ))}
        {tab === 'measure' && <MeasurePanel song={song} m={m} />}
      </div>
    </aside>
  );
}

/**
 * Applies `text` to the note at `pos` in the current tab, after the click that moved
 * away from it has been handled. `toSounds` reads the text (null if it can't).
 */
function applyLater(pos: Pos, text: string, seq: number, toSounds: (song: Song, text: string) => Sound[] | null) {
  // Typed for the tab open then (`seq`): if another one has been opened, the edit doesn't go there.
  queueMicrotask(() => {
    if (useApp.getState().loadSeq !== seq) return;
    const song = fromDoc(getParsed(useApp.getState().text).doc);
    if (!findItem(song, pos)) return;
    const sounds = toSounds(song, text);
    if (sounds) commitSong(updateItem(song, pos, { sounds }));
    else useApp.getState().notify(`Couldn’t use “${text}” for that note, so it was left as it was.`);
  });
}

/**
 * A field's typed-but-not-applied text goes to the note it was typed for when the panel
 * closes (you clicked another note): never to the next note, and never just dropped.
 */
function useApplyOnLeave(pending: string | null, apply: (text: string) => void) {
  const latest = useRef({ pending, apply });
  useLayoutEffect(() => {
    latest.current = { pending, apply };
  });
  useEffect(
    () => () => {
      const { pending: text, apply: go } = latest.current;
      if (text !== null) go(text);
    },
    [],
  );
}

function NotePanel({ song, pos, item }: { song: Song; pos: Pos; item: Item }) {
  const { harp, doc, text } = useParsed();
  const flats = flatsFor(text, doc.meta.key ?? harp.spec.key);
  const [input, setInput] = useState(soundsText(item.sounds));
  const [bad, setBad] = useState(false);
  // Another note (or the same one changed elsewhere): its holes replace what was typed.
  const [shownSounds, setShownSounds] = useState(item.sounds);
  if (item.sounds !== shownSounds) {
    setShownSounds(item.sounds);
    setInput(soundsText(item.sounds));
    setBad(false);
  }
  const seq = useApp((s) => s.loadSeq);
  useApplyOnLeave(input !== soundsText(item.sounds) ? input : null, (t) => applyLater(pos, t, seq, (_, x) => parseSoundsInput(x)));

  const set = (patch: Partial<Item>) => apply(updateItem(song, pos, patch));
  const asNotes = useApp((s) => s.readAs === 'notes');
  const holes = item.sounds.filter((s): s is HoleSound => s.type === 'hole');
  const first = holes[0];
  const midis = item.sounds.map((s) => (s.type === 'pitch' ? s.midi : soundPitch(harp, s)));
  // A tied note's length is the whole chain.
  const chain = chainAt(song, pos);
  const total = chainLength(song, chain);
  const measuresSpanned = new Set(chain.map((p) => p.m)).size;

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

  const insert = useApp((s) => s.ve.insert);
  const verse = useApp((s) => s.ve.verse);

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
          {item.sounds.length ? (
            item.sounds.map((s, k) => (asNotes ? <NoteGlyph key={k} sound={s} midi={midis[k]} flats={flats} /> : <Glyph key={k} sound={s} flats={flats} />))
          ) : (
            <span className="rest-glyph">𝄽</span>
          )}
        </span>
        <div className="insp-names">
          <b>
            {asNotes
              ? item.sounds.map((s) => (s.type === 'hole' ? holeSoundText(s) : 'no hole')).join(' + ') || 'rest'
              : midis.map((m) => (m === null ? 'not playable' : midiToName(m, flats))).join(' + ') || 'rest'}
          </b>
          <span className="muted small">
            {durationLabel(total)}
            {chain.length > 1 && ` · tied${measuresSpanned > 1 ? ` across ${measuresSpanned} measures` : ''}`}
          </span>
        </div>
        {item.sounds.length > 0 && (
          <button className="icon-btn" onClick={() => playSounds(item.sounds, total)} title="Hear it">
            ▶
          </button>
        )}
      </div>

      {asNotes && item.sounds.length > 0 && <NoteFields song={song} pos={pos} item={item} flats={flats} />}

      {!asNotes && (
      <div className="field">
        <span id="insp-holes">Holes</span>
        <div className="row">
          <input
            aria-labelledby="insp-holes"
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
      </div>
      )}

      {first && !asNotes && (
        <>
          <div className="field">
            <span>Breath</span>
            <div className="seg" role="group" aria-label="Breath">
              <button className={first.breath === 'blow' ? 'on' : ''} aria-pressed={first.breath === 'blow'} onClick={() => set({ sounds: mapHoles(harp, item.sounds, (s) => ({ ...s, breath: 'blow' })) })}>Blow</button>
              <button className={first.breath === 'draw' ? 'on' : ''} aria-pressed={first.breath === 'draw'} onClick={() => set({ sounds: mapHoles(harp, item.sounds, (s) => ({ ...s, breath: 'draw' })) })}>Draw</button>
            </div>
          </div>
          {harp.bendable && (
            <div className="field">
              <span>Bend</span>
              <div className="seg" role="group" aria-label="Bend">
                {[0, 1, 2, 3].map((b) => (
                  <button
                    key={b}
                    className={first.bend === b && !first.over ? 'on' : ''}
                    aria-pressed={first.bend === b && !first.over}
                    disabled={b > maxBend(harp, first.hole, first.breath)}
                    onClick={() => set({ sounds: mapHoles(harp, item.sounds, (s) => ({ ...s, bend: b, over: false })) })}
                    title={b ? `${b === 1 ? 'Half step' : b === 2 ? 'Whole step' : '1½ steps'} down` : 'No bend'}
                  >
                    {b ? "'".repeat(b) : 'none'}
                  </button>
                ))}
                {canOver(harp, first.hole, first.breath) && (
                  <button className={first.over ? 'on' : ''} aria-pressed={!!first.over} onClick={() => set({ sounds: mapHoles(harp, item.sounds, (s) => ({ ...s, over: !s.over, bend: 0 })) })} title="Overblow / overdraw">
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

      {item.sounds.length > 0 && (
        <label className="check" title="This note continues the note right before it (also across a bar line) instead of being played again (L)">
          <input
            type="checkbox"
            checked={!!item.tied}
            onChange={(e) => {
              const next = setTie(song, pos, e.target.checked);
              if (next === song) useApp.getState().notify('There’s no note right before this one to tie to.');
              else apply(next);
            }}
          />
          Tied to the previous note
        </label>
      )}

      <div className="field-row">
        <label className="field">
          <span>Chord</span>
          <LiveInput value={item.chord ?? ''} placeholder="G7" onCommit={(v) => commitSong(updateItem(song, pos, { chord: v.trim() || undefined }), 'typing')} />
        </label>
        {!item.tied ? (
          <label className="field">
            <span>Lyric{verse ? ` (verse ${verse + 1})` : ''}</span>
            <LiveInput value={lyricOf(item, verse) ?? ''} placeholder="syl-" onCommit={(v) => commitSong(setLyric(song, pos, verse, v || undefined), 'typing')} />
          </label>
        ) : (
          <div className="field">
            <span>Lyric</span>
            <span className="muted small">A tied note isn’t sung again — the syllable goes on the note it continues.</span>
          </div>
        )}
      </div>

      <div className="row">
        <button
          className="btn small"
          onClick={() => {
            const head = findItem(song, chain[0])!;
            const to = advance(song, chain[0], total);
            apply(placeItem(makeRoom(song, to, total, insert), to.m, { ...head, tied: undefined, start: to.start, dur: total }), { selection: [to], caret: advance(song, to, total), measure: to.m });
          }}
          title="Copy this note into the next slot"
        >
          Repeat
        </button>
        <button className="btn small danger" onClick={() => apply(deleteNotes(song, [pos], insert), { selection: [], caret: chain[0] })}>
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

/** Notes mode: type the note, step it, and choose how it's played. */
function NoteFields({ song, pos, item, flats }: { song: Song; pos: Pos; item: Item; flats: Spelling }) {
  const { harp, doc } = useParsed();
  const names = (sounds: Sound[]) => sounds.map((s) => pitchOf(harp, s)).map((m) => (m === null ? '?' : midiToName(m, flats))).join(' ');
  const [input, setInput] = useState(names(item.sounds));
  const [bad, setBad] = useState(false);
  // Another note, or another harmonica: the note names replace what was typed.
  const [shown, setShown] = useState({ sounds: item.sounds, harp });
  if (item.sounds !== shown.sounds || harp !== shown.harp) {
    setShown({ sounds: item.sounds, harp });
    setInput(names(item.sounds));
    setBad(false);
  }
  const seq = useApp((s) => s.loadSeq);
  useApplyOnLeave(input !== names(item.sounds) ? input : null, (t) =>
    applyLater(pos, t, seq, (s, x) => {
      const midis = parseNotes(x);
      return midis ? chooseSounds(harp, midis, neighbours(s, pos)) : null;
    }),
  );

  const setSounds = (sounds: Sound[]) => {
    apply(updateItem(song, pos, { sounds }));
    playSounds(sounds);
  };
  const applyInput = () => {
    const midis = parseNotes(input);
    if (!midis) {
      setBad(true);
      return;
    }
    setBad(false);
    setSounds(chooseSounds(harp, midis, neighbours(song, pos)));
  };
  const step = (dir: 1 | -1, chromatic: boolean) => {
    const s = stepNotes(harp, item.sounds, dir, chromatic, stepScale(doc.meta.key, harp), neighbours(song, pos));
    if (s) setSounds(s);
  };
  const off = item.sounds.filter((s) => offHarp(harp, s));

  return (
    <>
      <div className="field">
        <span id="insp-note">Note</span>
        <div className="row">
          <input
            aria-labelledby="insp-note"
            className={`meta-input mono ${bad ? 'bad' : ''}`}
            value={input}
            placeholder="D5  or  C5 E5 G5"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && applyInput()}
            onBlur={() => input !== names(item.sounds) && applyInput()}
          />
          <button className="icon-btn" title="Next note of the scale up (↑) — Shift-click: one semitone (Shift+↑)" onClick={(e) => step(1, e.shiftKey)}>▲</button>
          <button className="icon-btn" title="Next note of the scale down (↓) — Shift-click: one semitone (Shift+↓)" onClick={(e) => step(-1, e.shiftKey)}>▼</button>
        </div>
        {bad && <span className="input-error">Type a note like D5, Bb4 or F#5 — or several for a chord: C5 E5 G5.</span>}
      </div>
      {off.length > 0 && (
        <p className="insp-warn small">
          {names(off)} {off.length === 1 ? 'isn’t' : 'aren’t'} on this harmonica, so the tab keeps the note name. Move it an octave, or pick a harmonica that has it.
        </p>
      )}
      <div className="field">
        <span>Play it as</span>
        {item.sounds.map((s, k) => {
          const m = pitchOf(harp, s);
          const ways = m === null ? [] : waysToPlay(harp, m);
          if (!ways.length) return null;
          return (
            <div key={k} className="play-as">
              {item.sounds.length > 1 && <span className="muted small pa-note">{midiToName(m!, flats)}</span>}
              <div className="seg wrap" role="group" aria-label={item.sounds.length > 1 ? `Play ${midiToName(m!, flats)} as` : 'Play it as'}>
                {ways.map((w) => {
                  const on = s.type === 'hole' && holeSoundText(s) === holeSoundText(w.sound);
                  return (
                    <button
                      key={holeSoundText(w.sound)}
                      className={`${on ? 'on' : ''} ${w.sound.breath}`}
                      aria-pressed={on}
                      onClick={() => setSounds(item.sounds.map((x, i) => (i === k ? w.sound : x)))}
                      title={w.cost === 0 ? 'Plain hole' : w.sound.over ? (w.sound.breath === 'blow' ? 'Overblow' : 'Overdraw') : w.sound.bend ? `Bend (${w.sound.bend === 1 ? 'half' : w.sound.bend === 2 ? 'whole' : '1½'} step)` : 'Slide in'}
                    >
                      {holeSoundText(w.sound)}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
        <span className="muted small">Easiest first. Your choice stays until you change the note.</span>
      </div>
    </>
  );
}

function MultiPanel({ song, sel }: { song: Song; sel: Pos[] }) {
  const { harp, doc } = useParsed();
  const asNotes = useApp((s) => s.readAs === 'notes');
  const step = (dir: 1 | -1) => {
    let next = song;
    for (const p of sel) {
      const it = findItem(next, p);
      if (!it || !it.sounds.length) continue;
      const s = asNotes ? stepNotes(harp, it.sounds, dir, false, stepScale(doc.meta.key, harp), neighbours(next, p)) : stepPitch(harp, it.sounds, dir);
      if (s) next = updateItem(next, p, { sounds: s });
    }
    apply(next);
  };
  return (
    <section className="insp-card">
      <h3>{sel.length} notes selected</h3>
      <p className="muted small">Use the length buttons in the toolbar to change them all. Ctrl+C / Ctrl+X copy or cut them as tab text; Ctrl+V pastes at the caret. Drag one to move them all.</p>
      <div className="row">
        <button className="btn small" onClick={() => step(1)}>Pitch ▲</button>
        <button className="btn small" onClick={() => step(-1)}>Pitch ▼</button>
        <button className="btn small danger" onClick={() => apply(deleteNotes(song, sel, useApp.getState().ve.insert), { selection: [] })}>Delete</button>
      </div>
    </section>
  );
}

const END_BARS: { id: BarStyle | 'none'; label: string }[] = [
  { id: 'none', label: 'none (carries on)' },
  { id: 'single', label: '| bar' },
  { id: 'double', label: '|| double' },
  { id: 'repeat-end', label: ':| repeat back' },
  { id: 'final', label: '|] end' },
];

/** The endings offered (the times through a bar is played); one written otherwise is offered too. */
const ENDINGS: { id: string; label: string }[] = [
  { id: '', label: 'none (every time)' },
  { id: '1', label: '1st ending' },
  { id: '2', label: '2nd ending' },
  { id: '3', label: '3rd ending' },
  { id: '1,2', label: '1st and 2nd' },
  { id: '1,2,3', label: '1st, 2nd and 3rd' },
];

function MeasurePanel({ song, m }: { song: Song; m: number }) {
  const meas = song.measures[m];
  if (!meas) return null;
  const ending = meas.ending?.join(',') ?? '';
  const endings = ENDINGS.some((e) => e.id === ending) ? ENDINGS : [...ENDINGS, { id: ending, label: `${meas.ending!.map(ordinal).join(', ')}` }];
  const length = meas.items.reduce((a, it) => Math.max(a, it.start + it.dur), 0);
  return (
    <section className="insp-card">
      <div className="insp-head">
        <h3>Measure {m + 1}</h3>
        <span className={`muted small ${length > song.cap + EPS ? 'warn' : ''}`}>
          {+Math.min(length, 99).toFixed(2)} / {song.cap} beats
        </span>
      </div>
      {meas.len !== undefined && meas.len < song.cap - EPS && length < song.cap - EPS && (
        <div className="insp-note">
          <span className="muted small">Short bar{m === 0 ? ' (pickup)' : ''}: {+Math.max(meas.len, length).toFixed(2)} of {song.cap} beats.</span>
          <button className="btn small ghost" onClick={() => apply(updateMeasure(song, m, { len: undefined }))} title="Fill the rest of the bar with rests">
            Make full length
          </button>
        </div>
      )}
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
        <span>Ending</span>
        <select
          value={ending}
          onChange={(e) => apply(updateMeasure(song, m, { ending: e.target.value ? e.target.value.split(',').map(Number) : undefined }))}
          title="A 1st/2nd ending: this bar (and the ones after it, up to its :| or the next ending) is played only those times through the repeat"
        >
          {endings.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Bar line at the end</span>
        <select value={meas.endBar} onChange={(e) => apply(updateMeasure(song, m, { endBar: e.target.value as BarStyle | 'none', ...(e.target.value !== 'repeat-end' ? { endTimes: undefined } : {}) }))}>
          {END_BARS.map((b) => (
            <option key={b.id} value={b.id}>{b.label}</option>
          ))}
        </select>
      </label>
      {meas.endBar === 'repeat-end' && (
        <label className="field">
          <span>Times through</span>
          <select
            value={meas.endTimes ?? 2}
            onChange={(e) => apply(updateMeasure(song, m, { endTimes: Number(e.target.value) > 2 ? Number(e.target.value) : undefined }))}
            title="How many times the repeat is played in all (with endings, their numbers say it too)"
          >
            {/* (A count written in the text past 8 is offered too.) */}
            {[...new Set([2, 3, 4, 5, 6, 7, 8, meas.endTimes ?? 2])].sort((x, y) => x - y).map((n) => (
              <option key={n} value={n}>{n === 2 ? 'twice' : `${n} times (:|x${n})`}</option>
            ))}
          </select>
        </label>
      )}
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

