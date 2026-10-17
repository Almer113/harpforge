// Tricky tabs for the round-trip tests: each one exercises something that has been lost
// or changed on a round trip before (pickups, repeats, tuplets, syncopation, chord
// markers, sung rests, odd meters, held chords, bends and ties over bar lines).

export const CORPUS: { name: string; text: string }[] = [
  {
    name: 'pickup and repeats',
    text: `---
title: Pickup and repeats
harmonica: diatonic
harp-key: C
time: 4/4
tempo: 96
---
@ Verse
4 | |: 4 5 6 -6 | 6~ -5 5 :|: -4 4 -4 5 | 4~~~ :|
w: Oh when the saints go march- ing in oh when the saints
`,
  },
  {
    name: 'tuplets and syncopation',
    text: `---
title: Tuplets and syncopation
harmonica: diatonic
harp-key: C
time: 4/4
---
{4 5 6} {-4 5~ 6}~ 5 | {4 5~ 6~ 7~ 8}~~~ |
{4 5 6 -6 6} {6~ -6} 6~ | {4 5 6}~ 4~ |
`,
  },
  {
    name: 'chord symbols and sung rests',
    text: `---
title: Chords and sung rests
harmonica: diatonic
harp-key: C
key: C
time: 4/4
---
@ A
[C] 4 4 [G7] -4 -4 | [N.C.] _ _ [C] 6 6 [F] |
w: Hey ho la la so la la la
@ B
-6 -6 6~ [C] |
w: one two three
`,
  },
  {
    name: 'odd meter',
    text: `---
title: Seven eight
harmonica: diatonic
harp-key: G
key: G
time: 7/8
tempo: 140
---
4 5 {6 -6 6}~~/2 | -4 4 {5~ -4}~~/2 | 4 4 4 {.}/2 |
`,
  },
  {
    name: 'held chords, bends and ties over bar lines',
    text: `---
title: Held and bent
harmonica: diatonic
harp-key: A
key: E
time: 4/4
---
(4 5 6)~ -3' -3'' | 6~~~ | ~ -2 .~ | -(1 2 3)~~~ |
`,
  },
  {
    name: 'a tie over a line break',
    text: `---
title: Tie over a line
harmonica: diatonic
harp-key: C
time: 4/4
---
4 5 6~ |
~ 5 4 4 |
`,
  },
  {
    // Phase 20d: verses — a verse sung twice over (two w: lines), a chorus with one verse, a
    // held syllable, chords on both; Indonesian words.
    name: 'verses and a chorus',
    text: `---
title: Verses and a chorus
harmonica: diatonic
harp-key: C
time: 4/4
tempo: 92
---
@ Verse
[C] 4 4 5 6 | [F] -6 -6 6 . |
w: Di si-ni se-nang
w: Di sa-na se-nang
[G] -4 -4 -5 -4 | [C] 4~~~ |
w: di ma-na ma-na
w: ha-ti-ku se-nang
@ Chorus
[F] -6 -6 6 5 | [C] 4 5 6~ ~ |
w: La la la la la la la _
`,
  },
];
