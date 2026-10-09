// Your corrections to suggested syllable breaks, a list per language, kept in this browser:
// once you've split "every" as "ev-er-y", that's how it's suggested from then on.

import type { Lang } from '../core/syllables';

const KEY = 'harpforge:syllable-fixes';
const MAX = 3000;

type Fixes = Partial<Record<Lang, Record<string, string>>>;

function read(): Fixes {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
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
    localStorage.setItem(KEY, JSON.stringify({ ...all, [lang]: Object.fromEntries(entries) }));
  } catch {
    /* storage full or unavailable: the correction applies only this time */
  }
}
