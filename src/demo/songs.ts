// Built-in demo tabs (traditional / public-domain melodies and original riffs).

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
[C] 2 2 -2 3 | [G] 3 -2 2 -1 | [C] 1 1 -1 2 | [G] {2~~ -1} -1~ |
[C] 2 2 -2 3 | [G] 3 -2 2 -1 | [C] 1 1 -1 2 | [G] {-1~~ 1} [C] 1~ |]
`;

export const DEMOS = [TWINKLE, SHUFFLE, ODE_TO_JOY];

export const BLANK = `---
title: Untitled
harmonica: diatonic
harp-key: C
tempo: 100
time: 4/4
---
`;
