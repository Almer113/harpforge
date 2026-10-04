// Visual tab sheet: lines → measures → note cards, sized by duration.

import { useEffect, useRef } from 'react';
import type { BarStyle, NoteEvent, RestEvent, TabEvent } from '../core/htab/types';
import { midiToName, keyUsesFlats } from '../core/pitch';
import { eventKey } from '../core/score';
import type { HoleSound, Sound } from '../core/types';
import type { Parsed, ReadAs } from '../state/store';
import { doPitchClass, midiToDegree } from '../core/formats/jianpu';
import { holeSoundText } from '../core/htab/serializer';
import { followTo } from './follow';
import { offHarp } from '../core/edit/notes';

const BEAT_PX = 46;

interface Props {
  parsed: Parsed;
  activeEvents: number[];
  selectedEvent: number | null;
  showNoteNames: boolean;
  /** Lyrics under the notes and chord symbols above them (both shown unless turned off). */
  showLyrics?: boolean;
  showChords?: boolean;
  onCardClick?: (scoreIndex: number, ev: NoteEvent | RestEvent) => void;
  /** Follow the play-head by scrolling. */
  follow?: boolean;
  /** Show holes (tab) or scale-degree numbers (jianpu). */
  notation?: 'holes' | 'numbers';
  /** In Notes mode the note names are the big text and the holes go underneath. */
  readAs?: ReadAs;
}

interface Measure {
  items: { ev: NoteEvent | RestEvent; ei: number }[];
  bar?: BarStyle;
}

function toMeasures(events: TabEvent[]): Measure[] {
  const out: Measure[] = [];
  let cur: Measure = { items: [] };
  events.forEach((ev, ei) => {
    if (ev.kind === 'bar') {
      cur.bar = ev.style;
      out.push(cur);
      cur = { items: [] };
    } else cur.items.push({ ev, ei });
  });
  if (cur.items.length) out.push(cur);
  return out;
}

export function TabView({ parsed, activeEvents, selectedEvent, showNoteNames, showLyrics = true, showChords = true, onCardClick, follow = true, notation = 'holes', readAs = 'holes' }: Props) {
  const activeSet = new Set(activeEvents);
  const { doc, score, indexByKey, harp } = parsed;
  const flats = keyUsesFlats(doc.meta.key ?? harp.spec.key);
  const numbers = notation === 'numbers';
  const asNotes = !numbers && readAs === 'notes';
  const doPc = doPitchClass(doc.meta.key ?? harp.spec.key.replace(/^(Low|High)\s+/i, ''));
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!follow || !activeEvents.length || !root.current) return;
    const el = root.current.querySelector(`[data-index="${activeEvents[activeEvents.length - 1]}"]`);
    followTo(el);
  }, [activeEvents, follow]);

  useEffect(() => {
    if (!follow || selectedEvent === null || !root.current) return;
    root.current.querySelector(`[data-index="${selectedEvent}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedEvent, follow]);

  const hasContent = doc.lines.some((l) => l.events.length || l.section);
  if (!hasContent) {
    return (
      <div className="tab-empty">
        <p>This tab is empty.</p>
        <p className="muted">Play the harmonica with record on, or type tabs in the Editor — e.g. <code>4 -4 5 -5 6</code></p>
      </div>
    );
  }

  return (
    <div className="tabview" ref={root}>
      {doc.lines.map((line, li) => (
        <div className="tab-line-wrap" key={li}>
          {line.section !== undefined && <div className="tab-section">{line.section}</div>}
          {line.events.length > 0 && (
            <div className="tab-line">
              {toMeasures(line.events).map((m, mi) => (
                <div className={`measure bar-${m.bar ?? 'open'}`} key={mi}>
                  {m.bar === 'repeat-start' && <span className="repeat-dots left" />}
                  {m.items.map(({ ev, ei }) => {
                    const idx = indexByKey.get(eventKey(li, ei));
                    const sev = idx !== undefined ? score.events[idx] : undefined;
                    const width = Math.max(30, ev.beats * BEAT_PX);
                    if (ev.kind === 'rest' && ev.beats === 0) {
                      return ev.chord && showChords ? <div key={ei} className="card marker"><span className="card-chord">{ev.chord}</span></div> : null;
                    }
                    const active = idx !== undefined && activeSet.has(idx);
                    const selected = idx !== undefined && idx === selectedEvent;
                    const bad = sev?.midis.some((x) => x === null) || (ev.kind === 'note' && ev.sounds.some((s) => s.type === 'pitch' && offHarp(harp, s)));
                    const breath = ev.kind === 'note' ? breathOf(ev.sounds) : 'rest';
                    return (
                      <button
                        key={ei}
                        data-index={idx}
                        className={`card ${breath} ${ev.kind === 'note' && ev.tied ? 'tied' : ''} ${active ? 'active' : ''} ${selected ? 'selected' : ''} ${bad ? 'bad' : ''} ${ev.beats < 1 ? 'short' : ''}`}
                        style={{ minWidth: width }}
                        onClick={() => idx !== undefined && onCardClick?.(idx, ev)}
                        title={sev && !sev.rest ? sev.midis.map((x) => (x === null ? 'not playable' : midiToName(x, flats))).join(' + ') : 'rest'}
                      >
                        {showChords && <span className="card-chord">{ev.chord ?? ''}</span>}
                        <span className="card-body">
                          {numbers && ev.kind === 'note' && ev.tied ? (
                            <TieDashes beats={ev.beats} />
                          ) : numbers ? (
                            <NumberGlyphs midis={ev.kind === 'rest' ? [] : (sev?.midis ?? []).filter((m): m is number => m !== null)} beats={ev.beats} doPc={doPc} />
                          ) : ev.kind === 'rest' ? (
                            <span className="rest-glyph">𝄽</span>
                          ) : asNotes ? (
                            <span className={`glyphs ${ev.sounds.length > 1 ? 'stack' : ''}`}>
                              {ev.sounds.map((s, k) => (
                                <NoteGlyph key={k} sound={s} midi={sev?.midis[k] ?? null} flats={flats} />
                              ))}
                            </span>
                          ) : (
                            <span className={`glyphs ${ev.sounds.length > 1 ? 'stack' : ''}`}>
                              {ev.sounds.map((s, k) => (
                                <Glyph key={k} sound={s} flats={flats} />
                              ))}
                            </span>
                          )}
                        </span>
                        {showNoteNames && sev && !sev.rest && (
                          <span className="card-note">
                            {numbers || asNotes
                              ? sev.sounds.map((snd) => (snd.type === 'hole' ? holeSoundText(snd) : '')).join(' ')
                              : sev.midis.map((x) => (x === null ? '?' : midiToName(x, flats))).join(' ')}
                          </span>
                        )}
                        {showLyrics && <span className="card-lyric">{ev.lyric ?? ''}</span>}
                      </button>
                    );
                  })}
                  {(m.bar === 'repeat-end') && <span className="repeat-dots right" />}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function breathOf(sounds: Sound[]): string {
  const holes = sounds.filter((s): s is HoleSound => s.type === 'hole');
  if (!holes.length) return 'pitch';
  if (holes.every((h) => h.breath === 'blow')) return 'blow';
  if (holes.every((h) => h.breath === 'draw')) return 'draw';
  return 'mixed';
}

export function Glyph({ sound, flats }: { sound: Sound; flats: boolean }) {
  if (sound.type === 'pitch') return <span className="glyph pitch">{midiToName(sound.midi, flats)}</span>;
  return (
    <span className={`glyph ${sound.breath}`}>
      {sound.slide && <span className="g-slide">‹</span>}
      {sound.breath === 'draw' && <span className="g-sign">−</span>}
      <span className="g-num">{sound.hole}</span>
      {sound.bend > 0 && <span className="g-bend">{'ʼ'.repeat(sound.bend)}</span>}
      {sound.over && <span className="g-over">o</span>}
    </span>
  );
}

/** A note name as the main text (Notes mode): letter, accidental and a smaller octave, in the hole's blow/draw colour. */
export function NoteGlyph({ sound, midi, flats }: { sound: Sound; midi: number | null; flats: boolean }) {
  const breath = sound.type === 'hole' ? sound.breath : 'pitch';
  const name = midi === null ? null : /^([A-G])([#b]?)(-?\d+)$/.exec(midiToName(midi, flats));
  if (!name) return <span className={`glyph note ${breath}`} title="Not playable on this harmonica">?</span>;
  return (
    <span className={`glyph note ${breath}`}>
      <span className="n-letter">{name[1]}</span>
      {name[2] && <span className="n-acc">{name[2] === '#' ? '♯' : '♭'}</span>}
      <span className="n-oct">{name[3]}</span>
    </span>
  );
}

/**
 * Numbered notation for one event: digits with octave dots, underlines for notes
 * shorter than a beat, a dot for dotted notes and dashes for each extra beat.
 */
function NumberGlyphs({ midis, beats, doPc }: { midis: number[]; beats: number; doPc: number }) {
  const underlines = beats <= 0.3 ? 2 : beats < 1 - 1e-6 ? 1 : 0;
  const dotted = [0.375, 0.75, 1.5].some((b) => Math.abs(beats - b) < 1e-6);
  const dashes = beats >= 2 - 1e-6 ? Math.round(beats) - 1 : 0;
  const digits = midis.length ? [...midis].reverse().map((m) => midiToDegree(m, doPc)) : [null];
  return (
    <span className="jp">
      <span className={`jp-stack ${digits.length > 1 ? 'chord' : ''}`}>
        {digits.map((d, k) => (
          <span key={k} className="jp-note">
            <span className="jp-dots above">{d && d.octave > 0 ? '•'.repeat(d.octave) : ''}</span>
            <span className="jp-digit">
              {d && d.accidental !== 0 && <span className="jp-acc">{d.accidental > 0 ? '♯' : '♭'}</span>}
              {d ? d.degree : 0}
            </span>
            <span className="jp-dots below">{d && d.octave < 0 ? '•'.repeat(-d.octave) : ''}</span>
          </span>
        ))}
        {underlines > 0 && <span className={`jp-under u${underlines}`} />}
      </span>
      {dotted && <span className="jp-aug">·</span>}
      {Array.from({ length: dashes }, (_, k) => (
        <span key={k} className="jp-dash">–</span>
      ))}
    </span>
  );
}

/** Numbered notation shows a tie as dashes: the note keeps sounding. */
function TieDashes({ beats }: { beats: number }) {
  const n = Math.max(1, Math.round(beats));
  return (
    <span className="jp">
      {Array.from({ length: n }, (_, k) => (
        <span key={k} className="jp-dash">–</span>
      ))}
    </span>
  );
}
