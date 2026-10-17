// @vitest-environment happy-dom
// Phase 17a: the section tools in the visual editor — the heading's menu, renaming in place,
// moving with the selection along, deleting with Undo.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/engine', async () => (await import('../../test/fakeEngine')).fakeEngine());

import { useApp } from '../../state/store';
import { moveSectionAt, SectionGroup, SectionHeading } from './SectionTools';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TEXT = `---
title: Sections
---
@ Verse
# about the verse
4 4 | 5 5 |
w: one two three four

@ Chorus
6 6 | -6 -6 |]
w: la la li li
`;
const s = () => useApp.getState();
const headings = () => s().text.split('\n').filter((l) => l.startsWith('@'));
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  s().loadText(TEXT, null);
  useApp.setState({ page: 'editor', editorMode: 'visual' });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

/** The heading of the section starting at bar m, as the editor draws it. */
function Heading({ m }: { m: number }) {
  const name = useApp((st) => st.text.split('\n').filter((l) => l.startsWith('@'))[m === 0 ? 0 : 1]?.slice(2) ?? '');
  return <SectionHeading m={m} name={name} />;
}
const click = (el: Element | null | undefined) => act(async () => (el as HTMLElement).click());
const item = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('.menu button')].find((b) => b.textContent!.trim().startsWith(name));

describe('the heading’s menu', () => {
  it('Chorus ▾ opens its tools; Move up puts it first, with its lines', async () => {
    await act(async () => root.render(<Heading m={2} />));
    await click(host.querySelector('button.ve-section'));
    expect(item('Move up')!.disabled).toBe(false);
    expect(item('Move down')!.disabled).toBe(true);
    await click(item('Move up'));
    expect(headings()).toEqual(['@ Chorus', '@ Verse']);
    expect(s().text).toContain('@ Verse\n# about the verse\n4 4 | 5 5 |]\nw: one two three four');
  });

  it('Rename… puts a box in its place: Enter keeps the name, Esc doesn’t', async () => {
    await act(async () => root.render(<Heading m={2} />));
    await click(host.querySelector('button.ve-section'));
    await click(item('Rename'));
    const box = () => host.querySelector<HTMLInputElement>('.ve-section-name')!;
    expect(box().value).toBe('Chorus');
    const type = (v: string) =>
      act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(box(), v);
        box().dispatchEvent(new Event('input', { bubbles: true }));
      });
    await type('Refrain');
    await act(async () => box().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(headings()).toEqual(['@ Verse', '@ Chorus']);
    await act(async () => s().setVe({ naming: 2 }));
    await type('Refrain');
    await act(async () => box().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(headings()).toEqual(['@ Verse', '@ Refrain']);
    expect(host.querySelector('.ve-section-name')).toBeNull();
  });

  it('Delete: gone, and Undo in the message brings it back', async () => {
    await act(async () => root.render(<Heading m={2} />));
    await click(host.querySelector('button.ve-section'));
    await click(item('Delete'));
    expect(headings()).toEqual(['@ Verse']);
    expect(s().text).toContain('5 5 |]');
    expect(s().toast?.message).toMatch(/Deleted “Chorus” \(2 bars\)/);
    await act(async () => s().toast!.action!.run());
    expect(s().text).toBe(TEXT);
  });

  it('Repeat it ×2: |: … :| around it; once again: as it was', async () => {
    await act(async () => root.render(<Heading m={0} />));
    await click(host.querySelector('button.ve-section'));
    await click(item('×2'));
    expect(s().text).toContain('|: 4 4 | 5 5 :|');
    await click(host.querySelector('button.ve-section'));
    await click(item('once'));
    expect(s().text).toBe(TEXT);
  });
});

describe('Phase 17 review', () => {
  it('the arrow keys pass over a disabled item (Move up on the first section)', async () => {
    await act(async () => root.render(<Heading m={0} />));
    await click(host.querySelector('button.ve-section'));
    item('Duplicate')!.focus();
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
    expect(document.activeElement?.textContent).toMatch(/^Move down/);
  });

  it('Esc, then the box losing focus: the old name stays', async () => {
    await act(async () => root.render(<Heading m={2} />));
    await act(async () => s().setVe({ naming: 2 }));
    const box = host.querySelector<HTMLInputElement>('.ve-section-name')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(box, 'Oops');
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      box.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    expect(headings()).toEqual(['@ Verse', '@ Chorus']);
  });

  it('Loop it on a section with no notes yet: not offered', async () => {
    s().loadText(`${TEXT}\n@ Empty\n.~~~ |\n`, null);
    await act(async () => root.render(<Heading m={4} />));
    await click(host.querySelector('button.ve-section'));
    expect(item('Loop it')!.disabled).toBe(true);
  });
});

describe('moving with the keys', () => {
  it('the selection and the caret go with the section', async () => {
    s().setVe({ selection: [{ m: 2, start: 0 }], caret: { m: 3, start: 1 } });
    expect(moveSectionAt(1, -1)).toBe(true);
    expect(s().ve.selection).toEqual([{ m: 0, start: 0 }]);
    expect(s().ve.caret).toEqual({ m: 1, start: 1 });
    expect(moveSectionAt(0, -1)).toBe(false);
  });
});

describe('⋯ More tools → Section', () => {
  it('names the section at the caret, and makes one from the selection', async () => {
    s().setVe({ selection: [{ m: 1, start: 0 }], caret: { m: 1, start: 0 } });
    await act(async () => root.render(<div className="menu"><SectionGroup close={() => {}} /></div>));
    expect(host.querySelector('.mi-label')!.textContent).toBe('Section: Verse');
    await click(item('Make a section from the selection'));
    expect(s().ve.naming).toBe(1);
    expect(headings()).toEqual(['@ Verse', '@ New section', '@ Chorus']);
  });
});
