// Computer-keyboard control of the virtual harmonica.
//
//   1 2 3 4 5 6 7 8 9 0 - =   blow holes
//   Q W E R T Y U I O P [ ]   draw holes
//   Shift      bend (hold longer to bend deeper)
//   Alt        overblow / overdraw
//   Space      chromatic slide button
//   ← →        shift the key rows along longer harmonicas

import { useEffect } from 'react';
import { canOver, maxBend } from '../core/instruments';
import type { Breath, HoleSound } from '../core/types';
import { getParsed, useApp } from '../state/store';
import { change, press, release, releaseAll } from './livePlayer';

export const BLOW_CODES = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus', 'Equal'];
export const DRAW_CODES = ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP', 'BracketLeft', 'BracketRight'];
export const BLOW_LABELS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='];
export const DRAW_LABELS = ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', '[', ']'];

const BEND_STEP_MS = 260;

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

export function useHarmonicaKeyboard(enabled: boolean, opts: { arrows?: boolean } = {}) {
  const arrows = opts.arrows ?? true;
  useEffect(() => {
    if (!enabled) return;
    let bendLevel = 0;
    let bendTimer: ReturnType<typeof setInterval> | undefined;
    let slide = false;
    const keyIds = new Set<string>();

    const harp = () => getParsed(useApp.getState().text).harp;

    const shaped = (s: HoleSound): HoleSound => {
      const h = harp();
      const bend = Math.min(bendLevel, maxBend(h, s.hole, s.breath));
      return { ...s, bend: s.over ? 0 : bend, slide: h.hasSlide && (slide || useApp.getState().slideLatch) };
    };

    const refreshHeld = () => {
      const held = useApp.getState().held;
      for (const id of keyIds) {
        const s = held[id];
        if (s) change(id, shaped(s));
      }
    };

    const startBend = () => {
      bendLevel = 1;
      refreshHeld();
      clearInterval(bendTimer);
      bendTimer = setInterval(() => {
        if (bendLevel < 3) {
          bendLevel++;
          refreshHeld();
        }
      }, BEND_STEP_MS);
    };

    const endBend = () => {
      clearInterval(bendTimer);
      bendLevel = 0;
      refreshHeld();
    };

    const onDown = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey) return;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        if (!e.repeat) startBend();
        return;
      }
      if (e.code === 'AltLeft' || e.code === 'AltRight') {
        e.preventDefault();
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat && harp().hasSlide) {
          slide = true;
          refreshHeld();
        }
        return;
      }
      if (arrows && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
        const h = harp();
        const maxOffset = Math.max(0, h.holes.length - BLOW_CODES.length);
        const { keyOffset } = useApp.getState();
        const next = Math.min(maxOffset, Math.max(0, keyOffset + (e.code === 'ArrowLeft' ? -4 : 4)));
        if (next !== keyOffset) {
          e.preventDefault();
          useApp.setState({ keyOffset: next });
        }
        return;
      }
      let idx = BLOW_CODES.indexOf(e.code);
      let breath: Breath = 'blow';
      if (idx < 0) {
        idx = DRAW_CODES.indexOf(e.code);
        breath = 'draw';
      }
      if (idx < 0) return;
      e.preventDefault();
      if (e.repeat) return;
      const h = harp();
      const hole = useApp.getState().keyOffset + idx + 1;
      if (hole > h.holes.length) return;
      const over = e.altKey && canOver(h, hole, breath);
      const sound = shaped({ type: 'hole', hole, breath, bend: 0, over, slide: false });
      const id = 'key:' + e.code;
      if (press(id, sound)) keyIds.add(id);
    };

    const onUp = (e: KeyboardEvent) => {
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        endBend();
        return;
      }
      if (e.code === 'Space' && slide) {
        slide = false;
        refreshHeld();
        return;
      }
      const id = 'key:' + e.code;
      if (keyIds.has(id)) {
        keyIds.delete(id);
        release(id);
      }
    };

    const onBlur = () => {
      clearInterval(bendTimer);
      bendLevel = 0;
      slide = false;
      keyIds.clear();
      releaseAll();
    };

    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
      onBlur();
    };
  }, [enabled, arrows]);
}
