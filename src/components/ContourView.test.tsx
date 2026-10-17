// @vitest-environment happy-dom
// Phase 18a: the contour view.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/engine', async () => (await import('../test/fakeEngine')).fakeEngine());

import { getParsed } from '../state/store';
import { ContourView, placeWords } from './ContourView';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TEXT = `---
title: Shape
---
@ Verse
4 -4 5 (4 5 6) |
w: one two three four
w: uno dos tres

@ Chorus
6~ | ~ -3' |
w: la li
`;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const draw = (props: Partial<Parameters<typeof ContourView>[0]> = {}) => act(async () => root.render(<ContourView parsed={getParsed(TEXT)} activeEvents={[]} selectedEvent={null} verses={[0, 1]} {...props} />));
const notes = () => [...host.querySelectorAll('.ct-note')];

describe('the contour view', () => {
  it('a row per line with its heading; a bar per note (a chord: one per note), blow and draw', async () => {
    await draw();
    expect([...host.querySelectorAll('.ct-section')].map((h) => h.textContent)).toEqual(['Verse', 'Chorus']);
    expect(notes()).toHaveLength(3 + 3 + 3);
    expect(notes()[1].classList.contains('draw')).toBe(true);
    // (A chord's notes: one button for the three.)
    expect(host.querySelectorAll('.ct-note[role=button]')).toHaveLength(3 + 1 + 3);
  });

  it('the lanes: each pitch the song uses, named with its holes', async () => {
    await draw();
    const lanes = [...host.querySelector('.ct-svg')!.querySelectorAll('.ct-lane text')].map((t) => t.textContent);
    expect(lanes).toEqual(['G5 6', 'E5 5', 'D5 -4', 'C5 4', 'Bb4 -3\'']);
  });

  it('clicking a note selects it (Shift: a passage to it); the playing and selected ones are marked', async () => {
    const onSelect = vi.fn();
    await draw({ onSelect, activeEvents: [1], selectedEvent: 2 });
    await act(async () => (notes()[2] as unknown as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })));
    expect(onSelect).toHaveBeenCalledWith(2, expect.objectContaining({ kind: 'note' }), true);
    expect(notes()[1].classList.contains('active')).toBe(true);
    expect(notes()[2].classList.contains('selected')).toBe(true);
  });

  it('a row of words for each verse the line has (the chorus has one)', async () => {
    await draw();
    const rows = [...host.querySelectorAll('.ct-svg')].map((svg) => svg.querySelectorAll('.ct-words').length);
    expect(rows).toEqual([2, 1]);
  });

  it('words move right only as far as the word before them needs', () => {
    expect(placeWords([{ x: 0, text: 'Down' }, { x: 10, text: 'by' }, { x: 200, text: 'the' }]).map((w) => w.x)).toEqual([0, 4 * 7.2 + 6, 200]);
  });
});
