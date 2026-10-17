// Built-in demo tabs (traditional / public-domain melodies and original riffs).

import { parseHtab, splitHeader } from '../core/htab/parser';
import { hasWords } from '../core/verses';

export const TWINKLE = `---
title: Twinkle, Twinkle, Little Star
artist: Traditional
harmonica: diatonic
harp-key: C
tempo: 96
time: 4/4
---
@ Verse
[C] 4 4 6 6 | [F] -6 -6 [C] 6~ | [F] -5 -5 [C] 5 5 | [G] -4 -4 [C] 4~ |
w: Twin-kle twin-kle lit-tle star, how I won-der what you are
@ Bridge
[C] 6 6 [F] -5 -5 | [C] 5 5 [G] -4~ | [C] 6 6 [F] -5 -5 | [C] 5 5 [G] -4~ |
w: Up a-bove the world so high, like a dia-mond in the sky
@ Verse
[C] 4 4 6 6 | [F] -6 -6 [C] 6~ | [F] -5 -5 [C] 5 5 | [G] -4 -4 [C] 4~ |]
w: Twin-kle twin-kle lit-tle star, how I won-der what you are
`;

export const SHUFFLE = `---
title: Shuffle in G (2nd position)
artist: HarpForge demo
harmonica: diatonic
harp-key: C
key: G
position: 2
tempo: 92
time: 4/4
---
@ I chord (G7)
[G7] -2 {-3' -3} -4 -2 | -(1 2 3 4)~ . . | -2 {-3' -3} -4 -2 | -(1 2 3 4)~~~ |
@ IV chord (C7)
[C7] 4 {-4' -4} 5 4 | (1 2 3)~~~ | [G7] -2 {-3' -3} -4 -2 | -(1 2 3 4)~~~ |
@ Turnaround
[D7] -4 -3'' 4 -4 | [C7] 4 -3' 3 2 | [G7] -2 {-3' -3} -4 -2 | [D7] -1~ -4~ |]
`;

export const ODE_TO_JOY = `---
title: Ode to Joy
artist: Ludwig van Beethoven
harmonica: chromatic
tuning: solo-12
harp-key: C
tempo: 110
time: 4/4
---
[C] 2 2 -2 3 | [G] 3 -2 2 -1 | [C] 1 1 -1 2 | [G] {2~~ -1}~ -1~ |
[C] 2 2 -2 3 | [G] 3 -2 2 -1 | [C] 1 1 -1 2 | [G] {-1~~ 1}~ [C] 1~ |]
`;

export const FRERE_JACQUES = `---
title: Frère Jacques
artist: Traditional
harmonica: tremolo
tuning: asian-24
harp-key: C
tempo: 104
time: 4/4
---
2 -1 3 2 | 2 -1 3 2 |
w: Are you sleep-ing, are you sleep-ing,
3 -2 4~ | 3 -2 4~ |
w: Bro-ther John, Bro-ther John?
{4 -3} {4 -2} 3 2 | {4 -3} {4 -2} 3 2 |
w: Morn-ing bells are ring-ing, morn-ing bells are ring-ing,
2 1 2~ | 2 1 2~ |]
w: Ding, dang, dong! Ding, dang, dong!
`;

/** The tour as first shipped (library version 3): an unchanged copy is brought up to date. */
const RIVER_SONG_V3 = `---
title: Down by the River (a tour of HarpForge)
artist: HarpForge demo
harmonica: diatonic
harp-key: C
key: C
tempo: 96
time: 4/4
lang: en
---
# A song to try things on (an original, written for HarpForge):
# - The verse is between repeat signs: verse 1 the first time, verse 2 the second.
# - The chorus has one verse: with "Verse 2" picked in Show, it still shows its words.
# - "Oh" is held over two notes (_ in the lyrics); "roll" is sung while the harp rests
#   (_ in the tab); "and~on" is two words on one note; -4' is a bend; (4 5 6) a chord.
# Try: Perform (F) in the Lyrics view, Pages, Silent; Shift+click a passage, L to loop
# it, the tempo trainer, play along and its report; Play all verses; in the editor,
# Ctrl+L to type lyrics and Fill lyrics from text.
@ Intro
[C] 4 5 6 (4 5 6) | [G] -4 -5 -4~ |
@ Verse
|: [C] 4 4 5 6 | [F] -6 -6 6~ | [C] 6 5 4 5 | [G] -4~~~ :|
w: Down by the ri-ver, I sing un-der the wil-low
w: Light on the wa-ter, the moon, fol-low-ing me home
@ Chorus
[F] -6~ 6 -5 | [C] 6 _ 5 4 |
w: Oh _ ri-ver, roll on and~on
[F] -6 -6 [C] 6 5 | [G] -4' -4 [C] 4~ |]
w: Car-ry me down to the sea.
`;

/** The tour with endings (library version 4): an unchanged copy is brought up to date. */
const RIVER_SONG_V4 = `---
title: Down by the River (a tour of HarpForge)
artist: HarpForge demo
harmonica: diatonic
harp-key: C
key: C
tempo: 96
time: 4/4
lang: en
---
# A song to try things on (an original, written for HarpForge):
# - The verse is between repeat signs, with a 1st and a 2nd ending: verse 1 the first
#   time, verse 2 (and its own ending) the second.
# - The chorus has one verse: with "Verse 2" picked in Show, it still shows its words.
# - "Oh" is held over two notes (_ in the lyrics); "roll" is sung while the harp rests
#   (_ in the tab); "and~on" is two words on one note; -4' is a bend; (4 5 6) a chord.
# - The outro is played three times (:|x3).
# Try: Perform (F) in the Lyrics view, Pages, Silent; Shift+click a passage, L to loop
# it, the tempo trainer, play along and its report; Play all verses; in the editor,
# Ctrl+L to type lyrics, Fill lyrics from text, and a bar's Ending in the Inspector.
@ Intro
[C] 4 5 6 (4 5 6) | [G] -4 -5 -4~ |
@ Verse
|: [C] 4 4 5 6 | [F] -6 -6 6~ | [1.] [C] 6 5 4 5 | [G] -4~~~ :| [2.] [C] 6 5 4 -4 | 4~~~ ||
w: Down by the ri-ver, I sing un-der the wil-low
w: Light on the wa-ter, the moon, * * * * * fol-low-ing me home
@ Chorus
[F] -6~ 6 -5 | [C] 6 _ 5 4 |
w: Oh _ ri-ver, roll on and~on
[F] -6 -6 [C] 6 5 | [G] -4' -4 [C] 4~ |
w: Car-ry me down to the sea.
@ Outro
|: [G] -4' -4 [C] 4~ :|x3 (4 5 6)~~~ |]
w: to the sea.
`;

/** The tour with the backing and the drone (library version 5): an unchanged copy is brought up to date. */
const RIVER_SONG_V5 = `---
title: Down by the River (a tour of HarpForge)
artist: HarpForge demo
harmonica: diatonic
harp-key: C
key: C
tempo: 96
time: 4/4
lang: en
---
# A song to try things on (an original, written for HarpForge):
# - The verse is between repeat signs, with a 1st and a 2nd ending: verse 1 the first
#   time, verse 2 (and its own ending) the second.
# - The chorus has one verse: with "Verse 2" picked in Show, it still shows its words.
# - "Oh" is held over two notes (_ in the lyrics); "roll" is sung while the harp rests
#   (_ in the tab); "and~on" is two words on one note; -4' is a bend; (4 5 6) a chord.
# - The outro is played three times (:|x3).
# Try: the ♫ menu's Backing — Strum or Oom-pah plays the chords under it; then M (the
# tune off) and play it yourself over the backing, or Perform (F) that way; D for a
# drone in C to bend against. Also: Perform in the Lyrics view, Pages; Shift+click a
# passage, L to loop it, the tempo trainer, play along and its report; Play all verses;
# in the editor, Ctrl+L to type lyrics, Fill lyrics from text, a bar's Ending.
@ Intro
[C] 4 5 6 (4 5 6) | [G] -4 -5 -4~ |
@ Verse
|: [C] 4 4 5 6 | [F] -6 -6 6~ | [1.] [C] 6 5 4 5 | [G] -4~~~ :| [2.] [C] 6 5 4 -4 | 4~~~ ||
w: Down by the ri-ver, I sing un-der the wil-low
w: Light on the wa-ter, the moon, * * * * * fol-low-ing me home
@ Chorus
[F] -6~ 6 -5 | [C] 6 _ 5 4 |
w: Oh _ ri-ver, roll on and~on
[F] -6 -6 [C] 6 5 | [G] -4' -4 [C] 4~ |
w: Car-ry me down to the sea.
@ Outro
|: [G] -4' -4 [C] 4~ :|x3 (4 5 6)~~~ |]
w: to the sea.
`;

/** The tour now (library version 6): the library's history and trash too. */
export const RIVER_SONG = RIVER_SONG_V5.replace(
  "# in the editor, Ctrl+L to type lyrics, Fill lyrics from text, a bar's Ending.\n",
  "# in the editor, Ctrl+L to type lyrics, Fill lyrics from text, a bar's Ending.\n" +
    '# Save a change, then Save ▾ → History… to compare it with before, or bring the old one\n' +
    '# back; Delete in the library puts a tab in its Trash (Undo in the message).\n',
);

/**
 * Demo songs with the library version that introduced them (`first`) and the one that brought
 * their text up to date (`since`); `replaces`: their older texts.
 */
export const DEMOS: { text: string; since: number; first?: number; replaces?: string[] }[] = [
  { text: TWINKLE, since: 1 },
  { text: SHUFFLE, since: 1 },
  { text: ODE_TO_JOY, since: 1 },
  { text: FRERE_JACQUES, since: 2 },
  // (Version 4 brought endings and a repeat played three times; 5, the backing and the drone to
  // try; 6, the library's history and trash. An unchanged copy of an older one is updated.)
  { text: RIVER_SONG, since: 6, first: 3, replaces: [RIVER_SONG_V3, RIVER_SONG_V4, RIVER_SONG_V5] },
];
export const DEMO_VERSION = 6;

export const BLANK = `---
title: Untitled
harmonica: diatonic
harp-key: C
tempo: 100
time: 4/4
---
`;

/**
 * Whether a song holds nothing anyone wrote: no notes, words, chords, sections or comments,
 * and no title or artist of its own. (Its harmonica, key, tempo and time are only settings:
 * a new tab emptied again, or with its harp key changed, has nothing to lose.)
 */
export function isBlankSong(text: string): boolean {
  if (text.trim() === BLANK.trim()) return true;
  const { doc, issues } = parseHtab(text);
  if (issues.some((i) => i.severity === 'error')) return false;
  // (Comments, and words with no note to go on, aren't in the document: looked for in the text.)
  const body = text.slice(splitHeader(text).bodyStart);
  if (/^\s*#/m.test(body) || /^\s*w\s*:\s*\S/im.test(body) || doc.comments?.length || (doc.meta.title && doc.meta.title !== 'Untitled') || doc.meta.artist) return false;
  return doc.lines.every((l) => l.section === undefined && l.events.every((e) => e.kind === 'bar' || (e.kind === 'rest' && !e.chord && !hasWords(e))));
}
