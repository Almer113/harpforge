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
- **Import** — HarpTab, ABC, MusicXML (`.musicxml`/`.xml`/`.mxl`), MIDI, ChordPro, plain
  "chords over lyrics" sheets (Ultimate Guitar style, with capo and `x4` repeats), ASCII guitar tab,
  and **PDF** — from a file, drag & drop, or pasted text. Image-only PDFs (like Ultimate Guitar's
  downloads) are read with OCR (Tesseract, loaded on demand), with chord-aware corrections and an
  "Edit recognised text" step.
  Imports pick the best-fitting harmonica (or keep yours); chord sheets become harmonica chords.
- **Export** — HarpTab, ABC (with the tab as a lyric line), MusicXML (tab as lyric line 2), MIDI, ChordPro.
- **Staff view** — standard notation with the tab and lyrics under each note, synced to playback.
- **Microphone** — play your real harmonica: live hole + note detection with a tuner (great for bends);
  recording and practice work with it. Pitch detection (YIN) runs on an AudioWorklet feed.
- **Practice mode** — the app highlights the next hole and waits until you play it (keyboard, mouse,
  MIDI or mic), counting mistakes, with a Hint button.
- **MIDI keyboard** input (Web MIDI; Chrome/Edge).
- **Share links** — the whole tab compressed into the link's `#fragment`; nothing goes to a server.
- **Library** — tabs saved locally (IndexedDB).

See [docs/htab-format.md](docs/htab-format.md) for the tab format.

## Code map

| Path | What |
| --- | --- |
| `src/core/instruments` | Harmonica definitions as data, bends/overblows, playable options |
| `src/core/htab` | `.htab` parser, serializer, header editing |
| `src/core/score.ts` | Timed, pitched view of a tab (what plays) |
| `src/core/convert.ts` | tab ↔ notes, re-tabbing, chord sheets, harmonica suggestions |
| `src/core/chords.ts` | Chord symbols and the harmonica chord finder |
| `src/core/formats` | ABC, ChordPro / chord sheets, guitar tab, MusicXML, MIDI readers & writers |
| `src/core/formats/pdf*.ts` | PDF text layer / OCR → positioned words → column-aligned chord sheet |
| `src/audio/engine.ts` | Tone.js reed synth, live voices, transport playback |
| `src/live` | Keyboard/mouse input and recording |
| `src/state` | Zustand store, playback controls, actions |
| `src/pages`, `src/components` | UI |

## Roadmap

1. ~~Core model, `.htab`, conversion~~ · ~~Playable harmonica~~ · ~~Tab view + autoplay, record, editor, library~~
2. ~~Tremolo & octave harmonicas~~ (numbered-notation / jianpu tabs for Asian tremolo still to come)
3. ~~ABC / ChordPro / MusicXML / MIDI import & export, staff view~~
4. ~~PDF chord-sheet import (then guitar tabs)~~
5. ~~Microphone input, practice mode, MIDI keyboard, share links~~ · sampled harmonica sound
