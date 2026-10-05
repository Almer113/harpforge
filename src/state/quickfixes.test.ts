// @vitest-environment happy-dom
// Phase 5d: spelling in minor keys, and a new tab starting with a fresh editor caret.

import { describe, expect, it, vi } from 'vitest';

vi.mock('../audio/engine', async () => (await import('../test/fakeEngine')).fakeEngine());

import { DEFAULT_PLAIN_TEXT, writePlainText } from '../core/formats/plaintext';
import { parseHtab } from '../core/htab/parser';
import { getHarmonica } from '../core/instruments';
import { keyUsesFlats } from '../core/pitch';
import { useApp } from './store';

describe('minor keys', () => {
  it('are spelled with their own flats or sharps', () => {
    for (const k of ['Dm', 'Gm', 'Cm', 'Fm', 'G dorian', 'F', 'Bb']) expect(keyUsesFlats(k)).toBe(true);
    // D dorian has the notes of C major: no flats.
    for (const k of ['Am', 'Em', 'Bm', 'G', 'C', 'D dorian']) expect(keyUsesFlats(k)).toBe(false);
  });

  it('a D minor tune written as notes says B♭, not A♯', () => {
    const C = getHarmonica({ family: 'diatonic', tuning: 'richter', key: 'C' });
    const doc = parseHtab("---\nkey: Dm\n---\n-4 -3' 4 |\n").doc;
    expect(writePlainText(doc, C, { ...DEFAULT_PLAIN_TEXT, title: false, spelling: 'notes' })).toBe('D5 Bb4 C5 |\n');
  });
});

describe('opening another tab', () => {
  it('starts the editor’s caret and selection over', () => {
    useApp.getState().setVe({ selection: [{ m: 7, start: 2 }], caret: { m: 8, start: 1 }, measure: 7 });
    useApp.getState().loadText('---\n---\n4 |\n');
    const { ve } = useApp.getState();
    expect(ve.selection).toEqual([]);
    expect(ve.caret).toEqual({ m: 0, start: 0 });
    expect(ve.measure).toBe(0);
  });
});
