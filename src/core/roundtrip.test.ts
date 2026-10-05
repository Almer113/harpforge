// @vitest-environment happy-dom
// Phase 7d: the round-trip safety net. Every demo song and every tricky tab in the corpus
// must survive (1) the editor, (2) an edit to one note, and (3) every export format and
// back, losing only what the Export menu says that format drops.

import { describe, expect, it } from 'vitest';
import { DEMOS } from '../demo/songs';
import { fromDoc, toDoc, updateItem } from './edit/model';
import { spliceBody } from './edit/splice';
import { exportDoc, EXPORTS, importText, type ExportKind, type ImportKind } from './formats';
import { parseMidi } from './formats/midi';
import { parseHtab, splitHeader } from './htab/parser';
import { serializeHtab } from './htab/serializer';
import type { TabDoc } from './htab/types';
import { midiToName } from './pitch';
import { buildScore, harmonicaFromMeta } from './score';
import { CORPUS } from './roundtrip.corpus';
import { holeSound } from './types';

const SONGS = [...DEMOS.map((d) => ({ name: (/title: (.*)/.exec(d.text)?.[1] ?? 'demo').trim(), text: d.text })), ...CORPUS];

interface Note {
  at: number;
  len: number;
  pitches: string;
  chord?: string;
  lyric?: string;
}

/** What you hear and read: every note (ties joined) and every rest with a chord symbol or lyric. */
function music(d: TabDoc, harp = harmonicaFromMeta(d.meta)): Note[] {
  return buildScore(d, harp)
    .score.events.filter((e) => !e.tied && (!e.rest || e.chord || e.lyric))
    .map((e) => ({
      at: +e.start.toFixed(4),
      len: +e.soundBeats.toFixed(4),
      pitches: e.rest ? '.' : e.midis.map((m) => (m === null ? '?' : midiToName(m))).join('+'),
      ...(e.chord ? { chord: e.chord } : {}),
      ...(e.lyric ? { lyric: e.lyric } : {}),
    }));
}
const sections = (d: TabDoc) => d.lines.filter((l) => l.section !== undefined).map((l) => l.section);
/** Chord symbols in order, wherever they are (notes, rests, markers). */
const chords = (d: TabDoc) => d.lines.flatMap((l) => l.events.flatMap((e) => (e.kind !== 'bar' && e.chord ? [e.chord] : [])));
/** The words sung, joined from syllables ("Twin-" "kle" → "Twinkle"). */
function words(d: TabDoc): string[] {
  let text = '';
  for (const l of d.lines) for (const e of l.events) if (e.kind !== 'bar' && e.lyric && !(e.kind === 'note' && e.tied)) text += text.endsWith('-') ? e.lyric : ` ${e.lyric}`;
  return text.replace(/-(?=\S)/g, '').replace(/-\s/g, ' ').split(/\s+/).filter(Boolean);
}

describe('1. text → editor → text', () => {
  for (const s of SONGS) {
    it(s.name, () => {
      const doc = parseHtab(s.text).doc;
      const once = toDoc(fromDoc(doc));
      // Same music, the same as text, and stable on a second pass.
      expect(music(once)).toEqual(music(doc));
      expect(music(parseHtab(serializeHtab(once)).doc)).toEqual(music(doc));
      expect(serializeHtab(toDoc(fromDoc(once)))).toBe(serializeHtab(once));
      expect(sections(once)).toEqual(sections(doc));
    });
  }
});

describe('2. an edit to one note changes only its line', () => {
  for (const s of SONGS) {
    it(s.name, () => {
      const doc = parseHtab(s.text).doc;
      const song = fromDoc(doc);
      // A note on the last line of tab.
      const mi = song.measures.map((m, i) => ({ m, i })).reverse().find(({ m }) => m.items.some((it) => it.sounds.length && !it.tied))!.i;
      const item = song.measures[mi].items.find((it) => it.sounds.length && !it.tied)!;
      const hole = item.sounds[0].type === 'hole' && item.sounds[0].hole === 3 ? 2 : 3;
      const edited = spliceBody(s.text, updateItem(song, { m: mi, start: item.start }, { sounds: [holeSound(hole, 'blow')] }));
      const before = s.text.slice(splitHeader(s.text).bodyStart).replace(/\n+$/, '').split('\n');
      const after = edited.replace(/\n+$/, '').split('\n');
      expect(after).toHaveLength(before.length);
      // The tab line of that measure (and its lyrics line) may change; nothing else does.
      const src = doc.lines[song.measures[mi].src!].src!;
      const tabLine = s.text.slice(0, src.start).split('\n').length - 1 - (s.text.slice(0, splitHeader(s.text).bodyStart).split('\n').length - 1);
      const changed = before.map((l, i) => (l !== after[i] ? i : -1)).filter((i) => i >= 0);
      expect(changed).toContain(tabLine);
      for (const i of changed) expect(i === tabLine || (i === tabLine + 1 && /^w:/.test(before[i]))).toBe(true);
    });
  }
});

/**
 * 3. Export and import again. Each format keeps everything except what the Export menu
 * says it drops (EXPORTS[].loses):
 * - Notes, ABC, MusicXML: everything we compare (notes, rhythm, chords, lyrics, sections).
 *   A song with no key comes back in C: the formats always write a key signature.
 * - Numbered notation: harmonica chords keep only their top note.
 * - MIDI: notes and rhythm only (no lyrics, chord symbols or sections).
 * - ChordPro: chord symbols and words only (no melody).
 */
const KEEPS: Record<Exclude<ExportKind, 'htab'>, 'all' | 'top-note' | 'notes-only' | 'chords-and-words'> = {
  notes: 'all',
  abc: 'all',
  musicxml: 'all',
  jianpu: 'top-note',
  midi: 'notes-only',
  chordpro: 'chords-and-words',
};

function roundTrip(kind: ExportKind, doc: TabDoc, text: string): TabDoc {
  const harp = harmonicaFromMeta(doc.meta);
  const { data } = exportDoc(kind, doc, harp, text);
  if (typeof data !== 'string') return parseMidi(data).doc;
  return importText(data, (kind === 'notes' || kind === 'htab' ? 'htab' : kind) as ImportKind).doc;
}

describe('3. export and import again', () => {
  it('the Export menu lists what each format drops', () => {
    for (const kind of Object.keys(KEEPS)) expect(EXPORTS.find((e) => e.id === kind)?.loses).toBeTruthy();
    expect(EXPORTS.find((e) => e.id === 'htab')?.loses).toBeUndefined();
  });

  for (const s of SONGS) {
    describe(s.name, () => {
      const doc = parseHtab(s.text).doc;
      const want = music(doc);

      it('htab: exactly the same text', () => {
        expect(roundTrip('htab', doc, s.text)).toEqual(parseHtab(s.text).doc);
      });

      for (const [kind, keeps] of Object.entries(KEEPS) as [Exclude<ExportKind, 'htab'>, (typeof KEEPS)[keyof typeof KEEPS]][]) {
        it(kind, () => {
          const back = roundTrip(kind, doc, s.text);
          expect(back.meta.title).toBe(doc.meta.title);
          if (keeps === 'chords-and-words') {
            expect(chords(back)).toEqual(chords(doc));
            expect(words(back)).toEqual(words(doc));
            return;
          }
          expect(back.meta.time).toBe(doc.meta.time);
          expect(back.meta.tempo).toBe(doc.meta.tempo);
          const got = music(back);
          if (keeps === 'notes-only') {
            const notes = (ns: Note[]) => ns.filter((n) => n.pitches !== '.').map(({ at, len, pitches }) => ({ at, len, pitches }));
            expect(notes(got)).toEqual(notes(want));
            return;
          }
          expect(back.meta.key ?? 'C').toBe(doc.meta.key ?? 'C');
          expect(sections(back)).toEqual(sections(doc));
          const expected = keeps === 'top-note' ? want.map((n) => ({ ...n, pitches: n.pitches.split('+').pop()! })) : want;
          expect(got).toEqual(expected);
        });
      }
    });
  }
});
