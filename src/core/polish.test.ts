// @vitest-environment happy-dom
// The Phase 9–11 review's polish: repeats read from MusicXML, warnings for what isn't played
// as written, and words over rests on a staff line with no other words.

import { expect, it } from 'vitest';
import { writeAbc } from './formats/abc';
import { parseMusicXml, writeMusicXml } from './formats/musicxml';
import { parseHtab } from './htab/parser';
import { serializeHtab } from './htab/serializer';
import { harmonicaFromMeta } from './score';

const doc = (body: string) => parseHtab(`---\ntitle: P\n---\n${body}\n`).doc;
const bars = (text: string) => serializeHtab(parseMusicXml(text).doc).split('\n').filter((l) => l.includes('|'));

it('MusicXML: a repeat that starts part way through comes back where it was', () => {
  const d = doc('4 4 4 4 | |: 5 5 5 5 :| 6 6 6 6 |');
  const back = bars(writeMusicXml(d, harmonicaFromMeta(d.meta))).join(' ');
  // (Read back as notes: the file says nothing of a harmonica's holes.)
  expect(back).toMatch(/C5 C5 C5 C5 \|: E5 E5 E5 E5 :\| G5 G5 G5 G5/);
});

it('MusicXML: 1st and 2nd endings are warned about (both are played)', () => {
  const xml = `<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"><part-name>M</part-name></score-part></part-list><part id="P1">
    <measure number="1"><attributes><divisions>1</divisions><time><beats>1</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><type>quarter</type></note></measure>
    <measure number="2"><barline location="left"><ending number="1" type="start"/></barline><note><pitch><step>E</step><octave>5</octave></pitch><duration>1</duration><type>quarter</type></note><barline location="right"><ending number="1" type="stop"/><repeat direction="backward"/></barline></measure>
  </part></score-partwise>`;
  expect(parseMusicXml(xml).warnings.join(' ')).toMatch(/endings/);
});

it('a repeat inside a repeat: a warning on the inner "|:"', () => {
  const text = '---\ntitle: N\n---\n|: 4 4 |: 5 5 :| 6 6 :|\n';
  const { issues } = parseHtab(text);
  expect(issues).toHaveLength(1);
  expect(issues[0].message).toMatch(/repeat inside a repeat/);
  // ":|:" ends one and starts the next: no warning.
  expect(parseHtab('---\ntitle: N\n---\n|: 4 4 :|: 5 5 :|\n').issues).toHaveLength(0);
});

it('staff: words over a rest on a line with no other words go below it (no row to put them in)', () => {
  const d = doc('4 _ 5 6 |\nw: * oh\n4 _ 5 6 |\nw: a oh b c');
  const abc = writeAbc(d, harmonicaFromMeta(d.meta)).text;
  const music = abc.split('\n').filter((l) => l.includes('|'));
  expect(music[0]).toContain('"_oh"z2');
  // (With words on its notes, the staff view draws them in their row instead.)
  expect(music[1]).not.toContain('"_oh"');
});
