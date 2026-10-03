# HarpForge

A virtual harmonica and tab studio in the browser: play with mouse or keyboard,
record and edit tabs, auto-play them, and convert between notes and tabs for any
diatonic or chromatic harmonica.

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # core unit tests
npm run build
```

## What's in v0.1

- **Play** — a virtual harmonica: diatonic (all keys + 5 tunings), chromatic (10/12/14/16 holes),
  tremolo (5 layouts incl. Asian 24 / Ocean Star) and octave (3 layouts), each with its own sound.
  Keyboard: `1…0 - =` blow, `Q…P [ ]` draw, hold `Shift` to bend (deeper the longer you hold),
  `Alt` overblow/overdraw, `Space` chromatic slide, `Enter` play/pause, `Esc` stop.
  Mouse: top half blows, bottom half draws, drag sideways to glide, drag outward to bend.
- **Record** — timed (metronome + count-in, snapped to ♩/♪/𝅘𝅥𝅯) or free (just the order of notes);
  appends to the current tab or replaces it.
- **Auto-play** with moving highlight, loop, metronome and practice speed.
- **Editor** — syntax-highlighted `.htab` text with error squiggles and a live, clickable tab preview.
- **Convert** — paste notes (or a tab), get a ranked list of the best harmonicas/positions,
  and the tab for the one you pick. Switching a song's harmonica re-tabs it automatically.
- **Library** — tabs saved locally (IndexedDB), import/export `.htab` files.

See [docs/htab-format.md](docs/htab-format.md) for the tab format.

## Code map

| Path | What |
| --- | --- |
| `src/core/instruments` | Harmonica definitions as data, bends/overblows, playable options |
| `src/core/htab` | `.htab` parser, serializer, header editing |
| `src/core/score.ts` | Timed, pitched view of a tab (what plays) |
| `src/core/convert.ts` | tab ↔ notes, re-tabbing, harmonica suggestions |
| `src/audio/engine.ts` | Tone.js reed synth, live voices, transport playback |
| `src/live` | Keyboard/mouse input and recording |
| `src/state` | Zustand store, playback controls, actions |
| `src/pages`, `src/components` | UI |

## Roadmap

1. ~~Core model, `.htab`, conversion~~ · ~~Playable harmonica~~ · ~~Tab view + autoplay, record, editor, library~~
2. ~~Tremolo & octave harmonicas~~ (numbered-notation / jianpu tabs for Asian tremolo still to come)
3. ABC / ChordPro / MusicXML / MIDI import & export, staff view
4. PDF chord-sheet import (then guitar tabs)
5. Microphone input, practice mode, MIDI keyboard, share links, sampled harmonica sound
