// @vitest-environment happy-dom
// Phase 19a/b: the chords of an imported chord sheet, and playing one as another.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseHtab } from '../core/htab/parser';
import { harmonicaFromMeta } from '../core/score';
import { ChordList, type Picks } from './ChordList';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const doc = parseHtab('---\ntitle: S\n---\n[Am] . . . . | [C] . . . . | [Bb] . . . . |\n').doc;
const harp = harmonicaFromMeta(doc.meta);
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

/** The list, its picks kept as the dialog keeps them. */
async function draw(onHear = vi.fn()) {
  let picks: Picks = {};
  const render = () => root.render(<ChordList doc={doc} harp={harp} picks={picks} onPicks={(p) => { picks = p; render(); }} onHear={onHear} />);
  await act(async () => render());
  return { picks: () => picks };
}
const rows = () => [...host.querySelectorAll('li')].map((li) => li.querySelector('button')!.textContent);
const button = (t: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === t);

describe('the chord list', () => {
  it('the worst first, each with its holes, notes and what’s missing; a “Play as” for those not whole', async () => {
    await draw();
    expect(rows()).toEqual(['⚠Am×14 5C Eno A (the root)', '⚠Bb×1-4 -5D Fno Bb (the root)', '✓C×14 5 6 7C E G Call of it']);
    expect([...host.querySelectorAll('select')].map((s) => s.getAttribute('aria-label'))).toEqual(['Play Am as', 'Play Bb as']);
  });

  it('Use the suggestions: each such chord played as its first stand-in; Back to as written', async () => {
    const { picks } = await draw();
    await act(async () => button('Use the suggestions')!.click());
    expect(Object.fromEntries(Object.entries(picks()).map(([k, v]) => [k, v.symbol]))).toEqual({ Am: 'C', Bb: 'Dm' });
    expect(rows()[0]).toMatch(/^↪Am×14 5 6 7C E G Cas C: has Am’s C and E/);
    expect(button('Use the suggestions')).toBeUndefined();
    await act(async () => button('Back to as written')!.click());
    expect(picks()).toEqual({});
  });

  it('one picked by hand, from its “Play as”', async () => {
    const { picks } = await draw();
    const select = host.querySelector<HTMLSelectElement>('select[aria-label="Play Bb as"]')!;
    await act(async () => {
      select.value = 'Dm';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(Object.keys(picks())).toEqual(['Bb']);
  });

  it('no stand-in on the very holes it’s played on already (Cmaj7 as 4 5 6 7 is C’s holes)', async () => {
    const d = parseHtab('---\ntitle: S\n---\n[Cmaj7] . . . . | [Dm7] . . . . |\n').doc;
    await act(async () => root.render(<ChordList doc={d} harp={harp} picks={{}} onPicks={() => {}} onHear={() => {}} />));
    expect(host.querySelector('select[aria-label="Play Cmaj7 as"]')).toBeNull();
    const dm7 = host.querySelector<HTMLSelectElement>('select[aria-label="Play Dm7 as"]');
    expect(dm7 ? [...dm7.options].map((o) => o.value) : []).not.toContain('Dm');
  });

  it('clicking a chord: hear it', async () => {
    const onHear = vi.fn();
    await draw(onHear);
    await act(async () => host.querySelector('li button')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onHear).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'Am' }));
  });
});
