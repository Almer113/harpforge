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
- **Editor** — three modes over the same tab: **Visual** (drag-and-drop measures and note cards sized by the
  time signature; drag to move, Alt-drag to copy, drag a card's edge to change its length, step entry by
  playing the harmonica, inspector for holes/bends/chords/lyrics, measure tools, re-barring when the time
  signature changes), **Text** (syntax-highlighted `.htab` with error squiggles) and **Split** (text + live
  preview). Song details (title, key, time signature, tempo, harmonica) sit on top; undo/redo covers everything.
  Notes longer than the rest of a measure continue as **ties** into the next ones (also by dragging a note's
  edge past the bar line); a tied note acts as one note for moving, deleting and changing length.
  Shortcuts: Z X C V B note lengths, N dotted, M triplet, L tie, / rest, ←/→ select, ↑/↓ next note (Shift = semitone),
  Del delete, Ctrl+C/V copy/paste, Ctrl+Z/Y undo/redo.
- **Import & convert** (top bar → Import, or drag & drop) — HarpTab, ABC, MusicXML (`.musicxml`/`.xml`/`.mxl`), MIDI, ChordPro, plain
  "chords over lyrics" sheets (Ultimate Guitar style, with capo and `x4` repeats), ASCII guitar tab,
  and **PDF** — from a file, drag & drop, or pasted text. Image-only PDFs (like Ultimate Guitar's
  downloads) are read with OCR (Tesseract, loaded on demand), with chord-aware corrections and an
  "Edit recognised text" step.
  Typed or pasted notes (`C4 D4 E4~ |`) become a tab too. The dialog ranks every harmonica and position
  (worked out in the background), or keeps yours at the octave you choose, and previews the tab with sound.
  Chord sheets become harmonica chords. Changing a song's harmonica later asks whether to keep the holes
  (transpose) or the notes (re-tab).
- **Export** — HarpTab, ABC (with the tab as a lyric line), MusicXML (tab as lyric line 2), MIDI, ChordPro.
- **Staff view** — standard notation with the tab and lyrics under each note, synced to playback.
- **Numbered notation (jianpu)** — a third sheet view (1 = do of the key, octave dots, underlines,
  dashes, optional holes underneath), plus import/export. Text syntax: start with a key line such as
  `1=G 4/4`, then `5 3 5 - | 6_ 5_ 3 - |`; `1'`/`1,` (or 1̇/1̣) for octaves, `#4`/`b7`, `5.` dotted,
  `{5 6 5}` triplets, and `[G]`, `w:`, `@ Verse` as in HarpTab. See `src/core/formats/jianpu.ts`.
- **Microphone** — play your real harmonica: live hole + note detection with a tuner (great for bends);
  recording and practice work with it. Pitch detection (YIN) runs on an AudioWorklet feed.
- **Practice mode** — the app highlights the next hole and waits until you play it (keyboard, mouse,
  MIDI or mic), counting mistakes, with a Hint button.
- **MIDI keyboard** input (Web MIDI; Chrome/Edge).
- **Share links** — the whole tab compressed into the link's `#fragment`; nothing goes to a server.
- **Sound** — real harmonica recordings (Hohner Special 20, VCSL, CC0) with pitch-shifted draw
  notes and bends, or an improved synthesized reed; tremolo/octave harps layer extra reeds.
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
| `src/audio/engine.ts` | Live voices and transport playback |
| `src/audio/voices.ts` | Sample player (VCSL harmonica) and synthesized reed |
| `src/audio/pitch.ts` | Pitch detection (YIN) for the microphone |
| `scripts/prepare-samples.py` | Turns the VCSL recordings into web-ready, looped samples |
| `src/live` | Keyboard/mouse input and recording |
| `src/core/edit/model.ts` | Measure model behind the visual editor (placement, moves, re-barring) |
| `src/components/editor` | Visual editor, inspector, song details |
| `src/state` | Zustand store (incl. undo history), playback controls, actions |
| `src/pages`, `src/components` | UI |

## Roadmap

1. ~~Core model, `.htab`, conversion~~ · ~~Playable harmonica~~ · ~~Tab view + autoplay, record, editor, library~~
2. ~~Tremolo & octave harmonicas~~ · ~~numbered notation (jianpu)~~
3. ~~ABC / ChordPro / MusicXML / MIDI import & export, staff view~~
4. ~~PDF chord-sheet import (then guitar tabs)~~
5. ~~Microphone input, practice mode, MIDI keyboard, share links, sampled harmonica sound~~
