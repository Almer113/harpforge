// The interactive virtual harmonica.
//
// Mouse: press the top half of a hole to blow, the bottom half to draw. Drag
// sideways to slide across holes; drag further out (down for draw, up for blow)
// to bend. Alt+click overblows/overdraws.

import { useMemo, useRef } from 'react';
import { canOver, maxBend, soundPitch, type Harmonica as Harp } from '../core/instruments';
import { midiToName, prefersFlats } from '../core/pitch';
import type { Breath, HoleSound } from '../core/types';
import { change, press, release } from '../live/livePlayer';
import { BLOW_LABELS, DRAW_LABELS } from '../live/useHarmonicaKeyboard';
import { useApp, useParsed } from '../state/store';
import { holeSoundText } from '../core/htab/serializer';

const PX_PER_SEMITONE = 26;
const MOUSE_ID = 'mouse';

interface HoleState {
  blow?: HoleSound;
  draw?: HoleSound;
}

export function Harmonica() {
  const { harp, score } = useParsed();
  const held = useApp((s) => s.held);
  const activeEvents = useApp((s) => s.activeEvents);
  const keyOffset = useApp((s) => s.keyOffset);
  const asNotes = useApp((s) => s.readAs === 'notes');
  // Notes mode always labels the reeds with their notes.
  const showNames = useApp((s) => s.showNoteNames) || asNotes;
  const slideLatch = useApp((s) => s.slideLatch);
  const practice = useApp((s) => s.practice);
  const flats = prefersFlats(harp.spec.key);

  // Practice mode: the holes to play next.
  const targets = useMemo(() => {
    const map = new Map<number, HoleState>();
    if (!practice) return map;
    for (const s of score.events[practice.index]?.sounds ?? []) {
      if (s.type !== 'hole') continue;
      const st = map.get(s.hole) ?? {};
      st[s.breath] = s;
      map.set(s.hole, st);
    }
    return map;
  }, [practice, score]);

  // Which reeds are lit, from live input and from playback.
  const lit = useMemo(() => {
    const map = new Map<number, HoleState>();
    const add = (s: HoleSound) => {
      const st = map.get(s.hole) ?? {};
      st[s.breath] = s;
      map.set(s.hole, st);
    };
    Object.values(held).forEach(add);
    for (const i of activeEvents) {
      for (const s of score.events[i]?.sounds ?? []) if (s.type === 'hole') add(s);
    }
    return map;
  }, [held, activeEvents, score]);

  const sounding = useMemo(() => {
    const list = Object.values(held);
    if (!list.length) {
      const evs = activeEvents.map((i) => score.events[i]).filter(Boolean);
      return evs.flatMap((e) => e.sounds.filter((s): s is HoleSound => s.type === 'hole'));
    }
    return list;
  }, [held, activeEvents, score]);

  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ hole: number; breath: Breath; startY: number; over: boolean; pointerId: number } | null>(null);

  const holeAt = (clientX: number): number => {
    const el = ref.current!;
    const comb = el.querySelector('.harp-holes') as HTMLElement;
    const r = comb.getBoundingClientRect();
    const idx = Math.floor(((clientX - r.left) / r.width) * harp.holes.length);
    return Math.min(harp.holes.length, Math.max(1, idx + 1));
  };

  const soundFor = (hole: number, breath: Breath, bend: number, over: boolean): HoleSound => ({
    type: 'hole',
    hole,
    breath,
    bend,
    over: over && canOver(harp, hole, breath),
    slide: harp.hasSlide && slideLatch,
  });

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('.slide-button')) return;
    const comb = ref.current!.querySelector('.harp-holes') as HTMLElement;
    const r = comb.getBoundingClientRect();
    const breath: Breath = e.clientY < r.top + r.height / 2 ? 'blow' : 'draw';
    const hole = holeAt(e.clientX);
    e.preventDefault();
    ref.current!.setPointerCapture(e.pointerId);
    drag.current = { hole, breath, startY: e.clientY, over: e.altKey, pointerId: e.pointerId };
    press(MOUSE_ID, soundFor(hole, breath, 0, e.altKey));
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    // The button was let go somewhere we didn't hear about (e.g. in another window).
    if (e.pointerType === 'mouse' && e.buttons === 0) {
      endDrag();
      return;
    }
    const hole = holeAt(e.clientX);
    if (hole !== d.hole) {
      release(MOUSE_ID);
      d.hole = hole;
      d.startY = e.clientY;
      press(MOUSE_ID, soundFor(hole, d.breath, 0, d.over));
      return;
    }
    const max = maxBend(harp, d.hole, d.breath);
    if (max === 0 || d.over) return;
    const dy = d.breath === 'draw' ? e.clientY - d.startY : d.startY - e.clientY;
    const amount = Math.min(max, Math.max(0, dy / PX_PER_SEMITONE));
    const sound = soundFor(d.hole, d.breath, Math.round(amount), false);
    const base = soundPitch(harp, { ...sound, bend: 0 });
    if (base !== null) change(MOUSE_ID, sound, base - amount);
  };

  const endDrag = () => {
    if (!drag.current) return;
    drag.current = null;
    release(MOUSE_ID);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!drag.current || drag.current.pointerId !== e.pointerId) return;
    endDrag();
  };

  // Fit the holes to the available width (container query units, see .harp-wrap).
  const chrome = 72 + (harp.hasSlide ? 44 : 0);
  const holeWidth = `clamp(30px, calc((min(100cqw, 960px) - ${chrome}px) / ${harp.holes.length}), 76px)`;

  return (
    <div className="harp-wrap">
      <div className="now-playing" aria-live="polite">
        {sounding.length ? (
          sounding.map((s, i) => {
            const m = soundPitch(harp, s);
            return (
              <span key={i} className={`np-chip ${s.breath}`}>
                {asNotes ? (
                  <>
                    <b>{m !== null ? midiToName(m, flats) : '?'}</b>
                    <span>{holeSoundText(s)}</span>
                  </>
                ) : (
                  <>
                    <b>{holeSoundText(s)}</b>
                    {m !== null && <span>{midiToName(m, flats)}</span>}
                  </>
                )}
              </span>
            );
          })
        ) : (
          <span className="np-idle">Click a hole or press a key to play</span>
        )}
      </div>

      <div
        ref={ref}
        className={`harp voicing-${harp.voicing}`}
        style={{ ['--hole-w' as string]: holeWidth }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onLostPointerCapture={onPointerUp}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="harp-plate top">
          <span className="harp-engraving">HarpForge · {harp.name}</span>
          <div className="harp-labels">
            {harp.holes.map((h) => {
              const keyIdx = h.hole - 1 - keyOffset;
              return (
                <div key={h.hole} className="harp-label">
                  {keyIdx >= 0 && keyIdx < BLOW_LABELS.length && <kbd>{BLOW_LABELS[keyIdx]}</kbd>}
                  {showNames && <span className="note">{midiToName(h.blow + (slideLatch && harp.hasSlide ? 1 : 0), flats)}</span>}
                </div>
              );
            })}
          </div>
        </div>

        <div className="harp-comb">
          <div className="harp-holes">
            {harp.holes.map((h) => {
              const st = lit.get(h.hole);
              return <Hole key={h.hole} harp={harp} hole={h.hole} state={st} target={targets.get(h.hole)} flats={flats} />;
            })}
          </div>
        </div>

        <div className="harp-plate bottom">
          <div className="harp-labels">
            {harp.holes.map((h) => {
              const keyIdx = h.hole - 1 - keyOffset;
              return (
                <div key={h.hole} className="harp-label">
                  {showNames && <span className="note">{midiToName(h.draw + (slideLatch && harp.hasSlide ? 1 : 0), flats)}</span>}
                  {keyIdx >= 0 && keyIdx < DRAW_LABELS.length && <kbd>{DRAW_LABELS[keyIdx]}</kbd>}
                </div>
              );
            })}
          </div>
        </div>

        {harp.hasSlide && (
          <button
            className={`slide-button ${slideLatch ? 'on' : ''}`}
            onClick={() => useApp.setState({ slideLatch: !slideLatch })}
            title="Slide button (or hold Space)"
          >
            <span>slide</span>
          </button>
        )}
      </div>
    </div>
  );
}

function Hole({ harp, hole, state, target, flats }: { harp: Harp; hole: number; state?: HoleState; target?: HoleState; flats: boolean }) {
  const h = harp.holes[hole - 1];
  const bendsDraw = maxBend(harp, hole, 'draw');
  const bendsBlow = maxBend(harp, hole, 'blow');
  const tip = [
    `Hole ${hole}`,
    `blow ${midiToName(h.blow, flats)}`,
    `draw ${midiToName(h.draw, flats)}`,
    bendsDraw ? `draw bends: ${Array.from({ length: bendsDraw }, (_, i) => midiToName(h.draw - i - 1, flats)).join(', ')}` : '',
    bendsBlow ? `blow bends: ${Array.from({ length: bendsBlow }, (_, i) => midiToName(h.blow - i - 1, flats)).join(', ')}` : '',
    canOver(harp, hole, 'blow') ? `overblow: ${midiToName(h.draw + 1, flats)}` : '',
    canOver(harp, hole, 'draw') ? `overdraw: ${midiToName(h.blow + 1, flats)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  const active = state?.blow ?? state?.draw;
  return (
    <div className={`hole ${state?.blow ? 'blow-on' : ''} ${state?.draw ? 'draw-on' : ''} ${target?.blow ? 'blow-target' : ''} ${target?.draw ? 'draw-target' : ''}`} title={tip}>
      <span className="hole-num">{hole}</span>
      <div className="hole-slot">
        <div className="reed blow" />
        <div className="reed draw" />
        {active && (active.bend > 0 || active.over || active.slide) && (
          <span className="hole-tech">
            {active.over ? 'OB' : ''}
            {active.bend > 0 ? '↓' + "'".repeat(active.bend) : ''}
            {active.slide ? '♯' : ''}
          </span>
        )}
      </div>
    </div>
  );
}
