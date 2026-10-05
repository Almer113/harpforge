// @vitest-environment happy-dom

// The Phase 6–8 review's format fixes: numbered notation lines starting with a sharp,
// uneven groups in numbered notation, and MusicXML sections after a line without a bar line.

import { describe, expect, it } from 'vitest';
import { parseJianpu, writeJianpu } from './formats/jianpu';
import { parseMusicXml, writeMusicXml } from './formats/musicxml';
import { parseHtab } from './htab/parser';
import { getHarmonica } from './instruments';

const C = getHarmonica({ family: 'diatonic', key: 'C' });
const doc = (t: string) => parseHtab(t.startsWith('---') ? t : `---\n---\n${t}`).doc;
const beats = (d: ReturnType<typeof doc>) => d.lines.flatMap((l) => l.events).flatMap((e) => (e.kind === 'bar' ? [] : [Math.round(e.beats * 60)]));

describe('numbered notation', () => {
  it('a line starting with a sharp degree is music, not a comment', () => {
    const back = parseJianpu('1=C 4/4\n#1 2 3 4 |\n').doc;
    expect(back.lines).toHaveLength(1);
    expect(beats(back)).toEqual([60, 60, 60, 60]);
  });

  it('uneven groups keep their proportions', () => {
    const d = doc('{4~ 5~~}/2 6 7 8 |');
    expect(beats(parseJianpu(writeJianpu(d, C)).doc)).toEqual(beats(d));
  });
});

describe('MusicXML', () => {
  it('a section after a line without a closing bar line is kept', () => {
    const d = doc('4 5 6 7 | 4 5\n@ Chorus\n6 7 | 8 8 8 8 |');
    const back = parseMusicXml(writeMusicXml(d, C)).doc;
    expect(back.lines.map((l) => l.section).filter(Boolean)).toEqual(['Chorus']);
  });
});
