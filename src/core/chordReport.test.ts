// Phase 19a: what each chord of a chord sheet becomes on a harmonica.

import { describe, expect, it } from 'vitest';
import { parseChord } from './chords';
import { chordReport, fullChords, missingText, missingTones, roleOf, substitutes, toneName } from './chordReport';
import { chordSheetToTab } from './convert';
import { parseHtab } from './htab/parser';
import { getHarmonica } from './instruments';
import { harmonicaFromMeta } from './score';

const sheet = (bars: string, head = '') => parseHtab(`---\ntitle: S\n${head}---\n${bars}\n`).doc;
const C = () => harmonicaFromMeta(sheet('').meta);
const holes = (l: { sounds: { hole: number; breath: string }[] }) => l.sounds.map((s) => `${s.breath === 'draw' ? '-' : ''}${s.hole}`).join(' ');

describe('the chords on a harmonica', () => {
  const doc = sheet('[Am] . . . . | [G7] . . . . | [C] . . . . | [Am] . . . . | [F#] . . . . |');

  it('each chord once, with how often it comes, the worst first', () => {
    const report = chordReport(doc, C());
    expect(report.map((l) => [l.symbol, l.count, l.level])).toEqual([
      ['F#', 1, 'none'],
      ['Am', 2, 'thin'],
      ['G7', 1, 'full'],
      ['C', 1, 'full'],
    ]);
  });

  it('its holes, their notes, and what’s left out, named by what it is to the chord', () => {
    const am = chordReport(doc, C()).find((l) => l.symbol === 'Am')!;
    expect(am.notes).toEqual(['C', 'E']);
    expect(am.missing.map((m) => [m.role, m.strong])).toEqual([['the root', true]]);
    expect(missingText(am.missing)).toBe('no A (the root)');
    const g7 = chordReport(doc, C()).find((l) => l.symbol === 'G7')!;
    expect(holes(g7)).toBe('-2 -3 -4 -5');
    expect(missingText(g7.missing)).toBe('all of it');
  });

  it('a missing 7th is mild; colour notes (9ths and up) aren’t counted', () => {
    const harp = C();
    const cmaj9 = parseChord('Cmaj9')!;
    const triad = [4, 5, 6].map((hole) => ({ type: 'hole' as const, hole, breath: 'blow' as const, bend: 0, over: false, slide: false }));
    expect(missingTones(harp, cmaj9, triad).map((m) => [m.role, m.strong])).toEqual([['the 7th', false]]);
  });

  it('roles: a diminished 7th’s 7th, a 6th, a sus 4th', () => {
    expect([roleOf(9, [0, 3, 6, 9]), roleOf(9, [0, 4, 7, 9]), roleOf(5, [0, 5, 7])]).toEqual(['the 7th', 'the 6th', 'the 4th']);
  });

  it('a chord’s notes spelled from the chord: E7’s 3rd is G#, F7’s 7th is Eb, Bb’s root is Bb', () => {
    const report = chordReport(sheet('[Bb] . . . . | [E7] . . . . | [F7] . . . . |'), C());
    const of = (sym: string) => report.find((l) => l.symbol === sym)!;
    expect(missingText(of('Bb').missing)).toBe('no Bb (the root)');
    expect(of('E7').missing.map((m) => m.name)).toContain('G#');
    expect([toneName('F7', 10, [0, 4, 7, 10]), toneName('Ebm', 3, [0, 3, 7]), toneName('Bdim7', 9, [0, 3, 6, 9])]).toEqual(['Eb', 'Gb', 'Ab']);
  });

  it('a chord played another way (a substitute picked) is reported as that', () => {
    const c = [4, 5, 6].map((hole) => ({ type: 'hole' as const, hole, breath: 'blow' as const, bend: 0, over: false, slide: false }));
    const am = chordReport(doc, C(), { Am: c }).find((l) => l.symbol === 'Am')!;
    expect([am.notes.join(' '), am.level]).toEqual(['C E G', 'thin']);
  });

  it('the chords a harmonica plays in full: 3–4 neighbouring holes on one breath, all one chord', () => {
    expect(fullChords(C()).map((c) => c.symbol).sort()).toEqual(['Bdim', 'Bm7b5', 'C', 'Dm', 'G', 'G7']);
    expect(holes(fullChords(C()).find((c) => c.symbol === 'Dm')!)).toBe('-4 -5 -6');
  });

  it('stand-ins: sharing the chord’s notes (root and 3rd most), related to it, the best first, with why', () => {
    const subs = (sym: string, harp = C()) => substitutes(harp, parseChord(sym)!).map((s) => `${s.symbol}: ${s.reason}`);
    expect(subs('Am')[0]).toBe('C: has Am’s C and E (its relative major); adds G');
    expect(subs('F')[0]).toBe('Dm: has F’s F and A (its relative minor); adds D');
    expect(subs('Cmaj7')[0]).toBe('C: has Cmaj7’s C, E and G (the same chord, simpler)');
    // (Not one that grates against it: Bdim's B over Bb, Em7b5's G against E7's G#.)
    expect(subs('Bb')).toEqual(['Dm: has Bb’s D and F; adds A']);
    expect(subs('E7', getHarmonica({ family: 'diatonic', tuning: 'richter', key: 'F' }))).toEqual([]);
    // (A chord it plays in full needs none: not offered itself.)
    expect(subs('C').some((s) => s.startsWith('C:'))).toBe(false);
  });

  it('a stand-in picked: the tab plays its holes, the chord symbol stays as written', () => {
    const c = fullChords(C()).find((x) => x.symbol === 'C')!;
    const r = chordSheetToTab(sheet('[Am] . . . . |'), C(), 'hold', { Am: c.sounds });
    const note = r.doc.lines[0].events.find((e) => e.kind === 'note')!;
    expect(note.kind === 'note' && [note.chord, note.sounds.map((s) => (s.type === 'hole' ? s.hole : 0))]).toEqual(['Am', [4, 5, 6, 7]]);
  });

  it('the harmonica list counts each chord once: missing its root or 3rd, or not playable at all', () => {
    const { stats } = chordSheetToTab(doc, C());
    expect([stats.thinChords, stats.unplayableChords]).toEqual([1, 1]);
    // (On an A harp, Am's root is there.)
    const a = getHarmonica({ family: 'diatonic', tuning: 'richter', key: 'A' });
    expect(chordSheetToTab(doc, a).stats.thinChords).toBe(chordReport(doc, a).filter((l) => l.level === 'thin').length);
  });
});
