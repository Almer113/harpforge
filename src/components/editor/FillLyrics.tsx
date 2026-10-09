// "Fill lyrics from text": type or paste the words, see which syllable lands on which note,
// and put them on the notes in one go. Splitting words into syllables is up to you (hyphens:
// "dar-ling"); an optional tool suggests breaks for English or Indonesian, which you can
// click to correct before anything is put on the notes, and remembers your corrections.

import { useMemo, useState } from 'react';
import { fillLyrics, songVerseCount } from '../../core/edit/lyrics';
import { findItem, type Pos } from '../../core/edit/model';
import { setMetaFields } from '../../core/htab/meta';
import { soundText } from '../../core/htab/serializer';
import { applySuggestions, breaksOf, detectLang, LANG_NAMES, lyricWords, replaceWord, suggestBreaks, withBreaks, type Lang } from '../../core/syllables';
import { songText, currentSong } from '../../state/editor';
import { getParsed, useApp } from '../../state/store';
import { saveSyllableFix, syllableFixes } from '../../storage/syllableFixes';
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

const PREVIEW = 48;

function FillBody({ close }: { close: () => void }) {
  const song = useMemo(() => currentSong(), []);
  const selected = useApp((s) => s.ve.selection[0]);
  const count = songVerseCount(song);
  const [verse, setVerse] = useState(useApp((s) => s.ve.verse));
  const [from, setFrom] = useState<'selected' | 'start'>(selected ? 'selected' : 'start');
  const [text, setText] = useState('');
  // The syllable tool: its language (the song's, else a guess from the words), and whether it's been used.
  const songLang = useApp((s) => getParsed(s.text).doc.meta.extra.lang) as Lang | undefined;
  const [lang, setLang] = useState<Lang | null>(songLang === 'en' || songLang === 'id' ? songLang : null);
  // The language the last suggestions were made in (corrections are remembered in it).
  const [suggested, setSuggested] = useState<Lang | null>(null);
  const [busy, setBusy] = useState(false);

  const start: Pos | null = from === 'selected' && selected ? selected : null;
  const result = useMemo(() => fillLyrics(song, start, verse, text), [song, start, verse, text]);
  const words = useMemo(() => lyricWords(text), [text]);
  // (Guessed from the words as they'd be spoken: without the breaks.)
  const usedLang: Lang = lang ?? detectLang(text.replace(/-/g, ''));
  const fixLang: Lang = suggested ?? usedLang;

  const suggest = async () => {
    setBusy(true);
    try {
      const bare = words.filter((w) => !w.includes('-'));
      const map = await suggestBreaks(bare, usedLang, syllableFixes(usedLang));
      setText((t) => applySuggestions(t, map));
      setSuggested(usedLang);
    } catch {
      useApp.getState().notify('The syllable suggestions couldn’t be loaded. Check your connection, then try again.');
    } finally {
      setBusy(false);
    }
  };

  /** A click between two letters: a break there, or none; remembered for this language. */
  const toggle = (form: string, at: number) => {
    const { word, cuts } = breaksOf(form);
    const next = withBreaks(word, cuts.includes(at) ? cuts.filter((c) => c !== at) : [...cuts, at].sort((a, b) => a - b));
    setText((t) => replaceWord(t, form, next));
    saveSyllableFix(fixLang, next);
  };

  const apply = () => {
    let next = songText(result.song);
    // The language the suggestions were made in stays with the song.
    if (suggested && songLang !== suggested) next = setMetaFields(next, { lang: suggested });
    useApp.getState().setText(next, { kind: 'edit' });
    useApp.getState().setVe({ verse });
    const placed = result.placed.filter((p) => p.syllable).length;
    useApp.getState().notify(`${placed} syllable${placed === 1 ? '' : 's'} put on the notes${result.extra.length ? ` — ${result.extra.length} more than there are notes, left out` : ''}.`);
    close();
  };

  const noteLabel = (p: Pos) => findItem(song, p)?.sounds.map((s) => soundText(s)).join(' ') ?? '';
  const notesLeft = result.placed.length;

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
                    {k < count ? `Verse ${k + 1}` : `Verse ${k + 1} (new)`}
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
            Hyphens split a word into syllables (<code>dar-ling</code>); <code>_</code> leaves a note without words, held from the syllable before. Lines don’t matter: the words go on note after note.
          </p>

          <div className="fill-tool">
            <span className="pb-head">Syllables (optional)</span>
            <div className="fill-tool-row">
              <select value={lang ?? ''} onChange={(e) => setLang((e.target.value || null) as Lang | null)} aria-label="Language">
                <option value="">{text.trim() ? `Guess (${LANG_NAMES[usedLang]})` : 'Guess the language'}</option>
                <option value="en">English</option>
                <option value="id">Indonesian</option>
              </select>
              <button className="btn small" onClick={() => void suggest()} disabled={busy || !words.some((w) => !w.includes('-'))} title="Suggest where the words split into syllables (words you've hyphenated stay as they are)">
                {busy ? 'Suggesting…' : 'Suggest syllable breaks'}
              </button>
            </div>
            {suggested && (
              <>
                <span className="mi-hint">Click between two letters to add or take away a break. Your changes are remembered for {LANG_NAMES[fixLang]}.</span>
                <div className="fill-words" role="group" aria-label="Words and their breaks">
                  {words.map((form) => {
                    const { word, cuts } = breaksOf(form);
                    return (
                      <span key={form} className="fill-word">
                        {[...word].map((ch, i) => (
                          <span key={i} className="fill-letter-wrap">
                            {i > 0 && (
                              <button className={`fill-gap ${cuts.includes(i) ? 'on' : ''}`} onClick={() => toggle(form, i)} aria-label={`${cuts.includes(i) ? 'Join' : 'Split'} ${word} after "${word.slice(0, i)}"`} />
                            )}
                            <span className="fill-letter">{ch}</span>
                          </span>
                        ))}
                      </span>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="fill-preview" aria-label="Preview">
          <span className="pb-head">On the notes</span>
          {result.placed.length ? (
            <div className="fill-notes">
              {result.placed.slice(0, PREVIEW).map(({ pos, syllable }, k) => (
                <span key={k} className="fill-note">
                  <span className="fill-hole">{noteLabel(pos)}</span>
                  <span className={`fill-syl ${syllable ? '' : 'none'}`}>{syllable ?? '—'}</span>
                </span>
              ))}
              {result.placed.length > PREVIEW && <span className="muted small">… and {result.placed.length - PREVIEW} more</span>}
            </div>
          ) : (
            <p className="muted small">Type or paste the words to see where they go.</p>
          )}
          {result.extra.length > 0 && (
            <p className="fill-extra small">
              {result.extra.length} syllable{result.extra.length === 1 ? '' : 's'} more than there are notes ({result.extra.slice(0, 4).join(' ')}{result.extra.length > 4 ? '…' : ''}): left out.
            </p>
          )}
          {notesLeft > 0 && !result.extra.length && <p className="muted small">{notesLeft} note{notesLeft === 1 ? '' : 's'} get words; the rest keep theirs.</p>}
        </div>
      </div>
      <div className="modal-actions">
        <button className="btn ghost" onClick={close}>Cancel</button>
        <button className="btn primary" onClick={apply} disabled={!result.placed.length}>
          Put on the notes
        </button>
      </div>
    </>
  );
}
