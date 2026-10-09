// Suggested syllable breaks for lyrics (an optional tool: hyphens you type always win).
// Indonesian by its spelling rules, which follow how words sound; English by the hyphenation
// patterns word processors use (loaded only when asked for), adjusted for singing. Either way
// they're suggestions, shown to be corrected, and corrections are remembered.

export type Lang = 'en' | 'id';

export const LANG_NAMES: Record<Lang, string> = { en: 'English', id: 'Indonesian' };

const VOWELS = new Set('aeiouéèêàâáíóú');
const isVowel = (c: string) => VOWELS.has(c);

/**
 * An Indonesian word's syllables. ng, ny, sy and kh are one sound; ai, au, oi and ei stay
 * together at the end of a word or before a consonant that starts the next syllable
 * (pan-tai, sau-da-ra, but ma-in, la-ut); one consonant between vowels starts the next
 * syllable (ka-sih), of two or more the first ends the syllable before (ban-tu, in-stru-men).
 * Words with an apostrophe (t'lah, 'ku) are left whole.
 */
export function syllablesId(word: string): string[] {
  if (word.length < 3 || /['’]/.test(word)) return [word];
  const lower = word.toLowerCase();
  // Units: a letter, or a two-letter consonant sound.
  const units: { at: number; len: number; vowel: boolean }[] = [];
  for (let i = 0; i < lower.length; ) {
    const two = lower.slice(i, i + 2);
    if (['ng', 'ny', 'sy', 'kh'].includes(two)) {
      units.push({ at: i, len: 2, vowel: false });
      i += 2;
    } else {
      units.push({ at: i, len: 1, vowel: isVowel(lower[i]) });
      i++;
    }
  }
  // Vowel nuclei, as unit ranges [first, last].
  const nuclei: [number, number][] = [];
  for (let i = 0; i < units.length; i++) {
    if (!units[i].vowel) continue;
    const pair = lower.slice(units[i].at, units[i].at + 2);
    const next = units[i + 1];
    if (next?.vowel && ['ai', 'au', 'oi', 'ei'].includes(pair)) {
      const after = units[i + 2];
      const end = !after;
      const startsNext = !!after && !after.vowel && !!units[i + 3]?.vowel;
      if (end || startsNext) {
        nuclei.push([i, i + 1]);
        i++;
        continue;
      }
    }
    nuclei.push([i, i]);
  }
  if (nuclei.length < 2) return [word];
  // Where each syllable after the first starts (a unit index).
  const cuts: number[] = [];
  for (let k = 0; k + 1 < nuclei.length; k++) {
    const between = nuclei[k + 1][0] - nuclei[k][1] - 1;
    // (No consonant, or one: the next syllable starts right after this vowel; more: after the first.)
    cuts.push(nuclei[k][1] + (between <= 1 ? 1 : 2));
  }
  const out: string[] = [];
  let from = 0;
  for (const c of cuts) {
    const at = units[c].at;
    out.push(word.slice(from, at));
    from = at;
  }
  out.push(word.slice(from));
  return out;
}

/**
 * English, from the patterns' breaks: also a first vowel on its own before one consonant and
 * a vowel (a-bove, e-ven, o-pen), which word processors never split off but singers do
 * (not before a silent final e: use, ache, are).
 */
export function englishForSinging(word: string, parts: string[]): string[] {
  const lower = word.toLowerCase();
  const first = parts[0] ?? word;
  const vcv = lower.length >= 3 && isVowel(lower[0]) && !isVowel(lower[1]) && !'yw'.includes(lower[1]) && isVowel(lower[2]);
  // (A three-letter word ending in a silent e — "use", "are", "eve" — is one syllable.)
  const silentE = lower.length === 3 && lower[2] === 'e';
  if (vcv && !silentE && first.length >= 3) return [word.slice(0, 1), first.slice(1), ...parts.slice(1)];
  return parts;
}

const ID_WORDS = new Set('yang dan di ke dari ini itu aku kau engkau kamu dia kita kami tak tidak ada akan dengan untuk dalam pada tuhan hati cinta sayang selalu bagai seperti juga sudah telah lagi jangan mau bisa hanya kasih dunia hidup bersama'.split(' '));
const EN_WORDS = new Set('the and you i to of a in is it my me your we he she on for be this that with all love will are what when how so no oh do can not'.split(' '));

/** English or Indonesian, from the commonest little words in `text` (English when unsure). */
export function detectLang(text: string): Lang {
  let id = 0;
  let en = 0;
  for (const w of text.toLowerCase().split(/[^a-zà-ÿ']+/)) {
    if (ID_WORDS.has(w)) id++;
    if (EN_WORDS.has(w)) en++;
  }
  return id > en ? 'id' : 'en';
}

/** A word with breaks at `cuts` (letter positions), as "dar-ling". */
export function withBreaks(word: string, cuts: number[]): string {
  let out = '';
  for (let i = 0; i < word.length; i++) out += (cuts.includes(i) && i > 0 ? '-' : '') + word[i];
  return out;
}

/** "dar-ling" → the bare word and where its breaks are. */
export function breaksOf(form: string): { word: string; cuts: number[] } {
  const cuts: number[] = [];
  let word = '';
  for (const ch of form) {
    if (ch === '-') {
      if (word) cuts.push(word.length);
    } else word += ch;
  }
  return { word, cuts };
}

type Hyphenate = (word: string) => string[];
let english: Hyphenate | null = null;

/** The English patterns (loaded the first time they're needed). */
async function englishPatterns(): Promise<Hyphenate> {
  if (english) return english;
  const mod = (await import('hyphen/en-us')) as unknown as { hyphenateSync: (text: string, opts?: { hyphenChar?: string; minWordLength?: number }) => string };
  english = (word) => mod.hyphenateSync(word, { hyphenChar: '-', minWordLength: 3 }).split('-').filter(Boolean);
  return english;
}

/**
 * Suggested breaks for each word (bare words: letters, maybe an apostrophe), as "dar-ling".
 * `fixes` (lowercased word → its form) are your own corrections, used first.
 */
export async function suggestBreaks(words: string[], lang: Lang, fixes: Record<string, string> = {}): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const en = lang === 'en' ? await englishPatterns() : null;
  for (const word of words) {
    if (out.has(word)) continue;
    const fix = fixes[word.toLowerCase()];
    if (fix && breaksOf(fix).word === word.toLowerCase()) {
      out.set(word, withBreaks(word, breaksOf(fix).cuts));
      continue;
    }
    const parts = lang === 'id' ? syllablesId(word) : /['’]/.test(word) ? [word] : englishForSinging(word, en!(word));
    out.set(word, parts.join('-'));
  }
  return out;
}

const EDGE = /^([("'“‘¿¡]*)(.*?)([)"'”’.,!?;:…]*)$/u;

/**
 * The words of lyrics text, each once, in order ("dar-ling" as written): what the breaks can
 * be set on. Punctuation round a word isn't part of it; "_" and "*" aren't words.
 */
export function lyricWords(text: string): string[] {
  const out: string[] = [];
  for (const token of text.split(/\s+/)) {
    const core = EDGE.exec(token)?.[2] ?? token;
    if (!core || core === '_' || core === '*' || !/\p{L}/u.test(core)) continue;
    if (!out.includes(core)) out.push(core);
  }
  return out;
}

/** The text with every `from` (a whole word, punctuation round it kept) written as `to`. */
export function replaceWord(text: string, from: string, to: string): string {
  return text.replace(/\S+/g, (token) => {
    const m = EDGE.exec(token);
    return m && m[2] === from ? m[1] + to + m[3] : token;
  });
}

/** The text with each word that has no breaks yet given its suggested ones. */
export function applySuggestions(text: string, suggested: Map<string, string>): string {
  let out = text;
  for (const [word, form] of suggested) if (!word.includes('-') && form !== word) out = replaceWord(out, word, form);
  return out;
}
