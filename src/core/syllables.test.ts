// Phase 11d: suggested syllable breaks.

import { expect, it } from 'vitest';
import { breaksOf, detectLang, suggestBreaks, syllablesId, withBreaks } from './syllables';

it('Indonesian: by its spelling rules', () => {
  const split = (w: string) => syllablesId(w).join('-');
  expect(['kasih', 'tuhan', 'selamanya', 'dengan', 'bangun', 'mengapa', 'nyanyian', 'syair', 'khawatir'].map(split)).toEqual([
    'ka-sih',
    'tu-han',
    'se-la-ma-nya',
    'de-ngan',
    'ba-ngun',
    'me-nga-pa',
    'nya-nyi-an',
    'sya-ir',
    'kha-wa-tir',
  ]);
  // Diphthongs at the end, or before a consonant starting the next syllable; else two vowels.
  expect(['pantai', 'kalau', 'saudara', 'engkau', 'main', 'laut', 'daun', 'air', 'dia', 'doa'].map(split)).toEqual(['pan-tai', 'ka-lau', 'sau-da-ra', 'eng-kau', 'ma-in', 'la-ut', 'da-un', 'a-ir', 'di-a', 'do-a']);
  // Consonant clusters: the first ends the syllable before.
  expect(['bertemu', 'instrumen', 'Allah', 'bersama'].map(split)).toEqual(['ber-te-mu', 'in-stru-men', 'Al-lah', 'ber-sa-ma']);
  // Left whole: one syllable, short words, apostrophes.
  expect(['mau', 'ku', "t'lah", "'ku"].map(split)).toEqual(['mau', 'ku', "t'lah", "'ku"]);
});

it('English: the hyphenation patterns, with a first vowel on its own for singing', async () => {
  const s = await suggestBreaks(['above', 'even', 'open', 'again', 'beautiful', 'garden', 'use', 'are', 'star', 'Twinkle'], 'en');
  expect(s.get('above')).toBe('a-bove');
  expect(s.get('even')).toBe('e-ven');
  expect(s.get('open')).toBe('o-pen');
  expect(s.get('again')).toBe('a-gain');
  expect(s.get('beautiful')).toBe('beau-ti-ful');
  expect(s.get('garden')).toBe('gar-den');
  expect(s.get('use')).toBe('use');
  expect(s.get('are')).toBe('are');
  expect(s.get('star')).toBe('star');
  expect(s.get('Twinkle')).toBe('Twin-kle');
});

it('your corrections come first, kept as the word is written', async () => {
  const s = await suggestBreaks(['Every', 'kasih'], 'en', { every: 'ev-er-y' });
  expect(s.get('Every')).toBe('Ev-er-y');
  expect((await suggestBreaks(['Kasih'], 'id')).get('Kasih')).toBe('Ka-sih');
});

it('guesses the language from the little words', () => {
  expect(detectLang('Kasih Tuhan selalu ada untuk kita')).toBe('id');
  expect(detectLang('Twinkle twinkle little star, how I wonder what you are')).toBe('en');
  expect(detectLang('')).toBe('en');
});

it('breaks as positions and back', () => {
  expect(breaksOf('dar-ling')).toEqual({ word: 'darling', cuts: [3] });
  expect(withBreaks('darling', [3, 5])).toBe('dar-li-ng');
  expect(withBreaks('darling', [])).toBe('darling');
});

it('finds the words of lyrics text, and rewrites one wherever it is', async () => {
  const text = 'Up a-bove the world, so high! _ (the) * world';
  expect((await import('./syllables')).lyricWords(text)).toEqual(['Up', 'a-bove', 'the', 'world', 'so', 'high']);
  const { replaceWord, applySuggestions } = await import('./syllables');
  expect(replaceWord(text, 'world', 'wor-ld')).toBe('Up a-bove the wor-ld, so high! _ (the) * wor-ld');
  expect(applySuggestions('the darling, darling', new Map([['darling', 'dar-ling']]))).toBe('the dar-ling, dar-ling');
});
