// Phase 17a: section tools — on the song, and on the text's own lines (comments, spelling and
// verses travel with their section).

import { describe, expect, it } from 'vitest';
import { parseHtab, splitHeader } from '../htab/parser';
import { fromDoc, type Song } from './model';
import {
  canMove,
  canRepeat,
  crossesRepeat,
  deleteSection,
  duplicateSection,
  makeSection,
  moveSection,
  newSectionAfter,
  removeHeading,
  renameSection,
  repeatSection,
  sameMusic,
  sectionAt,
  sectionPositions,
  sectionRanges,
  sectionRepeat,
  sectionText,
  type SectionEdit,
} from './sections';
import { spliceBody } from './splice';

const HEAD = '---\ntitle: T\n---\n';
const TEXT = `${HEAD}# the start
4 5 6 -4 |
w: one two three four

@ Verse
# a comment about the verse
-4 -5 6 +6 | 5 5 4 4 |
w: a b c d e f g h
w: A B C D E F G H

@ Chorus
6 6 6 6 | -6 -6 -6 -6 |]
w: la la la la li li li li
`;
const songOf = (text: string) => fromDoc(parseHtab(text).doc);
const body = (text: string) => text.slice(splitHeader(text).bodyStart);
/** The text after an edit, as the editor writes it: the blocks' own lines if they fit, else spliced. */
const written = (text: string, edit: SectionEdit | Song) => {
  const e = 'song' in edit ? edit : { song: edit };
  return sectionText(text, e) ?? HEAD + spliceBody(text, e.song) + '\n';
};

describe('the parts of a song', () => {
  it('the start without a heading, then each section', () => {
    const s = songOf(TEXT);
    expect(sectionRanges(s)).toEqual([
      { name: undefined, from: 0, to: 1 },
      { name: 'Verse', from: 1, to: 3 },
      { name: 'Chorus', from: 3, to: 5 },
    ]);
    expect([sectionAt(s, 0), sectionAt(s, 2), sectionAt(s, 4)]).toEqual([0, 1, 2]);
  });

  it('a song starting with a heading has no part without one', () => {
    expect(sectionRanges(songOf(`${HEAD}@ A\n4 |\n@ B\n5 |\n`)).map((r) => r.name)).toEqual(['A', 'B']);
  });
});

describe('moving a section', () => {
  it('its lines move as written: comments, blank lines, both verses; the end bar stays last', () => {
    const s = songOf(TEXT);
    const edit = moveSection(s, 2, -1)!;
    expect(sectionRanges(edit.song).map((r) => r.name)).toEqual([undefined, 'Chorus', 'Verse']);
    const out = sectionText(TEXT, edit)!;
    expect(body(out)).toBe(`# the start
4 5 6 -4 |
w: one two three four

@ Chorus
6 6 6 6 | -6 -6 -6 -6 |
w: la la la la li li li li

@ Verse
# a comment about the verse
-4 -5 6 6 | 5 5 4 4 |]
w: a b c d e f g h
w: A B C D E F G H
`);
    expect(sameMusic(songOf(out), edit.song)).toBe(true);
    // (Only the lines whose bar line changed are written afresh, "+6" as "6"; the rest as they were.)
    const t2 = `${HEAD}@ A\n+6 4 |\n@ B\n5 5 |\n@ C\n4 4 |]\n`;
    expect(body(sectionText(t2, moveSection(songOf(t2), 1, -1)!)!)).toBe('@ B\n5 5 |\n\n@ A\n+6 4 |\n\n@ C\n4 4 |]\n');
  });

  it('down is the same as the next one moving up; never above the start without a heading', () => {
    const s = songOf(TEXT);
    expect(sameMusic(moveSection(s, 1, 1)!.song, moveSection(s, 2, -1)!.song)).toBe(true);
    expect([canMove(s, 1, -1), canMove(s, 0, 1), canMove(s, 2, 1), canMove(s, 1, 1)]).toEqual([false, false, false, true]);
    expect(moveSection(s, 1, -1)).toBeNull();
  });

  it('a repeat that runs across its edge is said; one inside a section isn’t', () => {
    const s = songOf(`${HEAD}@ A\n|: 4 4 |\n@ B\n5 5 :|\n@ C\n6 6 |]\n`);
    expect(crossesRepeat(s, sectionRanges(s)[0])).toBe(true);
    expect(crossesRepeat(s, sectionRanges(s)[2])).toBe(false);
    expect(moveSection(s, 1, -1)!.note).toMatch(/repeat/);
    // (C moving above B takes B's end of the repeat further away too.)
    expect(moveSection(s, 2, -1)!.note).toMatch(/repeat/);
    const own = songOf(`${HEAD}@ A\n|: 4 4 :|\n@ B\n5 5 |\n@ C\n6 6 |]\n`);
    expect(moveSection(own, 0, 1)!.note).toBeUndefined();
    expect(moveSection(own, 2, -1)!.note).toBeUndefined();
  });
});

describe('duplicating, deleting', () => {
  it('a copy right after it, with the same name and the same lines; the end bar on the copy', () => {
    const edit = duplicateSection(songOf(TEXT), 2)!;
    const out = written(TEXT, edit);
    expect(body(out).endsWith(`@ Chorus
6 6 6 6 | -6 -6 -6 -6 |
w: la la la la li li li li

@ Chorus
6 6 6 6 | -6 -6 -6 -6 |]
w: la la la la li li li li
`)).toBe(true);
    expect(sectionRanges(songOf(out)).map((r) => r.name)).toEqual([undefined, 'Verse', 'Chorus', 'Chorus']);
  });

  it('a copy of the verse keeps its comment and both verses', () => {
    const out = written(TEXT, duplicateSection(songOf(TEXT), 1)!);
    expect(out.split('# a comment about the verse').length).toBe(3);
    expect(out.split('w: A B C D E F G H').length).toBe(3);
  });

  it('deleting the last section: the end bar moves to the new last bar', () => {
    const edit = deleteSection(songOf(TEXT), 2)!;
    const out = written(TEXT, edit);
    expect(out).not.toContain('Chorus');
    expect(out).toContain('-4 -5 6 6 | 5 5 4 4 |]');
    expect(out).toContain('# a comment about the verse');
  });

  it('only named sections are duplicated or deleted (the start has none)', () => {
    expect([duplicateSection(songOf(TEXT), 0), deleteSection(songOf(TEXT), 0)]).toEqual([null, null]);
  });

  it('deleting the only section leaves an empty bar', () => {
    const edit = deleteSection(songOf(`${HEAD}@ A\n4 4 |]\n`), 0)!;
    expect(edit.song.measures).toHaveLength(1);
    expect(edit.song.measures[0].items).toEqual([]);
  });
});

describe('naming', () => {
  it('rename, and remove the heading (its bars join the part before, on their own line)', () => {
    const renamed = written(TEXT, renameSection(songOf(TEXT), 2, ' Refrain '));
    expect(renamed).toContain('@ Refrain\n6 6 6 6');
    expect(renamed).not.toContain('Chorus');
    const gone = written(TEXT, removeHeading(songOf(TEXT), 1));
    expect(gone).not.toContain('@ Verse');
    expect(gone).toContain('# a comment about the verse');
    expect(sectionRanges(songOf(gone)).map((r) => r.name)).toEqual([undefined, 'Chorus']);
  });

  it('naming the start makes it a section', () => {
    const out = written(TEXT, renameSection(songOf(TEXT), 0, 'Intro'));
    expect(sectionRanges(songOf(out)).map((r) => r.name)).toEqual(['Intro', 'Verse', 'Chorus']);
  });

  it('a new section after one: its heading and an empty bar', () => {
    const s = newSectionAfter(songOf(TEXT), 1, 'Bridge');
    expect(sectionRanges(s).map((r) => r.name)).toEqual([undefined, 'Verse', 'Bridge', 'Chorus']);
    expect(s.measures[3].items).toEqual([]);
  });

  it('a section made from bars inside another: the bars after start the old one again', () => {
    const t = `${HEAD}@ Verse\n4 4 | 5 5 | 6 6 | -4 -4 |]\n`;
    const { song: s, note } = makeSection(songOf(t), 1, 2, 'Bridge');
    expect(note).toBeUndefined();
    // Through a repeat: said.
    expect(makeSection(songOf(`${HEAD}@ A\n|: 4 4 | 5 5 :| 6 6 |]\n`), 1, 2, 'B').note).toMatch(/repeat/);
    expect(sectionRanges(s)).toEqual([
      { name: 'Verse', from: 0, to: 1 },
      { name: 'Bridge', from: 1, to: 3 },
      { name: 'Verse', from: 3, to: 4 },
    ]);
    const out = written(t, s);
    expect(body(out)).toBe('@ Verse\n4 4 |\n\n@ Bridge\n5 5 | 6 6 |\n\n@ Verse\n-4 -4 |]\n');
  });
});

describe('repeating a section', () => {
  it('|: … :| around it (×3 written :|x3), and back to once', () => {
    let s = repeatSection(songOf(TEXT), 1, 3);
    expect(sectionRepeat(s, 1)).toBe(3);
    expect(written(TEXT, s)).toContain('|: -4 -5 6 6 | 5 5 4 4 :|x3');
    s = repeatSection(s, 1, null);
    expect(sectionRepeat(s, 1)).toBeNull();
    expect(sameMusic(s, songOf(TEXT))).toBe(true);
  });

  it('the last section: its end bar comes back when the repeat goes', () => {
    const s = repeatSection(repeatSection(songOf(TEXT), 2, 2), 2, null);
    expect(s.measures.at(-1)!.endBar).toBe('final');
  });

  it('not offered over repeats or endings of its own', () => {
    const s = songOf(`${HEAD}@ A\n|: 4 4 | [1.] 5 5 :| [2.] 6 6 |]\n@ B\n4 |\n`);
    expect([canRepeat(s, 0), canRepeat(s, 1)]).toEqual([false, true]);
  });
});

describe('the text', () => {
  it('lines that don’t match the parts (a heading over no music): the music is still right', () => {
    const t = `${HEAD}@ Empty\n@ A\n4 4 |\n@ B\n5 5 |]\n`;
    const s = songOf(t);
    const edit = moveSection(s, 1, -1)!;
    expect(sectionText(t, edit)).toBeNull();
    expect(sameMusic(songOf(written(t, edit)), edit.song)).toBe(true);
  });

  it('a section’s notes, for selecting it', () => {
    expect(sectionPositions(songOf(TEXT), 2)).toHaveLength(8);
  });
});
