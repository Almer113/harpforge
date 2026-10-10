// @vitest-environment happy-dom
// The review of Phase 11.5 and the review fixes: endings played, shown and warned about by
// one rule; ties into a 2nd ending; files with endings; ABC words below rests; syllables.

import { describe, expect, it } from 'vitest';
import { lineEndings } from './endings';
import { parseAbc, writeAbc } from './formats/abc';
import { parseMusicXml, writeMusicXml } from './formats/musicxml';
import { parseHtab } from './htab/parser';
import { playbackScore } from './repeats';
import { buildScore, harmonicaFromMeta } from './score';
import { suggestBreaks } from './syllables';

const parse = (body: string) => {
  const r = parseHtab(`---\ntitle: R\n---\n${body}\n`);
  return { ...r, score: buildScore(r.doc, harmonicaFromMeta(r.doc.meta)).score };
};
const holes = (body: string, opts = {}) => {
  const { doc, score } = parse(body);
  return playbackScore(doc, score, opts).score.events.map((ev) => (ev.rest ? '.' : ev.sounds.map((s) => (s.type === 'hole' ? `${s.breath === 'draw' ? '-' : ''}${s.hole}` : '?')).join('')));
};
const messages = (body: string) => parse(body).issues.map((i) => i.message).join(' | ');

describe('endings played', () => {
  it('three endings, each with its ":|": once each, and on (it used to go round for ever)', () => {
    expect(holes('|: 1 | [1.] 2 :| [2.] 3 :| [3.] 4 |').join(' ')).toBe('1 2 1 3 1 4');
  });

  it('a 1st ending that wraps onto the next line runs to its ":|"', () => {
    expect(holes('|: 1 | [1.] 2 |\n3 :| [2.] 4 |').join(' ')).toBe('1 2 3 1 4');
    // On the sheet: its bracket on both lines, labelled on the first, hooked on the second.
    const spans = lineEndings(parse('|: 1 | [1.] 2 |\n3 :| [2.] 4 |').doc);
    expect(spans[0].map((s) => [s.nums, s.continued, s.closed])).toEqual([[[1], false, false]]);
    expect(spans[1].map((s) => [s.nums, s.continued, s.closed])).toEqual([[[1], true, true], [[2], false, false]]);
  });

  it('with all verses, the song still ends on the last ending', () => {
    const played = holes('|: 1 | [1.] 2 :| [2.] 3 |\nw: a b c\nw: d e f\nw: g h i', { allVerses: true });
    expect(played.at(-1)).toBe('3');
  });

  it('a note tied into both endings: the 2nd ending holds that note, not the 1st ending’s', () => {
    const { doc, score } = parse('|: 1~ | [1.] ~ 2 :| [2.] ~ 3 |');
    const p = playbackScore(doc, score);
    const second = p.score.events[p.orig.indexOf(3)];
    expect(second.sounds).toEqual(score.events[0].sounds);
    expect(second.tied).toBe(true);
  });

  it('":|" on its own after a bar line still closes the ending’s bracket with a hook', () => {
    expect(lineEndings(parse('|: 1 | [1.] 2 | :| [2.] 3 |').doc)[0].map((s) => s.closed)).toEqual([true, false]);
  });
});

describe('endings written and warned about', () => {
  it('"[1.2]" and "[1. 2.]" are endings too ("[1]" stays a chord)', () => {
    for (const mark of ['[1.2]', '[1. 2.]']) {
      const ev = parse(`|: 1 | ${mark} 2 :| [3.] 3 |`).doc.lines[0].events.find((e) => e.kind === 'note' && e.ending);
      expect(ev && ev.kind === 'note' ? ev.ending : undefined).toEqual([1, 2]);
    }
    expect(parse('[1] 4 |').doc.lines[0].events[0]).toMatchObject({ chord: '1' });
  });

  it('a 1st ending that never reaches a ":|" is said, even when a later ending has one', () => {
    expect(messages('|: 1 | [1.] 2 | [2.] 3 :| 4 |')).toMatch(/1st ending goes back/);
    expect(messages('|: 1 | [1.] 2 |\n3 :| [2.] 4 |')).toBe('');
  });

  it('":|x3" with endings only for two times through is said', () => {
    expect(messages('|: 1 | [1.] 2 :|x3 [2.] 3 |')).toMatch(/Played 3 times, but the endings stop at the 2nd/);
    expect(messages('|: 1 | [1.2.] 2 :|x3 [3.] 3 |')).toBe('');
  });

  it('MusicXML: an ending that stops without going back gets a "||" after it', () => {
    const { doc } = parse('|: 4 | [1.] 5 :| [2.] 6 |\n7 |');
    const back = parseMusicXml(writeMusicXml(doc, harmonicaFromMeta(doc.meta))).doc;
    const bars = back.lines.flatMap((l) => l.events).filter((e) => e.kind === 'bar').map((e) => (e.kind === 'bar' ? e.style : ''));
    expect(bars).toContain('double');
    const p = playbackScore(back, buildScore(back, harmonicaFromMeta(back.meta)).score);
    expect(p.pass.at(-1)).toBe(1);
  });

  it('ABC: ":|2" at a line’s end puts the 2nd ending on the next line’s first note', () => {
    const doc = parseAbc('X:1\nT:E\nM:2/4\nL:1/4\nK:C\n|: c c |1 d d :|2\ne e |]\n').doc;
    const endings = doc.lines.flatMap((l) => l.events).filter((e) => e.kind === 'note' && e.ending);
    expect(endings.map((e) => (e.kind === 'note' ? e.ending : undefined))).toEqual([[1], [2]]);
  });
});

describe('ABC words below rests', () => {
  it('only HarpForge’s own files: "_Fine" in another file stays a direction, not a word', () => {
    const rest = parseAbc('X:1\nT:E\nM:4/4\nL:1/4\nK:C\nC D "_Fine"z E |]\n').doc.lines[0].events.find((e) => e.kind === 'rest');
    expect(rest).not.toHaveProperty('lyric');
  });

  it('a "%" in a word over a rest is escaped, and comes back', () => {
    const { doc } = parse('4 _ 5 6 |\nw: a 50% b c');
    const abc = writeAbc(doc, harmonicaFromMeta(doc.meta), { restWords: true }).text;
    expect(abc).toContain('% HarpForge');
    const rest = parseAbc(abc).doc.lines[0].events.find((e) => e.kind === 'rest');
    expect(rest).toMatchObject({ lyric: '50%', sung: true });
  });

  it('a pickup after an opening "|:" still beams by where it falls', () => {
    const { doc } = parse('|: {4}/2 {5 6} | 4 4 4 4 :|');
    const line = writeAbc(doc, harmonicaFromMeta(doc.meta)).text.split('\n').find((l) => l.includes('|'));
    expect(line).toMatch(/^\|: c eg \|/);
  });
});

it('English: "ages", "aces", "ices" keep their second syllable', async () => {
  const s = await suggestBreaks(['ages', 'aces', 'ices', 'used', 'ones'], 'en');
  expect(['ages', 'aces', 'ices', 'used', 'ones'].map((w) => s.get(w) ?? w)).toEqual(['a-ges', 'a-ces', 'i-ces', 'used', 'ones']);
});
