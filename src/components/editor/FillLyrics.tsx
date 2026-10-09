// "Fill lyrics from text": type or paste the words, see which syllable lands on which note,
// and put them on the notes in one go. Splitting words into syllables is up to you (hyphens:
// "dar-ling"); an optional tool suggests breaks for English or Indonesian, which you can
// click to correct before anything is put on the notes, and remembers your corrections.

import { useMemo, useRef, useState } from 'react';
import { fillLyrics, songVerseCount } from '../../core/edit/lyrics';
import { allPositions, findItem, type Pos, type Song } from '../../core/edit/model';
import { setMetaFields } from '../../core/htab/meta';
import { soundText } from '../../core/htab/serializer';
import { applySuggestions, breaksOf, detectLang, LANG_NAMES, lyricWords, rebreakWord, suggestBreaks, withBreaks, type Lang } from '../../core/syllables';
import { lyricOf } from '../../core/verses';
import { songText, currentSong } from '../../state/editor';
import { getParsed, useApp } from '../../state/store';
import { lastLang, rememberLang, saveSyllableFix, syllableFixes } from '../../storage/syllableFixes';
import { Dialog } from '../Dialog';

export function FillLyricsDialog() {
  const open = useApp((s) => s.fillLyricsOpen);
  const close = () => useApp.setState({ fillLyricsOpen: false });
  if (!open) return null;
  return (
    <Dialog label="Fill lyrics from text" className="fill-lyrics" onClose={close}>
      <FillBody close={close} />
    </Dialog>
  );
}

const PREVIEW = 600;

/** Whether a verse has any words yet. */
const hasVerse = (song: Song, v: number) => allPositions(song).some((p) => !!lyricOf(findItem(song, p) ?? {}, v));

/** Blocks of text with an empty line between them (a whole song pasted, a verse a block). */
const blocksOf = (text: string) =>
  text
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);

function FillBody({ close }: { close: () => void }) {
  const song = useMemo(() => currentSong(), []);
  const selected = useApp((s) => s.ve.selection[0]);
  const count = songVerseCount(song);
  const [verse, setVerse] = useState(useApp((s) => s.ve.verse));
  // A verse with no words yet starts at the first note; one being corrected, at the selected note.
  const [from, setFrom] = useState<'selected' | 'start'>(() => (selected && hasVerse(song, verse) ? 'selected' : 'start'));
  // (The words are kept if the dialog is closed by mistake, until they're put on the notes.)
  const text = useApp((s) => s.fillDraft);
  const setText = (next: string | ((t: string) => string)) => useApp.setState((s) => ({ fillDraft: typeof next === 'function' ? next(s.fillDraft) : next }));
  const [byBlocks, setByBlocks] = useState(true);
  // The syllable tool: its language (the song's, else your last choice, else a guess).
  const songLang = useApp((s) => getParsed(s.text).doc.meta.extra.lang) as Lang | undefined;
  const [lang, setLang] = useState<Lang | null>(songLang === 'en' || songLang === 'id' ? songLang : null);
  // The language the last suggestions were made in (corrections are remembered in it).
  const [suggested, setSuggested] = useState<Lang | null>(null);
  const [busy, setBusy] = useState(false);

  const start: Pos | null = from === 'selected' && selected ? selected : null;
  const blocks = useMemo(() => blocksOf(text), [text]);
  const perBlock = byBlocks && blocks.length > 1;
  // Each block its own verse (from the one chosen on), or all the words in the one verse.
  const results = useMemo(() => {
    const out: { verse: number; result: ReturnType<typeof fillLyrics> }[] = [];
    let s = song;
    (perBlock ? blocks : [text]).forEach((b, k) => {
      const r = fillLyrics(s, start, verse + k, b);
      out.push({ verse: verse + k, result: r });
      s = r.song;
    });
    return out;
  }, [song, start, verse, text, blocks, perBlock]);
  const final = results[results.length - 1]?.result;
  const first = results[0]?.result;
  const extra = results.reduce((n, r) => n + r.result.extra.length, 0);
  const words = useMemo(() => {
    // Each word once, whatever its capitals ("Kasih" and "kasih" change together).
    const seen = new Set<string>();
    return lyricWords(text).filter((w) => {
      const key = breaksOf(w).word.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [text]);
  // (Guessed from the words as they'd be spoken, without the breaks; your last choice when they don't say.)
  const usedLang: Lang = lang ?? detectLang(text.replace(/-/g, ''), lastLang());
  const fixLang: Lang = suggested ?? usedLang;

  const suggest = async () => {
    setBusy(true);
    try {
      const map = await suggestBreaks(words, usedLang, syllableFixes(usedLang));
      setText((t) => applySuggestions(t, map));
      setSuggested(usedLang);
      rememberLang(usedLang);
    } catch {
      useApp.getState().notify('The syllable suggestions couldn’t be made. Try again, or put the hyphens in yourself.');
    } finally {
      setBusy(false);
    }
  };

  /** A click between two letters: a break there, or none; remembered for this language. */
  const toggle = (form: string, at: number) => {
    const { word, cuts } = breaksOf(form);
    const next = cuts.includes(at) ? cuts.filter((c) => c !== at) : [...cuts, at].sort((a, b) => a - b);
    setText((t) => rebreakWord(t, word, next));
    saveSyllableFix(fixLang, withBreaks(word, next));
  };

  const apply = () => {
    if (!final) return;
    let next = songText(final.song);
    // The language the suggestions were made in stays with the song.
    if (suggested && songLang !== suggested) next = setMetaFields(next, { lang: suggested });
    useApp.getState().setText(next, { kind: 'edit' });
    useApp.getState().setVe({ verse });
    const placed = results.reduce((n, r) => n + r.result.placed.filter((p) => p.syllable).length, 0);
    const into = perBlock ? ` in verses ${verse + 1}–${verse + results.length}` : '';
    useApp.getState().notify(`${placed} syllable${placed === 1 ? '' : 's'} put on the notes${into}${extra ? ` — ${extra} more than there are notes, left out` : ''}.`);
    useApp.setState({ fillDraft: '' });
    close();
  };

  const noteLabel = (p: Pos) => findItem(song, p)?.sounds.map((s) => soundText(s)).join(' ') ?? '';
  const given = first ? first.placed.filter((p) => p.syllable).length : 0;
  const without = first ? first.placed.length - given : 0;

  return (
    <>
      <div className="modal-head">
        <h2>Fill lyrics from text</h2>
        <span className="muted small">One syllable a note</span>
        <button className="modal-x" onClick={close} aria-label="Close">×</button>
      </div>
      <div className="fill-grid">
        <div className="fill-left">
          <div className="fill-options">
            <label className="field">
              <span>Verse</span>
              <select value={verse} onChange={(e) => setVerse(Number(e.target.value))}>
                {Array.from({ length: count + 1 }, (_, k) => (
                  <option key={k} value={k}>
                    {k < count ? `Verse ${k + 1}` : `+ New verse (${k + 1})`}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>From</span>
              <select value={from} onChange={(e) => setFrom(e.target.value as 'selected' | 'start')}>
                {selected && <option value="selected">The selected note (bar {selected.m + 1})</option>}
                <option value="start">The first note</option>
              </select>
            </label>
          </div>
          <label className="field">
            <span>The words</span>
            <textarea
              autoFocus
              rows={7}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={'Twin-kle twin-kle lit-tle star\nhow I won-der what you are'}
              spellCheck={false}
            />
          </label>
          <p className="mi-hint fill-help">
            Hyphens split a word into syllables (<code>dar-ling</code>); <code>_</code> leaves a note without words, held from the syllable before. Two words on one note: join them with <code>~</code> (<code>ku~kan</code>);
            a real hyphen: <code>\-</code>. Lines don’t matter: the words go on note after note.
          </p>
          {blocks.length > 1 && (
            <label className="check fill-blocks">
              <input type="checkbox" checked={byBlocks} onChange={(e) => setByBlocks(e.target.checked)} />
              Each block (with an empty line between) is a verse of its own: verses {verse + 1}–{verse + blocks.length}
            </label>
          )}

          <div className="fill-tool">
            <span className="pb-head">Syllables (optional)</span>
            <div className="fill-tool-row">
              <select
                value={lang ?? ''}
                onChange={(e) => {
                  const v = (e.target.value || null) as Lang | null;
                  setLang(v);
                  if (v) rememberLang(v);
                }}
                aria-label="Language of the words"
              >
                <option value="">{text.trim() ? `Language: guess (${LANG_NAMES[usedLang]})` : 'Language: guess'}</option>
                <option value="en">English</option>
                <option value="id">Indonesian (Bahasa Indonesia)</option>
              </select>
              <button className="btn small" onClick={() => void suggest()} disabled={busy || !words.length} title={words.length ? 'Suggest where the words split into syllables (breaks you’ve put in stay, and hyphenated words like anak-anak are split further)' : 'Type or paste the words first'}>
                {busy ? 'Suggesting…' : 'Suggest syllable breaks'}
              </button>
            </div>
            {words.length > 0 && <WordBreaks words={words} toggle={toggle} remembered={LANG_NAMES[fixLang]} />}
          </div>
        </div>

        <section className="fill-preview" aria-labelledby="fill-preview-head">
          <span className="pb-head" id="fill-preview-head">
            On the notes{perBlock ? ` (verse ${verse + 1}; the others likewise)` : ''}
          </span>
          {first?.placed.length ? (
            <div className="fill-notes">
              {first.placed.slice(0, PREVIEW).map(({ pos, syllable }, k) => (
                <span key={k} className="fill-note">
                  <span className="fill-hole">{noteLabel(pos)}</span>
                  <span className={`fill-syl ${syllable ? '' : 'none'}`}>{syllable ?? '—'}</span>
                </span>
              ))}
            </div>
          ) : (
            <p className="muted small">Type or paste the words to see where they go.</p>
          )}
          {extra > 0 && (
            <p className="fill-extra small">
              {extra} syllable{extra === 1 ? '' : 's'} more than there are notes: left out.
            </p>
          )}
          {given > 0 && !extra && (
            <p className="muted small">
              {given} note{given === 1 ? '' : 's'} get words{without ? ` (${without} left without)` : ''}, replacing what’s there; the rest keep theirs.
            </p>
          )}
        </section>
      </div>
      <div className="modal-actions">
        <button className="btn ghost" onClick={close}>Cancel</button>
        <button className="btn primary" onClick={apply} disabled={!first?.placed.length}>
          Put on the notes
        </button>
      </div>
    </>
  );
}

/**
 * The words with the spaces between their letters to click: a break there or not. One stop
 * for the keyboard: the arrow keys go from space to space, Space or Enter sets it.
 */
function WordBreaks({ words, toggle, remembered }: { words: string[]; toggle: (form: string, at: number) => void; remembered: string }) {
  // Every space between two letters, in order.
  const gaps = useMemo(() => words.flatMap((form, wi) => [...breaksOf(form).word].slice(1).map((_, i) => ({ wi, at: i + 1 }))), [words]);
  const [current, setCurrent] = useState(0);
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const here = Math.min(current, gaps.length - 1);
  const go = (k: number) => {
    const g = gaps[Math.max(0, Math.min(gaps.length - 1, k))];
    if (!g) return;
    setCurrent(gaps.indexOf(g));
    refs.current.get(`${g.wi}:${g.at}`)?.focus();
  };
  return (
    <>
      <span className="mi-hint">Click between two letters to add or take away a break (arrow keys: from space to space). Your changes are remembered for {remembered}.</span>
      <div
        className="fill-words"
        role="group"
        aria-label="Words and their breaks"
        onKeyDown={(e) => {
          const k = { ArrowRight: here + 1, ArrowDown: here + 1, ArrowLeft: here - 1, ArrowUp: here - 1, Home: 0, End: gaps.length - 1 }[e.key];
          if (k === undefined) return;
          e.preventDefault();
          go(k);
        }}
      >
        {words.map((form, wi) => {
          const { word, cuts } = breaksOf(form);
          return (
            <span key={word.toLowerCase()} className="fill-word" aria-label={form}>
              {[...word].map((ch, i) => {
                const k = gaps.findIndex((g) => g.wi === wi && g.at === i);
                return (
                  <span key={i} className="fill-letter-wrap">
                    {i > 0 && (
                      <button
                        ref={(el) => {
                          if (el) refs.current.set(`${wi}:${i}`, el);
                          else refs.current.delete(`${wi}:${i}`);
                        }}
                        className={`fill-gap ${cuts.includes(i) ? 'on' : ''}`}
                        tabIndex={k === here ? 0 : -1}
                        aria-pressed={cuts.includes(i)}
                        aria-label={`${word}: break after ${word.slice(0, i)}`}
                        onFocus={() => setCurrent(k)}
                        onClick={() => toggle(form, i)}
                      />
                    )}
                    <span className="fill-letter" aria-hidden>{ch}</span>
                  </span>
                );
              })}
            </span>
          );
        })}
      </div>
    </>
  );
}
