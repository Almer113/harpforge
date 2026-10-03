// Visual tab sheet: lines → measures → note cards, sized by duration.

import { useEffect, useRef } from 'react';
import type { BarStyle, NoteEvent, RestEvent, TabEvent } from '../core/htab/types';
import { midiToName, prefersFlats } from '../core/pitch';
import { eventKey } from '../core/score';
import type { HoleSound, Sound } from '../core/types';
import type { Parsed } from '../state/store';

const BEAT_PX = 46;

interface Props {
  parsed: Parsed;
  activeEvents: number[];
  selectedEvent: number | null;
  showNoteNames: boolean;
  onCardClick?: (scoreIndex: number, ev: NoteEvent | RestEvent) => void;
  /** Follow the play-head by scrolling. */
  follow?: boolean;
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

export function TabView({ parsed, activeEvents, selectedEvent, showNoteNames, onCardClick, follow = true }: Props) {
  const { doc, score, indexByKey, harp } = parsed;
  const flats = prefersFlats(doc.meta.key ?? harp.spec.key);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!follow || !activeEvents.length || !root.current) return;
    const el = root.current.querySelector(`[data-index="${activeEvents[activeEvents.length - 1]}"]`);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
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
                      return ev.chord ? <div key={ei} className="card marker"><span className="card-chord">{ev.chord}</span></div> : null;
                    }
                    const active = idx !== undefined && activeEvents.includes(idx);
                    const selected = idx !== undefined && idx === selectedEvent;
                    const bad = sev?.midis.some((x) => x === null);
                    const breath = ev.kind === 'note' ? breathOf(ev.sounds) : 'rest';
                    return (
                      <button
                        key={ei}
                        data-index={idx}
                        className={`card ${breath} ${active ? 'active' : ''} ${selected ? 'selected' : ''} ${bad ? 'bad' : ''} ${ev.beats < 1 ? 'short' : ''}`}
                        style={{ minWidth: width }}
                        onClick={() => idx !== undefined && onCardClick?.(idx, ev)}
                        title={sev && !sev.rest ? sev.midis.map((x) => (x === null ? 'not playable' : midiToName(x, flats))).join(' + ') : 'rest'}
                      >
                        <span className="card-chord">{ev.chord ?? ''}</span>
                        <span className="card-body">
                          {ev.kind === 'rest' ? (
                            <span className="rest-glyph">𝄽</span>
                          ) : (
                            <span className={`glyphs ${ev.sounds.length > 1 ? 'stack' : ''}`}>
                              {ev.sounds.map((s, k) => (
                                <Glyph key={k} sound={s} flats={flats} />
                              ))}
                            </span>
                          )}
                        </span>
                        {showNoteNames && sev && !sev.rest && (
                          <span className="card-note">{sev.midis.map((x) => (x === null ? '?' : midiToName(x, flats))).join(' ')}</span>
                        )}
                        <span className="card-lyric">{ev.lyric ?? ''}</span>
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

function Glyph({ sound, flats }: { sound: Sound; flats: boolean }) {
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
