# HarpTab (`.htab`) format — v0.1

A plain-text format for harmonica tabs that reads like the tabs people already
write online, plus a header that says which harmonica the tab is for and an
optional rhythm layer. The same syntax also holds pitch-only melodies (`C4 E4 G4`),
which is what the converter uses.

## Header

Optional front matter between `---` lines. Unknown fields are kept as-is.

```
---
title: Oh! Susanna
artist: Stephen Foster
harmonica: diatonic      # diatonic | chromatic | tremolo | octave
tuning: richter          # see the table below
harp-key: C              # key of the harmonica (G…F#; diatonic also Low C…Low F#, High G)
key: G                   # key of the song (optional)
position: 2              # optional
tempo: 100               # beats per minute
time: 4/4
lang: en                 # language of the lyrics (en | id), set by the syllable suggestions
---
```

Defaults: `diatonic`, `richter`, harp key `C`, tempo 100, time 4/4.

| harmonica | tunings |
| --- | --- |
| `diatonic` | `richter`, `paddy-richter`, `country`, `melody-maker`, `harmonic-minor` |
| `chromatic` | `solo-12`, `solo-10`, `solo-14`, `solo-16` |
| `tremolo` | `asian-24` (Ocean Star), `scale-24`, `echo-24` (Echo 48 / Big Valley), `richter-20` (Golden Melody), `echo-16` (Echo 32) |
| `octave` | `lieblinge-24` (Unsere Lieblinge 48), `comet-20` (Comet 40), `lieblinge-16` (Unsere Lieblinge 32) |

Tremolo and octave hole numbers follow Hohner's charts: each number is one
blow/draw pair of the physical double holes, so `4 -4` reads like a diatonic tab.
Aliases accepted on import: `instrument` = `harmonica`, `bpm` = `tempo`, `meter` = `time`.

## Body

| Syntax | Meaning |
| --- | --- |
| `4` / `-4` | blow / draw hole 4. Import also accepts `+4`, `4B`, `4D`, `4d` |
| `-3'` `-3''` `-3'''` | bend down ½, 1, 1½ steps. `b` and `"` (=2) also accepted |
| `6o` / `-7o` | overblow / overdraw (`°`, `O` accepted) |
| `<5` | chromatic: slide button in (`5<`, `5*` accepted) |
| `C4` `F#5` `Bb3` | a pitch instead of a hole (octave defaults to 4; lowercase `c4` accepted) |
| `(4 5 6)` | harmonica chord: sounds played together |
| `-(1 2 3)` / `+(…)` | chord with a default breath for every hole |
| `~` | hold: each `~` adds one beat (`4~~` = 3 beats) |
| `{a b c}` | split one beat between the items, weighted by their `~` (`{4~ 5}` = ⅔ + ⅓) |
| `{a b}~` | the group lasts 2 beats instead of 1 |
| `{a}/2`  `{a b~}~~/2` | the group lasts a fraction of a beat: `/2` halves it (`{7}/2` = ½ beat, `{6~ 7}~~/2` = 1½ beats). Used for bars that end on a half beat, as in 7/8 |
| `.` | rest (one beat, `.~` = two) |
| `_` | a **sung rest**: the harp rests while a syllable is sung; the `w:` line gives it a syllable like a note (`[N.C.] _ 4 5` + `w: Oh la la`) |
| `~` (on its own) | **tie**: the previous note keeps sounding for one beat per `~`, e.g. `6~ \| ~~ 5` |
| `\|` `\|\|` `\|]` `\|:` `:\|` | bar lines: single, double, final, repeat start/end. Also accepted: `:\|:` (end one repeat, start the next), `\|\|:`, and `:\|` right after a note (`4:\|`). A repeat plays twice; a repeat inside another isn't played as one (a warning says so) |
| `[G7]` | chord symbol shown above the next note or rest (right before a bar line: at the end of that bar) |
| `w: Twin-kle twin-kle` | lyrics for the tab line above: one syllable per note (and per sung rest `_`); `_` or `*` skips a note; `~` joins words (`Hello~my` is one syllable); `\-` is a real hyphen (`x\-` doesn't join the next syllable). Several `w:` lines under a tab line are its verses 1, 2, 3…; an empty `w:` keeps a verse's place when the line has no words in it |
| `@ Chorus` | section heading |
| `# text` | comment (at line start or after whitespace; in a `w:` line `#` is part of the words, as in `w: Sing #1`) |

### Ties

A `~` right after a note holds it (`6~~` = 3 beats). A `~` **on its own** is a tie:
the note before it keeps sounding — across bar lines and line breaks too:

```
6~ | ~~ 5 6 |          6 is held for 4 beats, over the bar line
-(1 2 3)~~~ | ~ .~ |   a chord tied over the bar
{-4 ~} 5 …             ties work inside beat groups
```

A tie takes its sound from the note it continues, plays as one unbroken note,
gets no lyric syllable, and is skipped in practice mode. A tie after a rest just
lengthens the rest. Imports and exports keep ties: ABC (`-`), MusicXML (`<tie>`),
MIDI (one long note, split at bar lines on import) and numbered notation
(a dash after the bar line: `5 - | - 3`).

Rhythm is optional: with no `~` or `{}`, every note is one beat, so tabs copied
from the internet play back evenly.

### How the editor writes rhythm

Lines you change in the visual editor are written beat by beat, so the text reads
the way you count: whole beats are single tokens (`4`, `4~`), shorter notes share
one group per beat (`{4 5}`), and a note that runs over a beat continues with a tie
in the next group. Lines you don't touch keep their own spelling.

```
{4 5} {~ 6} {~ 7} {~ 8}     eighth, three quarters, eighth (syncopation)
4 {~ 5} 6~                  dotted quarter, eighth, half
{4 5 6}~                    quarter-note triplet: tuplets over several beats stay one group
{4}/2 5 | …                 a pickup (eighth + quarter) is counted from its end
``` A beat is a quarter note; `tempo` counts
quarter notes per minute (so a 6/8 bar is 3 beats).

## Semantics

* A tab line holds events; blank lines are ignored; each line is shown as one row.
* Hole numbers mean different pitches on different harmonicas. Changing `harp-key`
  transposes the tab; changing `harmonica`/`tuning` needs re-tabbing (the app does
  this automatically, keeping pitches).
* A pitch (`C4`) sounds the same on any harmonica — that's the instrument-neutral
  "notes" form. Converting notes → tab chooses the easiest playable way.
