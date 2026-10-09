// Lyrics mode in the visual editor: a small box on a note's lyric, where you type its
// syllable. Space goes on to the next note, "-" joins the next syllable to this one, "_"
// holds the syllable over the next note; Shift+Space (or Backspace in an empty box) goes
// back; Enter finishes, Esc leaves without this syllable. Ctrl+L, the Lyrics button or a
// click under a note starts it; the verse switch says which verse you're typing.

import { useEffect, useMemo, useRef, useState } from 'react';
import { lyricStart, shownLyric, songVerseCount, typeLyric, type LyricKey } from '../../core/edit/lyrics';
import { samePos, type Pos, type Song } from '../../core/edit/model';
import { commitSong, currentSong } from '../../state/editor';
import { useApp } from '../../state/store';

// Syllables typed one after another are one undo step a word (a new word, a new step).
let word = 0;
// The open box's way of writing what's typed in it (before something else moves it on).
let flushOpen: (() => void) | null = null;
// Text pasted (or typed faster than keys) past a space, "-" or "_": it goes on in the next box.
let carry: string | null = null;

/** A separator in typed text, and the action it stands for. */
function firstSeparator(value: string): { at: number; key: LyricKey } | null {
  const m = /[\s\-_]/.exec(value);
  if (!m) return null;
  return { at: m.index, key: m[0] === '-' ? 'join' : m[0] === '_' ? 'hold' : 'next' };
}

/** Starts lyrics mode: on `at`, else the selected note, else the first (the next singable one). */
export function startLyrics(at?: Pos) {
  flushOpen?.();
  carry = null;
  const st = useApp.getState();
  const song = currentSong();
  const p = lyricStart(song, at ?? st.ve.selection[0]);
  if (!p) {
    st.notify('There are no notes to put words on yet.');
    return;
  }
  word++;
  st.setVe({ lyricAt: p, selection: [p], anchor: p, measure: p.m });
}

/** Ends lyrics mode, keeping what's typed. */
export function stopLyrics() {
  flushOpen?.();
  carry = null;
  useApp.getState().setVe({ lyricAt: undefined });
}

/** The typing box on the note at `pos`. */
export function LyricInput({ pos, verse }: { pos: Pos; verse: number }) {
  // What the box shows to begin with (its syllable, without a joining "-").
  const was = useMemo(() => shownLyric(currentSong(), pos, verse), [pos, verse]);
  // (Text carried on from the box before, when a whole line was pasted or typed at once.)
  const [first] = useState(() => {
    const c = carry;
    carry = null;
    return c;
  });
  const [text, setText] = useState(first ?? was.text);
  const box = useRef<HTMLInputElement>(null);
  const live = useRef({ text, was });
  useEffect(() => {
    live.current = { text, was };
  });

  useEffect(() => {
    box.current?.focus({ preventScroll: true });
    if (first === null) box.current?.select();
    box.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    // Carried text with more words in it: on they go.
    if (first !== null) take(first);
    // oxlint-disable-next-line react-hooks/exhaustive-deps, react/exhaustive-deps
  }, []);

  const isOpen = () => {
    const at = useApp.getState().ve.lyricAt;
    return !!at && samePos(at, pos);
  };

  /** Writes what's typed (`key` decides the joining and where the box goes next). */
  const write = (key: LyricKey): { song: Song; next: Pos | null } => {
    const song = currentSong();
    const r = typeLyric(song, pos, verse, live.current.text, live.current.was, key);
    if (r.song !== song) commitSong(r.song, `typing:lyrics-${word}`);
    return r;
  };

  useEffect(() => {
    const flush = () => {
      if (isOpen()) write('done');
    };
    flushOpen = flush;
    return () => {
      if (flushOpen === flush) flushOpen = null;
    };
  });

  const finish = (key: LyricKey | 'cancel') => {
    if (!isOpen()) return;
    const st = useApp.getState();
    if (key === 'cancel') {
      st.setVe({ lyricAt: undefined });
      return;
    }
    const { next } = write(key);
    // (A word ends on anything but "-": the next one is a new undo step.)
    if (key !== 'join') word++;
    st.setVe({ lyricAt: next ?? undefined, selection: [next ?? pos], anchor: next ?? pos, measure: (next ?? pos).m });
  };

  /** What's in the box now: up to a space, "-" or "_", that's this syllable (the rest goes on). */
  const take = (value: string) => {
    const sep = firstSeparator(value);
    if (!sep) {
      setText(value);
      return;
    }
    live.current = { ...live.current, text: value.slice(0, sep.at) };
    const rest = value.slice(sep.at + 1).replace(/^\s+/, '');
    carry = rest || null;
    finish(sep.key);
    // (The end of the song: nowhere for the rest to go.)
    if (!useApp.getState().ve.lyricAt) carry = null;
  };

  return (
    <input
      ref={box}
      className="ve-lyric-input"
      value={text}
      size={Math.max(4, text.length + 1)}
      aria-label={`Syllable${verse ? ` (verse ${verse + 1})` : ''}: Space next note, hyphen joins, underscore holds, Enter done`}
      onChange={(e) => take(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={() => finish('done')}
      onKeyDown={(e) => {
        const key = e.key;
        let action: LyricKey | 'cancel' | null = null;
        if (key === ' ' || key === 'Tab') action = e.shiftKey ? 'prev' : 'next';
        else if (key === '-') action = 'join';
        else if (key === '_') action = 'hold';
        else if (key === 'Enter') action = 'done';
        else if (key === 'Escape') action = 'cancel';
        else if (key === 'Backspace' && !text) action = 'prev';
        if (!action) return;
        e.preventDefault();
        e.stopPropagation();
        finish(action);
      }}
    />
  );
}

/** The Lyrics button (the toolbar). */
export function LyricsButton() {
  const typing = useApp((s) => !!s.ve.lyricAt);
  return (
    <button
      className={`pal-btn lyrics-btn ${typing ? 'on' : ''}`}
      aria-pressed={typing}
      aria-label="Lyrics"
      onClick={() => (typing ? stopLyrics() : startLyrics())}
      title="Lyrics: type the words onto the notes (Ctrl+L, or click under a note). Space: next note · - joins the next syllable · _ holds over the next note · Shift+Space: back · Enter: done"
    >
      <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <path d="M13 3v10l5-2" />
        <circle cx="10" cy="13" r="3" fill="currentColor" stroke="none" />
        <path d="M4 20h16" />
      </svg>
    </button>
  );
}

/** Which verse the lyrics under the notes show and edit (the status line), once there are lyrics. */
export function VerseSwitch({ song }: { song: Song }) {
  const typing = useApp((s) => !!s.ve.lyricAt);
  const verse = useApp((s) => s.ve.verse);
  const setVe = useApp((s) => s.setVe);
  const count = songVerseCount(song);
  const anyWords = song.measures.some((m) => m.items.some((it) => it.lyric || it.verses?.some(Boolean)));
  // (A verse past the song's last, chosen to start one, is one more.)
  const options = Math.max(count, verse + 1);
  return (
    <>
      {(anyWords || typing || verse > 0) && (
        <select
          className="verse-select"
          value={verse}
          aria-label="Verse"
          title="The verse the lyrics under the notes show and edit"
          onChange={(e) => {
            const v = Number(e.target.value);
            flushOpen?.();
            setVe({ verse: v });
            // A new verse: straight into typing it, from the first note.
            if (v >= count) startLyrics({ m: 0, start: 0 });
          }}
        >
          {Array.from({ length: options }, (_, k) => (
            <option key={k} value={k}>
              Verse {k + 1}
            </option>
          ))}
          {options === count && <option value={count}>+ New verse</option>}
        </select>
      )}
    </>
  );
}
