# HarpForge

A harmonica tab studio in the browser: play a virtual harmonica with mouse, keyboard,
MIDI or your real harmonica through the microphone; write and edit tabs with lyrics,
verses, repeats and endings; play them back with a backing; practise and perform them;
and convert between notes and tabs for diatonic, chromatic, tremolo and octave harps.
Songs live in your browser as a guest, or in your account on the computer running the
HarpForge server, reachable from every device on your network.

```bash
npm install      # also turns on the pre-commit check (.githooks)
npm run dev      # http://localhost:5173
npm test         # unit, round-trip, server and smoke tests
npm run lint     # oxlint (.oxlintrc.json)
npm run check    # type-check, lint, tests and a build: everything at once
npm run build
```

Each commit first runs the type-check, the linter and the tests (`.githooks/pre-commit`);
a failure stops the commit. `git commit --no-verify` skips it once.

## Running it for everyday use

```bash
npm run deploy          # build, then start the HarpForge server in the background
npm run deploy:status   # running? and the addresses to open
npm run undeploy        # stop it
```

On Windows, the same three can be double-clicked in the project folder: **Start HarpForge.cmd**,
**HarpForge Status.cmd** and **Stop HarpForge.cmd** (each waits for a key before closing). In
PowerShell, where running scripts may be turned off, type `npm.cmd` in place of `npm`.

The server (`server/`) serves the built app on port **5280**, on this computer
(`http://localhost:5280`) and the local network (`http://<this computer's address>:5280`,
printed by deploy). It keeps running after the terminal closes, until `npm run undeploy`
or a restart of the computer. It never takes a port another program uses: if 5280 is
busy it says so and stops (another port: `HARPFORGE_PORT=5281 npm run deploy`).
`npm run deploy -- --no-build` starts it with the build already there. After a code
change: `npm run undeploy`, then `npm run deploy`.

- Its files are in `data/` (left out of git, never served as files):
  - `accounts/<name>.json` — each account (the password only as a scrypt hash),
    `sessions/` — who's signed in where (30 days, renewed as used);
  - `users/<name>/` — an account's library: `tabs/<Title>.htab` (plain song files),
    `trash/`, `history/<id>.json`, `library.json` (the index), `practice.json`,
    `syllables.json`;
  - `server.pid`, `server.log` (past 1 MB it becomes `server.log.1`).
- Other devices: the first time, Windows asks whether Node may use private networks;
  allow it. On other devices (plain `http://`), browsers turn off the microphone and the
  clipboard API — copying falls back to an older way. The server answers only to
  `localhost`, this computer's addresses and its name (`<name>`, `<name>.local`,
  `<name>.lan`); other names get 421.
- In development, `npm run dev` serves the same API (`/api/…`) from the same `data/`.

### Accounts and guests

The start screen offers **Sign in**, **Create account** (made on the page — anyone on the
network may) or **Continue as guest**. A guest's library stays in that browser
(IndexedDB, as before); an account's is in `data/users/<name>/` on the computer running
the server, the same from every device. Signing in for the first time in a browser offers
once to bring that browser's own songs (with their history, trash, practice and syllable
fixes) into the account. Switching library keeps the open song open, unlinked from the
old one. No server answering: guest only (the account menu offers **Try again**).

## What's in it

**Playing**
- **A virtual harmonica:** diatonic (all keys, 5 tunings), chromatic (10/12/14/16 holes),
  tremolo (5 layouts incl. Asian 24 / Ocean Star) and octave (3 layouts), each with its
  own sound; every reed labelled with its note. Keyboard: `1…0 - =` blow, `Q…P [ ]` draw,
  hold `Shift` to bend (deeper the longer you hold), `Alt` overblow/overdraw, `Space`
  chromatic slide. Mouse: top half blows, bottom half draws, drag sideways to glide,
  drag outward to bend. Full, slim or hidden.
- **Microphone:** your real harmonica — live hole and note detection with a tuner for
  bends (YIN pitch detection on an AudioWorklet); recording, practice and play along work
  with it. **MIDI keyboard** input (Chrome/Edge).
- **Sound:** real harmonica recordings (Hohner Special 20, VCSL, CC0) with pitch-shifted
  draws and bends, or a synthesized reed. **Backing** from the chord symbols (Pad, Strum,
  Oom-pah), a **drone** on the key (D) to tune bends against, and a **mix** with master
  volume and a level for the tune (M mutes it), backing, drone, clicks and your playing.

**Reading and performing**
- **Six views of one song:** Simple tab, Tab (cards sized by length, with chords and
  lyrics), Staff (standard notation with the holes and words under it), Numbers (jianpu),
  Lyrics (the words with holes above, like a chord sheet), Contour (the tune's shape: each
  note as high as it sounds and as long as it lasts), each following playback.
  **Holes | Notes**: read the holes, or the note names with the holes small.
- **Playback** with count-in, an accented metronome, speed, repeats and 1st/2nd endings
  played as written, verses sung in turn ("Play all verses"), and playing from any note.
- **Performance mode** (F): the music fills the screen, scrolls at tempo or turns pages
  (page-turner pedals send the arrow keys), reads ahead, can play silently; ◐ changes the
  theme for the room's light.
- **Themes:** Dark, Light, Paper (cream and ink, like the printed sheet) or Match system
  (Dark or Light, as the computer is set), in the account menu — kept per device.
- **Print** or save as PDF, and a **plain-text tab** for posting on forums.

**Practising**
- **Practice mode:** the next hole lights up and waits for you (keys, mouse, MIDI or mic).
- **Loop a passage** (select, L), **tempo trainer** (faster after each clean pass).
- **Play along:** each note you play is marked in time, early, late or missed; a
  **practice report** shows the notes you miss most with a drill button, and a history
  per song.

**Writing**
- **Editor** with three modes over the same text: **Visual** (note cards sized by length,
  drag to move or resize, step entry from the harmonica, an inspector for notes, measures
  and the song, insert/overwrite, copy and paste, transpose and "make easier"), **Text**
  (the `.htab` text with highlighting and warnings) and **Split**. Undo/redo covers it all.
- **Section tools** (a heading's ▾ menu, or ⋯ More tools): rename, duplicate, move up and
  down (Alt+↑/↓), repeat it ×2–×4, loop it, select its notes, delete (with Undo), new
  section, a section from the selection. A section's comments and lyrics move with it.
- **Find and replace holes** (Ctrl+H): `-2` → `3` across the song, a section or the
  selection; says whether the tune stays the same; tied notes as one, chords if asked.
- **Lyrics:** type them onto the notes (Ctrl+L), fill them from pasted text with syllable
  suggestions for English and Indonesian (your corrections remembered), several verses
  per line, sung rests and held syllables ("Oh___").
- **Repeats, 1st/2nd endings, repeats played more than twice** (`:|x3`), sections.

**Files**
- **Import** (top bar → Import, drag & drop, or paste): HarpTab, ABC, MusicXML
  (`.musicxml`/`.xml`/`.mxl`), MuseScore 3–4 (`.mscz`/`.mscx`), Guitar Pro 3–8 (`.gp3`/`.gp4`/`.gp5`/`.gp`), MIDI (with its words),
  ChordPro, "chords over lyrics" sheets (with capo and
  `x4`), ASCII guitar tab, numbered notation, typed notes (`C4 D4 E4~`), and **PDF** —
  image-only PDFs through OCR with chord-aware corrections. Each import ranks the
  harmonicas and positions that play it best and previews the tab with sound; chord sheets
  become harmonica chords — the dialog lists each chord as that harmonica plays it (what's
  left out, by name: "Am · 4 5 · no A, the root") and offers chords it plays in full to
  stand in ("Play as C: Am's relative major"), the chord symbols kept as written.
- **Export:** HarpTab, Notes (the melody as note names, no holes), ABC, MusicXML, MIDI,
  ChordPro, numbered notation; a **plain-text tab** for posting; and **share links** (the
  whole tab in the link; nothing goes to a server).

**Library**
- Search, filter by harmonica, sort; **version history** for every song (compare, bring a
  version back, name versions); a **trash** with Undo; backups as a .zip (optionally with
  history and trash); the browser asks before closing when work would be lost.

See [docs/htab-format.md](docs/htab-format.md) for the tab format.

## Code map

| Path | What |
| --- | --- |
| `src/core/instruments` | Harmonica definitions as data, bends/overblows, playable options |
| `src/core/htab` | `.htab` parser, serializer, header editing |
| `src/core/score.ts` | Timed, pitched view of a tab (what plays) |
| `src/core/repeats.ts`, `endings.ts` | Repeats, endings and the order bars are played in |
| `src/core/verses.ts`, `lyricsLayout.ts`, `syllables.ts` | Verses, held syllables, the Lyrics view's layout, syllable suggestions |
| `src/core/contourLayout.ts` | The Contour view's layout: rows, lanes, wrapping at bar lines |
| `src/core/timeline.ts`, `pitch.ts`, `lineDiff.ts` | The editor's one timeline, note names and spelling, comparing versions |
| `src/core/suggest.worker.ts` | Ranking the harmonicas for an import, in the background |
| `src/core/convert.ts` | Tab ↔ notes, re-tabbing, chord sheets, harmonica suggestions |
| `src/core/chords.ts`, `backing.ts` | Chord symbols, the harmonica chord finder, backing chords |
| `src/core/playAlong.ts`, `report.ts`, `passage.ts` | Play-along marking, the practice report, passages |
| `src/core/formats` | ABC, ChordPro / chord sheets, guitar tab, MusicXML, MIDI, numbered notation, plain text; MuseScore (`musescore.ts`) and Guitar Pro (`guitarpro.ts` 7–8, `gp345.ts` 3–5, `gpsong.ts` shared) imports |
| `src/core/formats/pdf*.ts` | PDF text layer / OCR → positioned words → column-aligned chord sheet |
| `src/core/edit` | The visual editor's measure model, lyrics typing, clipboard, section tools, find and replace |
| `src/audio/engine.ts` | What the app calls for sound; loads `engineImpl.ts` in the background |
| `src/audio/engineImpl.ts`, `voices.ts`, `backingVoices.ts` | Playback (Tone.js), harmonica voices, backing and drone |
| `src/audio/pitch.ts` | Pitch detection (YIN) for the microphone |
| `src/live` | Keyboard, mouse, microphone and MIDI input; recording; clipboard |
| `src/storage` | The library (`library.ts`) on two backends: this browser (`local.ts`, IndexedDB) or an account (`remote.ts`); version thinning, practice and syllable data |
| `src/account` | Signing in and out, whose library is in use |
| `src/state` | Zustand store (incl. undo history), playback, practice, the trash, actions, the theme |
| `src/pages`, `src/components` | UI |
| `src/demo/songs.ts` | The demo songs (and their older versions, for updating unchanged copies) |
| `src/styles/` | Stylesheets by area; `index.css` imports them in cascade order (keep it). Every colour is named in `themes.css` (Dark, Light, Paper); the others use the names only (a test checks) |
| `server/` | The HarpForge server: the built app, accounts, account libraries (run by Node directly) |
| `scripts/server.mjs` | `npm run deploy` / `undeploy` / `deploy:status` |
| `scripts/prepare-samples.py` | Turns the VCSL recordings into web-ready, looped samples |
| `docs/htab-format.md` | The tab format (its examples are checked by a test) |

## Roadmap

**Done**
- **Before the phases:** the core model and `.htab`, conversion, a playable harmonica
  (diatonic, chromatic, tremolo, octave), tab view with autoplay, recording, the editor,
  the library; numbered notation; ABC, ChordPro, MusicXML and MIDI; the staff view; PDF
  chord-sheet import; the microphone, practice mode, MIDI keyboard, share links, sampled
  sound.
- **Phase 1:** no lost work (rewritten lines keep what you wrote, backups).
- **Phase 2:** harmonica suggestions, key changes and positions; import and export
  fixes; playback timing.
- **Phase 3:** the app shell and pages; the Edit page; Import and Convert as one flow;
  the Library.
- **Phase 4:** print and PDF; plain-text tab; selecting, copy/cut/paste, insert mode;
  transpose and "make easier"; your harmonicas. **N1–N2:** Notes mode, editing by note.
- **Phase 5:** rewritten lines keep everything; saving and storage; live input.
- **Phase 6:** the editor in one bar, docked harmonica, Play page, accessibility.
- **Phase 7:** one timeline for the editor; the tab text says what you meant; file round
  trips.
- **Phase 8:** fast editing and playback; a safety net (linter, pre-commit checks,
  smoke tests).
- **Phase 9:** practice — loops, count-in, tempo trainer, play along, practice report.
- **Phase 10:** performance mode, reading ahead, the Lyrics view, repeats in playback.
- **Phase 11:** verses, typing lyrics, filling lyrics from text, verses in ABC and
  MusicXML. **11.5:** 1st/2nd endings and repeats played more than twice.
- **Phase 12:** sound — the mix, backing chords, the drone.
- **Phase 13:** library — version history, trash with Undo, full backups.
- **Phase 14:** accounts and folder storage — the HarpForge server, deploy, sign-in, two
  library backends, practice and syllable data per account.
- **Phase 15:** housekeeping — asking before closing with unsaved work, the harmonica's
  own labels, held syllables, this README and the format guide.
- **Phase 16:** themes — Dark, Light, Paper and Match system, per device; every colour
  named in one place, with contrast tests.
- **Phase 17:** editing tools — section tools (heading menu, Alt+↑/↓), find and replace
  holes (Ctrl+H).
- **Phase 18:** the Contour view.
- **Phase 19:** chord sheets — what each chord becomes on the harmonica, and fully playable
  chords to play instead.
- **Phase 20:** file formats — picking the part, tune or voice with the melody (ABC,
  MusicXML, MIDI, MuseScore, Guitar Pro); ABC `W:` verses; MIDI words, tempo changes, and
  export with repeats played out and the backing; ChordPro `{chorus}`; every verse in the
  ChordPro, numbered-notation and plain-text exports; MuseScore 3–4 and Guitar Pro 3–8 import.

Nothing more is planned for now.

**Deferred** (for later, by choice): set lists; folders and tags; a bend trainer; phone
and tablet layouts; HTTPS for other devices (microphone and clipboard there); starting the
server with Windows; publishing online or as an offline app; online sync.

**Decided against:** choosing a passage by dragging; the Play page's harmonica docked at
the bottom; sampling your own harmonica; real-instrument backing samples; a per-song
backing setting; saving a .pdf without the print dialog; replacing the text editor with
CodeMirror; Notes-mode extras (melody-only documents, solfège, letter names).
