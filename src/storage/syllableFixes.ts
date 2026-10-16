// Your corrections to suggested syllable breaks, a list per language, kept with your library
// (this browser's, or the account's: see userData.ts):
// once you've split "every" as "ev-er-y", that's how it's suggested from then on.

import type { Lang } from '../core/syllables';
import { readData, writeData } from './userData';

const KEY = 'harpforge:syllable-fixes';
const MAX = 3000;

type Fixes = Partial<Record<Lang, Record<string, string>>>;

function read(): Fixes {
  try {
    const v: unknown = JSON.parse(readData(KEY) ?? '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Fixes) : {};
  } catch {
    return {};
  }
}

/** A language's corrections: lowercased word → its form ("ev-er-y"). */
export function syllableFixes(lang: Lang): Record<string, string> {
  const list = read()[lang];
  return list && typeof list === 'object' ? list : {};
}

/** Remembers how a word is split (`form`: "ev-er-y"). */
export function saveSyllableFix(lang: Lang, form: string) {
  const all = read();
  const list = { ...all[lang] };
  const word = form.replace(/-/g, '').toLowerCase();
  if (!word) return;
  delete list[word];
  list[word] = form.toLowerCase();
  // (The oldest go first past the limit.)
  const entries = Object.entries(list).slice(-MAX);
  try {
    // (The server's told just this word: another device's newer fixes aren't undone by this list.)
    writeData(KEY, JSON.stringify({ ...all, [lang]: Object.fromEntries(entries) }), JSON.stringify({ [lang]: { [word]: form.toLowerCase() } }));
  } catch {
    /* storage full or unavailable: the correction applies only this time */
  }
}

const LANG_KEY = 'harpforge:lyrics-lang';

/** The language last chosen for suggestions (the guess when the words don't say). */
export function lastLang(): Lang | undefined {
  try {
    const v = localStorage.getItem(LANG_KEY);
    return v === 'en' || v === 'id' ? v : undefined;
  } catch {
    return undefined;
  }
}

export function rememberLang(lang: Lang) {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    /* not remembered: the guess falls back to English */
  }
}
